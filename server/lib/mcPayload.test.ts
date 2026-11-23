import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProposedChangeToggle,
  buildMonsieurCuisinePayload,
  buildRawSmartMode,
  LOCALE_COMPLEXITY_IDS,
  MONSIEUR_CUISINE_SMART_DEVICE_TYPE_ID,
} from './mcPayload';
import type { ConvertedRecipe, RecipeStep } from '../../src/shared/types';

const sampleRecipe: ConvertedRecipe = {
  title: 'Spezzatino di manzo con patate',
  description: 'Spezzatino tenero adattato per Monsieur Cuisine Smart.',
  sourceUrl: 'https://ricette.giallozafferano.it/Spezzatino-di-manzo-con-patate.html',
  sourceDomain: 'ricette.giallozafferano.it',
  category: 'Piatti principali',
  difficulty: 'easy',
  originalServings: 4,
  targetServings: 5,
  appliedMultiplier: 1.5,
  prepTimeMin: 15,
  cookTimeMin: 60,
  totalTimeMin: 75,
  coverImageUrl: null,
  nutrition: {
    kcal: 465.4,
    proteine: 34.5,
    carboidrati: 29.2,
    grassi: 21.8,
  },
  ingredients: [
    {
      id: 'i1',
      name: 'Manzo a cubetti',
      originalAmount: 600,
      amount: 900,
      unit: 'g',
      isSeasoning: false,
      weighInBowl: true,
    },
  ],
  steps: [
    {
      id: 's1',
      stepNumber: 1,
      instruction: 'Cuocere lo spezzatino lentamente.',
      program: 'cottura_lenta',
      durationSec: 2700,
      temperatureC: 92,
      speed: null,
      reverse: true,
      useBladeCover: true,
    },
    {
      id: 's2',
      stepNumber: 2,
      instruction: 'Impiattare caldo con prezzemolo fresco.',
      program: 'prep',
      durationSec: 0,
      temperatureC: null,
      speed: null,
      reverse: false,
      useBladeCover: false,
    },
  ],
  proposedChanges: [
    {
      id: 'c1',
      type: 'program_optimization',
      title: 'Sostituito Step 1 manuale con programma Cottura lenta',
      reason: 'Evita lo sfaldamento di carne e patate rispetto alla Velocità 1 continua.',
      stepIndex: 0,
      originalSummary: 'Manuale 45 min, 95°C, Vel. 1 Antiorario',
      proposedSummary: 'Cottura lenta 45 min, 90°C + Coprilame',
      accepted: true,
      originalStepPatch: { program: 'manual', speed: 1, temperatureC: 95, useBladeCover: false },
      proposedStepPatch: { program: 'cottura_lenta', speed: null, temperatureC: 90, useBladeCover: true },
    },
  ],
  bowlCapacity: {
    estimatedVolumeMl: 1800,
    maxVolumeMl: 3000,
    fillPercent: 60,
    dryRiceOrPastaGrams: 0,
    vegAndLiquidGrams: 1200,
    status: 'ok',
    warnings: [],
  },
};

test('applyProposedChangeToggle reverts and reapplies step patches accurately', () => {
  const reverted = applyProposedChangeToggle(sampleRecipe.steps, sampleRecipe.proposedChanges[0], false);
  assert.equal(reverted[0].program, 'manual');
  assert.equal(reverted[0].speed, 1);
  assert.equal(reverted[0].useBladeCover, false);

  const reapplied = applyProposedChangeToggle(reverted, sampleRecipe.proposedChanges[0], true);
  assert.equal(reapplied[0].program, 'cottura_lenta');
  assert.equal(reapplied[0].speed, null);
  assert.equal(reapplied[0].useBladeCover, true);
});

