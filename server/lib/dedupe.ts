import crypto from 'node:crypto';
import type { DuplicateMatch } from '../../src/shared/types';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
  'share',
]);

export function normalizeSourceUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.protocol = 'https:';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.hash = '';

    const cleanParams = new URLSearchParams();
    const sortedKeys = Array.from(parsed.searchParams.keys()).sort();
    for (const key of sortedKeys) {
      if (!TRACKING_PARAMS.has(key.toLowerCase())) {
        const values = parsed.searchParams.getAll(key);
        for (const v of values) {
          cleanParams.append(key, v);
        }
      }
    }
    parsed.search = cleanParams.toString() ? `?${cleanParams.toString()}` : '';
    // Trim trailing slash except root
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashTitle(title: string): string {
  const norm = normalizeTitle(title);
  return crypto.createHash('sha256').update(norm).digest('hex');
}

function getBigrams(str: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < str.length - 1; i++) {
    const bg = str.slice(i, i + 2);
    map.set(bg, (map.get(bg) ?? 0) + 1);
  }
  return map;
}

export function diceCoefficient(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;

  const bigramsA = getBigrams(na);
  const bigramsB = getBigrams(nb);

  let intersection = 0;
  for (const [bg, countA] of bigramsA.entries()) {
    const countB = bigramsB.get(bg) ?? 0;
    intersection += Math.min(countA, countB);
  }

  return (2 * intersection) / (na.length - 1 + (nb.length - 1));
}

export function levenshteinSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const m = na.length;
  const n = nb.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = na[i - 1] === nb[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }

  const maxLen = Math.max(m, n);
  return maxLen === 0 ? 1 : 1 - prev[n] / maxLen;
}

/**
 * Combined fuzzy similarity score in [0, 1].
 * Matches requirements: > 0.85 flags a likely duplicate even across different sites.
 */
export function computeTitleSimilarity(titleA: string, titleB: string): number {
  const na = normalizeTitle(titleA);
  const nb = normalizeTitle(titleB);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const dice = diceCoefficient(na, nb);
  const lev = levenshteinSimilarity(na, nb);
  return Number((dice * 0.55 + lev * 0.45).toFixed(4));
}

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

export function findFuzzyMatches(
  candidateTitle: string,
  entries: Array<{
    title: string;
    source: DuplicateMatch['source'];
    sourceUrl?: string | null;
    remoteId?: string | null;
    remoteUrl?: string | null;
    importedAt?: string | null;
  }>,
  threshold = DUPLICATE_SIMILARITY_THRESHOLD
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const entry of entries) {
    const sim = computeTitleSimilarity(candidateTitle, entry.title);
    if (sim >= threshold) {
      matches.push({
        source: entry.source,
        similarity: sim,
        title: entry.title,
        sourceUrl: entry.sourceUrl ?? null,
        remoteId: entry.remoteId ?? null,
        remoteUrl: entry.remoteUrl ?? null,
        importedAt: entry.importedAt ?? null,
      });
    }
  }
  return matches.sort((a, b) => b.similarity - a.similarity);
}
