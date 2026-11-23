import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvContent, mergeEnvContent, formatEnvValue } from './envManager';

test('parseEnvContent reads comments, unquoted, and quoted values', () => {
  const raw = [
    '# Comment line',
    'DEFAULT_MULTIPLIER=1.5',
    'MC_EMAIL="chef@example.com"',
    'APP_PASSWORD="my secret#pass"',
  ].join('\n');

  const parsed = parseEnvContent(raw);
  assert.equal(parsed.DEFAULT_MULTIPLIER, '1.5');
  assert.equal(parsed.MC_EMAIL, 'chef@example.com');
  assert.equal(parsed.APP_PASSWORD, 'my secret#pass');
});

test('mergeEnvContent preserves comments and unmanaged keys while updating allowed keys', () => {
  const existing = [
    '# Custom server setting',
    'PORT=8000',
    'DEFAULT_MULTIPLIER=1.5',
    'MC_EMAIL=old@example.com',
  ].join('\n');

  const merged = mergeEnvContent(existing, {
    DEFAULT_MULTIPLIER: '1.25',
    MC_EMAIL: 'new@example.com',
    MC_LOCALE: 'it-IT',
  });

  assert.ok(merged.includes('# Custom server setting'));
  assert.ok(merged.includes('PORT=8000'));
  assert.ok(merged.includes('DEFAULT_MULTIPLIER=1.25'));
  assert.ok(merged.includes('MC_EMAIL=new@example.com'));
  assert.ok(merged.includes('MC_LOCALE=it-IT'));
});

test('formatEnvValue quotes values containing spaces or special characters', () => {
  assert.equal(formatEnvValue('1.5'), '1.5');
  assert.equal(formatEnvValue('pass word#1'), '"pass word#1"');
});
