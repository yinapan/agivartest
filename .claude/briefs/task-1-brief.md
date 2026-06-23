# Task 1: LLM Provider 抽象层 + OpenAIClient 适配

**Files:**
- Create: `packages/core/src/llm/provider.ts`
- Create: `packages/core/src/llm/openai-compatible.ts`
- Create: `packages/core/src/llm/prompts.ts`
- Test: `packages/core/tests/llm-provider.test.ts`
- Modify: `packages/core/package.json` (add `ai`, `@ai-sdk/openai` deps)

## Steps

### Step 1: Install dependencies

```bash
cd f:/agivar && pnpm add -F @agivar/core ai @ai-sdk/openai
```

### Step 2: Create provider.ts — LLMProvider interface and types

```typescript
// packages/core/src/llm/provider.ts
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
```

### Step 3: Create openai-compatible.ts — Vercel AI SDK adapter

```typescript
// packages/core/src/llm/openai-compatible.ts
import { generateText, streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod/v4';
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
      maxTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.1,
    });

    return {
      text: result.text,
      toolCalls: result.toolCalls?.map(tc => ({
        id: tc.toolCallId,
        type: 'function' as const,
        function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
      })) ?? [],
      finishReason: result.finishReason === 'tool-calls' ? 'tool_calls' : 'stop',
      usage: result.usage ? {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
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
      maxTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.1,
    });

    for await (const chunk of stream.fullStream) {
      if (chunk.type === 'text-delta') {
        yield { type: 'text-delta', textDelta: chunk.textDelta };
      } else if (chunk.type === 'tool-call') {
        yield {
          type: 'tool-call',
          toolCall: {
            id: chunk.toolCallId,
            type: 'function',
            function: { name: chunk.toolName, arguments: JSON.stringify(chunk.args) },
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
          parameters: z.object({}).passthrough(), // Accept any JSON Schema
        }),
      ]),
    );
  }
}
```

### Step 4: Create prompts.ts — system prompt templates

```typescript
// packages/core/src/llm/prompts.ts
import type { StepPlan } from '../types/agent.js';

export interface PromptContext {
  goal: string;
  stepHistory: string;
  memoryContext: string;
}

export function buildSystemPrompt(context: PromptContext): string {
  return `你是一个桌面自动化助手。你可以看到用户的屏幕截图，并通过工具描述你想要执行的操作。

## 能力
- 浏览器操作（通过 Playwright）
- 桌面应用控件操作（通过 UIA）
- 键鼠模拟
- 截屏观察

## 规则
1. 每次只建议一步操作，执行后观察结果
2. 优先使用 Playwright DOM 定位（浏览器）或 UIA 控件定位（桌面应用）
3. 遇到密码框、验证码、支付页面时必须调用 ask_user
4. 不确定时先 observe 再决定
5. 操作完成后调用 task_complete

## 当前任务
${context.goal}

## 已执行步骤
${context.stepHistory || '(无)'}

## 匹配的流程记忆（如有）
${context.memoryContext || '(无)'}`;
}

export function formatStepHistory(steps: StepPlan[]): string {
  if (steps.length === 0) return '(无)';
  return steps.map((s, i) => `${i + 1}. [${s.source}] ${s.intent} — ${s.action.type}`).join('\n');
}
```

### Step 5: Write llm-provider.test.ts

```typescript
// packages/core/tests/llm-provider.test.ts
import { describe, it, expect } from 'vitest';
import { OpenAIClient } from '../src/llm/openai-compatible.js';
import { buildSystemPrompt, formatStepHistory } from '../src/llm/prompts.js';
import type { StepPlan } from '../src/types/agent.js';

describe('OpenAIClient', () => {
  it('constructs with default baseURL', () => {
    const client = new OpenAIClient({ apiKey: 'sk-test', model: 'gpt-4o' });
    expect(client.id).toBe('openai-compatible');
    expect(client.displayName).toBe('OpenAI Compatible');
    expect(client.supportsVision).toBe(false);
  });

  it('enables vision when visionModel is set', () => {
    const client = new OpenAIClient({ apiKey: 'sk-test', model: 'deepseek-chat', visionModel: 'gpt-4o' });
    expect(client.supportsVision).toBe(true);
  });

  it('accepts custom baseURL for DeepSeek/Qwen', () => {
    const client = new OpenAIClient({
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
    });
    expect(client.id).toBe('openai-compatible');
  });
});

describe('prompts', () => {
  it('buildSystemPrompt fills goal, history, and memory', () => {
    const prompt = buildSystemPrompt({
      goal: '填写本地测试表单',
      stepHistory: '1. [workflow] 打开测试页 — navigate',
      memoryContext: '匹配流程: form-fill-local (score: 0.9)',
    });
    expect(prompt).toContain('填写本地测试表单');
    expect(prompt).toContain('打开测试页');
    expect(prompt).toContain('form-fill-local');
  });

  it('formatStepHistory handles empty array', () => {
    expect(formatStepHistory([])).toBe('(无)');
  });

  it('formatStepHistory formats steps', () => {
    const steps: StepPlan[] = [
      { intent: 'open page', action: { type: 'navigate', url: 'http://localhost' }, riskLevel: 'low', source: 'workflow' },
    ];
    const result = formatStepHistory(steps);
    expect(result).toContain('1. [workflow] open page');
  });
});
```

### Step 6: Run tests

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/llm-provider.test.ts
```
Expected: 5 tests PASS

### Step 7: Commit

```bash
git add packages/core/src/llm/ packages/core/tests/llm-provider.test.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): add LLM provider abstraction and OpenAI-compatible adapter"
```

## Global Constraints

- **ESM strict**: `type: "module"`, all relative imports use `.js` extension
- **better-sqlite3 via `createRequire`**: CJS package, must use require mode
- **Agent does NOT depend on Electron**: `packages/core/src/agent/` is pure Node.js
- **LLM plans only, never executes**: LLM produces StepPlan, all side effects through ToolRouter
- **ToolResult\<T\>**: `{ ok: true; data: T; durationMs: number } | { ok: false; error: ToolError; durationMs: number }`
- **Phase 1A interfaces zero-change**: Do NOT modify existing Phase 1A modules
- **Test DB uses `:memory:`**
- **UI components don't get unit tests**: Unit tests only for core layer pure logic

## Context

This is Task 1 of 12 in the Phase 1B plan. You are creating the LLM abstraction layer. The existing project has:
- `packages/core/src/types/agent.ts` — StepPlan, StepAction, TaskContext types
- `packages/core/src/types/errors.ts` — ToolResult, toolOk, toolErr
- `packages/core/package.json` — already has zod as dependency
- pnpm monorepo with `@agivar/core`, `@agivar/desktop`, `@agivar/native` packages

Install `ai` and `@ai-sdk/openai` first, then create the three source files and test file, run tests, and commit.

## Important note

The `zod/v4` import may not exist. Check what version of zod is installed and use the correct import path. If zod v3 is installed, use `zod` instead of `zod/v4`, and for the tool parameters schema use `z.object({}).passthrough()` syntax.

## Report

Write your full report to: `f:/agivar/.claude/briefs/task-1-report.md`
Include: status (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED), commits, test summary, and any concerns.
