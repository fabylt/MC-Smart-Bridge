import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import type {
  AppSettingsView,
  ConvertedRecipe,
  DuplicateCheckResult,
  DuplicateMatch,
} from './src/shared/types';
import {
  DUPLICATE_SIMILARITY_THRESHOLD,
  findFuzzyMatches,
  normalizeSourceUrl,
} from './server/lib/dedupe';
import {
  getDefaultMultiplier,
  getEnvFilePath,
  loadEnvIntoProcess,
  updateEnvAndHotReload,
  type ManagedEnvKey,
} from './server/lib/envManager';
import { buildMonsieurCuisinePayload } from './server/lib/mcPayload';
import {
  adjustStepDurationForScale,
  evaluateBowlCapacity,
  scaleAllIngredients,
} from './server/lib/scaling';
import {
  claimInitialAdminPassword,
  clearSessionCookie,
  getAuthConfigurationState,
  isRequestAuthenticated,
  requireAuth,
  setSessionCookie,
  updateClaimedAdminPasswordHash,
  verifyAdminPassword,
  verifyCsrfForMutation,
} from './server/services/auth';
import {
  deleteStoredRecipe,
  ensureDataDirs,
  findStoredRecipeById,
  findStoredRecipeByNormalizedUrl,
  getDb,
  insertStoredRecipe,
  listStoredRecipes,
  updateStoredRecipeRemoteInfo,
} from './server/services/db';
import {
  convertRecipeWithGemini,
  GeminiUpstreamError,
  testGeminiConnection,
} from './server/services/geminiEngine';
import {
  exportMcSessionBackup,
  fetchRemoteMcPersonalRecipes,
  getMcBaseUrl,
  getMcLocale,
  getMcSessionStatus,
  importMcCookiesFromInput,
  loginMonsieurCuisineDirect,
  uploadRecipeToMonsieurCuisine,
  verifyMcSession,
} from './server/services/mcClient';
import { processAndSaveCoverImage, scrapeRecipeUrl } from './server/services/scraper';

// Initialize .env hot values and SQLite schema on startup
loadEnvIntoProcess();
ensureDataDirs();
getDb();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Support Nginx / Cloud Run reverse proxy headers (X-Forwarded-For, X-Forwarded-Proto)
app.set('trust proxy', 1);

app.use(cookieParser());
app.use(express.json({ limit: '4mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Matches Nginx client_max_body_size 10M
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato immagine non supportato. Usa JPG, PNG, WebP o AVIF.'));
    }
  },
});

// ============================================================================
// Health & Authentication Routes
// ============================================================================

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mc-smart-bridge', timestamp: new Date().toISOString() });
});

app.get('/api/auth/status', (req, res) => {
  const configState = getAuthConfigurationState();
  const authenticated = isRequestAuthenticated(req);
  res.json({
    authenticated,
    needsSetup: configState.needsSetup,
    authSource: configState.source,
  });
});

app.post('/api/auth/setup', (req, res) => {
  if (!verifyCsrfForMutation(req)) {
    res.status(403).json({ error: 'Richiesta non valida (controllo CSRF fallito).' });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const result = claimInitialAdminPassword(password);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  const token = setSessionCookie(req, res);
  res.json({ ok: true, authenticated: true, token });
});

app.post('/api/auth/login', (req, res) => {
  if (!verifyCsrfForMutation(req)) {
    res.status(403).json({ error: 'Richiesta non valida (controllo CSRF fallito).' });
    return;
  }
  const configState = getAuthConfigurationState();
  if (configState.needsSetup) {
    res.status(409).json({
      error: 'Nessuna password configurata: completa prima la configurazione iniziale.',
      needsSetup: true,
    });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!verifyAdminPassword(password)) {
    res.status(401).json({ error: 'Password non corretta.' });
    return;
  }
  const token = setSessionCookie(req, res);
  res.json({ ok: true, authenticated: true, token });
});

app.post('/api/auth/logout', (req, res) => {
  if (!verifyCsrfForMutation(req)) {
    res.status(403).json({ error: 'Richiesta non valida (controllo CSRF fallito).' });
    return;
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

// ============================================================================
// Protected Cover Image Serving (confined strictly to data/uploads/)
// ============================================================================

app.get('/api/uploads/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename || '');
  if (!/^cover-[a-f0-9-]+\.jpg$/i.test(filename)) {
    res.status(400).json({ error: 'Nome file non valido.' });
    return;
  }
  const { uploadsDir } = ensureDataDirs();
  const fullPath = path.resolve(uploadsDir, filename);
  if (!fullPath.startsWith(uploadsDir + path.sep) || !fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'Immagine non trovata.' });
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(fullPath);
});

app.post('/api/images/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore upload immagine.' });
      return;
    }
    if (!req.file?.buffer) {
      res.status(400).json({ error: 'Nessun file immagine ricevuto.' });
      return;
    }
    try {
      const url = await processAndSaveCoverImage(req.file.buffer);
      res.json({ ok: true, coverImageUrl: url });
    } catch (procErr) {
      res.status(400).json({
        error:
          procErr instanceof Error
            ? `Immagine non valida o corrotta: ${procErr.message}`
            : 'Impossibile elaborare l’immagine.',
      });
    }
  });
});

