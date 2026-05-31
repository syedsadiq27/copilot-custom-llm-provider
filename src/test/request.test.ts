import { test } from 'node:test';
import assert from 'node:assert';
import { buildRequestBody } from '../provider/requestBuild';

test('buildRequestBody merges model parameters', () => {
  const body = buildRequestBody({
    rawModelId: 'qwen3-coder-plus',
    openaiMessages: [{ role: 'user', content: 'hi' }],
    maxTokens: 8000,
    modelParams: { temperature: 0, top_p: 1 },
    toolConfig: {},
  });
  assert.strictEqual(body.model, 'qwen3-coder-plus');
  assert.strictEqual(body.max_tokens, 8000);
  assert.strictEqual(body.temperature, 0);
  assert.strictEqual(body.top_p, 1);
  assert.strictEqual(body.stream, true);
});
