import * as vscode from 'vscode';
import type { ModelConfig, ProviderConfig } from '../types';
import { buildExposedModelId } from '../provider/route';
import { inferCapabilities } from '../provider/capabilities';
import { getDiscoveryTimeoutMs, getDefaultMaxOutputTokens, getDefaultContextLength } from '../provider/config';
import { resolveProviderApiKey } from '../provider/secrets';

const KNOWN_LIMITS: Array<[string, { maxInputTokens: number; maxOutputTokens: number }]> = [
  ['qwen3.6-plus', { maxInputTokens: 1000000, maxOutputTokens: 65536 }],
  ['qwen3.5-plus', { maxInputTokens: 1000000, maxOutputTokens: 16384 }],
  ['qwen3-max', { maxInputTokens: 131072, maxOutputTokens: 16384 }],
  ['qwen3-coder', { maxInputTokens: 131072, maxOutputTokens: 16384 }],
  ['kimi-k2', { maxInputTokens: 262144, maxOutputTokens: 32768 }],
  ['glm-5', { maxInputTokens: 204800, maxOutputTokens: 16384 }],
  ['glm-4', { maxInputTokens: 131072, maxOutputTokens: 8192 }],
  ['MiniMax', { maxInputTokens: 262144, maxOutputTokens: 8192 }],
  ['qwen-vl', { maxInputTokens: 131072, maxOutputTokens: 8192 }],
];

export function getKnownLimits(id: string) {
  for (const [prefix, limits] of KNOWN_LIMITS) {
    if (id.startsWith(prefix)) return limits;
  }
  return {
    maxInputTokens: getDefaultContextLength(),
    maxOutputTokens: getDefaultMaxOutputTokens(),
  };
}

export function toDisplayName(id: string): string {
  return id.split(/[-_.]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

export function normalizeModelConfig(m: ModelConfig, providerCount: number): ModelConfig {
  const rawModelId = m.rawModelId ?? m.id;
  const id = m.id.includes('/') ? m.id : buildExposedModelId(rawModelId, m.providerId, providerCount);
  const caps = inferCapabilities(rawModelId, {
    supports_function_calling: m.toolCalling,
    supports_vision: m.imageInput,
    supports_pdf_input: m.pdfInput,
  });
  return { ...m, id, rawModelId, ...caps };
}

export async function fetchModelsForProvider(
  provider: ProviderConfig,
  secrets: vscode.SecretStorage,
  providerCount: number
): Promise<ModelConfig[] | null> {
  const apiKey = await resolveProviderApiKey(secrets, provider);
  if (!apiKey) return null;

  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  const timeout = getDiscoveryTimeoutMs();

  try {
    const infoRes = await fetch(`${baseUrl}/model/info`, { headers, signal: AbortSignal.timeout(timeout) });
    if (infoRes.ok) {
      const infoJson = await infoRes.json() as {
        data?: Array<{
          model_name?: string;
          model_info?: {
            max_tokens?: number;
            max_input_tokens?: number;
            supports_tool_choice?: boolean;
            supports_function_calling?: boolean;
            supports_vision?: boolean;
            supports_pdf_input?: boolean;
            modalities?: string[];
          };
        }>;
      };
      if (Array.isArray(infoJson?.data) && infoJson.data.length > 0) {
        return infoJson.data.filter((m) => !!m.model_name).map((m) => {
          const rawModelId = m.model_name!;
          const known = getKnownLimits(rawModelId);
          const info = m.model_info ?? {};
          const caps = inferCapabilities(rawModelId, info);
          return normalizeModelConfig({
            id: buildExposedModelId(rawModelId, provider.id, providerCount),
            rawModelId,
            name: toDisplayName(rawModelId),
            providerId: provider.id,
            maxInputTokens: info.max_input_tokens ?? known.maxInputTokens,
            maxOutputTokens: info.max_tokens ?? known.maxOutputTokens,
            ...caps,
          }, providerCount);
        });
      }
    }

    const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;

    const json = await res.json() as {
      data?: Array<{ id: string; context_length?: number; max_completion_tokens?: number }>;
    };
    if (!Array.isArray(json?.data) || json.data.length === 0) return null;

    return json.data.map((m) => {
      const rawModelId = m.id;
      const known = getKnownLimits(rawModelId);
      const caps = inferCapabilities(rawModelId);
      return normalizeModelConfig({
        id: buildExposedModelId(rawModelId, provider.id, providerCount),
        rawModelId,
        name: toDisplayName(rawModelId),
        providerId: provider.id,
        maxInputTokens: m.context_length ?? known.maxInputTokens,
        maxOutputTokens: m.max_completion_tokens ?? known.maxOutputTokens,
        ...caps,
      }, providerCount);
    });
  } catch {
    return null;
  }
}