// ============================================================================
// Anti-Duplicate Check (Local SQLite + Remote Monsieur Cuisine Cloud)
// ============================================================================

async function runDuplicateCheck(input: {
  sourceUrl?: string | null;
  title?: string | null;
  includeRemote?: boolean;
}): Promise<DuplicateCheckResult> {
  const matches: DuplicateMatch[] = [];
  const normUrl = normalizeSourceUrl(input.sourceUrl);

  // 1. Local SQLite exact normalized URL match
  if (normUrl) {
    const existingByUrl = findStoredRecipeByNormalizedUrl(normUrl);
    if (existingByUrl) {
      matches.push({
        source: 'local_url',
        similarity: 1,
        title: existingByUrl.title,
        sourceUrl: existingByUrl.sourceUrl,
        remoteId: existingByUrl.remoteId,
        remoteUrl: existingByUrl.remoteUrl,
        importedAt: existingByUrl.createdAt,
      });
    }
  }

  // 2. Local SQLite fuzzy title match (> 85%)
  if (input.title && input.title.trim().length >= 3) {
    const allLocal = listStoredRecipes();
    const localFuzzy = findFuzzyMatches(
      input.title,
      allLocal.map((r) => ({
        title: r.title,
        source: 'local_title' as const,
        sourceUrl: r.sourceUrl,
        remoteId: r.remoteId,
        remoteUrl: r.remoteUrl,
        importedAt: r.createdAt,
      })),
      DUPLICATE_SIMILARITY_THRESHOLD
    );
    for (const m of localFuzzy) {
      if (!matches.some((ex) => ex.title === m.title && ex.source === 'local_url')) {
        matches.push(m);
      }
    }
  }

  // 3. Remote Monsieur Cuisine API fuzzy title match (> 85%)
  let remoteChecked = false;
  let remoteCheckError: string | undefined;

  if (input.includeRemote !== false && input.title && input.title.trim().length >= 3) {
    const remoteRes = await fetchRemoteMcPersonalRecipes();
    remoteChecked = remoteRes.checked;
    remoteCheckError = remoteRes.error;
    if (remoteRes.checked && remoteRes.recipes.length > 0) {
      const remoteFuzzy = findFuzzyMatches(
        input.title,
        remoteRes.recipes.map((r) => ({
          title: r.title,
          source: 'remote_mc' as const,
          remoteId: r.id,
          remoteUrl: r.url,
          importedAt: r.updatedAt ?? null,
        })),
        DUPLICATE_SIMILARITY_THRESHOLD
      );
      matches.push(...remoteFuzzy);
    }
  }

  return {
    hasDuplicate: matches.length > 0,
    matches: matches.sort((a, b) => b.similarity - a.similarity),
    remoteChecked,
    remoteCheckError,
  };
}

app.post('/api/recipes/check-duplicate', requireAuth, async (req, res) => {
  try {
    const sourceUrl = typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl : null;
    const title = typeof req.body?.title === 'string' ? req.body.title : null;
    const result = await runDuplicateCheck({ sourceUrl, title, includeRemote: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Errore durante il controllo duplicati.',
    });
  }
});

// ============================================================================
// Recipe Import, AI Conversion & Smart Re-Scaling
// ============================================================================

