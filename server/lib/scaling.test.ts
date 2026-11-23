import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSeasoningMultiplier,
  roundPracticalAmount,
  scaleIngredient,
  evaluateBowlCapacity,
  adjustStepDurationForScale,
} from './scaling';
import type { RecipeIngredient, RecipeStep } from '../../src/shared/types';

test('seasoning multiplier is non-linear and capped between 1.2x and 1.3x for 1.5x scaling', () => {
  const m = computeSeasoningMultiplier(1.5);
  assert.ok(m >= 1.2 && m <= 1.3, `Expected 1.2..1.3, got ${m}`);
  assert.equal(computeSeasoningMultiplier(1.0), 1.0);
});

test('practical rounding rounds eggs to nearest integer and weights to 5g/10g', () => {
  assert.equal(roundPracticalAmount(4.4, 'pz', 'Uova medie'), 4);
  assert.equal(roundPracticalAmount(4.6, 'pz', 'Uova'), 5);
  assert.equal(roundPracticalAmount(373, 'g', 'Riso Carnaroli'), 370);
  assert.equal(roundPracticalAmount(376, 'g', 'Riso Carnaroli'), 380);
  assert.equal(roundPracticalAmount(43, 'g', 'Burro'), 45);
  assert.equal(roundPracticalAmount(22, 'g', 'Olio EVO'), 20);
});

test('scaleIngredient applies 1.5x to main ingredients and <=1.3x to seasonings', () => {
  const beef: RecipeIngredient = {
    id: '1',
    name: 'Polpa di manzo a cubetti',
    originalAmount: 600,
    amount: 600,
    unit: 'g',
    isSeasoning: false,
    weighInBowl: true,
  };
  const oil: RecipeIngredient = {
    id: '2',
    name: 'Olio extravergine d’oliva',
    originalAmount: 40,
    amount: 40,
    unit: 'g',
    isSeasoning: true,
    weighInBowl: true,
  };

  const scaledBeef = scaleIngredient(beef, 1.5);
  const scaledOil = scaleIngredient(oil, 1.5);

  assert.equal(scaledBeef.amount, 900);
  assert.equal(scaledOil.amount, 50); // 40 * 1.25 = 50 (not 60!)
});

test('evaluateBowlCapacity flags rice/pasta over 500g and total volume over 3000ml', () => {
  const overloaded: RecipeIngredient[] = [
    { id: '1', name: 'Riso Carnaroli', originalAmount: 400, amount: 600, unit: 'g', isSeasoning: false, weighInBowl: true },
    { id: '2', name: 'Brodo vegetale', originalAmount: 1600, amount: 2400, unit: 'ml', isSeasoning: false, weighInBowl: true },
  ];
  const report = evaluateBowlCapacity(overloaded);
  assert.equal(report.status, 'exceeded');
  assert.equal(report.dryRiceOrPastaGrams, 600);
  assert.ok(report.warnings.some((w) => w.includes('500 g')));
  assert.ok(report.warnings.some((w) => w.includes('3000 ml')));
});

test('evaluateBowlCapacity does not misclassify patate a pasta gialla as dry pasta', () => {
  const stew: RecipeIngredient[] = [
    { id: '1', name: 'Patate a pasta gialla a cubetti', originalAmount: 450, amount: 680, unit: 'g', isSeasoning: false, weighInBowl: true },
    { id: '2', name: 'Polpa di manzo a cubetti', originalAmount: 600, amount: 900, unit: 'g', isSeasoning: false, weighInBowl: true },
    { id: '3', name: 'Brodo di carne', originalAmount: 350, amount: 520, unit: 'ml', isSeasoning: false, weighInBowl: true },
  ];
  const report = evaluateBowlCapacity(stew);
  assert.equal(report.dryRiceOrPastaGrams, 0);
  assert.equal(report.status, 'ok');
});

test('adjustStepDurationForScale extends rosolare and cuocere times when scaling up', () => {
  const soffritto: RecipeStep = {
    id: 's1',
    stepNumber: 1,
    instruction: 'Soffriggere la cipolla',
    program: 'rosolare',
    durationSec: 300,
    temperatureC: 130,
    speed: null,
    reverse: false,
    useBladeCover: false,
  };
  const boiling: RecipeStep = {
    id: 's2',
    stepNumber: 2,
    instruction: 'Cuocere il brodo',
    program: 'cuocere',
    durationSec: 600,
    temperatureC: 100,
    speed: null,
    reverse: false,
    useBladeCover: false,
  };

  assert.equal(adjustStepDurationForScale(soffritto, 1.0, 1.5), 390);
  assert.equal(adjustStepDurationForScale(boiling, 1.0, 1.5), 750);
});
