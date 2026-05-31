export type ModelDefaultsMap = Record<string, Record<string, unknown>>;

const FALLBACK_DEFAULTS: Record<string, unknown> = { temperature: 0.7 };

const MODEL_OVERRIDES: ModelDefaultsMap = {
  'qwen3-coder': { temperature: 0 },
  'qwen3.6': { temperature: 0 },
  'glm-5': { temperature: 0.1 },
  'gpt-5': { temperature: 1 },
  'gpt-5.5': {},
};

export function findLongestPrefixMatch<T>(id: string, entries: Record<string, T>): T | undefined {
  let best: { key: string; value: T } | undefined;
  for (const [key, value] of Object.entries(entries)) {
    if (id === key || id.startsWith(key)) {
      if (!best || key.length > best.key.length) {
        best = { key, value };
      }
    }
  }
  return best?.value;
}

export function getModelDefaults(modelId: string): Record<string, unknown> {
  const override = findLongestPrefixMatch(modelId, MODEL_OVERRIDES);
  if (override !== undefined) {
    return { ...override };
  }
  return { ...FALLBACK_DEFAULTS };
}
