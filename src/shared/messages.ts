import * as vscode from 'vscode';
import type { OpenAIContentPart, OpenAIMessage } from '../types';
import { logLine } from './logger';

function toDataUrl(data: Uint8Array, mimeType: string): string {
  const base64 = Buffer.from(data).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTextPartLike(value: unknown): value is { value: string } {
  return isObject(value) && typeof value.value === 'string';
}

function isToolCallPartLike(value: unknown): value is { callId: string; name: string; input?: unknown } {
  return isObject(value) && typeof value.callId === 'string' && typeof value.name === 'string';
}

function isToolResultPartLike(value: unknown): value is { callId: string; content: unknown[] } {
  return isObject(value) && typeof value.callId === 'string' && Array.isArray(value.content);
}

function partDebugInfo(part: unknown): string {
  if (!isObject(part)) {
    return `type=${typeof part}`;
  }
  const ctor = typeof part.constructor?.name === 'string' ? part.constructor.name : 'Object';
  return `ctor=${ctor} keys=[${Object.keys(part).slice(0, 10).join(',')}]`;
}

function dataPartToContent(part: vscode.LanguageModelDataPart): OpenAIContentPart | null {
  const mime = part.mimeType.toLowerCase();
  if (mime.startsWith('image/')) {
    return { type: 'image_url', image_url: { url: toDataUrl(part.data, mime) } };
  }
  if (mime === 'application/pdf') {
    return { type: 'file', file: { file_data: toDataUrl(part.data, mime) } };
  }
  return null;
}

export function toOpenAIMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[]
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const msg of messages) {
    const isUser = msg.role === vscode.LanguageModelChatMessageRole.User;
    const textParts: string[] = [];
    const mediaParts: OpenAIContentPart[] = [];
    const toolCallParts: vscode.LanguageModelToolCallPart[] = [];
    const toolResultParts: vscode.LanguageModelToolResultPart[] = [];

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value);
      } else if (part instanceof vscode.LanguageModelDataPart) {
        const block = dataPartToContent(part);
        if (block) {
          mediaParts.push(block);
        }
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCallParts.push(part);
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        toolResultParts.push(part);
      } else if (isToolCallPartLike(part)) {
        toolCallParts.push(part as unknown as vscode.LanguageModelToolCallPart);
      } else if (isToolResultPartLike(part)) {
        toolResultParts.push(part as unknown as vscode.LanguageModelToolResultPart);
      } else {
        logLine(`[messages] unknown part ignored: ${partDebugInfo(part)}`);
      }
    }

    if (toolCallParts.length > 0) {
      result.push({
        role: 'assistant',
        content: textParts.join('') || null,
        tool_calls: toolCallParts.map((tc) => ({
          id: tc.callId,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input ?? {}),
          },
        })),
      });
    }

    for (const tr of toolResultParts) {
      const content = tr.content
        .map((p) => {
          if (p instanceof vscode.LanguageModelTextPart) return p.value;
          if (isTextPartLike(p)) return p.value;
          return '';
        })
        .join('');
      result.push({ role: 'tool', content, tool_call_id: tr.callId });
    }

    if (toolCallParts.length === 0 && toolResultParts.length === 0) {
      if (mediaParts.length > 0) {
        const contentParts: OpenAIContentPart[] = [];
        if (textParts.length > 0) {
          contentParts.push({ type: 'text', text: textParts.join('') });
        }
        contentParts.push(...mediaParts);
        result.push({ role: isUser ? 'user' : 'assistant', content: contentParts });
      } else {
        result.push({ role: isUser ? 'user' : 'assistant', content: textParts.join('') });
      }
    }
  }

  return result;
}
