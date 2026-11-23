import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  isRequestAuthenticated,
  setSessionCookie,
  verifyCsrfForMutation,
  verifySessionToken,
} from '../services/auth';

function createMockReqRes(overrides: Partial<Request> = {}) {
  const headersSent: Record<string, string> = {};
  const req = {
    method: 'POST',
    secure: false,
    headers: {
      host: 'ais-dev-example.run.app',
      origin: 'https://ais-dev-example.run.app',
      'x-requested-with': 'MCSmartBridge',
    },
    cookies: {},
    ...overrides,
  } as unknown as Request;

  const res = {
    setHeader(name: string, val: string) {
      headersSent[name.toLowerCase()] = val;
    },
  } as unknown as Response;

  return { req, res, headersSent };
}

test('setSessionCookie returns a valid signed token and sets Secure SameSite=None Partitioned on HTTPS origin', () => {
  const { req, res, headersSent } = createMockReqRes();
  const token = setSessionCookie(req, res);

  assert.ok(token.includes('.'));
  assert.ok(verifySessionToken(token) !== null);
  assert.ok(headersSent['set-cookie']?.includes('HttpOnly'));
  assert.ok(headersSent['set-cookie']?.includes('Secure'));
  assert.ok(headersSent['set-cookie']?.includes('SameSite=None'));
  assert.ok(headersSent['set-cookie']?.includes('Partitioned'));
});

test('isRequestAuthenticated accepts Authorization Bearer token even when cookies are blocked', () => {
  const { req, res } = createMockReqRes();
  const token = setSessionCookie(req, res);

  const bearerOnlyReq = {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-requested-with': 'MCSmartBridge',
    },
    cookies: {},
  } as unknown as Request;

  assert.equal(isRequestAuthenticated(bearerOnlyReq), true);
  assert.equal(verifyCsrfForMutation(bearerOnlyReq), true);
});

test('isRequestAuthenticated accepts HttpOnly cookie and rejects tampered tokens', () => {
  const { req, res } = createMockReqRes();
  const token = setSessionCookie(req, res);

  const cookieReq = {
    method: 'GET',
    headers: {},
    cookies: { mc_bridge_session: token },
  } as unknown as Request;

  const tamperedReq = {
    method: 'GET',
    headers: { authorization: 'Bearer invalid.signature' },
    cookies: { mc_bridge_session: 'invalid.signature' },
  } as unknown as Request;

  assert.equal(isRequestAuthenticated(cookieReq), true);
  assert.equal(isRequestAuthenticated(tamperedReq), false);
});
