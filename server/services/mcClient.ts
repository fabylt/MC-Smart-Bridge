import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ConvertedRecipe, McSessionStatus } from '../../src/shared/types';
import {
  buildMonsieurCuisinePayload,
  normalizeMcLocale,
  type McRecipeCreationGuide,
  type MonsieurCuisineApiPayload,
  type SupportedMcLocale,
} from '../lib/mcPayload';
import { ensureDataDirs } from './db';

export interface StoredCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number; // epoch seconds
  httpOnly?: boolean;
  secure?: boolean;
}

export interface PersistedMcSession {
  email: string | null;
  baseUrl: string;
  cookies: StoredCookie[];
  csrfToken?: string | null;
  bearerToken?: string | null;
  savedAt: string;
  expiresAt: string | null;
  source: 'direct_login' | 'imported_json';
  lastError?: string | null;
}

export interface RemoteMcRecipeSummary {
  id: string;
  title: string;
  url: string;
  updatedAt?: string;
}

export interface McProxyCallResult {
  ok: boolean;
  httpStatus: number;
  code?: number;
  message?: string;
  data?: unknown;
  raw?: unknown;
}

// Verified reverse-engineered headers & constants from gerkensm/smart-recipe & Unofficial-Monsieur-Cuisine-MCP
export const DEFAULT_MC_BASE_URL = 'https://www.monsieur-cuisine.com';
export const DEFAULT_MC_PROXY_BYPASS = 'cd844315-77c4-46ba-83fe-7702d13b12b2';
const MC_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CREATE_RECIPE_PATHS: Record<SupportedMcLocale, string> = {
  'it-IT': '/it/create-recipe?devices=mc-smart',
  'de-DE': '/de/create-recipe?devices=mc-smart',
  'fr-FR': '/fr/creer-une-recette?devices=mc-smart',
  'en-US': '/en/create-recipe?devices=mc-smart',
  'pl-PL': '/pl/create-recipe?devices=mc-smart',
  'cs-CZ': '/cs/vytvorit-recept?devices=mc-smart',
};

export function createMcRecipePageUrl(
  localeInput?: string,
  baseUrlInput?: string,
  recipeId?: string | number
): string {
  const baseUrl = (baseUrlInput || getMcBaseUrl()).replace(/\/+$/, '');
  const locale = normalizeMcLocale(localeInput || getMcLocale());
  const url = new URL(`${baseUrl}${CREATE_RECIPE_PATHS[locale]}`);
  if (recipeId !== undefined && recipeId !== null && String(recipeId).trim() !== '') {
    url.searchParams.set('recipe-id', String(recipeId));
  }
  return url.toString();
}

const guideCache = new Map<string, { expiresAt: number; guide: McRecipeCreationGuide }>();

/**
 * Fetches live locale-specific category & complexity IDs directly from
 * `POST {baseUrl}/wp-admin/admin-ajax.php` (`action=load_recipe_post`),
 * matching the official Monsieur Cuisine web form so category IDs never mismatch by locale.
 */
