import type {
  BowlCapacityReport,
  RecipeIngredient,
  RecipeStep,
} from '../../src/shared/types';

export const MC_BOWL_MAX_VOLUME_ML = 3000;
export const MC_MAX_DRY_RICE_PASTA_G = 500;
export const MC_MAX_VEG_AND_LIQUID_G = 1400;

const SEASONING_KEYWORDS = [
  'sale',
  'pepe',
  'spezie',
  'peperoncino',
  'aglio',
  'zucchero',
  'olio',
  'soffritto',
  'noce moscata',
  'cannella',
  'paprika',
  'curry',
  'curcuma',
  'cumino',
  'origano',
  'rosmarino',
  'timo',
  'alloro',
  'salvia',
  'basilico',
  'prezzemolo',
  'zafferano',
  'zenzero',
  'chiodi di garofano',
  'aceto',
  'salsa di soia',
];

const EGG_KEYWORDS = ['uovo', 'uova', 'tuorlo', 'tuorli', 'albume', 'albumi'];

const DRY_GRAIN_KEYWORDS = [
  'riso',
  'carnaroli',
  'arborio',
  'vialone',
  'basmati',
  'pasta',
  'penne',
  'fusilli',
  'rigatoni',
  'mezzemaniche',
  'ditalini',
  'farro',
  'orzo',
  'couscous',
];

const LIQUID_UNITS = new Set(['ml', 'l', 'lt', 'cl', 'dl']);

export function detectIsSeasoning(name: string, note = ''): boolean {
  const haystack = `${name} ${note}`.toLowerCase();
  return SEASONING_KEYWORDS.some((kw) => haystack.includes(kw));
}

export function detectIsEgg(name: string, unit = ''): boolean {
  const haystack = `${name} ${unit}`.toLowerCase();
  if (unit.toLowerCase() === 'g' || unit.toLowerCase() === 'gr') {
    return false;
  }
  return EGG_KEYWORDS.some((kw) => haystack.includes(kw));
}

/**
 * Computes effective non-linear multiplier for seasonings:
 * When standard multiplier is > 1.0, seasonings are capped between 1.2x and 1.3x
 * (specifically scaled gently: 1 + (multiplier - 1) * 0.5, clamped to [1.2, 1.3] when multiplier >= 1.4).
 */
export function computeSeasoningMultiplier(baseMultiplier: number): number {
  if (baseMultiplier <= 1) {
    return Number(Math.max(0.25, baseMultiplier).toFixed(2));
  }
  const gentle = 1 + (baseMultiplier - 1) * 0.5;
  if (baseMultiplier >= 1.4) {
    return Number(Math.min(1.3, Math.max(1.2, gentle)).toFixed(2));
  }
  return Number(Math.min(1.25, gentle).toFixed(2));
}

/**
 * Practical kitchen rounding:
 * - Eggs -> nearest integer (min 1)
 * - Grams / ml >= 100 -> nearest 10
 * - Grams / ml >= 20 -> nearest 5
 * - Small values (spoons, cloves, < 20) -> nearest 0.5 or integer
 */
export function roundPracticalAmount(
  value: number,
  unit: string,
  name: string
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;

  if (detectIsEgg(name, unit)) {
    return Math.max(1, Math.round(value));
  }

  const u = unit.trim().toLowerCase();
  if (u === 'g' || u === 'gr' || u === 'ml') {
    if (value >= 100) {
      return Math.round(value / 10) * 10;
    }
    if (value >= 20) {
      return Math.round(value / 5) * 5;
    }
    return Math.max(1, Math.round(value));
  }

  if (u === 'kg' || u === 'l' || u === 'lt') {
    // Round to 0.05 kg / L (50g / 50ml)
    return Number((Math.round(value * 20) / 20).toFixed(2));
  }

  // Pieces, cloves, spoons, cups -> nearest 0.5
  if (value >= 4) {
    return Math.round(value);
  }
  return Number((Math.round(value * 2) / 2).toFixed(1));
}