app.post('/api/recipes/convert', requireAuth, async (req, res) => {
  try {
    const mode = req.body?.mode === 'url' ? 'url' : 'text';
    const urlInput = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const textInput = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const sampleCoverImage =
      typeof req.body?.coverImageUrl === 'string' &&
      req.body.coverImageUrl.startsWith('/src/assets/images/')
        ? req.body.coverImageUrl
        : null;
    const forceReimport = Boolean(req.body?.forceReimport);
    const requestedMultiplier = Number(req.body?.multiplier) || getDefaultMultiplier();

    if (mode === 'url' && !urlInput) {
      res.status(400).json({ error: 'Inserisci un URL valido della ricetta da importare.' });
      return;
    }
    if (mode === 'text' && textInput.length < 20) {
      res
        .status(400)
        .json({ error: 'Incolla almeno il titolo, gli ingredienti e i passaggi principali della ricetta.' });
      return;
    }

    // Pre-check local URL duplicate before scraping/AI unless forceReimport is set
    if (mode === 'url' && !forceReimport) {
      const preDup = await runDuplicateCheck({ sourceUrl: urlInput, includeRemote: false });
      if (preDup.hasDuplicate) {
        res.status(409).json({
          error: 'Questa ricetta (URL) risulta già importata nello storico locale.',
          duplicateCheck: preDup,
        });
        return;
      }
    }

    let rawText = textInput;
    let sourceUrl: string | null = mode === 'url' ? urlInput : (urlInput || null);
    let sourceDomain: string | null = null;
    let coverImageUrl: string | null = sampleCoverImage;
    let servingsHint: number | null = null;

    if (mode === 'url') {
      const scraped = await scrapeRecipeUrl(urlInput);
      rawText = scraped.rawText;
      sourceUrl = scraped.url;
      sourceDomain = scraped.domain;
      coverImageUrl = scraped.localCoverPath || sampleCoverImage;
      servingsHint = scraped.servingsHint;
    } else if (sourceUrl) {
      try {
        sourceDomain = new URL(sourceUrl).hostname.replace(/^www\./, '');
      } catch {
        sourceDomain = null;
      }
    }

    const converted = await convertRecipeWithGemini({
      rawText,
      sourceUrl,
      sourceDomain,
      coverImageUrl,
      requestedMultiplier,
      servingsHint,
    });

    // Post-conversion duplicate check against BOTH SQLite and remote Monsieur Cuisine cloud
    const duplicateCheck = await runDuplicateCheck({
      sourceUrl: converted.sourceUrl,
      title: converted.title,
      includeRemote: true,
    });

    res.json({
      recipe: converted,
      duplicateCheck,
      mcPayloadPreview: buildMonsieurCuisinePayload(converted, { locale: getMcLocale() }),
    });
  } catch (err) {
    const status = err instanceof GeminiUpstreamError ? err.statusCode : 400;
    const message = err instanceof Error ? err.message : 'Errore durante la conversione della ricetta.';
    res.status(status).json({ error: message });
  }
});

app.post('/api/recipes/rescale', requireAuth, (req, res) => {
  try {
    const recipe = req.body?.recipe as ConvertedRecipe | undefined;
    const nextMultiplier = Number(req.body?.multiplier);
    if (!recipe || !Array.isArray(recipe.ingredients) || !Number.isFinite(nextMultiplier)) {
      res.status(400).json({ error: 'Dati ricetta o moltiplicatore non validi.' });
      return;
    }
    const clampedMult = Number(Math.min(3.0, Math.max(0.5, nextMultiplier)).toFixed(2));
    const scaledIngredients = scaleAllIngredients(recipe.ingredients, clampedMult);
    const bowlCapacity = evaluateBowlCapacity(scaledIngredients);
    const updatedSteps = recipe.steps.map((step) => ({
      ...step,
      durationSec: adjustStepDurationForScale(step, recipe.appliedMultiplier, clampedMult),
    }));

    const targetServings =
      recipe.originalServings <= 4 && clampedMult === 1.5
        ? 5
        : Math.max(1, Math.round(recipe.originalServings * clampedMult));

    const updated: ConvertedRecipe = {
      ...recipe,
      appliedMultiplier: clampedMult,
      targetServings,
      ingredients: scaledIngredients,
      steps: updatedSteps,
      bowlCapacity,
    };

    res.json({
      recipe: updated,
      mcPayloadPreview: buildMonsieurCuisinePayload(updated, { locale: getMcLocale() }),
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Errore durante il riproporzionamento.',
    });
  }
});

// ============================================================================
// Approve, Upload to Monsieur Cuisine & SQLite Archive
// ============================================================================

