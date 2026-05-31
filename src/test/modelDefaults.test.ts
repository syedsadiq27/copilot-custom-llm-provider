import { test } from 'node:test';
import assert from 'node:assert';
import { findLongestPrefixMatch, getModelDefaults } from '../provider/modelDefaults';

test('findLongestPrefixMatch picks longest key', () => {
  const m = { gpt: { temperature: 1 }, 'gpt-4': { temperature: 0.5 } };
  assert.strictEqual(findLongestPrefixMatch('gpt-4-turbo', m)?.temperature, 0.5);
});

test('getModelDefaults returns fallback temperature', () => {
  assert.strictEqual(getModelDefaults('unknown-model').temperature, 0.7);
});