export function scaleIngredient(
  ingredient: RecipeIngredient,
  multiplier: number
): RecipeIngredient {
  const baseAmount =
    ingredient.originalAmount !== null && ingredient.originalAmount !== undefined
      ? ingredient.originalAmount
      : ingredient.amount;

  if (baseAmount === null || baseAmount === undefined) {
    return { ...ingredient };
  }

  const isSeasoning = ingredient.isSeasoning ?? detectIsSeasoning(ingredient.name, ingredient.note);
  const effectiveMultiplier = isSeasoning
    ? computeSeasoningMultiplier(multiplier)
    : multiplier;

  const rawScaled = baseAmount * effectiveMultiplier;
  const rounded = roundPracticalAmount(rawScaled, ingredient.unit, ingredient.name);

  return {
    ...ingredient,
    isSeasoning,
    originalAmount: baseAmount,
    amount: rounded,
  };
}

export function scaleAllIngredients(
  ingredients: RecipeIngredient[],
  multiplier: number
): RecipeIngredient[] {
  return ingredients.map((ing) => scaleIngredient(ing, multiplier));
}

const NOT_DRY_PASTA_PHRASES = [
  'pasta gialla',
  'pasta bianca',
  'pasta sfoglia',
  'pasta frolla',
  'pasta bris',
  'pasta fillo',
  'pasta di ',
  'pasta d’',
  "pasta d'",
  'pasta madre',
];

export function detectIsDryGrain(name: string): boolean {
  const lower = name.toLowerCase();
  if (NOT_DRY_PASTA_PHRASES.some((phrase) => lower.includes(phrase))) {
    return false;
  }
  return DRY_GRAIN_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(lower));
}

export function estimateIngredientGramsAndVolume(ing: RecipeIngredient): {
  grams: number;
  volumeMl: number;
  isLiquid: boolean;
  isDryGrain: boolean;
} {
  const amt = ing.amount ?? 0;
  const u = (ing.unit || '').trim().toLowerCase();
  const nameLower = ing.name.toLowerCase();
  const isDryGrain = detectIsDryGrain(ing.name);

  let grams = 0;
  let volumeMl = 0;
  let isLiquid = false;

  if (u === 'g' || u === 'gr') {
    grams = amt;
    volumeMl = isDryGrain ? amt * 1.35 : amt * 1.05;
  } else if (u === 'kg') {
    grams = amt * 1000;
    volumeMl = grams * 1.05;
  } else if (u === 'ml') {
    grams = amt;
    volumeMl = amt;
    isLiquid = true;
  } else if (u === 'l' || u === 'lt') {
    grams = amt * 1000;
    volumeMl = amt * 1000;
    isLiquid = true;
  } else if (u === 'cl') {
    grams = amt * 10;
    volumeMl = amt * 10;
    isLiquid = true;
  } else if (u === 'dl') {
    grams = amt * 100;
    volumeMl = amt * 100;
    isLiquid = true;
  } else if (u.includes('cucchiai')) {
    grams = amt * 15;
    volumeMl = amt * 15;
    isLiquid = nameLower.includes('olio') || nameLower.includes('acqua') || nameLower.includes('latte');
  } else if (u.includes('cucchiain')) {
    grams = amt * 5;
    volumeMl = amt * 5;
  } else if (detectIsEgg(ing.name, u)) {
    grams = amt * 60;
    volumeMl = amt * 55;
  } else if (amt > 0 && !LIQUID_UNITS.has(u)) {
    // Generic piece (e.g. 1 cipolla, 2 carote, 1 spicchio)
    if (nameLower.includes('spicchi') || nameLower.includes('aglio')) {
      grams = amt * 6;
      volumeMl = amt * 6;
    } else if (nameLower.includes('cipoll') || nameLower.includes('patat') || nameLower.includes('pomodor')) {
      grams = amt * 120;
      volumeMl = amt * 130;
    } else {
      grams = amt * 50;
      volumeMl = amt * 55;
    }
  }

  return {
    grams: Math.round(grams),
    volumeMl: Math.round(ing.estimatedVolumeMl && ing.estimatedVolumeMl > 0 ? ing.estimatedVolumeMl : volumeMl),
    isLiquid,
    isDryGrain,
  };
}