export async function fetchMcRecipeCreationGuide(
  options: { baseUrl: string; locale: SupportedMcLocale; cookies: StoredCookie[] },
  fetchImpl: typeof fetch = fetch
): Promise<McRecipeCreationGuide | null> {
  const cacheKey = `${options.baseUrl}|${options.locale}`;
  const cached = guideCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.guide;
  }

  try {
    const langPrefix = options.locale.split('-')[0].toLowerCase() || 'it';
    const resp = await fetchImpl(`${options.baseUrl}/wp-admin/admin-ajax.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': options.locale,
        Origin: options.baseUrl,
        Referer: `${options.baseUrl}/${langPrefix}/create-recipe`,
        'User-Agent': MC_BROWSER_USER_AGENT,
        Cookie: buildMcCookieHeader(options.cookies, options.locale),
      },
      body: 'action=load_recipe_post',
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return null;
    const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    const guideObj =
      json?.guide && typeof json.guide === 'object'
        ? (json.guide as Record<string, unknown>)
        : null;
    if (!guideObj) return null;

    const rawCats = Array.isArray(guideObj.category_options) ? guideObj.category_options : [];
    const rawLevels = Array.isArray(guideObj.level_options) ? guideObj.level_options : [];

    const categories = rawCats
      .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
      .map((c) => ({ id: Number(c.id), name: String(c.name || '').trim() }))
      .filter((c) => Number.isInteger(c.id) && c.id > 0 && c.name.length > 0);

    const complexityLevels = rawLevels
      .filter((l): l is Record<string, unknown> => Boolean(l && typeof l === 'object'))
      .map((l) => ({ id: Number(l.id), name: String(l.name || '').trim() }))
      .filter((l) => Number.isInteger(l.id) && l.id > 0 && l.name.length > 0);

    if (categories.length === 0) return null;

    const guide: McRecipeCreationGuide = {
      locale: options.locale,
      categories,
      complexityLevels,
    };
    guideCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60 * 1000, guide });
    return guide;
  } catch {
    return null;
  }
}

function getSessionFilePath(): string {
  const { dataDir } = ensureDataDirs();
  return path.resolve(dataDir, 'mc_session.json');
}

export function getMcBaseUrl(): string {
  const configured = (process.env.MC_BASE_URL || DEFAULT_MC_BASE_URL).trim();
  return configured.replace(/\/+$/, '');
}

export function getMcLocale(): SupportedMcLocale {
  return normalizeMcLocale(process.env.MC_LOCALE || 'it-IT');
}

export function readPersistedMcSession(): PersistedMcSession | null {
  const filePath = getSessionFilePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as PersistedMcSession;
    if (!parsed || !Array.isArray(parsed.cookies)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistedMcSession(session: PersistedMcSession): void {
  const filePath = getSessionFilePath();
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function hasRequiredMcSessionCookies(cookies: StoredCookie[]): {
  hasWordpressLogin: boolean;
  hasLidlSsoToken: boolean;
  hasAnySessionCookie: boolean;
} {
  const hasWordpressLogin = cookies.some((c) => c.name.startsWith('wordpress_logged_in_'));
  const hasLidlSsoToken = cookies.some((c) => c.name === 'lidl_sso_id_token');
  return {
    hasWordpressLogin,
    hasLidlSsoToken,
    hasAnySessionCookie: hasWordpressLogin || hasLidlSsoToken,
  };
}

export function getMcSessionStatus(): McSessionStatus {
  const session = readPersistedMcSession();
  if (!session || session.cookies.length === 0) {
    return {
      authenticated: false,
      expired: false,
      email: (process.env.MC_EMAIL || '').trim() || null,
      cookieCount: 0,
      savedAt: null,
      expiresAt: null,
      source: 'none',
      lastError: session?.lastError ?? null,
    };
  }

  const nowMs = Date.now();
  const expired = session.expiresAt ? new Date(session.expiresAt).getTime() <= nowMs : false;
  const check = hasRequiredMcSessionCookies(session.cookies);

  return {
    authenticated: !expired && check.hasAnySessionCookie,
    expired,
    email: session.email || (process.env.MC_EMAIL || '').trim() || null,
    cookieCount: session.cookies.length,
    savedAt: session.savedAt,
    expiresAt: session.expiresAt,
    source: session.source,
    lastError:
      session.lastError ??
      (!check.hasAnySessionCookie
        ? 'I cookie salvati non contengono wordpress_logged_in_* o lidl_sso_id_token (richiesti da /proxy-api).'
        : null),
  };
}

function parseSetCookieHeaders(headers: Headers): StoredCookie[] {
  const cookies: StoredCookie[] = [];
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const rawList: string[] =
    typeof getSetCookie === 'function'
      ? getSetCookie.call(headers)
      : headers.get('set-cookie')
        ? [headers.get('set-cookie')!]
        : [];

  for (const raw of rawList) {
    const segments = raw.split(';').map((s) => s.trim());
    if (!segments[0]) continue;
    const eq = segments[0].indexOf('=');
    if (eq <= 0) continue;
    const name = segments[0].slice(0, eq).trim();
    const value = segments[0].slice(eq + 1).trim();
    const cookie: StoredCookie = { name, value, path: '/' };

    for (const attr of segments.slice(1)) {
      const [k, ...rest] = attr.split('=');
      const key = k.trim().toLowerCase();
      const val = rest.join('=').trim();
      if (key === 'domain') cookie.domain = val;
      if (key === 'path') cookie.path = val;
      if (key === 'httponly') cookie.httpOnly = true;
      if (key === 'secure') cookie.secure = true;
      if (key === 'max-age' && !Number.isNaN(Number(val))) {
        cookie.expires = Math.floor(Date.now() / 1000) + Number(val);
      }
      if (key === 'expires') {
        const ts = Date.parse(val);
        if (!Number.isNaN(ts)) cookie.expires = Math.floor(ts / 1000);
      }
    }
    cookies.push(cookie);
  }
  return cookies;
}

function mergeCookies(existing: StoredCookie[], incoming: StoredCookie[]): StoredCookie[] {
  const map = new Map<string, StoredCookie>();
  for (const c of existing) map.set(c.name, c);
  for (const c of incoming) map.set(c.name, c);
  return Array.from(map.values());
}

function domainMatchesMc(domain?: string): boolean {
  if (!domain) return true;
  const cleaned = domain.replace(/^\./, '').toLowerCase();
  return cleaned === 'monsieur-cuisine.com' || cleaned.endsWith('.monsieur-cuisine.com');
}

export function buildMcCookieHeader(cookies: StoredCookie[], locale: SupportedMcLocale): string {
  const langPrefix = locale.split('-')[0].toLowerCase() || 'it';
  const filtered = cookies.filter((c) => domainMatchesMc(c.domain));
  const pairs = filtered.map((c) => `${c.name}=${c.value}`);
  if (!filtered.some((c) => c.name === 'wp-wpml_current_language')) {
    pairs.unshift(`wp-wpml_current_language=${langPrefix}`);
  }
  return pairs.join('; ');
}

function computeSessionExpiry(cookies: StoredCookie[]): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const authExpiries = cookies
    .filter(
      (c) =>
        (c.name.startsWith('wordpress_logged_in_') || c.name === 'lidl_sso_id_token') &&
        typeof c.expires === 'number' &&
        c.expires > nowSec
    )
    .map((c) => c.expires!);

  if (authExpiries.length > 0) {
    return new Date(Math.max(...authExpiries) * 1000).toISOString();
  }

  const allFuture = cookies
    .map((c) => c.expires)
    .filter((e): e is number => typeof e === 'number' && e > nowSec);
  if (allFuture.length > 0) {
    return new Date(Math.max(...allFuture) * 1000).toISOString();
  }

  // Rolling 7-day estimate for session cookies without explicit expiry
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Parses cookies from any of these user-supplied formats:
 *  1. MC Smart Bridge backup JSON ({ email, cookies: [...] })
 *  2. Cookie-Editor / browser extension JSON array ([{ name, value, domain, ... }])
 *  3. Playwright storage_state.json ({ cookies: [...], origins: [...] })
 *  4. Plain JSON object ({ "wordpress_logged_in_...": "...", "lidl_sso_id_token": "..." })
 *  5. Raw browser Cookie header string ("wordpress_logged_in_...=...; lidl_sso_id_token=...")
 */
export function parseCookiesFromFlexibleInput(rawInput: string): {
  cookies: StoredCookie[];
  emailHint: string | null;
  error?: string;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      cookies: [],
      emailHint: null,
      error: 'Inserisci il JSON dei cookie oppure la stringa dell’header Cookie.',
    };
  }

  // Try JSON formats first if input looks like JSON
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      let emailHint: string | null = null;
      let rawArray: unknown[] | null = null;

      if (Array.isArray(parsed)) {
        rawArray = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.email === 'string' && obj.email.trim()) {
          emailHint = obj.email.trim();
        }
        if (Array.isArray(obj.cookies)) {
          rawArray = obj.cookies;
        } else {
          const mapped: StoredCookie[] = Object.entries(obj)
            .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
            .map(([name, value]) => ({
              name: name.trim(),
              value: String(value).trim(),
              domain: '.monsieur-cuisine.com',
              path: '/',
              secure: true,
            }));
          if (mapped.length > 0) {
            return { cookies: mapped, emailHint };
          }
        }
      }

      if (rawArray) {
        const mapped = rawArray
          .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
          .map((c) => {
            const rawExp =
              typeof c.expirationDate === 'number'
                ? Math.floor(c.expirationDate)
                : typeof c.expires === 'number' && c.expires > 0
                  ? Math.floor(c.expires)
                  : undefined;
            return {
              name: String(c.name || '').trim(),
              value: String(c.value || '').trim(),
              domain: typeof c.domain === 'string' ? c.domain : '.monsieur-cuisine.com',
              path: typeof c.path === 'string' ? c.path : '/',
              expires: rawExp,
              httpOnly: Boolean(c.httpOnly),
              secure: Boolean(c.secure ?? true),
            };
          })
          .filter((c) => c.name.length > 0 && c.value.length > 0 && domainMatchesMc(c.domain));

        return {
          cookies: mapped,
          emailHint,
          error:
            mapped.length === 0
              ? 'Nessun cookie valido per monsieur-cuisine.com trovato nel JSON.'
              : undefined,
        };
      }
    } catch {
      return {
        cookies: [],
        emailHint: null,
        error:
          'JSON non valido. Incolla un export Cookie-Editor/backup JSON oppure una stringa Cookie (nome=valore; ...).',
      };
    }
  }

  // Fallback: Raw HTTP Cookie header string (e.g. "Cookie: a=1; b=2" or "a=1; b=2")
  const headerBody = trimmed.replace(/^cookie\s*:\s*/i, '');
  const cookies: StoredCookie[] = [];
  for (const part of headerBody.split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    const name = seg.slice(0, eq).trim();
    const value = seg.slice(eq + 1).trim();
    if (!name || !value) continue;
    cookies.push({
      name,
      value,
      domain: '.monsieur-cuisine.com',
      path: '/',
      secure: true,
    });
  }

  if (cookies.length === 0) {
    return {
      cookies: [],
      emailHint: null,
      error:
        'Formato cookie non riconosciuto. Incolla JSON da Cookie-Editor oppure l’header Cookie da DevTools (wordpress_logged_in_...=...; lidl_sso_id_token=...).',
    };
  }

  return { cookies, emailHint: null };
}

/**
 * Calls the real Monsieur Cuisine same-origin `/proxy-api` gateway:
 *   POST https://www.monsieur-cuisine.com/proxy-api
 *   Body: { endpoint, method, lang, payload? }
 */
export async function callMcProxy(
  options: {
    baseUrl?: string;
    locale?: SupportedMcLocale;
    cookies: StoredCookie[];
    endpoint: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    payload?: unknown;
    referer?: string;
    timeoutMs?: number;
  },
  fetchImpl: typeof fetch = fetch
): Promise<McProxyCallResult> {
  const baseUrl = (options.baseUrl || getMcBaseUrl()).replace(/\/+$/, '');
  const locale = options.locale || getMcLocale();
  const method = options.method || 'GET';
  const referer = options.referer || createMcRecipePageUrl(locale, baseUrl);
  const proxyBypass = (process.env.MC_PROXY_BYPASS || DEFAULT_MC_PROXY_BYPASS).trim();

  const body: Record<string, unknown> = {
    endpoint: options.endpoint,
    method,
    lang: locale,
  };
  if (options.payload !== undefined) {
    body.payload = options.payload;
  }

  const resp = await fetchImpl(`${baseUrl}/proxy-api`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': locale,
      'Content-Type': 'application/json',
      'User-Agent': MC_BROWSER_USER_AGENT,
      'X-Request-ID': randomUUID(),
      'x-bypass-cdn': proxyBypass,
      'device-type': 'web',
      Origin: baseUrl,
      Referer: referer,
      Cookie: buildMcCookieHeader(options.cookies, locale),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
  });

  const text = await resp.text().catch(() => '');
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  const apiCode = typeof record?.code === 'number' ? record.code : undefined;
  const apiMessage = typeof record?.message === 'string' ? record.message : undefined;

  if (!resp.ok) {
    return {
      ok: false,
      httpStatus: resp.status,
      code: apiCode,
      message: apiMessage,
      data: record?.data,
      raw: parsed,
    };
  }

  if (apiCode !== undefined && apiCode !== 0) {
    return {
      ok: false,
      httpStatus: resp.status,
      code: apiCode,
      message: apiMessage || `Errore API Monsieur Cuisine (codice ${apiCode})`,
      data: record?.data,
      raw: parsed,
    };
  }

  return {
    ok: true,
    httpStatus: resp.status,
    code: apiCode,
    message: apiMessage,
    data: record?.data ?? parsed,
    raw: parsed,
  };
}

/**
 * Verifies the persisted Monsieur Cuisine session against `GET api/v1/users` via `/proxy-api`.
 */
export async function verifyMcSession(
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; status: McSessionStatus; userId?: string; message: string }> {
  const session = readPersistedMcSession();
  if (!session || session.cookies.length === 0) {
    return {
      ok: false,
      status: getMcSessionStatus(),
      message: 'Nessuna sessione Monsieur Cuisine salvata. Incolla i cookie dal browser o effettua il login.',
    };
  }

  const check = hasRequiredMcSessionCookies(session.cookies);
  if (!check.hasAnySessionCookie) {
    const msg =
      'Mancano i cookie di sessione richiesti (wordpress_logged_in_* e lidl_sso_id_token). Assicurati di esportarli da www.monsieur-cuisine.com dopo aver fatto accesso.';
    writePersistedMcSession({ ...session, lastError: msg });
    return { ok: false, status: getMcSessionStatus(), message: msg };
  }

  try {
    const result = await callMcProxy(
      {
        baseUrl: session.baseUrl || getMcBaseUrl(),
        locale: getMcLocale(),
        cookies: session.cookies,
        endpoint: 'api/v1/users',
        method: 'GET',
        timeoutMs: 12000,
      },
      fetchImpl
    );

    if (!result.ok) {
      const detail = result.message
        ? `${result.message}${result.code ? ` (code ${result.code})` : ''}`
        : `HTTP ${result.httpStatus}`;
      const msg =
        result.httpStatus === 401 || result.httpStatus === 403
          ? `Sessione Monsieur Cuisine rifiutata (${detail}). I cookie potrebbero essere scaduti o incompleti (servono wordpress_logged_in_* e lidl_sso_id_token).`
          : `Verifica sessione MC fallita (${detail}).`;
      writePersistedMcSession({ ...session, lastError: msg });
      return { ok: false, status: getMcSessionStatus(), message: msg };
    }

    const dataObj =
      result.data && typeof result.data === 'object'
        ? (result.data as Record<string, unknown>)
        : null;
    const userObj =
      dataObj?.user && typeof dataObj.user === 'object'
        ? (dataObj.user as Record<string, unknown>)
        : dataObj;
    const userId = userObj?.id !== undefined ? String(userObj.id) : undefined;

    writePersistedMcSession({ ...session, lastError: null });
    return {
      ok: true,
      status: getMcSessionStatus(),
      userId,
      message: userId
        ? `Sessione Monsieur Cuisine verificata e attiva su /proxy-api (Account ID: ${userId}).`
        : 'Sessione Monsieur Cuisine verificata e attiva su /proxy-api.',
    };
  } catch (err) {
    const errText = err instanceof Error ? err.message : 'errore di rete';
    const msg = `Impossibile verificare la sessione su monsieur-cuisine.com (${errText}).`;
    writePersistedMcSession({ ...session, lastError: msg });
    return { ok: false, status: getMcSessionStatus(), message: msg };
  }
}

/**
 * Initiates the real Monsieur Cuisine SSO flow:
 *   GET {baseUrl}/{lang}/sso/login?redirect_uri={baseUrl}/{lang}/create-recipe
 * and attempts credential submission on accounts.lidl.com.
 *
 * Note: accounts.lidl.com uses Akamai Bot Manager / CAPTCHA / optional 2FA on datacenter IPs;
 * when blocked, this returns an explicit diagnostic guiding the user to paste browser cookies.
 */
export async function loginMonsieurCuisineDirect(
  emailInput?: string,
  passwordInput?: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; status: McSessionStatus; message: string }> {
  const email = (emailInput || process.env.MC_EMAIL || '').trim();
  const password = (passwordInput || process.env.MC_PASSWORD || '').trim();
  const baseUrl = getMcBaseUrl();
  const locale = getMcLocale();
  const localePath = locale.split('-')[0].toLowerCase() || 'it';

  if (!email || !password) {
    return {
      ok: false,
      status: getMcSessionStatus(),
      message:
        'Inserisci MC_EMAIL e MC_PASSWORD nelle Impostazioni oppure importa i cookie dal browser.',
    };
  }

  let mcCookies: StoredCookie[] = [];
  let lidlCookies: StoredCookie[] = [];

  try {
    // Step 1: Real MC SSO initiation endpoint (returns PHPSESSID + 302 to accounts.lidl.com)
    const redirectUri = `${baseUrl}/${localePath}/create-recipe`;
    const ssoUrl = `${baseUrl}/${localePath}/sso/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
    const initResp = await fetchImpl(ssoUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': MC_BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': `${locale},${localePath};q=0.9`,
      },
      signal: AbortSignal.timeout(12000),
    });

    mcCookies = mergeCookies(mcCookies, parseSetCookieHeaders(initResp.headers));
    const lidlLocation = initResp.headers.get('location');

    if (!lidlLocation) {
      const msg = `Endpoint SSO di monsieur-cuisine.com non ha restituito il redirect Lidl (HTTP ${initResp.status}). Usa "Importa Cookie" dal browser come metodo immediato.`;
      return { ok: false, status: getMcSessionStatus(), message: msg };
    }

    // Step 2: Follow authorize redirect to accounts.lidl.com login page
    let currentUrl = new URL(lidlLocation, baseUrl).toString();
    let html = '';
    let lastStatus = initResp.status;

    for (let hop = 0; hop < 5; hop++) {
      const targetHost = new URL(currentUrl).hostname;
      const isMc = domainMatchesMc(targetHost);
      const r = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': MC_BROWSER_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': `${locale},${localePath};q=0.9`,
          Cookie: (isMc ? mcCookies : lidlCookies).map((c) => `${c.name}=${c.value}`).join('; '),
        },
        signal: AbortSignal.timeout(12000),
      });
      lastStatus = r.status;
      const incoming = parseSetCookieHeaders(r.headers);
      if (isMc) mcCookies = mergeCookies(mcCookies, incoming);
      else lidlCookies = mergeCookies(lidlCookies, incoming);

      const nextLoc = r.headers.get('location');
      if (nextLoc && r.status >= 300 && r.status < 400) {
        currentUrl = new URL(nextLoc, currentUrl).toString();
        continue;
      }
      html = await r.text().catch(() => '');
      break;
    }

    // Check if Akamai / bot protection / JS-only SPA blocked the HTTP login form
    const tokenMatch =
      html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i) ||
      html.match(/value=["']([^"']+)["'][^>]*name=["']__RequestVerificationToken["']/i);
    const formActionMatch = html.match(/<form[^>]+action=["']([^"']+)["']/i);

    if (lastStatus === 403 || !tokenMatch || !formActionMatch) {
      const reason =
        lastStatus === 403
          ? 'Lidl (accounts.lidl.com) ha bloccato il login automatico dal server con protezione anti-bot Akamai (HTTP 403).'
          : 'Il portale accounts.lidl.com richiede l’esecuzione JavaScript / verifica anti-bot nel browser per il login Lidl Plus.';
      const msg = `${reason} Per collegare subito il cloud, accedi a www.monsieur-cuisine.com dal tuo browser e incolla i cookie (Cookie-Editor JSON o header Cookie) nel riquadro qui sotto.`;
      const existing = readPersistedMcSession();
      if (existing) {
        writePersistedMcSession({ ...existing, lastError: msg });
      }
      return { ok: false, status: getMcSessionStatus(), message: msg };
    }

    // Attempt form submission if IdentityServer returned a standard server-rendered form
    const postUrl = new URL(formActionMatch[1].replace(/&amp;/g, '&'), currentUrl).toString();
    const formParams = new URLSearchParams({
      __RequestVerificationToken: tokenMatch[1],
      Email: email,
      email,
      Password: password,
      password,
    });

    const postResp = await fetchImpl(postUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'User-Agent': MC_BROWSER_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,*/*',
        Origin: new URL(postUrl).origin,
        Referer: currentUrl,
        Cookie: lidlCookies.map((c) => `${c.name}=${c.value}`).join('; '),
      },
      body: formParams.toString(),
      signal: AbortSignal.timeout(12000),
    });

    lidlCookies = mergeCookies(lidlCookies, parseSetCookieHeaders(postResp.headers));
    let callbackUrl = postResp.headers.get('location')
      ? new URL(postResp.headers.get('location')!, postUrl).toString()
      : null;

    for (let hop = 0; hop < 8 && callbackUrl; hop++) {
      const targetHost = new URL(callbackUrl).hostname;
      const isMc = domainMatchesMc(targetHost);
      const r = await fetchImpl(callbackUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': MC_BROWSER_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,*/*',
          Cookie: (isMc ? mcCookies : lidlCookies).map((c) => `${c.name}=${c.value}`).join('; '),
        },
        signal: AbortSignal.timeout(12000),
      });
      const incoming = parseSetCookieHeaders(r.headers);
      if (isMc) mcCookies = mergeCookies(mcCookies, incoming);
      else lidlCookies = mergeCookies(lidlCookies, incoming);

      const nextLoc = r.headers.get('location');
      if (nextLoc && r.status >= 300 && r.status < 400) {
        callbackUrl = new URL(nextLoc, callbackUrl).toString();
      } else {
        callbackUrl = null;
      }
    }

    const check = hasRequiredMcSessionCookies(mcCookies);
    if (!check.hasAnySessionCookie) {
      const msg =
        'Lidl Plus non ha completato il redirect SSO automatico (richiede verifica 2FA/CAPTCHA o login interattivo dal browser). Accedi su www.monsieur-cuisine.com dal browser e incolla i cookie qui sotto.';
      return { ok: false, status: getMcSessionStatus(), message: msg };
    }

    const session: PersistedMcSession = {
      email,
      baseUrl,
      cookies: mcCookies,
      savedAt: new Date().toISOString(),
      expiresAt: computeSessionExpiry(mcCookies),
      source: 'direct_login',
      lastError: null,
    };
    writePersistedMcSession(session);
    return await verifyMcSession(fetchImpl);
  } catch (err) {
    const message =
      err instanceof Error
        ? `Connessione SSO a monsieur-cuisine.com non riuscita (${err.message}). Usa "Importa Cookie" dal browser come fallback immediato.`
        : 'Errore imprevisto durante il login SSO su monsieur-cuisine.com.';
    return {
      ok: false,
      status: getMcSessionStatus(),
      message,
    };
  }
}

