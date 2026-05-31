import type { ModelConfig } from '../types';

const VISION_PREFIXES = ['qwen-vl', 'qwen2-vl', 'qwen3-vl', 'gpt-4o', 'gpt-4-vision', 'claude-3', 'gemini'];
const PDF_PREFIXES = ['qwen-vl', 'gpt-4o', 'claude-3', 'gemini'];
const NO_TOOL_PREFIXES = ['embed', 'whisper', 'tts', 'dall-e'];

export function inferCapabilities(modelId: string, info?: {
  supports_function_calling?: boolean;
  supports_tool_choice?: boolean;
  supports_vision?: boolean;
  supports_pdf_input?: boolean;
  modalities?: string[];
}): Pick<ModelConfig, 'toolCalling' | 'imageInput' | 'pdfInput'> {
  const lower = modelId.toLowerCase();
  const modalities = info?.modalities ?? [];

  const imageInput = info?.supports_vision === true
    || modalities.includes('image')
    || VISION_PREFIXES.some((p) => lower.includes(p));

  const pdfInput = info?.supports_pdf_input === true
    || PDF_PREFIXES.some((p) => lower.includes(p));

  const toolCalling = info?.supports_function_calling !== false
    && info?.supports_tool_choice !== false
    && !NO_TOOL_PREFIXES.some((p) => lower.includes(p));

  return { toolCalling, imageInput, pdfInput };
}
