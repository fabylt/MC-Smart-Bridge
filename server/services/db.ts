import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeMcCategory,
  type ConvertedRecipe,
  type NutritionInfo,
  type StoredRecipeRecord,
} from '../../src/shared/types';
import { hashTitle, normalizeSourceUrl } from '../lib/dedupe';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');
const DB_PATH = path.resolve(DATA_DIR, 'recipes.db');

let dbInstance: Database.Database | null = null;

export function ensureDataDirs(): { dataDir: string; uploadsDir: string; dbPath: string } {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  return { dataDir: DATA_DIR, uploadsDir: UPLOADS_DIR, dbPath: DB_PATH };
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  ensureDataDirs();

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      title_hash TEXT NOT NULL,
      source_url TEXT,
      normalized_url TEXT,
      category TEXT NOT NULL,
      original_servings INTEGER NOT NULL,
      target_servings INTEGER NOT NULL,
      applied_multiplier REAL NOT NULL,
      nutrition_json TEXT NOT NULL,
      remote_id TEXT,
      remote_url TEXT,
      upload_status TEXT NOT NULL DEFAULT 'local_draft',
      cover_image_url TEXT,
      recipe_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recipes_normalized_url ON recipes(normalized_url);
    CREATE INDEX IF NOT EXISTS idx_recipes_title_hash ON recipes(title_hash);
  `);

  dbInstance = db;
  return db;
}

export function getAppConfigValue(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setAppConfigValue(key: string, value: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_config (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

interface RawRecipeRow {
  id: number;
  title: string;
  title_hash: string;
  source_url: string | null;
  normalized_url: string | null;
  category: string;
  original_servings: number;
  target_servings: number;
  applied_multiplier: number;
  nutrition_json: string;
  remote_id: string | null;
  remote_url: string | null;
  upload_status: 'synced' | 'local_draft' | 'failed';
  cover_image_url: string | null;
  recipe_json: string;
  created_at: string;
  updated_at: string;
}

function hydrateRow(row: RawRecipeRow): StoredRecipeRecord {
  const normalizedCat = normalizeMcCategory(row.category);
  const parsedRecipe = JSON.parse(row.recipe_json) as ConvertedRecipe;
  parsedRecipe.category = normalizeMcCategory(parsedRecipe.category || normalizedCat);
  return {
    id: row.id,
    title: row.title,
    titleHash: row.title_hash,
    sourceUrl: row.source_url,
    normalizedUrl: row.normalized_url,
    category: normalizedCat,
    originalServings: row.original_servings,
    targetServings: row.target_servings,
    appliedMultiplier: row.applied_multiplier,
    nutrition: JSON.parse(row.nutrition_json) as NutritionInfo,
    remoteId: row.remote_id,
    remoteUrl: row.remote_url,
    uploadStatus: row.upload_status,
    coverImageUrl: row.cover_image_url,
    recipeJson: parsedRecipe,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listStoredRecipes(): StoredRecipeRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM recipes ORDER BY datetime(created_at) DESC, id DESC')
    .all() as RawRecipeRow[];
  return rows.map(hydrateRow);
}

export function findStoredRecipeByNormalizedUrl(normalizedUrl: string): StoredRecipeRecord | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM recipes WHERE normalized_url = ? ORDER BY id DESC LIMIT 1')
    .get(normalizedUrl) as RawRecipeRow | undefined;
  return row ? hydrateRow(row) : null;
}

export function findStoredRecipeById(id: number): StoredRecipeRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as RawRecipeRow | undefined;
  return row ? hydrateRow(row) : null;
}

export function insertStoredRecipe(input: {
  recipe: ConvertedRecipe;
  remoteId: string | null;
  remoteUrl: string | null;
  uploadStatus: 'synced' | 'local_draft' | 'failed';
}): StoredRecipeRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const normalizedUrl = normalizeSourceUrl(input.recipe.sourceUrl);
  const titleHash = hashTitle(input.recipe.title);

  const info = db
    .prepare(
      `INSERT INTO recipes (
        title, title_hash, source_url, normalized_url, category,
        original_servings, target_servings, applied_multiplier,
        nutrition_json, remote_id, remote_url, upload_status,
        cover_image_url, recipe_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.recipe.title,
      titleHash,
      input.recipe.sourceUrl,
      normalizedUrl,
      input.recipe.category,
      input.recipe.originalServings,
      input.recipe.targetServings,
      input.recipe.appliedMultiplier,
      JSON.stringify(input.recipe.nutrition),
      input.remoteId,
      input.remoteUrl,
      input.uploadStatus,
      input.recipe.coverImageUrl,
      JSON.stringify(input.recipe),
      now,
      now
    );

  const created = findStoredRecipeById(Number(info.lastInsertRowid));
  if (!created) {
    throw new Error('Errore durante il salvataggio della ricetta nel database SQLite.');
  }
  return created;
}

export function updateStoredRecipeRemoteInfo(
  id: number,
  remoteId: string | null,
  remoteUrl: string | null,
  uploadStatus: 'synced' | 'local_draft' | 'failed'
): StoredRecipeRecord | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE recipes SET remote_id = ?, remote_url = ?, upload_status = ?, updated_at = ? WHERE id = ?`
  ).run(remoteId, remoteUrl, uploadStatus, now, id);
  return findStoredRecipeById(id);
}

export function deleteStoredRecipe(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  return result.changes > 0;
}
