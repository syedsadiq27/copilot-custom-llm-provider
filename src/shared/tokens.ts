import * as vscode from 'vscode';
import type { OpenAITool } from '../types';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(
  msgs: readonly vscode.LanguageModelChatRequestMessage[]
): number {
  let total = 0;
  for (const m of msgs) {
    for (const part of m.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        total += estimateTokens(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        total += estimateTokens(part.name + JSON.stringify(part.input ?? {}));
      } else if (part instanceof vscode.LanguageModelDataPart) {
        const mime = part.mimeType.toLowerCase();
        if (mime.startsWith('text/') || mime === 'application/json' || mime.endsWith('+json')) {
          total += Math.ceil(part.data.length / 4);
        } else if (mime.startsWith('image/') || mime === 'application/pdf') {
          total += 1000;
        }
      }
    }
  }
  return total;
}

export function estimateToolTokens(tools: OpenAITool[] | undefined): number {
  if (!tools?.length) {
    return 0;
  }
  try {
    return Math.ceil(JSON.stringify(tools).length / 4);
  } catch {
    return 0;
  }
}
