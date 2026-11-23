import * as cheerio from 'cheerio';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { assertSafePublicUrl } from '../lib/ssrf';
import { ensureDataDirs } from './db';

export interface ScrapedRecipeContent {
  url: string;
  domain: string;
  title: string;
  description: string;
  rawText: string;
  extractedImageUrl: string | null;
  localCoverPath: string | null;
  servingsHint: number | null;
  prepTimeMinHint: number | null;
  cookTimeMinHint: number | null;
  structuredJsonLd: boolean;
}

const MAX_HTML_BYTES = 3 * 1024 * 1024; // 3 MB
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

async function fetchWithSafeRedirects(rawUrl: string, accept: string, maxBytes: number): Promise<{ buffer: Buffer; finalUrl: string; contentType: string }> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    const safeUrl = await assertSafePublicUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const resp = await fetch(safeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: accept,
          'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7',
        },
      });

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location');
        if (!location) throw new Error('Redirect HTTP senza intestazione Location.');
        currentUrl = new URL(location, safeUrl).toString();
        continue;
      }

      if (!resp.ok) {
        throw new Error(`Il sito sorgente ha risposto con errore HTTP ${resp.status}.`);
      }

      const contentType = resp.headers.get('content-type') || '';
      const reader = resp.body?.getReader();
      if (!reader) {
        const ab = await resp.arrayBuffer();
        if (ab.byteLength > maxBytes) throw new Error('Risposta remota troppo grande.');
        return { buffer: Buffer.from(ab), finalUrl: safeUrl.toString(), contentType };
      }

      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new Error('Contenuto remoto oltre il limite consentito.');
          }
          chunks.push(Buffer.from(value));
        }
      }

      return { buffer: Buffer.concat(chunks), finalUrl: safeUrl.toString(), contentType };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('Troppi redirect durante il recupero della pagina.');
}

function parseIsoDurationMinutes(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match) return null;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  const total = hours * 60 + mins;
  return total > 0 ? total : null;
}

function parseServingsHint(yieldVal: unknown): number | null {
  const str = Array.isArray(yieldVal) ? String(yieldVal[0] ?? '') : String(yieldVal ?? '');
  const m = str.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return n >= 1 && n <= 30 ? n : null;
}

function extractImageFromSchema(img: unknown): string | null {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) {
    for (const item of img) {
      const found = extractImageFromSchema(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof img === 'object') {
    const obj = img as Record<string, unknown>;
    if (typeof obj.url === 'string') return obj.url;
  }
  return null;
}

function flattenInstructions(instructions: unknown): string[] {
  if (!instructions) return [];
  if (typeof instructions === 'string') return [instructions.trim()];
  if (Array.isArray(instructions)) {
    return instructions.flatMap(flattenInstructions);
  }
  if (typeof instructions === 'object') {
    const obj = instructions as Record<string, unknown>;
    if (typeof obj.text === 'string') return [obj.text.trim()];
    if (Array.isArray(obj.itemListElement)) {
      return flattenInstructions(obj.itemListElement);
    }
  }
  return [];
}

function findRecipeNodeInJsonLd(data: unknown): Record<string, unknown> | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeNodeInJsonLd(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const rawType = obj['@type'];
    const types = Array.isArray(rawType) ? rawType : [rawType];
    if (types.some((t) => typeof t === 'string' && t.toLowerCase() === 'recipe')) {
      return obj;
    }
    if (obj['@graph']) {
      return findRecipeNodeInJsonLd(obj['@graph']);
    }
  }
  return null;
}

/**
 * Resizes an image buffer to Monsieur Cuisine Smart recommended dimensions (1200x800 cover JPEG)
 * and persists it safely in data/uploads/<uuid>.jpg.
 */
export async function processAndSaveCoverImage(buffer: Buffer): Promise<string> {
  const { uploadsDir } = ensureDataDirs();
  const filename = `cover-${crypto.randomUUID()}.jpg`;
  const targetPath = path.resolve(uploadsDir, filename);

  // Path confinement check
  if (!targetPath.startsWith(uploadsDir + path.sep)) {
    throw new Error('Percorso di salvataggio immagine non valido.');
  }

  const processed = await sharp(buffer)
    .rotate()
    .resize(1200, 800, { fit: 'cover', position: 'centre', withoutEnlargement: true })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();

  fs.writeFileSync(targetPath, processed);
  return `/api/uploads/${filename}`;
}

