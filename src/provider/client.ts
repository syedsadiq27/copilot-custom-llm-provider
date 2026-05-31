import type { RetryConfig } from '../types';
import { getRequestTimeoutMs } from './config';

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
};

function calculateDelay(attempt: number, initial: number, max: number): number {
  const exp = initial * Math.pow(2, attempt);
  return Math.min(exp + Math.random() * 0.3 * exp, max);
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 504);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retryConfig: RetryConfig = DEFAULT_RETRY
): Promise<Response> {
  const timeoutMs = getRequestTimeoutMs();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
      if (init.signal) {
        signals.unshift(init.signal);
      }
      const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

      const response = await fetch(url, {
        ...init,
        signal,
      });

      if (response.ok) {
        return response;
      }

      const status = response.status;
      const errorBody = await response.text().catch(() => 'Unknown error');
      let errorMessage = errorBody;
      try {
        const parsed = JSON.parse(errorBody);
        errorMessage = parsed?.error?.message ?? parsed?.message ?? parsed?.msg ?? errorBody;
      } catch { /* not JSON */ }

      if (status === 401) {
        throw new Error(
          'Copilot Custom LLM: Invalid or missing API key.\n' +
          'Open Command Palette → "Custom LLM: Manage providers".\n' +
          `Details: ${errorMessage}`
        );
      }

      if (status === 400) {
        const lower = errorMessage.toLowerCase();
        if (
          lower.includes('image') || lower.includes('vision') || lower.includes('multimodal') ||
          lower.includes('pdf') || lower.includes('does not support') ||
          lower.includes('unsupported') || lower.includes('invalid content type')
        ) {
          throw new Error(
            'Copilot Custom LLM: This model does not support that attachment type.\n' +
            'Use a multimodal model (e.g. qwen-vl-max) for images or PDFs.\n' +
            `Details: ${errorMessage}`
          );
        }
      }

      if (!isRetryable(status)) {
        throw new Error(`Copilot Custom LLM (${status}): ${errorMessage}`);
      }

      lastError = new Error(`Copilot Custom LLM (${status}): ${errorMessage}`);
      if (attempt < retryConfig.maxRetries) {
        await new Promise((r) => setTimeout(r, calculateDelay(attempt, retryConfig.initialDelayMs, retryConfig.maxDelayMs)));
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retryConfig.maxRetries) {
        await new Promise((r) => setTimeout(r, calculateDelay(attempt, retryConfig.initialDelayMs, retryConfig.maxDelayMs)));
      }
    }
  }

  throw lastError || new Error('Request failed after all retries');
}
