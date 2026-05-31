import { getModelDefaults } from './modelDefaults';

export interface RequestBodyParams {
  rawModelId: string;
  openaiMessages: unknown[];
  maxTokens: number;
  modelParams: Record<string, unknown>;
  toolConfig: { tools?: unknown[]; tool_choice?: unknown };
}

export function buildRequestBody(params: RequestBodyParams): Record<string, unknown> {
  const { rawModelId, openaiMessages, maxTokens, modelParams, toolConfig } = params;

  const replaceDefaults = modelParams._replaceDefaults === true;
  const paramsCopy = { ...modelParams };
  delete paramsCopy._replaceDefaults;

  const defaults = replaceDefaults ? {} : getModelDefaults(rawModelId);

  const body: Record<string, unknown> = {
    model: rawModelId,
    messages: openaiMessages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
    ...defaults,
  };

  const owned = new Set(['model', 'messages', 'stream', 'stream_options', 'tools', 'tool_choice']);

  for (const [key, value] of Object.entries(paramsCopy)) {
    if (key !== 'max_tokens' && !owned.has(key)) {
      body[key] = value;
    }
  }

  if (typeof paramsCopy.max_tokens === 'number') {
    body.max_tokens = paramsCopy.max_tokens;
  }

  if (toolConfig.tools) {
    body.tools = toolConfig.tools;
  }
  if (toolConfig.tool_choice) {
    body.tool_choice = toolConfig.tool_choice;
  }

  return body;
}
