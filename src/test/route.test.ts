import { test } from 'node:test';
import assert from 'node:assert';
import { buildExposedModelId, parseExposedModelId } from '../provider/route';

test('buildExposedModelId prefixes when multiple providers', () => {
  assert.strictEqual(buildExposedModelId('gpt-4', 'openrouter', 2), 'openrouter/gpt-4');
  assert.strictEqual(buildExposedModelId('gpt-4', 'openrouter', 1), 'gpt-4');
});

test('parseExposedModelId splits provider prefix', () => {
  const p = parseExposedModelId('dashscope/qwen3-max', ['dashscope', 'openrouter']);
  assert.strictEqual(p.providerId, 'dashscope');
  assert.strictEqual(p.rawModelId, 'qwen3-max');
});