export function evaluateBowlCapacity(ingredients: RecipeIngredient[]): BowlCapacityReport {
  let totalVolumeMl = 0;
  let dryRiceOrPastaGrams = 0;
  let vegAndLiquidGrams = 0;

  for (const ing of ingredients) {
    const est = estimateIngredientGramsAndVolume(ing);
    totalVolumeMl += est.volumeMl;
    if (est.isDryGrain) {
      dryRiceOrPastaGrams += est.grams;
    } else if (!ing.isSeasoning) {
      vegAndLiquidGrams += est.grams;
    }
  }

  const warnings: string[] = [];

  if (dryRiceOrPastaGrams > MC_MAX_DRY_RICE_PASTA_G) {
    warnings.push(
      `Quantità di riso/pasta corta (${dryRiceOrPastaGrams} g) superiore al limite consigliato di ${MC_MAX_DRY_RICE_PASTA_G} g per Monsieur Cuisine Smart: valuta di ridurre il moltiplicatore o cuocere in due lotti.`
    );
  }

  if (vegAndLiquidGrams > MC_MAX_VEG_AND_LIQUID_G && totalVolumeMl > 2400) {
    warnings.push(
      `Massa di verdure/carne e liquidi elevata (${vegAndLiquidGrams} g, stima ${totalVolumeMl} ml): verifica di non superare la tacca MAX (3,0 L) durante la bollitura.`
    );
  }

  if (totalVolumeMl > MC_BOWL_MAX_VOLUME_ML) {
    warnings.push(
      `Volume totale stimato (${totalVolumeMl} ml) oltre la capienza massima del boccale (${MC_BOWL_MAX_VOLUME_ML} ml): riduci le porzioni o aggiungi i liquidi in due fasi.`
    );
  } else if (totalVolumeMl > 2550) {
    warnings.push(
      `Riempimento vicino al limite massimo (${Math.round((totalVolumeMl / MC_BOWL_MAX_VOLUME_ML) * 100)}%): usa il misurino inclinato o il cestello paraschizzi.`
    );
  }

  const fillPercent = Math.min(130, Math.round((totalVolumeMl / MC_BOWL_MAX_VOLUME_ML) * 100));
  const status: BowlCapacityReport['status'] =
    totalVolumeMl > MC_BOWL_MAX_VOLUME_ML || dryRiceOrPastaGrams > MC_MAX_DRY_RICE_PASTA_G
      ? 'exceeded'
      : warnings.length > 0
        ? 'warning'
        : 'ok';

  return {
    estimatedVolumeMl: Math.round(totalVolumeMl),
    maxVolumeMl: MC_BOWL_MAX_VOLUME_ML,
    fillPercent,
    dryRiceOrPastaGrams: Math.round(dryRiceOrPastaGrams),
    vegAndLiquidGrams: Math.round(vegAndLiquidGrams),
    status,
    warnings,
  };
}

/**
 * Adjusts cooking times when scaling up (>= 1.35x):
 * +1 to +2 min on soffritto/rosolare, +2 to +3 min on boiling/cuocere.
 */
export function adjustStepDurationForScale(
  step: RecipeStep,
  fromMultiplier: number,
  toMultiplier: number
): number {
  if (step.durationSec <= 0 || fromMultiplier === toMultiplier) {
    return step.durationSec;
  }
  const scaledUp = toMultiplier >= 1.35 && fromMultiplier < 1.35;
  const scaledDown = toMultiplier < 1.35 && fromMultiplier >= 1.35;

  if (step.program === 'rosolare') {
    if (scaledUp) return step.durationSec + 90; // +1.5 min
    if (scaledDown) return Math.max(60, step.durationSec - 90);
  }
  if (step.program === 'cuocere' || (step.temperatureC !== null && step.temperatureC >= 98)) {
    if (scaledUp) return step.durationSec + 150; // +2.5 min
    if (scaledDown) return Math.max(120, step.durationSec - 150);
  }
  return step.durationSec;
}
