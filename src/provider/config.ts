import * as vscode from 'vscode';
import { normalizePositiveNumber } from '../shared/numbers';

const DEFAULT_MAX_OUTPUT = 16000;
const DEFAULT_CONTEXT = 128000;
const DEFAULT_REQUEST_TIMEOUT = 300000;
const DEFAULT_DISCOVERY_TIMEOUT = 30000;
const DEFAULT_STREAM_IDLE = 300000;
const DEFAULT_MAX_OUTPUT_CAP = 65536;

export function getExtensionConfig() {
  return vscode.workspace.getConfiguration('customLlm');
}

export function getDefaultMaxOutputTokens(): number {
  return normalizePositiveNumber(getExtensionConfig().get('defaultMaxOutputTokens', DEFAULT_MAX_OUTPUT))
    ?? DEFAULT_MAX_OUTPUT;
}

export function getDefaultContextLength(): number {
  return normalizePositiveNumber(getExtensionConfig().get('defaultContextLength', DEFAULT_CONTEXT))
    ?? DEFAULT_CONTEXT;
}

export function getMaxOutputTokensCap(): number {
  return normalizePositiveNumber(getExtensionConfig().get('maxOutputTokensCap', DEFAULT_MAX_OUTPUT_CAP))
    ?? DEFAULT_MAX_OUTPUT_CAP;
}

export function getRequestTimeoutMs(): number {
  return normalizePositiveNumber(getExtensionConfig().get('requestTimeout', DEFAULT_REQUEST_TIMEOUT))
    ?? DEFAULT_REQUEST_TIMEOUT;
}

export function getDiscoveryTimeoutMs(): number {
  return normalizePositiveNumber(getExtensionConfig().get('discoveryTimeout', DEFAULT_DISCOVERY_TIMEOUT))
    ?? DEFAULT_DISCOVERY_TIMEOUT;
}

export function getStreamIdleTimeoutMs(): number {
  return normalizePositiveNumber(getExtensionConfig().get('streamIdleTimeout', DEFAULT_STREAM_IDLE))
    ?? DEFAULT_STREAM_IDLE;
}

export function getModelParameters(): Record<string, Record<string, unknown>> {
  return getExtensionConfig().get<Record<string, Record<string, unknown>>>('modelParameters', {}) ?? {};
}

export function resolveMaxOutputTokens(modelMax: number): number {
  const cap = getMaxOutputTokensCap();
  const fallback = getDefaultMaxOutputTokens();
  const base = modelMax > 0 ? modelMax : fallback;
  return Math.min(base, cap);
}
