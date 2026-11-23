import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSourceUrl,
  hashTitle,
  computeTitleSimilarity,
  findFuzzyMatches,
} from './dedupe';

test('normalizeSourceUrl strips utm params, www, fragments, and trailing slashes', () => {
  const a = normalizeSourceUrl('http://www.GialloZafferano.it/ricette/Spezzatino/?utm_source=ig&fbclid=123#step1');
  const b = normalizeSourceUrl('https://giallozafferano.it/ricette/Spezzatino');
  assert.equal(a, b);
});

test('hashTitle normalizes accents and punctuation consistently', () => {
  assert.equal(hashTitle('Ragù alla Bolognese!'), hashTitle('ragu alla bolognese'));
});

test('computeTitleSimilarity flags >85% duplicates and ignores distinct recipes', () => {
  const sameScore = computeTitleSimilarity(
    'Spezzatino di manzo con patate',
    'Spezzatino di manzo con le patate'
  );
  assert.ok(sameScore > 0.85, `Expected >0.85, got ${sameScore}`);

  const diffScore = computeTitleSimilarity(
    'Spezzatino di manzo con patate',
    'Tiramisù classico al mascarpone'
  );
  assert.ok(diffScore < 0.4, `Expected <0.4, got ${diffScore}`);
});

test('findFuzzyMatches returns sorted matches above 85% threshold', () => {
  const matches = findFuzzyMatches('Risotto ai funghi porcini', [
    { title: 'Risotto ai funghi porcini classico', source: 'remote_mc', remoteId: 'mc-1' },
    { title: 'Risotto con funghi porcini', source: 'local_title', remoteId: 'mc-2' },
    { title: 'Lasagne alla bolognese', source: 'remote_mc', remoteId: 'mc-3' },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].remoteId, 'mc-2');
});
