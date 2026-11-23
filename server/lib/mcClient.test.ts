import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMcCookieHeader,
  callMcProxy,
  createMcRecipePageUrl,
  hasRequiredMcSessionCookies,
  parseCookiesFromFlexibleInput,
} from '../services/mcClient';

test('parseCookiesFromFlexibleInput parses Cookie-Editor JSON, Playwright storage_state, and raw Cookie header', () => {
  // 1. Cookie-Editor JSON array
  const fromArray = parseCookiesFromFlexibleInput(
    JSON.stringify([
      {
        name: 'wordpress_logged_in_abc123',
        value: 'user%7C1799999999%7Ctok',
        domain: '.monsieur-cuisine.com',
      },
      {
        name: 'lidl_sso_id_token',
        value: 'eyJhbGciOi...',
        domain: 'www.monsieur-cuisine.com',
      },
      {
        name: 'unrelated_cookie',
        value: 'ignore-me',
        domain: '.accounts.lidl.com',
      },
    ])
  );
  assert.equal(fromArray.error, undefined);
  assert.equal(fromArray.cookies.length, 2);
  assert.equal(hasRequiredMcSessionCookies(fromArray.cookies).hasWordpressLogin, true);
  assert.equal(hasRequiredMcSessionCookies(fromArray.cookies).hasLidlSsoToken, true);

  // 2. Raw Cookie header string from DevTools
  const fromHeader = parseCookiesFromFlexibleInput(
    'Cookie: wordpress_logged_in_999=abc=def; lidl_sso_id_token=jwt.token.here; GCLB=123'
  );
  assert.equal(fromHeader.error, undefined);
  assert.equal(fromHeader.cookies.length, 3);
  assert.equal(fromHeader.cookies[0].value, 'abc=def');
  assert.equal(hasRequiredMcSessionCookies(fromHeader.cookies).hasAnySessionCookie, true);
});

test('buildMcCookieHeader injects wp-wpml_current_language automatically when missing', () => {
  const header = buildMcCookieHeader(
    [
      { name: 'wordpress_logged_in_1', value: 'v1', domain: '.monsieur-cuisine.com' },
      { name: 'lidl_sso_id_token', value: 'v2', domain: 'www.monsieur-cuisine.com' },
    ],
    'it-IT'
  );
  assert.ok(header.includes('wp-wpml_current_language=it'));
  assert.ok(header.includes('wordpress_logged_in_1=v1'));
  assert.ok(header.includes('lidl_sso_id_token=v2'));
});

test('createMcRecipePageUrl produces official MC Smart draft URL with recipe-id', () => {
  const url = createMcRecipePageUrl('it-IT', 'https://www.monsieur-cuisine.com', 10408588);
  assert.equal(
    url,
    'https://www.monsieur-cuisine.com/it/create-recipe?devices=mc-smart&recipe-id=10408588'
  );
});

test('callMcProxy sends exact /proxy-api payload, headers, and surfaces mc-api business errors on HTTP 403', async () => {
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};

  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedHeaders = (init?.headers as Record<string, string>) || {};
    capturedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(
      JSON.stringify({ code: 40008, message: 'Invalid category' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const res = await callMcProxy(
    {
      baseUrl: 'https://www.monsieur-cuisine.com',
      locale: 'it-IT',
      cookies: [{ name: 'wordpress_logged_in_1', value: 'ok', domain: '.monsieur-cuisine.com' }],
      endpoint: 'api/v3/auth/user/recipes/',
      method: 'POST',
      payload: { title: 'Test' },
    },
    mockFetch
  );

  assert.equal(capturedUrl, 'https://www.monsieur-cuisine.com/proxy-api');
  assert.equal(capturedHeaders['device-type'], 'web');
  assert.ok(capturedHeaders['x-bypass-cdn']);
  assert.ok(capturedHeaders['Cookie'].includes('wp-wpml_current_language=it'));
  assert.equal(capturedBody.endpoint, 'api/v3/auth/user/recipes/');
  assert.equal(capturedBody.method, 'POST');
  assert.equal(capturedBody.lang, 'it-IT');

  assert.equal(res.ok, false);
  assert.equal(res.httpStatus, 403);
  assert.equal(res.code, 40008);
  assert.equal(res.message, 'Invalid category');
});
