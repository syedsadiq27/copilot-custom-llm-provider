export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { file_data: string } };

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | OpenAIContentPart[];
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIStreamChunk {
  choices: Array<{
    delta: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
      text_tokens?: number;
    };
  };
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
}

export interface ModelConfig {
  id: string;
  rawModelId: string;
  name: string;
  providerId: string;
  providerUrl?: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  toolCalling?: boolean;
  imageInput?: boolean;
  pdfInput?: boolean;
}

export interface ModelRoute {
  providerId: string;
  rawModelId: string;
  providerLabel: string;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface RequestStats {
  contentChunks: number;
  contentChars: number;
  reasoningChunks: number;
  reasoningChars: number;
  toolCallChunks: number;
  finishReason: string | null;
  malformedChunks: number;
  summaryLogged: boolean;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number } | null;
}