app.post('/api/recipes/upload', requireAuth, async (req, res) => {
  try {
    const recipe = req.body?.recipe as ConvertedRecipe | undefined;
    const forceReimport = Boolean(req.body?.forceReimport);
    if (!recipe || !recipe.title?.trim() || !Array.isArray(recipe.steps)) {
      res.status(400).json({ error: 'Payload ricetta incompleto.' });
      return;
    }

    if (!forceReimport) {
      const dupCheck = await runDuplicateCheck({
        sourceUrl: recipe.sourceUrl,
        title: recipe.title,
        includeRemote: true,
      });
      if (dupCheck.hasDuplicate) {
        res.status(409).json({
          error:
            'Rilevato possibile duplicato (>85% di similarità o URL già presente). Attiva "Forza re-importazione" se desideri procedere comunque.',
          duplicateCheck: dupCheck,
        });
        return;
      }
    }

    // Recompute bowl capacity cleanly before persisting
    const finalRecipe: ConvertedRecipe = {
      ...recipe,
      bowlCapacity: evaluateBowlCapacity(recipe.ingredients),
    };

    const uploadRes = await uploadRecipeToMonsieurCuisine(finalRecipe);
    const stored = insertStoredRecipe({
      recipe: finalRecipe,
      remoteId: uploadRes.remoteId,
      remoteUrl: uploadRes.remoteUrl,
      uploadStatus: uploadRes.uploaded ? 'synced' : 'local_draft',
    });

    res.json({
      ok: true,
      uploadedToCloud: uploadRes.uploaded,
      message: uploadRes.message,
      record: stored,
      mcPayload: uploadRes.payload,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Errore durante il salvataggio della ricetta.',
    });
  }
});

app.get('/api/recipes', requireAuth, (_req, res) => {
  res.json({ recipes: listStoredRecipes() });
});

app.post('/api/recipes/:id/retry-upload', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID ricetta non valido.' });
    return;
  }
  const existing = findStoredRecipeById(id);
  if (!existing) {
    res.status(404).json({ error: 'Ricetta non trovata.' });
    return;
  }
  const uploadRes = await uploadRecipeToMonsieurCuisine(existing.recipeJson);
  const updated = updateStoredRecipeRemoteInfo(
    id,
    uploadRes.remoteId,
    uploadRes.remoteUrl,
    uploadRes.uploaded ? 'synced' : 'local_draft'
  );
  res.json({
    ok: uploadRes.uploaded,
    uploadedToCloud: uploadRes.uploaded,
    message: uploadRes.message,
    record: updated,
  });
});

app.delete('/api/recipes/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID ricetta non valido.' });
    return;
  }
  const deleted = deleteStoredRecipe(id);
  if (!deleted) {
    res.status(404).json({ error: 'Ricetta non trovata.' });
    return;
  }
  res.json({ ok: true });
});

// ============================================================================
// Online .env Settings Panel & AI Connection Test
// ============================================================================

function buildSettingsView(): AppSettingsView {
  const authState = getAuthConfigurationState();
  return {
    hasAppPassword: !authState.needsSetup,
    appPasswordSource: authState.source,
    hasGeminiKey: Boolean((process.env.GEMINI_API_KEY || '').trim()),
    geminiKeySource: (process.env.GEMINI_API_KEY || '').trim() ? 'env' : 'none',
    mcEmail: (process.env.MC_EMAIL || '').trim(),
    hasMcPassword: Boolean((process.env.MC_PASSWORD || '').trim()),
    defaultMultiplier: getDefaultMultiplier(),
    mcBaseUrl: getMcBaseUrl(),
    mcLocale: getMcLocale(),
    envFilePath: path.basename(getEnvFilePath()),
    mcSession: getMcSessionStatus(),
  };
}

app.get('/api/settings', requireAuth, (_req, res) => {
  res.json(buildSettingsView());
});

