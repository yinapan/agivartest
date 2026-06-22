export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface GenerateTextParams {
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateTextResult {
  text: string;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length';
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface StreamChunk {
  type: 'text-delta' | 'tool-call' | 'finish';
  textDelta?: string;
  toolCall?: ToolCall;
}

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  readonly supportsVision: boolean;

  generateText(params: GenerateTextParams): Promise<GenerateTextResult>;
  streamText(params: GenerateTextParams): AsyncGenerator<StreamChunk>;
}
