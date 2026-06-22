import { generateText, streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import type { LLMProvider, GenerateTextParams, GenerateTextResult, StreamChunk, ToolDefinition } from './provider.js';

export interface OpenAIClientConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  visionModel?: string;
}

export class OpenAIClient implements LLMProvider {
  readonly id = 'openai-compatible';
  readonly displayName = 'OpenAI Compatible';
  readonly supportsVision: boolean;

  private client: ReturnType<typeof createOpenAI>;
  private modelId: string;
  private visionModelId: string;

  constructor(config: OpenAIClientConfig) {
    this.client = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? 'https://api.openai.com/v1',
    });
    this.modelId = config.model;
    this.visionModelId = config.visionModel ?? config.model;
    this.supportsVision = !!config.visionModel;
  }

  async generateText(params: GenerateTextParams): Promise<GenerateTextResult> {
    const result = await generateText({
      model: this.client(this.modelId),
      messages: params.messages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      tools: params.tools ? this.convertTools(params.tools) : undefined,
      maxOutputTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.1,
    });

    return {
      text: result.text,
      toolCalls: result.toolCalls?.map(tc => ({
        id: tc.toolCallId,
        type: 'function' as const,
        function: { name: tc.toolName, arguments: JSON.stringify(tc.input) },
      })) ?? [],
      finishReason: result.finishReason === 'tool-calls' ? 'tool_calls'
        : result.finishReason === 'length' ? 'length'
        : 'stop',
      usage: result.usage ? {
        promptTokens: result.usage.inputTokens,
        completionTokens: result.usage.outputTokens,
      } : undefined,
    };
  }

  async *streamText(params: GenerateTextParams): AsyncGenerator<StreamChunk> {
    const stream = streamText({
      model: this.client(this.modelId),
      messages: params.messages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      tools: params.tools ? this.convertTools(params.tools) : undefined,
      maxOutputTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.1,
    });

    for await (const chunk of stream.fullStream) {
      if (chunk.type === 'text-delta') {
        yield { type: 'text-delta', textDelta: chunk.text };
      } else if (chunk.type === 'tool-call') {
        yield {
          type: 'tool-call',
          toolCall: {
            id: chunk.toolCallId,
            type: 'function',
            function: { name: chunk.toolName, arguments: JSON.stringify(chunk.input) },
          },
        };
      }
    }
    yield { type: 'finish' };
  }

  private convertTools(tools: ToolDefinition[]) {
    return Object.fromEntries(
      tools.map(t => [
        t.name,
        tool({
          description: t.description,
          inputSchema: z.object({}).passthrough(), // Accept any JSON Schema
        }),
      ]),
    );
  }
}