app.put('/api/settings', requireAuth, (req, res) => {
  try {
    const body = req.body || {};
    const updates: Partial<Record<ManagedEnvKey, string>> = {};

    if (typeof body.appPassword === 'string' && body.appPassword.trim().length > 0) {
      if (body.appPassword.trim().length < 6) {
        res.status(400).json({ error: 'APP_PASSWORD deve avere almeno 6 caratteri.' });
        return;
      }
      updates.APP_PASSWORD = body.appPassword.trim();
      updateClaimedAdminPasswordHash(body.appPassword.trim());
    }

    if (typeof body.geminiApiKey === 'string' && body.geminiApiKey.trim().length > 0) {
      updates.GEMINI_API_KEY = body.geminiApiKey.trim();
    }

    if (typeof body.mcEmail === 'string') {
      updates.MC_EMAIL = body.mcEmail.trim();
    }

    if (typeof body.mcPassword === 'string' && body.mcPassword.trim().length > 0) {
      updates.MC_PASSWORD = body.mcPassword.trim();
    }

    if (body.defaultMultiplier !== undefined) {
      const m = Number(body.defaultMultiplier);
      if (!Number.isFinite(m) || m < 0.5 || m > 3.0) {
        res.status(400).json({ error: 'DEFAULT_MULTIPLIER deve essere compreso tra 0.5 e 3.0.' });
        return;
      }
      updates.DEFAULT_MULTIPLIER = String(Number(m.toFixed(2)));
    }

    if (typeof body.mcBaseUrl === 'string' && body.mcBaseUrl.trim().length > 0) {
      try {
        const parsed = new URL(body.mcBaseUrl.trim());
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error('Protocollo non valido');
        }
        updates.MC_BASE_URL = parsed.origin;
      } catch {
        res.status(400).json({ error: 'MC_BASE_URL non valido.' });
        return;
      }
    }

    if (typeof body.mcLocale === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(body.mcLocale.trim())) {
      updates.MC_LOCALE = body.mcLocale.trim();
    }

    if (Object.keys(updates).length > 0) {
      updateEnvAndHotReload(updates);
    }

    res.json({
      ok: true,
      message: 'Configurazione salvata in .env e ricaricata a caldo senza riavvio del servizio.',
      settings: buildSettingsView(),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Impossibile aggiornare il file .env.',
    });
  }
});

app.post('/api/settings/test-ai', requireAuth, async (_req, res) => {
  const result = await testGeminiConnection();
  res.status(result.ok ? 200 : 502).json(result);
});

// ============================================================================
// Monsieur Cuisine Direct Login & Persistent Cookie Backup Routes
// ============================================================================

app.post('/api/mc/login', requireAuth, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : undefined;
  const password = typeof req.body?.password === 'string' ? req.body.password.trim() : undefined;
  const result = await loginMonsieurCuisineDirect(email, password);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/mc/verify', requireAuth, async (_req, res) => {
  const result = await verifyMcSession();
  res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/mc/cookies/export', requireAuth, (_req, res) => {
  const session = exportMcSessionBackup();
  if (!session) {
    res.status(404).json({ error: 'Nessun file data/mc_session.json presente da esportare.' });
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="mc_session_backup.json"');
  res.send(JSON.stringify(session, null, 2));
});

app.post('/api/mc/cookies/import', requireAuth, async (req, res) => {
  const rawJson = typeof req.body?.json === 'string' ? req.body.json : '';
  const email = typeof req.body?.email === 'string' ? req.body.email : undefined;
  if (!rawJson.trim()) {
    res.status(400).json({ error: 'Incolla i cookie (JSON o stringa header Cookie) prima di importare.' });
    return;
  }
  const result = await importMcCookiesFromInput(rawJson, email);
  // Return 200 if cookies were saved (even if remote verification failed, so UI shows exact status + warning)
  res.status(result.status.cookieCount > 0 ? 200 : 400).json(result);
});

// ============================================================================
// Oracle Cloud VM Deployment Files Viewer Endpoint
// ============================================================================

app.get('/api/deploy/files', requireAuth, (_req, res) => {
  const deployDir = path.resolve(process.cwd(), 'deploy');
  const readDeployFile = (name: string): string => {
    const filePath = path.resolve(deployDir, name);
    if (!filePath.startsWith(deployDir + path.sep) || !fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
  };

  res.json({
    nginx: readDeployFile('nginx-mc-bridge.conf'),
    systemd: readDeployFile('mc-bridge.service'),
    dockerCompose: readDeployFile('docker-compose.yml'),
    dockerfile: readDeployFile('Dockerfile'),
  });
});

// ============================================================================
// Frontend Static / Vite Dev Middleware
// ============================================================================

async function startServer() {
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[mc-smart-bridge] Server listening on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[mc-smart-bridge] Failed to start server:', err);
  process.exit(1);
});