test('buildMonsieurCuisinePayload builds official MC3.0 SmartRecipePayload schema', () => {
  const payload = buildMonsieurCuisinePayload(sampleRecipe, {
    locale: 'it-IT',
    detailsMediaId: 991,
    thumbnailMediaId: 992,
  });

  assert.equal(payload.status, 'draft');
  assert.equal(payload.source, 'member');
  assert.equal(payload.languageLocale, 'it-IT');
  assert.deepEqual(payload.deviceTypeIds, [MONSIEUR_CUISINE_SMART_DEVICE_TYPE_ID]);
  assert.equal(payload.complexityId, LOCALE_COMPLEXITY_IDS['it-IT'].easy);
  assert.deepEqual(payload.categoryIds, [261]);
  assert.equal(payload.allowSocialSharing, false);
  assert.equal(payload.detailsImage.landscapeMediaId, 991);
  assert.equal(payload.thumbnail.portraitMediaId, 992);

  // Nutrients must be whole integers with official names & units
  assert.deepEqual(payload.nutrients, [
    { name: 'calories', unit: 'kCal', amount: 465 },
    { name: 'protein', unit: 'g', amount: 35 },
    { name: 'carbohydrate', unit: 'g', amount: 29 },
    { name: 'fat', unit: 'g', amount: 22 },
  ]);

  const serving = payload.servingSizes[0];
  assert.equal(serving.amount, 5);
  assert.equal(serving.unit, 'porzioni');
  assert.equal(serving.ingredientGroups[0].ingredients[0].amount, '900');
  assert.equal(serving.ingredientGroups[0].ingredients[0].order, 1);

  // Step 0: slow_cooking snaps 92°C -> 90°C, empty description for mode step, title includes Coprilame
  const step0 = serving.steps[0];
  assert.ok(step0.title.includes('Coprilame'));
  assert.equal(step0.description, '');
  assert.deepEqual(step0.mode, {
    type: 'slow_cooking',
    modeSetting: null,
    deviceSettings: [{ order: 0, temperature: 90, time: 2700 }],
  });

  // Step 1: text-only prep step has mode=null and non-empty description
  const step1 = serving.steps[1];
  assert.equal(step1.mode, null);
  assert.ok(step1.description.includes('prezzemolo'));
});

test('buildRawSmartMode enforces MC3.0 hardware constraints (speed cap & duration bounds)', () => {
  const heatedFastStep: RecipeStep = {
    id: 'm1',
    stepNumber: 1,
    instruction: 'Mantecare caldo',
    program: 'manual',
    durationSec: 120,
    temperatureC: 98,
    speed: 6,
    reverse: true,
    useBladeCover: false,
  };
  const rawManual = buildRawSmartMode(heatedFastStep);
  assert.deepEqual(rawManual, {
    type: 'customized',
    modeSetting: null,
    deviceSettings: [{ order: 0, temperature: 100, time: 120, speed: 3, clockwise: false }],
  });

  // Slow cooking under 15 min (900s) safely falls back to customized instead of violating MC API schema
  const shortSlowCook: RecipeStep = {
    id: 'm2',
    stepNumber: 2,
    instruction: 'Insaporire 10 min',
    program: 'cottura_lenta',
    durationSec: 600,
    temperatureC: 90,
    speed: null,
    reverse: true,
    useBladeCover: false,
  };
  const rawShortSlow = buildRawSmartMode(shortSlowCook);
  assert.equal(rawShortSlow?.type, 'customized');
  assert.equal(rawShortSlow?.deviceSettings[0].speed, 1);
  assert.equal(rawShortSlow?.deviceSettings[0].clockwise, false);
});

test('buildMonsieurCuisinePayload maps official it-IT categories, legacy aliases, and liveGuide IDs', () => {
  const salse = buildMonsieurCuisinePayload(
    { ...sampleRecipe, category: 'Salse e condimenti' },
    { locale: 'it-IT' }
  );
  assert.deepEqual(salse.categoryIds, [221]);

  const taglia = buildMonsieurCuisinePayload(
    { ...sampleRecipe, category: 'Tagliaverdure' },
    { locale: 'it-IT' }
  );
  assert.deepEqual(taglia.categoryIds, [557]);

  const legacy = buildMonsieurCuisinePayload(
    { ...sampleRecipe, category: 'Primi piatti' as unknown as ConvertedRecipe['category'] },
    { locale: 'it-IT' }
  );
  assert.deepEqual(legacy.categoryIds, [261]);

  // Dynamic liveGuide resolves exact locale IDs returned by WordPress load_recipe_post
  const withGuide = buildMonsieurCuisinePayload(
    { ...sampleRecipe, category: 'Zuppe & stufati' },
    {
      locale: 'it-IT',
      liveGuide: {
        locale: 'it-IT',
        categories: [
          { id: 229, name: 'Zuppe & stufati' },
          { id: 261, name: 'Piatti principali' },
        ],
        complexityLevels: [
          { id: 109, name: 'Minima' },
          { id: 100, name: 'Media' },
        ],
      },
    }
  );
  assert.deepEqual(withGuide.categoryIds, [229]);
  assert.equal(withGuide.complexityId, 109);
});