/**
 * Imports cookies from JSON or raw Cookie header string, persists to data/mc_session.json,
 * and immediately verifies them against `GET api/v1/users` via `/proxy-api`.
 */
export async function importMcCookiesFromInput(
  rawInput: string,
  emailFallback?: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; verified: boolean; status: McSessionStatus; message: string }> {
  const parsed = parseCookiesFromFlexibleInput(rawInput);
  if (parsed.error || parsed.cookies.length === 0) {
    return {
      ok: false,
      verified: false,
      status: getMcSessionStatus(),
      message: parsed.error || 'Nessun cookie valido trovato.',
    };
  }

  const email = (parsed.emailHint || emailFallback || process.env.MC_EMAIL || '').trim() || null;
  const check = hasRequiredMcSessionCookies(parsed.cookies);

  const session: PersistedMcSession = {
    email,
    baseUrl: getMcBaseUrl(),
    cookies: parsed.cookies,
    savedAt: new Date().toISOString(),
    expiresAt: computeSessionExpiry(parsed.cookies),
    source: 'imported_json',
    lastError: null,
  };
  writePersistedMcSession(session);

  if (!check.hasAnySessionCookie) {
    const warning =
      `Salvati ${parsed.cookies.length} cookie, ma mancano wordpress_logged_in_* e lidl_sso_id_token: assicurati di aver fatto login su www.monsieur-cuisine.com prima di esportarli.`;
    writePersistedMcSession({ ...session, lastError: warning });
    return {
      ok: false,
      verified: false,
      status: getMcSessionStatus(),
      message: warning,
    };
  }

  const verification = await verifyMcSession(fetchImpl);
  return {
    ok: verification.ok,
    verified: verification.ok,
    status: verification.status,
    message: verification.ok
      ? `Importati ${parsed.cookies.length} cookie e verificati sul cloud Monsieur Cuisine! ${verification.message}`
      : `Importati ${parsed.cookies.length} cookie, ma verifica cloud fallita: ${verification.message}`,
  };
}