export async function downloadAndResizeRemoteImage(imageUrl: string): Promise<string | null> {
  try {
    const { buffer } = await fetchWithSafeRedirects(
      imageUrl,
      'image/avif,image/webp,image/jpeg,image/png,image/*,*/*;q=0.8',
      MAX_IMAGE_BYTES
    );
    return await processAndSaveCoverImage(buffer);
  } catch {
    return null;
  }
}

export async function scrapeRecipeUrl(rawUrl: string): Promise<ScrapedRecipeContent> {
  const { buffer, finalUrl } = await fetchWithSafeRedirects(
    rawUrl,
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    MAX_HTML_BYTES
  );

  const parsedFinal = new URL(finalUrl);
  const html = buffer.toString('utf8');
  const $ = cheerio.load(html);

  let recipeNode: Record<string, unknown> | null = null;
  const ldScripts = $('script[type="application/ld+json"]').toArray();
  for (const el of ldScripts) {
    try {
      const jsonText = $(el).contents().text().trim();
      if (!jsonText) continue;
      const parsed = JSON.parse(jsonText);
      const found = findRecipeNodeInJsonLd(parsed);
      if (found) {
        recipeNode = found;
        break;
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }

  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim() || '';
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || null;

  let title = ogTitle || $('h1').first().text().trim() || $('title').text().trim() || 'Ricetta importata';
  let description = ogDesc;
  let extractedImageUrl: string | null = ogImage;
  let servingsHint: number | null = null;
  let prepTimeMinHint: number | null = null;
  let cookTimeMinHint: number | null = null;
  let rawText = '';

  if (recipeNode) {
    if (typeof recipeNode.name === 'string' && recipeNode.name.trim()) {
      title = recipeNode.name.trim();
    }
    if (typeof recipeNode.description === 'string' && recipeNode.description.trim()) {
      description = recipeNode.description.trim();
    }
    const schemaImg = extractImageFromSchema(recipeNode.image);
    if (schemaImg) extractedImageUrl = schemaImg;
    servingsHint = parseServingsHint(recipeNode.recipeYield);
    prepTimeMinHint = parseIsoDurationMinutes(recipeNode.prepTime);
    cookTimeMinHint = parseIsoDurationMinutes(recipeNode.cookTime);

    const ingredients = Array.isArray(recipeNode.recipeIngredient)
      ? recipeNode.recipeIngredient.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const steps = flattenInstructions(recipeNode.recipeInstructions);

    rawText = [
      `Titolo: ${title}`,
      description ? `Descrizione: ${description}` : '',
      servingsHint ? `Porzioni originali: ${servingsHint}` : '',
      prepTimeMinHint ? `Preparazione: ${prepTimeMinHint} min` : '',
      cookTimeMinHint ? `Cottura: ${cookTimeMinHint} min` : '',
      '',
      'Ingredienti:',
      ...ingredients.map((i) => `- ${i}`),
      '',
      'Procedimento:',
      ...steps.map((s, idx) => `${idx + 1}. ${s}`),
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    // Clean DOM fallback
    $('script, style, nav, footer, header, aside, iframe, noscript').remove();
    const mainEl = $('article, main, .recipe, [itemtype*="Recipe"]').first();
    const textSource = mainEl.length ? mainEl.text() : $('body').text();
    rawText = textSource.replace(/\s+/g, ' ').trim().slice(0, 12000);
  }

  let resolvedImageUrl: string | null = null;
  if (extractedImageUrl) {
    try {
      resolvedImageUrl = new URL(extractedImageUrl, finalUrl).toString();
    } catch {
      resolvedImageUrl = null;
    }
  }

  const localCoverPath = resolvedImageUrl
    ? await downloadAndResizeRemoteImage(resolvedImageUrl)
    : null;

  return {
    url: finalUrl,
    domain: parsedFinal.hostname.replace(/^www\./, ''),
    title,
    description,
    rawText,
    extractedImageUrl: resolvedImageUrl,
    localCoverPath,
    servingsHint,
    prepTimeMinHint,
    cookTimeMinHint,
    structuredJsonLd: Boolean(recipeNode),
  };
}
