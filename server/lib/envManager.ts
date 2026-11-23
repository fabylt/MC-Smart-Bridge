import fs from 'node:fs';
import path from 'node:path';

export const MANAGED_ENV_KEYS = [
  'APP_PASSWORD',
  'GEMINI_API_KEY',
  'MC_EMAIL',
  'MC_PASSWORD',
  'DEFAULT_MULTIPLIER',
  'MC_BASE_URL',
  'MC_LOCALE',
] as const;

export type ManagedEnvKey = (typeof MANAGED_ENV_KEYS)[number];

const ALLOWED_SET = new Set<string>(MANAGED_ENV_KEYS);

export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    result[key] = value;
  }

  return result;
}

export function formatEnvValue(value: string): string {
  const sanitized = value.replace(/\r/g, '');
  if (/[\s#"'`\\=]/.test(sanitized) || sanitized === '') {
    const escaped = sanitized
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
    return `"${escaped}"`;
  }
  return sanitized;
}

/**
 * Updates existing .env file content while preserving comments and unmanaged lines.
 */
export function mergeEnvContent(
  existingContent: string,
  updates: Partial<Record<ManagedEnvKey, string>>
): string {
  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  const handled = new Set<string>();

  const nextLines = lines.map((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) return rawLine;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) return rawLine;

    const key = trimmed.slice(0, eqIndex).trim();
    if (ALLOWED_SET.has(key) && key in updates) {
      const val = updates[key as ManagedEnvKey];
      if (val !== undefined) {
        handled.add(key);
        return `${key}=${formatEnvValue(val)}`;
      }
    }
    return rawLine;
  });

  for (const [key, val] of Object.entries(updates)) {
    if (!ALLOWED_SET.has(key) || val === undefined || handled.has(key)) continue;
    nextLines.push(`${key}=${formatEnvValue(val)}`);
  }

  // Ensure single trailing newline
  const cleaned = nextLines.join('\n').replace(/\n+$/, '');
  return cleaned ? `${cleaned}\n` : '';
}

export function getEnvFilePath(cwd = process.cwd()): string {
  return path.resolve(cwd, '.env');
}

export function loadEnvIntoProcess(envPath = getEnvFilePath()): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const parsed = parseEnvContent(content);
  for (const [key, value] of Object.entries(parsed)) {
    // Only fill process.env if not already explicitly provided by container runtime,
    // OR for managed keys written via UI hot-reload.
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
  return parsed;
}

export function updateEnvAndHotReload(
  updates: Partial<Record<ManagedEnvKey, string>>,
  envPath = getEnvFilePath()
): void {
  const safeUpdates: Partial<Record<ManagedEnvKey, string>> = {};

  for (const [key, val] of Object.entries(updates)) {
    if (!ALLOWED_SET.has(key) || typeof val !== 'string') continue;
    // Strip CR/LF from secret/config values to prevent env injection
    const cleanVal = val.replace(/[\r\n]/g, '').trim();
    safeUpdates[key as ManagedEnvKey] = cleanVal;
  }

  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const merged = mergeEnvContent(existing, safeUpdates);
  fs.writeFileSync(envPath, merged, { encoding: 'utf8', mode: 0o600 });

  // Hot-reload into active Node.js process immediately (no SSH restart needed)
  for (const [key, val] of Object.entries(safeUpdates)) {
    if (val !== undefined) {
      process.env[key] = val;
    }
  }
}

export function getDefaultMultiplier(): number {
  const raw = Number(process.env.DEFAULT_MULTIPLIER);
  if (Number.isFinite(raw) && raw >= 0.5 && raw <= 3.0) {
    return Number(raw.toFixed(2));
  }
  return 1.5;
}
