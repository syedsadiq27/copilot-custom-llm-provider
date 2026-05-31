import * as vscode from 'vscode';
import type { OpenAIStreamChunk, RequestStats } from '../types';
import { logLine } from '../shared/logger';
import { tryParseJSONObject } from '../shared/json';
import { getStreamIdleTimeoutMs } from './config';

export function createRequestStats(): RequestStats {
  return {
    contentChunks: 0,
    contentChars: 0,
    reasoningChunks: 0,
    reasoningChars: 0,
    toolCallChunks: 0,
    finishReason: null,
    malformedChunks: 0,
    summaryLogged: false,
    usage: null,
  };
}

export function logSummary(
  reqId: string,
  stats: RequestStats,
  startedAt: number,
  model: vscode.LanguageModelChatInformation,
  reason = 'done'
): void {
  if (stats.summaryLogged) return;
  stats.summaryLogged = true;
  const ms = Date.now() - startedAt;
  const parts = [
    `[${reqId}] ← ${reason}`,
    `model=${model.id}`,
    `${ms}ms`,
    `content=${stats.contentChunks}ch/${stats.contentChars}c`,
    `reasoning=${stats.reasoningChunks}ch/${stats.reasoningChars}c`,
    `tools=${stats.toolCallChunks}`,
    `finish=${stats.finishReason ?? '∅'}`,
  ];
  if (stats.malformedChunks > 0) parts.push(`malformed=${stats.malformedChunks}`);
  logLine(parts.join('  '));

  if (stats.usage) {
    logLine(JSON.stringify({
      event: 'token_usage',
      reqId,
      model: model.id,
      ms,
      prompt_tokens: stats.usage.promptTokens,
      completion_tokens: stats.usage.completionTokens,
      reasoning_tokens: stats.usage.reasoningTokens,
      finish_reason: stats.finishReason,
    }));
  }

  if (stats.contentChunks === 0 && stats.toolCallChunks === 0) {
    if (stats.reasoningChunks > 0) {
      logLine(
        `[${reqId}] ⚠️ EMPTY CONTENT — reasoning used ${stats.reasoningChars} chars. ` +
        `Increase maxOutputTokens for "${model.id}" in settings.`
      );
    } else {
      logLine(`[${reqId}] ⚠️ EMPTY RESPONSE — check upstream model / network.`);
    }
  }
}

function emitToolCalls(
  pending: Map<number, { id: string; name: string; arguments: string }>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  reqId: string
): void {
  for (const [, call] of pending) {
    if (!call.name) continue;
    try {
      const input = tryParseJSONObject(call.arguments || '{}') ?? {};
      progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, input));
    } catch {
      progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, {}));
    }
    logLine(`[${reqId}] tool_call: id=${call.id} name=${call.name}`);
  }
}

export async function processStreamingResponse(
  responseBody: ReadableStream<Uint8Array>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken,
  stats: RequestStats,
  reqId: string,
  model: vscode.LanguageModelChatInformation,
  startedAt: number,
  abortController: AbortController
): Promise<void> {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const idleMs = getStreamIdleTimeoutMs();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logLine(`[${reqId}] ✗ idle timeout (${idleMs}ms)`);
      abortController.abort();
    }, idleMs);
  };
  resetIdle();

  const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let thinkState: 'detect' | 'skip' | 'pass' = 'detect';
    let thinkBuf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || token.isCancellationRequested) break;
      resetIdle();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();

        if (data === '[DONE]') {
          emitToolCalls(pendingToolCalls, progress, reqId);
          logSummary(reqId, stats, startedAt, model);
          return;
        }

        try {
          const chunk: OpenAIStreamChunk = JSON.parse(data);
          if (chunk.usage) {
            stats.usage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
            };
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          if (choice.finish_reason) {
            stats.finishReason = choice.finish_reason;
          }

          const reasoning = choice.delta?.reasoning_content;
          if (reasoning) {
            stats.reasoningChunks++;
            stats.reasoningChars += reasoning.length;
          }

          const content = choice.delta?.content;
          if (content) {
            stats.contentChunks++;
            stats.contentChars += content.length;

            if (thinkState === 'pass') {
              progress.report(new vscode.LanguageModelTextPart(content));
            } else {
              thinkBuf += content;
              if (thinkState === 'detect') {
                const tb = thinkBuf.trimStart();
                if (tb.startsWith('<think>')) {
                  thinkState = 'skip';
                  thinkBuf = tb.slice('<think>'.length);
                } else if (tb.length > 0 && !('<think>'.startsWith(tb.slice(0, 7)))) {
                  thinkState = 'pass';
                  progress.report(new vscode.LanguageModelTextPart(thinkBuf));
                  thinkBuf = '';
                } else if (thinkBuf.length > 30) {
                  thinkState = 'pass';
                  progress.report(new vscode.LanguageModelTextPart(thinkBuf));
                  thinkBuf = '';
                }
              } else {
                const endIdx = thinkBuf.indexOf('</think>');
                if (endIdx !== -1) {
                  thinkState = 'pass';
                  const after = thinkBuf.slice(endIdx + '</think>'.length).replace(/^\n{1,2}/, '');
                  thinkBuf = '';
                  if (after) progress.report(new vscode.LanguageModelTextPart(after));
                } else if (thinkBuf.length > 200) {
                  thinkBuf = thinkBuf.slice(-20);
                }
              }
            }
          }

          if (choice.delta?.tool_calls) {
            stats.toolCallChunks++;
            for (const tc of choice.delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!pendingToolCalls.has(idx)) {
                pendingToolCalls.set(idx, { id: tc.id ?? `call_${idx}`, name: '', arguments: '' });
              }
              const entry = pendingToolCalls.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name += tc.function.name;
              if (tc.function?.arguments) entry.arguments += tc.function.arguments;
            }
          }

          if (choice.finish_reason === 'tool_calls') {
            emitToolCalls(pendingToolCalls, progress, reqId);
            pendingToolCalls.clear();
            logSummary(reqId, stats, startedAt, model, 'tool_calls');
            return;
          }
        } catch {
          stats.malformedChunks++;
        }
      }
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    reader.releaseLock();
  }
  logSummary(reqId, stats, startedAt, model, token.isCancellationRequested ? 'cancelled' : 'done');
}
