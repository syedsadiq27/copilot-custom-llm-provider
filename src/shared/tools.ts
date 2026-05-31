import * as vscode from 'vscode';
import type { OpenAITool } from '../types';

export function sanitizeFunctionName(name: unknown): string {
  if (typeof name !== 'string' || !name) {
    return 'tool';
  }
  let sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = `tool_${sanitized}`;
  }
  return sanitized.replace(/_+/g, '_').slice(0, 64);
}

function pruneSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} };
  }
  const allow = new Set([
    'type', 'properties', 'required', 'additionalProperties', 'description',
    'enum', 'default', 'items', 'anyOf', 'oneOf', 'allOf', '$ref',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (allow.has(k)) {
      out[k] = v;
    }
  }
  if (!out.type) {
    out.type = 'object';
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [pk, pv] of Object.entries(out.properties as Record<string, unknown>)) {
      props[pk] = pruneSchema(pv);
    }
    out.properties = props;
  }
  return out;
}

export function convertTools(
  options: vscode.ProvideLanguageModelChatResponseOptions
): { tools?: OpenAITool[]; tool_choice?: unknown } {
  const tools = options.tools ?? [];
  if (tools.length === 0) {
    return {};
  }

  const toolDefs: OpenAITool[] = tools.map((t) => ({
    type: 'function',
    function: {
      name: sanitizeFunctionName(t.name),
      description: typeof t.description === 'string' ? t.description : '',
      parameters: pruneSchema(t.inputSchema ?? { type: 'object', properties: {} }),
    },
  }));

  let tool_choice: unknown = 'auto';
  if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
    tool_choice = tools.length === 1
      ? { type: 'function', function: { name: sanitizeFunctionName(tools[0].name) } }
      : 'required';
  }

  return { tools: toolDefs, tool_choice };
}
