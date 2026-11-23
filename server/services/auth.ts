import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getAppConfigValue, setAppConfigValue } from './db';

const SESSION_COOKIE_NAME = 'mc_bridge_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const ADMIN_HASH_KEY = 'admin_password_hash';

// Keep signing secret in env if provided, otherwise secure in-memory random 32-byte key
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function timingSafeCompareStrings(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function getAuthConfigurationState(): {
  needsSetup: boolean;
  source: 'env' | 'db_claimed' | 'none';
} {
  const envPass = (process.env.APP_PASSWORD || '').trim();
  if (envPass.length > 0) {
    return { needsSetup: false, source: 'env' };
  }
  const dbHash = getAppConfigValue(ADMIN_HASH_KEY);
  if (dbHash) {
    return { needsSetup: false, source: 'db_claimed' };
  }
  return { needsSetup: true, source: 'none' };
}

export function verifyAdminPassword(candidate: string): boolean {
  if (!candidate || typeof candidate !== 'string') return false;
  const envPass = (process.env.APP_PASSWORD || '').trim();
  if (envPass.length > 0) {
    // Configured process.env APP_PASSWORD always takes precedence
    return timingSafeCompareStrings(candidate, envPass);
  }
  const dbHash = getAppConfigValue(ADMIN_HASH_KEY);
  if (!dbHash) return false;
  return verifyPasswordScrypt(candidate, dbHash);
}

export function claimInitialAdminPassword(password: string): { ok: boolean; error?: string } {
  const state = getAuthConfigurationState();
  if (!state.needsSetup) {
    return { ok: false, error: 'La password amministratore è già configurata.' };
  }
  if (!password || password.trim().length < 6) {
    return { ok: false, error: 'Inserisci una password di almeno 6 caratteri.' };
  }
  const hashed = hashPasswordScrypt(password.trim());
  setAppConfigValue(ADMIN_HASH_KEY, hashed);
  return { ok: true };
}

export function updateClaimedAdminPasswordHash(password: string): void {
  const hashed = hashPasswordScrypt(password);
  setAppConfigValue(ADMIN_HASH_KEY, hashed);
}

interface SessionPayload {
  sub: 'admin';
  iat: number;
  exp: number;
}

function signToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (parsed.sub !== 'admin' || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim() === 'https') {
    return true;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('https://')) {
    return true;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.startsWith('https://')) {
    return true;
  }
  return req.secure;
}

export function setSessionCookie(req: Request, res: Response): string {
  const now = Date.now();
  const token = signToken({
    sub: 'admin',
    iat: now,
    exp: now + SESSION_TTL_MS,
  });

  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  if (isHttpsRequest(req)) {
    // Support cross-site iframe preview (HTTPS) and Nginx HTTPS reverse proxy
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=None; Partitioned`
    );
  } else {
    // Local HTTP development / headless browser testing on http://localhost:3000
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`
    );
  }
  return token;
}

export function clearSessionCookie(req: Request, res: Response): void {
  if (isHttpsRequest(req)) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`
    );
  } else {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
    );
  }
}

export function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string') return undefined;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

export function isRequestAuthenticated(req: Request): boolean {
  const bearer = extractBearerToken(req);
  if (bearer && verifySessionToken(bearer) !== null) {
    return true;
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  return verifySessionToken(cookieToken) !== null;
}

export function verifyCsrfForMutation(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }

  // Require custom header sent by SPA fetch wrapper
  const requestedWith = req.headers['x-requested-with'];
  if (requestedWith !== 'MCSmartBridge') {
    return false;
  }

  // Requests explicitly authenticated with an in-memory Authorization Bearer token
  // cannot be forged via ambient browser cookies.
  const bearer = extractBearerToken(req);
  if (bearer && verifySessionToken(bearer) !== null) {
    return true;
  }

  // For cookie-only mutations, also verify Origin matches Host / X-Forwarded-Host when present
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      const expectedHost = (
        (typeof req.headers['x-forwarded-host'] === 'string'
          ? req.headers['x-forwarded-host'].split(',')[0].trim()
          : '') ||
        req.headers.host ||
        ''
      ).toLowerCase();
      if (expectedHost && originHost !== expectedHost) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isRequestAuthenticated(req)) {
    res.status(401).json({ error: 'Sessione scaduta o non autenticata. Effettua il login.' });
    return;
  }
  if (!verifyCsrfForMutation(req)) {
    res.status(403).json({ error: 'Richiesta non valida (controllo origine/CSRF fallito).' });
    return;
  }
  next();
}