export function exportMcSessionBackup(): PersistedMcSession | null {
  return readPersistedMcSession();
}

function sanitizeHttpUrl(candidate: unknown, fallback: string): string {
  if (typeof candidate !== 'string' || !candidate.trim()) return fallback;
  try {
    const parsed = new URL(candidate.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // Fall back to constructed URL
  }
  return fallback;
}

/**
 * Fetches personal cloud recipes (draft + private-publish) via the real `/proxy-api`
 * endpoint `GET api/v3/auth/user/recipes` for remote anti-duplicate checking.
 */
export async function fetchRemoteMcPersonalRecipes(
  fetchImpl: typeof fetch = fetch
): Promise<{
  checked: boolean;
  recipes: RemoteMcRecipeSummary[];
  error?: string;
}> {
  const session = readPersistedMcSession();
  const status = getMcSessionStatus();
  if (!session || !status.authenticated) {
    return {
      checked: false,
      recipes: [],
      error:
        'Sessione Monsieur Cuisine non attiva: controllo remoto saltato (attivo solo SQLite locale).',
    };
  }

  const baseUrl = session.baseUrl || getMcBaseUrl();
  const locale = getMcLocale();

  try {
    const params = new URLSearchParams();
    params.set('size', '100');
    params.set('page', '1');
    params.append('filters[status][]', 'draft');
    params.append('filters[status][]', 'private-publish');

    const res = await callMcProxy(
      {
        baseUrl,
        locale,
        cookies: session.cookies,
        endpoint: `api/v3/auth/user/recipes?${params.toString()}`,
        method: 'GET',
        timeoutMs: 12000,
      },
      fetchImpl
    );

    if (!res.ok) {
      const detail = res.message
        ? `${res.message}${res.code ? ` (code ${res.code})` : ''}`
        : `HTTP ${res.httpStatus}`;
      return {
        checked: false,
        recipes: [],
        error: `Impossibile leggere le ricette remote su monsieur-cuisine.com (${detail}).`,
      };
    }

    const dataObj =
      res.data && typeof res.data === 'object' ? (res.data as Record<string, unknown>) : null;
    const rawItems = Array.isArray(dataObj?.recipes)
      ? dataObj.recipes
      : Array.isArray(res.data)
        ? res.data
        : [];

    const mapped: RemoteMcRecipeSummary[] = rawItems
      .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
      .map((r) => {
        const id = String(r.id || r.recipeId || '');
        const title = String(r.title || r.name || '').trim();
        const fallbackUrl = createMcRecipePageUrl(locale, baseUrl, id);
        return {
          id,
          title,
          url: sanitizeHttpUrl(r.url, fallbackUrl),
          updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined,
        };
      })
      .filter((r) => r.title.length > 0);

    return { checked: true, recipes: mapped };
  } catch (err) {
    const errText = err instanceof Error ? err.message : 'errore di rete';
    return {
      checked: false,
      recipes: [],
      error: `Controllo duplicati remoto non riuscito (${errText}).`,
    };
  }
}

function resolveLocalCoverImageBuffer(coverImageUrl: string | null): Buffer | null {
  if (!coverImageUrl) return null;

  // Uploaded / scraped covers stored in data/uploads/
  if (coverImageUrl.startsWith('/api/uploads/')) {
    const filename = path.basename(coverImageUrl);
    const { uploadsDir } = ensureDataDirs();
    const imgPath = path.resolve(uploadsDir, filename);
    if (imgPath.startsWith(uploadsDir + path.sep) && fs.existsSync(imgPath)) {
      return fs.readFileSync(imgPath);
    }
    return null;
  }

  // Bundled sample cover images in src/assets/images/
  if (coverImageUrl.startsWith('/src/assets/images/')) {
    const filename = path.basename(coverImageUrl);
    const assetsDir = path.resolve(process.cwd(), 'src/assets/images');
    const imgPath = path.resolve(assetsDir, filename);
    if (imgPath.startsWith(assetsDir + path.sep) && fs.existsSync(imgPath)) {
      return fs.readFileSync(imgPath);
    }
  }

  return null;
}

/**
 * Official 3-step Monsieur Cuisine media upload pipeline:
 *   1. POST api/v1/media/image/upload-url (for details + thumbnail)
 *   2. PUT JPEG bytes directly to signed upload URLs
 *   3. Poll GET api/v1/media?ids[]=... until processed
 */
async function uploadRecipeImageToMc(
  imgBuffer: Buffer,
  options: { baseUrl: string; locale: SupportedMcLocale; cookies: StoredCookie[] },
  fetchImpl: typeof fetch = fetch
): Promise<{ detailsMediaId: number; thumbnailMediaId: number } | null> {
  const detailsName = `${randomUUID()}_details.jpg`;
  const thumbName = `${randomUUID()}_thumbnail.jpg`;

  const [detailsReq, thumbReq] = await Promise.all([
    callMcProxy(
      {
        ...options,
        endpoint: 'api/v1/media/image/upload-url',
        method: 'POST',
        payload: { fileName: detailsName, mimeType: 'image/jpeg' },
        timeoutMs: 15000,
      },
      fetchImpl
    ),
    callMcProxy(
      {
        ...options,
        endpoint: 'api/v1/media/image/upload-url',
        method: 'POST',
        payload: { fileName: thumbName, mimeType: 'image/jpeg' },
        timeoutMs: 15000,
      },
      fetchImpl
    ),
  ]);

  if (!detailsReq.ok || !thumbReq.ok) return null;

  const dData = detailsReq.data as Record<string, unknown> | undefined;
  const tData = thumbReq.data as Record<string, unknown> | undefined;
  if (
    typeof dData?.url !== 'string' ||
    typeof dData?.mediaId !== 'number' ||
    typeof tData?.url !== 'string' ||
    typeof tData?.mediaId !== 'number'
  ) {
    return null;
  }

  const blob = new Blob([new Uint8Array(imgBuffer)], { type: 'image/jpeg' });
  const [putDetails, putThumb] = await Promise.all([
    fetchImpl(dData.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
      signal: AbortSignal.timeout(20000),
    }),
    fetchImpl(tData.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
      signal: AbortSignal.timeout(20000),
    }),
  ]);

  if (!putDetails.ok || !putThumb.ok) return null;

  // Poll briefly so MC backend marks the media IDs ready before attaching to recipe
  const mediaIds = [dData.mediaId, tData.mediaId];
  const query = mediaIds.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&');
  for (let attempt = 0; attempt < 6; attempt++) {
    const check = await callMcProxy(
      {
        ...options,
        endpoint: `api/v1/media?${query}`,
        method: 'GET',
        timeoutMs: 10000,
      },
      fetchImpl
    ).catch(() => null);

    const mediaList =
      check?.ok && Array.isArray(check.data)
        ? check.data
        : check?.ok &&
            check.data &&
            typeof check.data === 'object' &&
            Array.isArray((check.data as Record<string, unknown>).media)
          ? ((check.data as Record<string, unknown>).media as unknown[])
          : null;

    if (
      mediaList &&
      mediaList.length === mediaIds.length &&
      mediaList.every(
        (m) => m && typeof m === 'object' && Boolean((m as Record<string, unknown>).url)
      )
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  return {
    detailsMediaId: dData.mediaId,
    thumbnailMediaId: tData.mediaId,
  };
}

/**
 * Uploads the cover photo (if present locally) and official MC3.0 recipe draft payload
 * to `https://www.monsieur-cuisine.com/proxy-api` -> `POST api/v3/auth/user/recipes/`.
 */
export async function uploadRecipeToMonsieurCuisine(
  recipe: ConvertedRecipe,
  fetchImpl: typeof fetch = fetch
): Promise<{
  uploaded: boolean;
  remoteId: string | null;
  remoteUrl: string | null;
  payload: MonsieurCuisineApiPayload;
  message: string;
}> {
  const locale = getMcLocale();
  let session = readPersistedMcSession();
  let status = getMcSessionStatus();

  // If no valid session is saved yet, attempt auto-login once if MC_EMAIL + MC_PASSWORD exist
  if (!session || !status.authenticated) {
    const hasCreds = Boolean((process.env.MC_EMAIL || '').trim() && (process.env.MC_PASSWORD || '').trim());
    if (hasCreds) {
      const loginRes = await loginMonsieurCuisineDirect(undefined, undefined, fetchImpl);
      if (loginRes.ok) {
        session = readPersistedMcSession();
        status = getMcSessionStatus();
      } else {
        const previewPayload = buildMonsieurCuisinePayload(recipe, { locale });
        return {
          uploaded: false,
          remoteId: null,
          remoteUrl: null,
          payload: previewPayload,
          message: `Ricetta salvata solo come bozza locale: ${loginRes.message}`,
        };
      }
    }
  }

  if (!session || !status.authenticated) {
    const previewPayload = buildMonsieurCuisinePayload(recipe, { locale });
    return {
      uploaded: false,
      remoteId: null,
      remoteUrl: null,
      payload: previewPayload,
      message:
        'Sessione Monsieur Cuisine non attiva: ricetta salvata solo in locale. Vai in "Impostazioni .env" e importa i cookie di www.monsieur-cuisine.com per abilitare l’invio al cloud.',
    };
  }

  const baseUrl = session.baseUrl || getMcBaseUrl();

  // Step 1: Upload cover image via presigned URLs if available locally
  let detailsMediaId: number | null = null;
  let thumbnailMediaId: number | null = null;
  const imgBuffer = resolveLocalCoverImageBuffer(recipe.coverImageUrl);
  if (imgBuffer) {
    try {
      const uploadedMedia = await uploadRecipeImageToMc(
        imgBuffer,
        { baseUrl, locale, cookies: session.cookies },
        fetchImpl
      );
      if (uploadedMedia) {
        detailsMediaId = uploadedMedia.detailsMediaId;
        thumbnailMediaId = uploadedMedia.thumbnailMediaId;
      }
    } catch {
      // Proceed with recipe creation even if image upload fails
    }
  }

  // Step 1b: Fetch live locale-specific category & complexity guide from WP admin-ajax
  const liveGuide = await fetchMcRecipeCreationGuide(
    { baseUrl, locale, cookies: session.cookies },
    fetchImpl
  );

  // Step 2: Build official MC3.0 payload & POST via /proxy-api -> api/v3/auth/user/recipes/
  const finalPayload = buildMonsieurCuisinePayload(recipe, {
    locale,
    detailsMediaId,
    thumbnailMediaId,
    status: 'draft',
    liveGuide,
  });

  try {
    const result = await callMcProxy(
      {
        baseUrl,
        locale,
        cookies: session.cookies,
        endpoint: 'api/v3/auth/user/recipes/',
        method: 'POST',
        payload: finalPayload,
        timeoutMs: 45000, // MC backend resolves ingredients and nutrition server-side
      },
      fetchImpl
    );

    if (!result.ok) {
      const apiDetail = result.message
        ? `${result.message}${result.code !== undefined ? ` (code ${result.code})` : ''}`
        : `HTTP ${result.httpStatus}`;
      const hint =
        (result.httpStatus === 401 || result.httpStatus === 403) && !result.message
          ? 'La sessione cookie è scaduta o bloccata: aggiorna i cookie in Impostazioni .env e clicca "Carica MC" nello Storico.'
          : 'Ricetta salvata localmente in SQLite: verifica i dettagli sopra e riprova con "Carica MC".';
      const errMsg = `Upload cloud rifiutato da monsieur-cuisine.com (${apiDetail}). ${hint}`;
      writePersistedMcSession({ ...session, lastError: errMsg });
      return {
        uploaded: false,
        remoteId: null,
        remoteUrl: null,
        payload: finalPayload,
        message: errMsg,
      };
    }

    const dataObj =
      result.data && typeof result.data === 'object'
        ? (result.data as Record<string, unknown>)
        : {};
    const recipeObj =
      dataObj.recipe && typeof dataObj.recipe === 'object'
        ? (dataObj.recipe as Record<string, unknown>)
        : dataObj;

    const rawId = recipeObj.id ?? dataObj.id ?? (result.raw as Record<string, unknown> | null)?.id;
    const remoteId = rawId !== undefined && rawId !== null ? String(rawId) : null;

    if (!remoteId) {
      return {
        uploaded: false,
        remoteId: null,
        remoteUrl: null,
        payload: finalPayload,
        message:
          'Risposta inattesa da monsieur-cuisine.com (ID ricetta mancante nella risposta /proxy-api). Verifica la sessione nelle Impostazioni.',
      };
    }

    const remoteUrl = createMcRecipePageUrl(locale, baseUrl, remoteId);
    writePersistedMcSession({ ...session, lastError: null });

    return {
      uploaded: true,
      remoteId,
      remoteUrl,
      payload: finalPayload,
      message: `Ricetta caricata come bozza sul tuo account cloud Monsieur Cuisine Smart (ID #${remoteId}).`,
    };
  } catch (err) {
    const errText = err instanceof Error ? err.message : 'errore di rete';
    return {
      uploaded: false,
      remoteId: null,
      remoteUrl: null,
      payload: finalPayload,
      message: `Impossibile raggiungere monsieur-cuisine.com (${errText}). Ricetta salvata in locale come bozza pronta per il nuovo tentativo.`,
    };
  }
}
