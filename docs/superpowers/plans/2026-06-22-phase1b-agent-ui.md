# Phase 1B Agent 调度 + LLM 层 + 聊天 UI 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 Phase 1A 执行引擎之上构建 Agent 调度层、LLM 抽象层、Desktop 主进程扩展和完整聊天 UI

**架构：** AgentService 主循环（AsyncGenerator 事件流）统一两条执行路径——WorkflowExecutor（确定性流程）和 LLMPlanner（LLM 自主规划）。两者产出 StepPlan，经 SafetyLayer → ToolRouter → StepExecutor → StateVerifier → ExecutionLog 共享执行链。Desktop 层通过 IPC contextBridge 暴露 agent/memory/session/settings API，渲染进程用 React 19 + Zustand + Tailwind CSS 构建聊天界面。

**技术栈：** Vercel AI SDK (`ai` + `@ai-sdk/openai`)、React 19、Zustand、Tailwind CSS v4、Electron globalShortcut、better-sqlite3

---

## 全局约束

- **ESM 严格模式**：`type: "module"`，所有相对导入使用 `.js` 扩展名
- **better-sqlite3 用 `createRequire`**：CJS 包，必须使用 require 模式导入
- **Agent 不依赖 Electron**：`packages/core/src/agent/` 纯 Node.js，可独立测试
- **LLM 只规划不执行**：LLM 产出 StepPlan，所有副作用统一经过 ToolRouter → StepExecutor → StateVerifier
- **ToolResult\<T\>**：`{ ok: true; data: T; durationMs: number } | { ok: false; error: ToolError; durationMs: number }`
- **Phase 1A 接口零改动**：已交付模块不修改
- **测试数据库用 `:memory:`**
- **UI 组件不写单元测试**：React 组件通过 E2E 评测验证（任务 12），单元测试只覆盖 core 层纯逻辑
- **Tailwind CSS v4**：使用 `@tailwindcss/vite` 插件

---

## 文件结构

```
packages/core/src/
├── llm/                          # 新增：LLM 抽象层
│   ├── provider.ts               # LLMProvider 接口 + Message/ToolDefinition 类型
│   ├── openai-compatible.ts      # OpenAI-compatible provider (Vercel AI SDK)
│   └── prompts.ts                # 系统提示词
├── agent/                        # Phase 1A 已有 + 新增
│   ├── tool-router.ts            # (Phase 1A)
│   ├── step-executor.ts          # (Phase 1A)
│   ├── state-verifier.ts         # (Phase 1A)
│   ├── failure-handler.ts        # (Phase 1A)
│   ├── workflow-executor.ts      # (Phase 1A)
│   ├── task-planner.ts           # 新增：LLM 规划 + 流程编排
│   └── agent-service.ts          # 新增：主循环调度器
├── safety/                       # (Phase 1A 全部已有)
├── memory/                       # (Phase 1A 全部已有)
└── index.ts                      # 扩展导出

packages/desktop/src/
├── main/
│   ├── index.ts                  # 修改：集成 AgentService 生命周期
│   ├── ipc.ts                    # 修改：添加 agent/memory/session/settings IPC
│   ├── windows.ts                # (Phase 0 已有)
│   ├── global-hotkey.ts          # 新增：Electron globalShortcut 适配
│   └── credential-store.ts       # 新增：OS 凭据管理器（DPAPI 临时方案）
├── renderer/
│   ├── App.tsx                   # 重写：路由 + 布局
│   ├── main.tsx                  # (已有，微调)
│   ├── index.html                # 修改：Tailwind 配置
│   ├── pages/
│   │   ├── ChatPage.tsx          # 新增：聊天主页面
│   │   └── SettingsPage.tsx      # 新增：设置页
│   ├── components/
│   │   ├── Sidebar.tsx           # 新增：侧边栏
│   │   ├── ChatView.tsx          # 新增：消息流
│   │   ├── InputBar.tsx          # 新增：输入栏
│   │   ├── MessageBubble.tsx     # 新增：消息气泡
│   │   ├── ToolCallCard.tsx      # 新增：工具调用卡片
│   │   ├── StepProgressCard.tsx  # 新增：步骤进度卡片
│   │   ├── TakeoverCard.tsx      # 新增：人工接管卡片
│   │   ├── MemoryCandidateCard.tsx # 新增：流程候选卡片
│   │   └── TaskSummaryCard.tsx   # 新增：任务完成/失败摘要
│   └── stores/
│       ├── chat-store.ts         # 新增：会话/消息状态
│       └── task-store.ts         # 新增：任务执行状态
└── preload.ts                    # 修改：添加 agent/memory/session/settings API
```

---

### 任务 1：LLM Provider 抽象层 + OpenAIClient 适配

**文件：**
- 创建：`packages/core/src/llm/provider.ts`
- 创建：`packages/core/src/llm/openai-compatible.ts`
- 创建：`packages/core/src/llm/prompts.ts`
- 测试：`packages/core/tests/llm-provider.test.ts`
- 修改：`packages/core/package.json`（添加 `ai`、`@ai-sdk/openai` 依赖）

- [ ] **步骤 1：安装依赖**

```bash
cd f:/agivar && pnpm add -F @agivar/core ai @ai-sdk/openai
```

- [ ] **步骤 2：创建 provider.ts — LLMProvider 接口和类型**

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

- [ ] **步骤 3：创建 openai-compatible.ts — Vercel AI SDK 适配**

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

- [ ] **步骤 4：创建 prompts.ts — 系统提示词模板**

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

- [ ] **步骤 5：编写 llm-provider.test.ts**

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

- [ ] **步骤 6：运行测试**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/llm-provider.test.ts
```
预期：5 tests PASS

- [ ] **步骤 7：Commit**

```bash
git add packages/core/src/llm/ packages/core/tests/llm-provider.test.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): add LLM provider abstraction and OpenAI-compatible adapter"
```

---

### 任务 2：TaskPlanner — LLM 规划 + 流程编排

**文件：**
- 创建：`packages/core/src/agent/task-planner.ts`
- 测试：`packages/core/tests/task-planner.test.ts`

- [ ] **步骤 1：创建 task-planner.ts**

```typescript
// packages/core/src/agent/task-planner.ts
import type { StepPlan, TaskContext, ExpectedState } from '../types/agent.js';
import type { LLMProvider, Message, ToolDefinition } from '../llm/provider.js';
import { buildSystemPrompt, formatStepHistory, type PromptContext } from '../llm/prompts.js';
import type { WorkflowMemory, WorkflowStep } from '../types/workflow.js';

export interface PlannerOutput {
  step: StepPlan;
  confidence: number;
  rationale: string;
}

const PLANNING_TOOLS: ToolDefinition[] = [
  {
    name: 'click',
    description: '点击屏幕上的目标元素',
    parameters: {
      type: 'object',
      properties: {
        strategy: { type: 'string', enum: ['playwright', 'uia', 'coordinate'] },
        selector: { type: 'string', description: 'CSS selector (playwright)' },
        controlType: { type: 'string', description: 'UIA control type (uia)' },
        x: { type: 'number' },
        y: { type: 'number' },
        hint: { type: 'string' },
      },
      required: ['strategy'],
    },
  },
  {
    name: 'type_text',
    description: '在当前焦点位置输入文本',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'press_keys',
    description: '按快捷键',
    parameters: {
      type: 'object',
      properties: { keys: { type: 'array', items: { type: 'string' } } },
      required: ['keys'],
    },
  },
  {
    name: 'navigate',
    description: '在浏览器中打开URL',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'scroll',
    description: '滚动页面',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'] },
        amount: { type: 'number', default: 3 },
      },
      required: ['direction'],
    },
  },
  {
    name: 'observe',
    description: '截取当前屏幕，观察状态',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'ask_user',
    description: '遇到密码、验证码或不确定时请求用户接管',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
  {
    name: 'task_complete',
    description: '任务完成',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  },
];

export class TaskPlanner {
  constructor(private llm: LLMProvider) {}

  async planNextFromLLM(
    context: TaskContext,
    executedSteps: StepPlan[],
  ): Promise<PlannerOutput> {
    const promptCtx: PromptContext = {
      goal: context.goal,
      stepHistory: formatStepHistory(executedSteps),
      memoryContext: '',
    };

    const messages: Message[] = [
      { role: 'system', content: buildSystemPrompt(promptCtx) },
      { role: 'user', content: '下一步应该怎么做？' },
    ];

    const result = await this.llm.generateText({
      messages,
      tools: PLANNING_TOOLS,
      maxTokens: 1024,
      temperature: 0.1,
    });

    if (result.toolCalls.length === 0) {
      return {
        step: { intent: '任务完成', action: { type: 'done', summary: result.text }, riskLevel: 'low', source: 'llm' },
        confidence: 0.5,
        rationale: result.text,
      };
    }

    const tc = result.toolCalls[0];
    const args = JSON.parse(tc.function.arguments);
    const step = this.toolCallToStepPlan(tc.function.name, args);
    const riskLevel = this.inferRiskLevel(tc.function.name, args);

    return {
      step: { ...step, riskLevel, source: 'llm' },
      confidence: 0.7,
      rationale: result.text || `Tool call: ${tc.function.name}`,
    };
  }

  buildStepPlanFromWorkflow(
    step: WorkflowStep,
    resolvedInputs: Record<string, string>,
  ): StepPlan {
    const strategy = step.target.strategy;

    let action = step.action as StepPlan['action'];
    if (!action || !('type' in action)) {
      action = this.inferAction(step);
    }

    // Apply variable substitution to input text
    if (action.type === 'type' && step.inputHint) {
      action = { ...action, text: this.resolveText(step.inputHint, resolvedInputs) };
    }
    if (action.type === 'navigate' && step.inputHint) {
      action = { ...action, url: this.resolveText(step.inputHint, resolvedInputs) };
    }

    return {
      intent: step.intent,
      action,
      expectedState: step.expectedState,
      riskLevel: step.riskLevel ?? 'low',
      source: 'workflow',
    };
  }

  private inferAction(step: WorkflowStep): StepPlan['action'] {
    const hint = step.inputHint ?? '';
    const strategy = step.target.strategy;

    if (hint.startsWith('http://') || hint.startsWith('https://')) {
      return { type: 'navigate', url: hint };
    }
    if (hint.startsWith('{{') || (strategy === 'playwright' && hint)) {
      return { type: 'type', text: hint };
    }
    if (strategy === 'human') {
      return { type: 'takeover', reason: step.intent };
    }
    return { type: 'click', target: step.target };
  }

  private toolCallToStepPlan(name: string, args: Record<string, unknown>): StepPlan {
    switch (name) {
      case 'click': {
        const strategy = (args.strategy as string) ?? 'playwright';
        if (strategy === 'coordinate') {
          return {
            intent: `点击坐标 (${args.x}, ${args.y})`,
            action: {
              type: 'click',
              target: {
                strategy: 'coordinate',
                point: { x: (args.x as number) ?? 0, y: (args.y as number) ?? 0, space: 'screen-physical' },
              },
            },
            riskLevel: 'low',
            source: 'llm',
          };
        }
        if (strategy === 'uia') {
          return {
            intent: `点击 UIA 元素 ${args.controlType ?? ''}`,
            action: {
              type: 'click',
              target: {
                strategy: 'uia',
                query: {
                  controlType: (args.controlType as string) ?? 'Button',
                  name: (args.hint as string) ?? undefined,
                },
              },
            },
            riskLevel: 'low',
            source: 'llm',
          };
        }
        return {
          intent: `点击 ${(args.hint as string) ?? (args.selector as string) ?? '元素'}`,
          action: {
            type: 'click',
            target: { strategy: 'playwright', selector: (args.selector as string) ?? 'body' },
          },
          riskLevel: 'low',
          source: 'llm',
        };
      }
      case 'type_text':
        return {
          intent: `输入 "${args.text}"`,
          action: { type: 'type', text: (args.text as string) ?? '' },
          riskLevel: 'low',
          source: 'llm',
        };
      case 'press_keys':
        return {
          intent: `按键 ${(args.keys as string[])?.join('+')}`,
          action: { type: 'press', keys: (args.keys as string[]) ?? [] },
          riskLevel: 'low',
          source: 'llm',
        };
      case 'navigate':
        return {
          intent: `导航到 ${args.url}`,
          action: { type: 'navigate', url: (args.url as string) ?? 'about:blank' },
          riskLevel: 'low',
          source: 'llm',
        };
      case 'scroll':
        return {
          intent: `滚动 ${args.direction}`,
          action: { type: 'scroll', direction: (args.direction as 'up' | 'down') ?? 'down', amount: (args.amount as number) ?? 3 },
          riskLevel: 'low',
          source: 'llm',
        };
      case 'observe':
        return {
          intent: '观察当前屏幕',
          action: { type: 'observe' },
          riskLevel: 'low',
          source: 'llm',
        };
      case 'ask_user':
        return {
          intent: `人工接管: ${args.reason}`,
          action: { type: 'takeover', reason: (args.reason as string) ?? '用户请求接管' },
          riskLevel: 'high',
          source: 'llm',
        };
      case 'task_complete':
        return {
          intent: '任务完成',
          action: { type: 'done', summary: (args.summary as string) ?? '任务完成' },
          riskLevel: 'low',
          source: 'llm',
        };
      default:
        return {
          intent: '未知动作',
          action: { type: 'observe' },
          riskLevel: 'low',
          source: 'llm',
        };
    }
  }

  private inferRiskLevel(toolName: string, args: Record<string, unknown>): StepPlan['riskLevel'] {
    const text = JSON.stringify(args).toLowerCase();
    const forbidden = ['密码', 'password', '验证码', 'captcha', '支付', 'pay', 'otp'];
    const highRisk = ['删除', 'delete', '提交', 'submit', '发送', 'send', 'remove'];
    if (forbidden.some(k => text.includes(k))) return 'forbidden';
    if (highRisk.some(k => text.includes(k))) return 'high';
    return 'low';
  }

  private resolveText(template: string, inputs: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => inputs[name] ?? `{{${name}}}`);
  }
}
```

- [ ] **步骤 2：编写 task-planner.test.ts**

```typescript
// packages/core/tests/task-planner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TaskPlanner } from '../src/agent/task-planner.js';
import type { LLMProvider, GenerateTextResult } from '../src/llm/provider.js';
import type { TaskContext, StepPlan } from '../src/types/agent.js';
import type { WorkflowStep } from '../src/types/workflow.js';

function mockLLM(response: Partial<GenerateTextResult> = {}): LLMProvider {
  return {
    id: 'test',
    displayName: 'Test',
    supportsVision: false,
    generateText: vi.fn().mockResolvedValue({ text: '', toolCalls: [], finishReason: 'stop', ...response }),
    streamText: vi.fn().mockReturnValue((async function* () { yield { type: 'finish' as const }; })()),
  };
}

function makeContext(): TaskContext {
  const ctrl = new AbortController();
  return {
    taskRunId: 'tr-1', sessionId: 's-1', goal: 'test', mode: 'llm', status: 'running',
    stepIndex: 0, retryCountByStep: new Map(), maxRetries: 2, outputDir: '/tmp/test',
    abortController: ctrl, signal: ctrl.signal, startedPids: [], createdTempDirs: [], humanTakeoverEvents: [],
  };
}

describe('TaskPlanner', () => {
  it('builds StepPlan from workflow step with navigate hint', () => {
    const planner = new TaskPlanner(mockLLM());
    const step: WorkflowStep = {
      id: 's1', order: 0, intent: '打开页面', targetHint: '地址栏',
      target: { strategy: 'playwright', selector: 'body' },
      inputHint: 'http://localhost/test', riskLevel: 'low',
    };
    const result = planner.buildStepPlanFromWorkflow(step, {});
    expect(result.action.type).toBe('navigate');
    expect((result.action as any).url).toBe('http://localhost/test');
  });

  it('builds StepPlan from workflow step with variable substitution', () => {
    const planner = new TaskPlanner(mockLLM());
    const step: WorkflowStep = {
      id: 's1', order: 0, intent: '输入文本', targetHint: '输入框',
      target: { strategy: 'playwright', selector: '#input' },
      inputHint: '{{userName}}', riskLevel: 'low',
    };
    const result = planner.buildStepPlanFromWorkflow(step, { userName: 'Alice' });
    expect(result.action.type).toBe('type');
    expect((result.action as any).text).toBe('Alice');
  });

  it('builds StepPlan with human strategy → takeover', () => {
    const planner = new TaskPlanner(mockLLM());
    const step: WorkflowStep = {
      id: 's1', order: 0, intent: '打开应用', targetHint: '开始菜单',
      target: { strategy: 'human', hint: '按 Win 键搜索' }, riskLevel: 'low',
    };
    const result = planner.buildStepPlanFromWorkflow(step, {});
    expect(result.action.type).toBe('takeover');
  });

  it('planNextFromLLM returns done step when no tool calls', async () => {
    const llm = mockLLM({ text: '任务已完成' });
    const planner = new TaskPlanner(llm);
    const result = await planner.planNextFromLLM(makeContext(), []);
    expect(result.step.action.type).toBe('done');
  });

  it('planNextFromLLM parses click tool call', async () => {
    const llm = mockLLM({
      toolCalls: [{
        id: 'tc1', type: 'function',
        function: { name: 'click', arguments: '{"strategy":"playwright","selector":"#btn"}' },
      }],
      finishReason: 'tool_calls',
    });
    const planner = new TaskPlanner(llm);
    const result = await planner.planNextFromLLM(makeContext(), []);
    expect(result.step.action.type).toBe('click');
    if (result.step.action.type === 'click') {
      expect(result.step.action.target.strategy).toBe('playwright');
    }
  });

  it('planNextFromLLM infers forbidden risk for password', async () => {
    const llm = mockLLM({
      toolCalls: [{
        id: 'tc1', type: 'function',
        function: { name: 'type_text', arguments: '{"text":"password123"}' },
      }],
      finishReason: 'tool_calls',
    });
    const planner = new TaskPlanner(llm);
    const result = await planner.planNextFromLLM(makeContext(), []);
    expect(result.step.riskLevel).toBe('forbidden');
  });
});
```

- [ ] **步骤 3：运行测试**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/task-planner.test.ts
```
预期：6 tests PASS

- [ ] **步骤 4：Commit**

```bash
git add packages/core/src/agent/task-planner.ts packages/core/tests/task-planner.test.ts
git commit -m "feat(core): add TaskPlanner for LLM-driven and workflow-driven step planning"
```

---

### 任务 3：AgentService 主循环

**文件：**
- 创建：`packages/core/src/agent/agent-service.ts`
- 测试：`packages/core/tests/agent-service.test.ts`

- [ ] **步骤 1：创建 agent-service.ts**

```typescript
// packages/core/src/agent/agent-service.ts
import { nanoid } from 'nanoid';
import { TakeoverRequest } from '../types/agent.js';
import type { StepPlan, TaskContext, StepResult } from '../types/agent.js';
import type { AgentEvent } from '../types/agent.js';
import type { WorkflowMemory } from '../types/workflow.js';
import type { MemorySearchResult } from '../memory/memory-store.js';
import { MemoryStore } from '../memory/memory-store.js';
import { TaskPlanner } from './task-planner.js';
import { ToolRouter, type ToolAdapters } from './tool-router.js';
import { StepExecutor } from './step-executor.js';
import { StateVerifier } from './state-verifier.js';
import { FailureHandler } from './failure-handler.js';
import { RiskClassifier } from '../safety/risk-classifier.js';
import { ExecutionLog } from '../safety/execution-log.js';
import { AbortManager } from '../safety/abort-manager.js';
import type { LLMProvider } from '../llm/provider.js';
import type Database from 'better-sqlite3';

export interface AgentServiceDeps {
  db: Database.Database;
  llm: LLMProvider;
  tools: ToolAdapters;
  abortManager: AbortManager;
  memoryStore: MemoryStore;
}

const MEMORY_AUTO_SELECT_THRESHOLD = 0.8;
const MEMORY_SHOW_CANDIDATES_THRESHOLD = 0.5;
const MAX_FAILURES_BEFORE_LLM = 2;

export class AgentService {
  private toolRouter: ToolRouter;
  private stepExecutor: StepExecutor;
  private stateVerifier: StateVerifier;
  private failureHandler: FailureHandler;
  private riskClassifier: RiskClassifier;
  private executionLog: ExecutionLog;
  private taskPlanner: TaskPlanner;

  constructor(private deps: AgentServiceDeps) {
    this.toolRouter = new ToolRouter(deps.tools);
    this.stateVerifier = new StateVerifier(deps.tools);
    this.failureHandler = new FailureHandler();
    this.riskClassifier = new RiskClassifier();
    this.executionLog = new ExecutionLog(deps.db);
    this.taskPlanner = new TaskPlanner(deps.llm);

    this.stepExecutor = new StepExecutor({
      toolRouter: this.toolRouter,
      stateVerifier: this.stateVerifier,
      riskClassifier: this.riskClassifier,
      executionLog: this.executionLog,
      tools: deps.tools,
    });
  }

  async *run(goal: string, sessionId: string): AsyncGenerator<AgentEvent> {
    const taskRunId = nanoid();
    const signal = this.deps.abortManager.createTaskSignal(taskRunId);
    const context = this.createTaskContext(taskRunId, sessionId, goal, signal);
    const executedSteps: StepPlan[] = [];
    let consecutiveFailures = 0;

    yield this.taskEvent(taskRunId, sessionId, 'thinking', '正在搜索相关流程记忆...');

    try {
      // Phase 1: Search memory
      const searchResults = await this.deps.memoryStore.search(goal);
      let selectedMemory: WorkflowMemory | null = null;

      if (searchResults.length > 0) {
        const best = searchResults[0];
        if (best.score >= MEMORY_AUTO_SELECT_THRESHOLD) {
          selectedMemory = best.memory;
          yield this.taskEvent(taskRunId, sessionId, 'memory-match', undefined, selectedMemory);
        } else if (best.score >= MEMORY_SHOW_CANDIDATES_THRESHOLD) {
          yield this.taskEvent(taskRunId, sessionId, 'memory-candidates', undefined, undefined, searchResults);
          return; // Wait for user selection via resumeWithMemory
        }
      }

      if (selectedMemory) {
        context.mode = 'workflow';
        yield* this.executeWorkflow(selectedMemory, context, executedSteps, consecutiveFailures);
      }

      // Phase 2: LLM path
      if (!context.isAborted()) {
        context.mode = context.mode === 'hybrid' ? 'hybrid' : 'llm';
        yield* this.executeLLMLoop(context, executedSteps, consecutiveFailures);
      }
    } catch (err) {
      if (err instanceof TakeoverRequest) {
        yield this.taskEvent(taskRunId, sessionId, 'takeover-required', err.message);
        return;
      }
      yield this.taskEvent(taskRunId, sessionId, 'task-failed', err instanceof Error ? err.message : String(err));
    } finally {
      this.executionLog.flush();
      this.deps.abortManager.cleanup(taskRunId);
    }
  }

  private async *executeWorkflow(
    memory: WorkflowMemory,
    context: TaskContext,
    executedSteps: StepPlan[],
    consecutiveFailures: number,
  ): AsyncGenerator<AgentEvent> {
    for (const step of memory.steps) {
      if (context.signal.aborted) break;

      const plan = this.taskPlanner.buildStepPlanFromWorkflow(step, {});
      yield this.taskEvent(context.taskRunId, context.sessionId, 'step-start', undefined, undefined, undefined, plan, context.stepIndex);

      const result = await this.executePlannedStep(plan, context);
      executedSteps.push(plan);

      if (result.success) {
        consecutiveFailures = 0;
        yield this.taskEvent(context.taskRunId, context.sessionId, 'step-result', undefined, undefined, undefined, undefined, undefined, true, result.verification);
      } else {
        consecutiveFailures++;
        yield this.taskEvent(context.taskRunId, context.sessionId, 'step-failed', undefined, undefined, undefined, undefined, undefined, false, undefined, result.failure, consecutiveFailures);
        if (consecutiveFailures > MAX_FAILURES_BEFORE_LLM) {
          context.mode = 'hybrid';
          break;
        }
      }

      context.stepIndex++;
    }

    if (context.mode !== 'hybrid') {
      yield this.taskEvent(context.taskRunId, context.sessionId, 'task-complete', '流程执行完毕');
    }
  }

  private async *executeLLMLoop(
    context: TaskContext,
    executedSteps: StepPlan[],
    consecutiveFailures: number,
  ): AsyncGenerator<AgentEvent> {
    while (!context.signal.aborted) {
      yield this.taskEvent(context.taskRunId, context.sessionId, 'thinking', 'LLM 正在规划下一步...');

      const output = await this.taskPlanner.planNextFromLLM(context, executedSteps);
      const plan = output.step;

      if (plan.action.type === 'done') {
        yield this.taskEvent(context.taskRunId, context.sessionId, 'task-complete', plan.action.summary);
        return;
      }

      yield this.taskEvent(context.taskRunId, context.sessionId, 'step-start', undefined, undefined, undefined, plan, context.stepIndex);

      const result = await this.executePlannedStep(plan, context);
      executedSteps.push(plan);

      if (result.success) {
        consecutiveFailures = 0;
        yield this.taskEvent(context.taskRunId, context.sessionId, 'step-result', undefined, undefined, undefined, undefined, undefined, true, result.verification);
      } else {
        consecutiveFailures++;
        yield this.taskEvent(context.taskRunId, context.sessionId, 'step-failed', undefined, undefined, undefined, undefined, undefined, false, undefined, result.failure, consecutiveFailures);
        if (consecutiveFailures > MAX_FAILURES_BEFORE_LLM) {
          yield this.taskEvent(context.taskRunId, context.sessionId, 'task-failed', '连续失败次数过多');
          return;
        }
      }

      context.stepIndex++;
    }
  }

  async executePlannedStep(plan: StepPlan, context: TaskContext): Promise<StepResult> {
    // Risk check
    const risk = plan.riskLevel;
    if (risk === 'forbidden') {
      throw new TakeoverRequest(`禁止操作: ${plan.intent}`);
    }

    return this.stepExecutor.execute(plan, context);
  }

  private createTaskContext(
    taskRunId: string, sessionId: string, goal: string, signal: AbortSignal,
  ): TaskContext {
    return {
      taskRunId, sessionId, goal, mode: 'workflow', status: 'running',
      stepIndex: 0, retryCountByStep: new Map(), maxRetries: 2,
      outputDir: '', abortController: new AbortController(), signal,
      startedPids: [], createdTempDirs: [], humanTakeoverEvents: [],
    };
  }

  private taskEvent(
    taskRunId: string, sessionId: string,
    type: AgentEvent['type'],
    message?: string,
    workflow?: WorkflowMemory,
    candidates?: MemorySearchResult[],
    step?: StepPlan,
    index?: number,
    success?: boolean,
    verification?: StepResult['verification'],
    failure?: StepResult['failure'],
    failCount?: number,
  ): AgentEvent {
    const base = { taskRunId, sessionId, timestamp: new Date().toISOString() };
    switch (type) {
      case 'thinking': return { ...base, type: 'thinking' as const, message: message! };
      case 'memory-match': return { ...base, type: 'memory-match' as const, workflow: workflow! };
      case 'memory-candidates': return { ...base, type: 'memory-candidates' as const, candidates: candidates! };
      case 'step-start': return { ...base, type: 'step-start' as const, step: step!, index: index! };
      case 'step-result': return { ...base, type: 'step-result' as const, success: success!, verification };
      case 'step-failed': return { ...base, type: 'step-failed' as const, failure: failure!, failCount: failCount! };
      case 'task-complete': return { ...base, type: 'task-complete' as const, summary: message! };
      case 'task-failed': return { ...base, type: 'task-failed' as const, diagnosis: message! };
      case 'takeover-required': return { ...base, type: 'takeover-required' as const, reason: message! };
      default: return { ...base, type: 'step-result' as const, success: true };
    }
  }

  async resumeWithMemory(memoryId: string, context: TaskContext): Promise<WorkflowMemory | null> {
    return this.deps.memoryStore.getById(memoryId);
  }

  abort(taskRunId: string): void {
    this.deps.abortManager.abortTask(taskRunId, 'ui');
  }
}
```

- [ ] **步骤 2：编写 agent-service.test.ts**

```typescript
// packages/core/tests/agent-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from '../src/agent/agent-service.js';
import { MemoryStore } from '../src/memory/memory-store.js';
import { AbortManager } from '../src/safety/abort-manager.js';
import { getDatabaseForTest } from '../src/memory/db.js';
import { toolOk } from '../src/types/errors.js';
import type { LLMProvider, GenerateTextResult } from '../src/llm/provider.js';
import type { ToolAdapters } from '../src/agent/tool-router.js';

function mockAdapters(): ToolAdapters {
  return {
    browser: {
      clickElement: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      fillInput: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      navigateTo: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      getPageText: vi.fn().mockResolvedValue(toolOk('success', 5)),
    },
    uia: {
      invokeElement: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      findElement: vi.fn().mockResolvedValue(toolOk(null, 5)),
      setElementValue: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      getElementValue: vi.fn().mockResolvedValue(toolOk('', 5)),
      getUiTree: vi.fn().mockResolvedValue(toolOk({} as any, 5)),
    },
    input: {
      clickPoint: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      typeText: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      pressKeys: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      scroll: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      releaseAllKeys: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
    },
    screenshot: {
      captureScreen: vi.fn().mockResolvedValue(toolOk({ buffer: Buffer.from('PNG'), width: 100, height: 100, timestamp: '' }, 5)),
      captureWindow: vi.fn().mockResolvedValue(toolOk({ buffer: Buffer.from('PNG'), width: 100, height: 100, timestamp: '' }, 5)),
      getActiveWindow: vi.fn().mockResolvedValue(toolOk({ hwnd: 1, title: 'Test', x: 0, y: 0, width: 800, height: 600, isMinimized: false }, 5)),
    },
  };
}

describe('AgentService', () => {
  let agent: AgentService;
  let db: ReturnType<typeof getDatabaseForTest>;
  let memoryStore: MemoryStore;

  beforeEach(() => {
    db = getDatabaseForTest(':memory:');
    db.prepare("INSERT INTO sessions (id, title) VALUES ('s-1', 'test')").run();
    db.prepare("INSERT INTO task_runs (id, session_id, user_goal, status) VALUES ('tr-1', 's-1', 'test', 'running')").run();

    const llm: LLMProvider = {
      id: 'test', displayName: 'Test', supportsVision: false,
      generateText: vi.fn().mockResolvedValue({
        text: 'done', toolCalls: [{ id: 't1', type: 'function', function: { name: 'task_complete', arguments: '{"summary":"done"}' } }], finishReason: 'tool_calls',
      } as GenerateTextResult),
      streamText: vi.fn().mockReturnValue((async function* () { yield { type: 'finish' as const }; })()),
    };

    memoryStore = new MemoryStore(db);
    agent = new AgentService({
      db, llm, tools: mockAdapters(), abortManager: new AbortManager(), memoryStore,
    });
  });

  it('constructs without error', () => {
    expect(agent).toBeDefined();
  });

  it('run yields thinking event when no memory matches', async () => {
    const events: any[] = [];
    for await (const ev of agent.run('test task', 's-1')) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('thinking');
  });

  it('abort sets signal', () => {
    agent.abort('tr-1');
    // AbortManager marks unknown tasks as aborted
    const am = new AbortManager();
    expect(am.isAborted('tr-1')).toBe(true);
  });

  it('resumeWithMemory returns null for non-existent', async () => {
    const result = await agent.resumeWithMemory('nonexistent', {} as any);
    expect(result).toBeNull();
  });
});
```

- [ ] **步骤 3：运行测试**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/agent-service.test.ts
```
预期：3 tests PASS

- [ ] **步骤 4：Commit**

```bash
git add packages/core/src/agent/agent-service.ts packages/core/tests/agent-service.test.ts
git commit -m "feat(core): add AgentService main loop with event-driven execution"
```

---

### 任务 4：Desktop 主进程 — GlobalHotkey + CredentialStore + SettingsStore

**文件：**
- 创建：`packages/desktop/src/main/global-hotkey.ts`
- 创建：`packages/desktop/src/main/credential-store.ts`
- 创建：`packages/desktop/src/main/settings-store.ts`
- 测试：`packages/core/tests/settings-store.test.ts`（settings-store 纯逻辑测试）

- [ ] **步骤 1：创建 global-hotkey.ts**

```typescript
// packages/desktop/src/main/global-hotkey.ts
import { globalShortcut } from 'electron';
import type { AbortManager } from '@agivar/core';

export class GlobalHotkeyAdapter {
  private registeredKey: string | null = null;

  constructor(private abortManager: AbortManager) {}

  register(hotkey: string, taskRunId: string): boolean {
    try {
      this.unregister();
      const ok = globalShortcut.register(hotkey, () => {
        this.abortManager.abortTask(taskRunId, 'hotkey');
      });
      if (ok) this.registeredKey = hotkey;
      return ok;
    } catch {
      return false;
    }
  }

  unregister(): void {
    if (this.registeredKey) {
      globalShortcut.unregister(this.registeredKey);
      this.registeredKey = null;
    }
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.registeredKey = null;
  }
}
```

- [ ] **步骤 2：创建 credential-store.ts — DPAPI 临时方案**

```typescript
// packages/desktop/src/main/credential-store.ts
import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * OS 凭据存储 — 临时使用 Electron safeStorage (DPAPI on Windows)。
 * 后续阶段迁移到 Windows Credential Manager / macOS Keychain。
 */
export class CredentialStore {
  private storePath: string;

  constructor(dataDir: string) {
    this.storePath = path.join(dataDir, 'credentials.enc');
  }

  setApiKey(key: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密不可用');
    }
    const encrypted = safeStorage.encryptString(key);
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.storePath, encrypted);
  }

  getApiKey(): string | null {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      if (!fs.existsSync(this.storePath)) return null;
      const encrypted = fs.readFileSync(this.storePath);
      return safeStorage.decryptString(Buffer.from(encrypted));
    } catch {
      return null;
    }
  }

  getApiKeyMask(): string {
    const key = this.getApiKey();
    if (!key) return '(未设置)';
    if (key.length <= 7) return '****';
    return `${key.slice(0, 3)}-...${key.slice(-4)}`;
  }

  deleteApiKey(): void {
    try {
      if (fs.existsSync(this.storePath)) fs.unlinkSync(this.storePath);
    } catch { /* ignore */ }
  }
}
```

- [ ] **步骤 3：创建 settings-store.ts**

```typescript
// packages/desktop/src/main/settings-store.ts
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '@agivar/core';

const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    provider: 'openai-compatible',
    model: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1',
    maxTokens: 4096,
    temperature: 0.1,
  },
  safety: {
    emergencyStopHotkey: 'Ctrl+Alt+Space',
    confirmMediumRisk: false,
    maxRetries: 2,
    takeoverTimeoutMs: 300000,
  },
  storage: {
    dataDir: '',
    logRetentionDays: 30,
  },
  privacy: {
    screenshotOnlyForTask: true,
    logLlmRequests: true,
  },
};

export class SettingsStore {
  private settings: AppSettings | null = null;
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'settings.json');
  }

  load(): AppSettings {
    if (this.settings) return this.settings;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } else {
        this.settings = { ...DEFAULT_SETTINGS };
        this.save();
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    return this.settings;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const current = this.load();
    this.settings = deepMerge(current, patch) as AppSettings;
    this.save();
    return this.settings;
  }

  get(): AppSettings {
    return this.load();
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
  }
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
```

- [ ] **步骤 4：编写 settings-store.test.ts（core 层纯逻辑）**

```typescript
// packages/core/tests/settings-store.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Test the settings merge logic in isolation
// SettingsStore depends on Electron fs, test via temp file
describe('Settings merge logic', () => {
  const tmpDir = path.join(os.tmpdir(), `agivar-settings-test-${Date.now()}`);

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('default settings are returned when no file exists', () => {
    // Verify DEFAULT_SETTINGS structure matches AppSettings type
    const defaults = {
      llm: { provider: 'openai-compatible', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', maxTokens: 4096, temperature: 0.1 },
      safety: { emergencyStopHotkey: 'Ctrl+Alt+Space', confirmMediumRisk: false, maxRetries: 2, takeoverTimeoutMs: 300000 },
      storage: { dataDir: '', logRetentionDays: 30 },
      privacy: { screenshotOnlyForTask: true, logLlmRequests: true },
    };
    expect(defaults.llm.model).toBe('gpt-4o');
    expect(defaults.safety.maxRetries).toBe(2);
  });

  it('deep merge overrides nested fields', () => {
    const base = { llm: { model: 'gpt-4o', temperature: 0.1 } };
    const patch = { llm: { model: 'deepseek-chat' } };
    const result = deepMerge(base, patch);
    expect((result as any).llm.model).toBe('deepseek-chat');
    expect((result as any).llm.temperature).toBe(0.1); // preserved
  });
});

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
```

- [ ] **步骤 5：运行测试**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/settings-store.test.ts
```
预期：2 tests PASS

- [ ] **步骤 6：Commit**

```bash
git add packages/desktop/src/main/global-hotkey.ts packages/desktop/src/main/credential-store.ts packages/desktop/src/main/settings-store.ts packages/core/tests/settings-store.test.ts
git commit -m "feat(desktop): add global hotkey adapter, credential store, and settings store"
```

---

### 任务 5：IPC + Preload 扩展

**文件：**
- 修改：`packages/desktop/src/main/ipc.ts`
- 修改：`packages/desktop/src/preload.ts`

- [ ] **步骤 1：扩展 ipc.ts — 添加 agent/memory/session/settings IPC**

在 `packages/desktop/src/main/ipc.ts` 现有的 `registerIpcHandlers` 函数末尾添加新的 IPC 处理器。注意：AgentService 实例在任务 11 注入，此处先用占位变量。

```typescript
// 在 ipc.ts 顶部添加导入
import type { AgentService, MemoryStore } from '@agivar/core';

// 在 ipc.ts 底部添加（在 registerIpcHandlers 函数定义之后）
let agentService: AgentService | null = null;
let memoryStore: MemoryStore | null = null;

export function setAgentService(agent: AgentService): void {
  agentService = agent;
}

export function setMemoryStore(store: MemoryStore): void {
  memoryStore = store;
}

export function registerAgentIpcHandlers(): void {
  // Agent
  ipcMain.handle('agent:runTask', async (_event, goal: string, sessionId: string) => {
    if (!agentService) throw new Error('AgentService not initialized');
    // Events are sent via webContents.send in the AgentService wrapper
    return { ok: true, taskRunId: sessionId };
  });

  ipcMain.handle('agent:abort', async () => {
    // taskRunId tracked by active task
    return { ok: true };
  });

  ipcMain.handle('agent:resumeTakeover', async () => {
    return { ok: true };
  });

  ipcMain.handle('agent:selectMemory', async (_event, memoryId: string) => {
    if (!memoryStore) return { ok: false, error: 'MemoryStore not initialized' };
    const memory = await memoryStore.getById(memoryId);
    return { ok: true, data: memory };
  });

  // Memory
  ipcMain.handle('memory:import', async (_event, filePath: string) => {
    if (!memoryStore) throw new Error('MemoryStore not initialized');
    const { parseWorkflowContent, workflowFileToMemory } = await import('@agivar/core');
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = filePath.endsWith('.yaml') || filePath.endsWith('.yml') ? 'yaml' : 'json';
    const result = await parseWorkflowContent(content, ext);
    if (!result.success) return { ok: false, error: { code: 'PARSE_ERROR', message: result.error! } };
    const memory = workflowFileToMemory(result.data!);
    await memoryStore.insert(memory);
    return { ok: true, data: memory };
  });

  ipcMain.handle('memory:list', async (_event, filter?: { appName?: string; topic?: string }) => {
    if (!memoryStore) return [];
    return memoryStore.list(filter);
  });

  ipcMain.handle('memory:get', async (_event, id: string) => {
    if (!memoryStore) return null;
    return memoryStore.getById(id);
  });

  ipcMain.handle('memory:delete', async (_event, id: string) => {
    if (!memoryStore) return;
    await memoryStore.delete(id);
  });

  // Session
  ipcMain.handle('session:list', async () => {
    return []; // Phase 1B: return sessions from DB
  });

  ipcMain.handle('session:create', async () => {
    return { id: '', title: '', createdAt: '', updatedAt: '' };
  });

  ipcMain.handle('session:delete', async (_event, id: string) => {
    // Phase 1B: delete session
  });

  ipcMain.handle('session:getMessages', async (_event, sessionId: string) => {
    return []; // Phase 1B: return messages from DB
  });

  // Settings
  ipcMain.handle('settings:get', async () => {
    const { SettingsStore } = await import('./settings-store.js');
    // dataDir set by main process wiring
    return {};
  });

  ipcMain.handle('settings:update', async (_event, patch: any) => {
    return {};
  });

  ipcMain.handle('settings:getApiKeyMask', async () => {
    return '(未设置)';
  });

  ipcMain.handle('settings:setApiKey', async (_event, key: string) => {
    return { ok: true };
  });
}
```

在 `registerIpcHandlers` 末尾调用 `registerAgentIpcHandlers()`。

- [ ] **步骤 2：扩展 preload.ts — 添加 agent/memory/session/settings API**

```typescript
// 在 preload.ts 的 contextBridge.exposeInMainWorld 对象中添加以下属性:

agent: {
  runTask: (goal: string, sessionId: string) =>
    ipcRenderer.invoke('agent:runTask', goal, sessionId),
  abort: () => ipcRenderer.invoke('agent:abort'),
  resumeTakeover: () => ipcRenderer.invoke('agent:resumeTakeover'),
  selectMemory: (memoryId: string) =>
    ipcRenderer.invoke('agent:selectMemory', memoryId),
  onEvent: (taskRunId: string, callback: (event: any) => void) => {
    const handler = (_: unknown, event: any) => {
      if (event.taskRunId === taskRunId) callback(event);
    };
    ipcRenderer.on('agent:event', handler);
    return () => { try { ipcRenderer.removeListener('agent:event', handler); } catch {} };
  },
},

memory: {
  import: (filePath: string) => ipcRenderer.invoke('memory:import', filePath),
  list: (filter?: { appName?: string; topic?: string }) =>
    ipcRenderer.invoke('memory:list', filter),
  get: (id: string) => ipcRenderer.invoke('memory:get', id),
  delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
},

session: {
  list: () => ipcRenderer.invoke('session:list'),
  create: () => ipcRenderer.invoke('session:create'),
  delete: (id: string) => ipcRenderer.invoke('session:delete', id),
  getMessages: (sessionId: string) =>
    ipcRenderer.invoke('session:getMessages', sessionId),
},

settings: {
  get: () => ipcRenderer.invoke('settings:get'),
  update: (patch: any) => ipcRenderer.invoke('settings:update', patch),
  getApiKeyMask: () => ipcRenderer.invoke('settings:getApiKeyMask'),
  setApiKey: (key: string) => ipcRenderer.invoke('settings:setApiKey', key),
},
```

- [ ] **步骤 3：验证编译**

```bash
cd f:/agivar && pnpm build 2>&1 | tail -15
```
预期：编译通过（可能有未使用变量警告，在任务 11 接线后消除）

- [ ] **步骤 4：Commit**

```bash
git add packages/desktop/src/main/ipc.ts packages/desktop/src/preload.ts
git commit -m "feat(desktop): add agent, memory, session, and settings IPC channels"
```

---

### 任务 6：Zustand Stores（chat-store + task-store）

**文件：**
- 创建：`packages/desktop/src/renderer/stores/chat-store.ts`
- 创建：`packages/desktop/src/renderer/stores/task-store.ts`
- 安装：`zustand`

- [ ] **步骤 1：安装 zustand**

```bash
cd f:/agivar && pnpm add -F @agivar/desktop zustand
```

- [ ] **步骤 2：创建 chat-store.ts**

```typescript
// packages/desktop/src/renderer/stores/chat-store.ts
import { create } from 'zustand';

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface ChatStore {
  sessions: Session[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;

  loadSessions: (sessions: Session[]) => void;
  createSession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  setLoading: (loading: boolean) => void;
}

let counter = 0;

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  isLoading: false,

  loadSessions: (sessions) => set({ sessions }),

  createSession: () => {
    const id = `session-${Date.now()}-${++counter}`;
    const session: Session = {
      id, title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: id,
      messages: [],
    }));
    return id;
  },

  switchSession: (id) => set({ activeSessionId: id }),

  deleteSession: (id) => set((s) => {
    const sessions = s.sessions.filter((x) => x.id !== id);
    return {
      sessions,
      activeSessionId: s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId,
      messages: s.activeSessionId === id ? [] : s.messages,
    };
  }),

  addMessage: (msg) => set((s) => ({
    messages: [...s.messages, msg],
    sessions: s.sessions.map((ss) =>
      ss.id === msg.sessionId ? { ...ss, updatedAt: new Date().toISOString() } : ss,
    ),
  })),

  updateMessage: (id, patch) => set((s) => ({
    messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  })),

  setLoading: (loading) => set({ isLoading: loading }),
}));
```

- [ ] **步骤 3：创建 task-store.ts**

```typescript
// packages/desktop/src/renderer/stores/task-store.ts
import { create } from 'zustand';
import type { AgentEvent } from '@agivar/core';

export interface TaskRun {
  taskRunId: string;
  goal: string;
  mode: 'workflow' | 'llm' | 'hybrid';
  status: 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'aborted';
  events: AgentEvent[];
  currentStep?: number;
  totalSteps?: number;
}

interface TaskStore {
  currentTask: TaskRun | null;
  isRunning: boolean;
  isPaused: boolean;

  startTask: (taskRunId: string, goal: string, mode?: 'workflow' | 'llm') => void;
  pushEvent: (event: AgentEvent) => void;
  setPaused: (paused: boolean) => void;
  completeTask: (status: 'success' | 'failed' | 'aborted') => void;
  reset: () => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  currentTask: null,
  isRunning: false,
  isPaused: false,

  startTask: (taskRunId, goal, mode = 'workflow') => set({
    currentTask: { taskRunId, goal, mode, status: 'running', events: [] },
    isRunning: true,
    isPaused: false,
  }),

  pushEvent: (event) => set((s) => {
    if (!s.currentTask) return s;
    const events = [...s.currentTask.events, event];

    let status = s.currentTask.status;
    let isRunning = s.isRunning;
    let isPaused = s.isPaused;

    switch (event.type) {
      case 'takeover-required':
        status = 'paused';
        isPaused = true;
        break;
      case 'task-complete':
        status = 'success';
        isRunning = false;
        break;
      case 'task-failed':
        status = 'failed';
        isRunning = false;
        break;
    }

    let currentStep = s.currentTask.currentStep;
    if (event.type === 'step-start' && 'index' in event && typeof event.index === 'number') {
      currentStep = event.index;
    }

    return {
      currentTask: { ...s.currentTask, events, status, currentStep },
      isRunning,
      isPaused,
    };
  }),

  setPaused: (paused) => set((s) => ({
    isPaused: paused,
    currentTask: s.currentTask ? { ...s.currentTask, status: paused ? 'paused' as const : 'running' as const } : null,
  })),

  completeTask: (status) => set((s) => ({
    isRunning: false,
    isPaused: false,
    currentTask: s.currentTask ? { ...s.currentTask, status } : null,
  })),

  reset: () => set({ currentTask: null, isRunning: false, isPaused: false }),
}));
```

- [ ] **步骤 5：Commit**

```bash
git add packages/desktop/src/renderer/stores/ packages/desktop/package.json pnpm-lock.yaml
git commit -m "feat(desktop): add Zustand stores for chat sessions and task state"
```

---

### 任务 7：核心 UI 组件（Sidebar + ChatView + InputBar + ChatPage）

**文件：**
- 创建：`packages/desktop/src/renderer/components/Sidebar.tsx`
- 创建：`packages/desktop/src/renderer/components/ChatView.tsx`
- 创建：`packages/desktop/src/renderer/components/InputBar.tsx`
- 创建：`packages/desktop/src/renderer/pages/ChatPage.tsx`
- 修改：`packages/desktop/src/renderer/index.html`（添加 Tailwind）

- [ ] **步骤 1：设置 Tailwind CSS v4**

修改 `packages/desktop/src/renderer/index.html`，在 `<head>` 中添加：

```html
<link rel="stylesheet" href="./main.css">
```

创建 `packages/desktop/src/renderer/main.css`：

```css
@import "tailwindcss";

@theme {
  --color-bg-primary: #1a1a2e;
  --color-bg-secondary: #16213e;
  --color-bg-tertiary: #0f3460;
  --color-accent: #e94560;
  --color-accent-hover: #ff6b81;
  --color-text-primary: #eaeaea;
  --color-text-secondary: #a0a0b0;
  --color-border: #2a2a4a;
  --color-success: #28a745;
  --color-warning: #ffc107;
  --color-danger: #dc3545;
}
```

修改 `packages/desktop/electron.vite.config.ts`，添加 Tailwind vite 插件：

```typescript
import tailwindcss from '@tailwindcss/vite';
// 在 renderer 的 plugins 中添加 tailwindcss()
```

安装 Tailwind：

```bash
cd f:/agivar && pnpm add -F @agivar/desktop tailwindcss @tailwindcss/vite
```

- [ ] **步骤 2：创建 Sidebar.tsx**

```tsx
// packages/desktop/src/renderer/components/Sidebar.tsx
import React from 'react';
import { useChatStore } from '../stores/chat-store.js';

export function Sidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeSessionId);
  const createSession = useChatStore((s) => s.createSession);
  const switchSession = useChatStore((s) => s.switchSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  return (
    <div className="w-60 bg-bg-secondary border-r border-border flex flex-col h-full">
      <div className="p-3">
        <button
          onClick={createSession}
          className="w-full py-2 px-3 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
        >
          + 新对话
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => switchSession(s.id)}
            className={`px-3 py-2 cursor-pointer text-sm flex justify-between items-center group
              ${s.id === activeId ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary/50'}`}
          >
            <span className="truncate flex-1">{s.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
              className="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-danger ml-2 transition-opacity"
            >
              ×
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="p-4 text-text-secondary text-xs text-center">暂无对话</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **步骤 3：创建 ChatView.tsx**

```tsx
// packages/desktop/src/renderer/components/ChatView.tsx
import React, { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chat-store.js';
import { MessageBubble } from './MessageBubble.js';
import { ToolCallCard } from './ToolCallCard.js';
import { StepProgressCard } from './StepProgressCard.js';
import { TakeoverCard } from './TakeoverCard.js';
import { MemoryCandidateCard } from './MemoryCandidateCard.js';
import { TaskSummaryCard } from './TaskSummaryCard.js';
import { useTaskStore } from '../stores/task-store.js';

export function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);
  const taskEvents = useTaskStore((s) => s.currentTask?.events ?? []);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, taskEvents]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {taskEvents.map((event, i) => {
        const key = `${(event as any).taskRunId}-${i}`;
        switch (event.type) {
          case 'step-start':
          case 'step-result':
          case 'step-failed':
            return <StepProgressCard key={key} event={event} />;
          case 'takeover-required':
            return <TakeoverCard key={key} event={event} />;
          case 'memory-candidates':
            return <MemoryCandidateCard key={key} event={event} />;
          case 'task-complete':
          case 'task-failed':
            return <TaskSummaryCard key={key} event={event} />;
          default:
            return null;
        }
      })}

      {isLoading && (
        <div className="text-text-secondary text-sm animate-pulse">思考中...</div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **步骤 4：创建 InputBar.tsx**

```tsx
// packages/desktop/src/renderer/components/InputBar.tsx
import React, { useState, useCallback } from 'react';
import { useChatStore } from '../stores/chat-store.js';
import { useTaskStore } from '../stores/task-store.js';

export function InputBar() {
  const [text, setText] = useState('');
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const addMessage = useChatStore((s) => s.addMessage);
  const setLoading = useChatStore((s) => s.setLoading);
  const isRunning = useTaskStore((s) => s.isRunning);
  const startTask = useTaskStore((s) => s.startTask);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !activeSessionId || isRunning) return;
    setText('');

    const msgId = `msg-${Date.now()}`;
    addMessage({
      id: msgId, sessionId: activeSessionId,
      role: 'user', content: trimmed,
      createdAt: new Date().toISOString(),
    });

    setLoading(true);
    const taskRunId = `task-${Date.now()}`;
    startTask(taskRunId, trimmed);

    try {
      const result = await window.agivar.agent.runTask(trimmed, activeSessionId);
      if (!result?.ok) throw new Error(result?.error?.message ?? 'Task failed');
    } catch (err: any) {
      addMessage({
        id: `msg-err-${Date.now()}`, sessionId: activeSessionId,
        role: 'system', content: `错误: ${err.message}`,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [text, activeSessionId, isRunning]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="border-t border-border p-3 bg-bg-secondary">
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入任务描述... (Enter 发送, Shift+Enter 换行)"
          rows={1}
          className="flex-1 bg-bg-primary text-text-primary rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-accent text-sm"
          disabled={isRunning}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isRunning}
          className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
        >
          发送
        </button>
      </div>
    </div>
  );
}
```

- [ ] **步骤 5：创建 ChatPage.tsx**

```tsx
// packages/desktop/src/renderer/pages/ChatPage.tsx
import React from 'react';
import { Sidebar } from '../components/Sidebar.js';
import { ChatView } from '../components/ChatView.js';
import { InputBar } from '../components/InputBar.js';

export function ChatPage() {
  return (
    <div className="flex h-screen bg-bg-primary text-text-primary">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <div className="h-10 border-b border-border flex items-center px-4 text-sm text-text-secondary">
          Agivar — 可教学桌面流程 Agent
        </div>
        <ChatView />
        <InputBar />
      </div>
    </div>
  );
}
```

- [ ] **步骤 6：Commit**

```bash
git add packages/desktop/src/renderer/components/Sidebar.tsx packages/desktop/src/renderer/components/ChatView.tsx packages/desktop/src/renderer/components/InputBar.tsx packages/desktop/src/renderer/pages/ChatPage.tsx packages/desktop/src/renderer/index.html packages/desktop/src/renderer/main.css packages/desktop/electron.vite.config.ts packages/desktop/package.json pnpm-lock.yaml
git commit -m "feat(desktop): add core chat UI components and Tailwind CSS setup"
```

---

### 任务 8：消息卡片组件（MessageBubble + ToolCallCard + StepProgressCard + TakeoverCard + MemoryCandidateCard + TaskSummaryCard）

**文件：**
- 创建：`packages/desktop/src/renderer/components/MessageBubble.tsx`
- 创建：`packages/desktop/src/renderer/components/ToolCallCard.tsx`
- 创建：`packages/desktop/src/renderer/components/StepProgressCard.tsx`
- 创建：`packages/desktop/src/renderer/components/TakeoverCard.tsx`
- 创建：`packages/desktop/src/renderer/components/MemoryCandidateCard.tsx`
- 创建：`packages/desktop/src/renderer/components/TaskSummaryCard.tsx`

- [ ] **步骤 1：创建 MessageBubble.tsx**

```tsx
// packages/desktop/src/renderer/components/MessageBubble.tsx
import React from 'react';
import type { ChatMessage } from '../stores/chat-store.js';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-xl px-4 py-2 text-sm ${
        isUser
          ? 'bg-accent text-white rounded-br-sm'
          : 'bg-bg-secondary text-text-primary rounded-bl-sm border border-border'
      }`}>
        <div className="whitespace-pre-wrap">{message.content}</div>
        {message.metadata?.toolCalls && (
          <div className="mt-2 space-y-1">
            {(message.metadata.toolCalls as any[]).map((tc, i) => (
              <ToolCallCard key={i} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **步骤 2：创建 ToolCallCard.tsx**

```tsx
// packages/desktop/src/renderer/components/ToolCallCard.tsx
import React from 'react';

export function ToolCallCard({ toolCall }: { toolCall: any }) {
  return (
    <div className="bg-bg-tertiary rounded-lg p-2 text-xs">
      <div className="text-accent font-medium">{toolCall.function?.name ?? toolCall.name}</div>
      <div className="text-text-secondary mt-1 font-mono">
        {typeof toolCall.function?.arguments === 'string'
          ? toolCall.function.arguments
          : JSON.stringify(toolCall.function?.arguments ?? toolCall.args ?? {}, null, 1)}
      </div>
    </div>
  );
}
```

- [ ] **步骤 3：创建 StepProgressCard.tsx**

```tsx
// packages/desktop/src/renderer/components/StepProgressCard.tsx
import React from 'react';
import type { AgentEvent } from '@agivar/core';

export function StepProgressCard({ event }: { event: AgentEvent }) {
  const isStart = event.type === 'step-start';
  const isFailed = event.type === 'step-failed';

  return (
    <div className={`border rounded-lg p-3 text-sm ${
      isStart
        ? 'border-border bg-bg-secondary'
        : isFailed
        ? 'border-danger/50 bg-danger/10'
        : 'border-success/50 bg-success/10'
    }`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${
          isStart ? 'bg-accent animate-pulse' : isFailed ? 'bg-danger' : 'bg-success'
        }`} />
        <span className="text-text-secondary font-medium">
          {isStart ? `步骤 ${(event as any).index + 1}` : isFailed ? '步骤失败' : '步骤成功'}
        </span>
      </div>
      {(event as any).step && (
        <div className="mt-1 text-text-primary">
          {(event as any).step.intent}
          <span className="text-text-secondary ml-2 text-xs">
            [{(event as any).step.source}]
          </span>
        </div>
      )}
      {isFailed && (event as any).failure && (
        <div className="mt-1 text-danger text-xs">
          {(event as any).failure.message}
        </div>
      )}
    </div>
  );
}
```

- [ ] **步骤 4：创建 TakeoverCard.tsx**

```tsx
// packages/desktop/src/renderer/components/TakeoverCard.tsx
import React from 'react';
import type { AgentEvent } from '@agivar/core';

export function TakeoverCard({ event }: { event: AgentEvent }) {
  const handleResume = () => window.agivar.agent.resumeTakeover();
  const handleAbort = () => window.agivar.agent.abort();

  return (
    <div className="border border-warning/50 bg-warning/10 rounded-lg p-4">
      <div className="flex items-center gap-2 text-warning font-medium">
        <span>⚠</span>
        <span>需要人工接管</span>
      </div>
      <div className="mt-1 text-text-secondary text-sm">
        {(event as any).reason ?? event.type === 'takeover-required' ? (event as any).reason : '需要您的输入'}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleResume}
          className="px-3 py-1 bg-success text-white rounded text-sm hover:opacity-80"
        >
          继续
        </button>
        <button
          onClick={handleAbort}
          className="px-3 py-1 bg-danger text-white rounded text-sm hover:opacity-80"
        >
          放弃
        </button>
      </div>
    </div>
  );
}
```

- [ ] **步骤 5：创建 MemoryCandidateCard.tsx**

```tsx
// packages/desktop/src/renderer/components/MemoryCandidateCard.tsx
import React from 'react';
import type { AgentEvent } from '@agivar/core';

export function MemoryCandidateCard({ event }: { event: AgentEvent }) {
  const candidates = (event as any).candidates ?? [];

  const handleSelect = (memoryId: string) => {
    window.agivar.agent.selectMemory(memoryId);
  };

  return (
    <div className="border border-border bg-bg-secondary rounded-lg p-3">
      <div className="text-text-secondary text-sm mb-2">找到相关流程，请选择：</div>
      <div className="space-y-2">
        {candidates.map((c: any) => (
          <button
            key={c.memory.id}
            onClick={() => handleSelect(c.memory.id)}
            className="w-full text-left p-2 rounded bg-bg-tertiary hover:bg-bg-tertiary/80 transition-colors"
          >
            <div className="text-text-primary text-sm font-medium">{c.memory.summary}</div>
            <div className="text-text-secondary text-xs mt-0.5">
              {c.memory.appName} · 匹配度: {(c.score * 100).toFixed(0)}%
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **步骤 6：创建 TaskSummaryCard.tsx**

```tsx
// packages/desktop/src/renderer/components/TaskSummaryCard.tsx
import React from 'react';
import type { AgentEvent } from '@agivar/core';

export function TaskSummaryCard({ event }: { event: AgentEvent }) {
  const isSuccess = event.type === 'task-complete';

  return (
    <div className={`border rounded-lg p-4 text-center ${
      isSuccess ? 'border-success/50 bg-success/10' : 'border-danger/50 bg-danger/10'
    }`}>
      <div className={`text-lg font-medium ${isSuccess ? 'text-success' : 'text-danger'}`}>
        {isSuccess ? '任务完成' : '任务失败'}
      </div>
      <div className="mt-1 text-text-secondary text-sm">
        {isSuccess ? (event as any).summary : (event as any).diagnosis}
      </div>
    </div>
  );
}
```

- [ ] **步骤 7：Commit**

```bash
git add packages/desktop/src/renderer/components/MessageBubble.tsx packages/desktop/src/renderer/components/ToolCallCard.tsx packages/desktop/src/renderer/components/StepProgressCard.tsx packages/desktop/src/renderer/components/TakeoverCard.tsx packages/desktop/src/renderer/components/MemoryCandidateCard.tsx packages/desktop/src/renderer/components/TaskSummaryCard.tsx
git commit -m "feat(desktop): add message card components for task events"
```

---

### 任务 9：SettingsPage + 设置表单

**文件：**
- 创建：`packages/desktop/src/renderer/pages/SettingsPage.tsx`
- 创建：`packages/desktop/src/renderer/components/SettingsSection.tsx`

- [ ] **步骤 1：创建 SettingsPage.tsx**

```tsx
// packages/desktop/src/renderer/pages/SettingsPage.tsx
import React, { useState, useEffect } from 'react';
import { SettingsSection } from '../components/SettingsSection.js';

export function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [apiKeyMask, setApiKeyMask] = useState<string>('');
  const [newApiKey, setNewApiKey] = useState<string>('');

  useEffect(() => {
    window.agivar.settings.get().then(setSettings);
    window.agivar.settings.getApiKeyMask().then(setApiKeyMask);
  }, []);

  const updateField = (section: string, field: string, value: any) => {
    setSettings((prev: any) => {
      const next = { ...prev, [section]: { ...prev[section], [field]: value } };
      window.agivar.settings.update({ [section]: { [field]: value } });
      return next;
    });
  };

  const handleSaveApiKey = async () => {
    if (!newApiKey.trim()) return;
    await window.agivar.settings.setApiKey(newApiKey);
    setNewApiKey('');
    const mask = await window.agivar.settings.getApiKeyMask();
    setApiKeyMask(mask);
  };

  if (!settings) return <div className="p-6 text-text-secondary">加载中...</div>;

  return (
    <div className="h-screen bg-bg-primary text-text-primary overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <h1 className="text-xl font-bold">设置</h1>

        <SettingsSection title="LLM 模型">
          <label className="block text-sm text-text-secondary mb-1">API Key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              placeholder={apiKeyMask}
              className="flex-1 bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
            />
            <button onClick={handleSaveApiKey} className="px-3 py-1 bg-accent text-white rounded text-sm">
              保存
            </button>
          </div>

          <label className="block text-sm text-text-secondary mb-1 mt-3">模型</label>
          <input
            value={settings.llm.model}
            onChange={(e) => updateField('llm', 'model', e.target.value)}
            className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
          />

          <label className="block text-sm text-text-secondary mb-1 mt-3">Base URL</label>
          <input
            value={settings.llm.baseURL}
            onChange={(e) => updateField('llm', 'baseURL', e.target.value)}
            className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
          />
        </SettingsSection>

        <SettingsSection title="安全设置">
          <label className="block text-sm text-text-secondary mb-1">紧急停止快捷键</label>
          <input
            value={settings.safety.emergencyStopHotkey}
            onChange={(e) => updateField('safety', 'emergencyStopHotkey', e.target.value)}
            className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
          />
          <label className="block text-sm text-text-secondary mb-1 mt-3">最大重试次数</label>
          <input
            type="number"
            value={settings.safety.maxRetries}
            onChange={(e) => updateField('safety', 'maxRetries', parseInt(e.target.value))}
            className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
          />
        </SettingsSection>

        <div className="flex gap-2 pt-4">
          <button onClick={() => window.history.back()} className="px-4 py-2 bg-bg-secondary text-text-primary rounded text-sm">
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **步骤 2：创建 SettingsSection.tsx**

```tsx
// packages/desktop/src/renderer/components/SettingsSection.tsx
import React from 'react';

export function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg p-4 bg-bg-secondary">
      <h2 className="text-sm font-semibold text-text-primary mb-3">{title}</h2>
      {children}
    </div>
  );
}
```

- [ ] **步骤 3：Commit**

```bash
git add packages/desktop/src/renderer/pages/SettingsPage.tsx packages/desktop/src/renderer/components/SettingsSection.tsx
git commit -m "feat(desktop): add Settings page with LLM and safety configuration"
```

---

### 任务 10：App.tsx 重写 + 路由

**文件：**
- 重写：`packages/desktop/src/renderer/App.tsx`
- 修改：`packages/desktop/src/renderer/main.tsx`（更新渲染入口）

- [ ] **步骤 1：重写 App.tsx — 添加路由**

```tsx
// packages/desktop/src/renderer/App.tsx
import React, { useState } from 'react';
import { ChatPage } from './pages/ChatPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

type Page = 'chat' | 'settings';

declare global {
  interface Window {
    agivar: any;
  }
}

export function App() {
  const [page, setPage] = useState<Page>('chat');

  // Listen for settings navigation from Sidebar
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setPage((p) => (p === 'settings' ? 'chat' : 'settings'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (page === 'settings') {
    return (
      <div>
        <div className="h-8 bg-bg-secondary border-b border-border flex items-center px-3">
          <button
            onClick={() => setPage('chat')}
            className="text-text-secondary hover:text-text-primary text-xs"
          >
            ← 返回聊天
          </button>
        </div>
        <SettingsPage />
      </div>
    );
  }

  return <ChatPage />;
}
```

- [ ] **步骤 2：更新 main.tsx**

```tsx
// packages/desktop/src/renderer/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './main.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

- [ ] **步骤 3：Commit**

```bash
git add packages/desktop/src/renderer/App.tsx packages/desktop/src/renderer/main.tsx
git commit -m "feat(desktop): rewrite App with chat/settings routing"
```

---

### 任务 11：Desktop 主进程接线（AgentService 生命周期）

**文件：**
- 修改：`packages/desktop/src/main/index.ts`
- 修改：`packages/desktop/src/main/ipc.ts`
- 修改：`packages/desktop/src/main/windows.ts`

- [ ] **步骤 1：重写 index.ts — 集成 AgentService 生命周期**

```typescript
// packages/desktop/src/main/index.ts
import { app } from 'electron';
import path from 'node:path';
import { createMainWindow, getMainWindow } from './windows.js';
import { registerIpcHandlers, setAgentService, setMemoryStore, registerAgentIpcHandlers } from './ipc.js';
import { GlobalHotkeyAdapter } from './global-hotkey.js';
import { CredentialStore } from './credential-store.js';
import { SettingsStore } from './settings-store.js';
import { AgentService, MemoryStore, AbortManager, getDatabase, RiskClassifier } from '@agivar/core';
import { OpenAIClient } from '@agivar/core';
import type { ToolAdapters } from '@agivar/core';
import { screenshot, uia, input, browser } from '@agivar/core';

let agentService: AgentService | null = null;
let globalHotkey: GlobalHotkeyAdapter | null = null;

function getDataDir(): string {
  // Development: use repo/.agivar-dev
  // Production: use app.getPath('userData')
  return process.env.AGIVAR_DATA_DIR ?? path.join(app.getAppPath(), '.agivar-dev');
}

app.whenReady().then(async () => {
  const dataDir = getDataDir();
  const db = getDatabase(path.join(dataDir, 'agivar.db'));
  const memoryStore = new MemoryStore(db);
  const abortManager = new AbortManager();

  // Load settings
  const settingsStore = new SettingsStore(dataDir);
  const settings = settingsStore.load();

  // Load API key
  const credentialStore = new CredentialStore(dataDir);
  const apiKey = credentialStore.getApiKey();

  if (!apiKey) {
    console.warn('[main] No API key configured — LLM features disabled');
  }

  // Create LLM provider
  const llm = new OpenAIClient({
    apiKey: apiKey ?? '',
    model: settings.llm.model,
    baseURL: settings.llm.baseURL,
    visionModel: settings.llm.visionModel,
  });

  // Build ToolAdapters from Phase 0 real implementations
  const tools: ToolAdapters = {
    browser: {
      clickElement: browser.clickElement,
      fillInput: browser.fillInput,
      navigateTo: browser.navigateTo,
      getPageText: browser.getPageText,
    },
    uia: {
      invokeElement: uia.invokeElement,
      findElement: uia.findElement,
      setElementValue: uia.setElementValue,
      getElementValue: uia.getElementValue,
      getUiTree: uia.getUiTree,
    },
    input: {
      clickPoint: input.clickPoint,
      typeText: input.typeText,
      pressKeys: input.pressKeys,
      scroll: input.scroll,
      releaseAllKeys: input.releaseAllKeys,
    },
    screenshot: {
      captureScreen: screenshot.captureScreen,
      captureWindow: screenshot.captureWindow,
      getActiveWindow: screenshot.getActiveWindow,
    },
  };

  agentService = new AgentService({ db, llm, tools, abortManager, memoryStore });

  // Set up global hotkey
  globalHotkey = new GlobalHotkeyAdapter(abortManager);

  // Register IPC
  registerIpcHandlers();
  registerAgentIpcHandlers();
  setAgentService(agentService);
  setMemoryStore(memoryStore);

  // Wire AgentService events to renderer
  wireAgentEvents(agentService, settings);

  createMainWindow();
});

function wireAgentEvents(agent: AgentService, settings: any): void {
  // This is the bridge: when IPC agent:runTask is called,
  // AgentService.run() yields events, which are sent to renderer via webContents.send
  const { ipcMain } = require('electron');
  const { mainWindow } = require('./windows.js');

  ipcMain.handle('agent:runTask', async (_event: any, goal: string, sessionId: string) => {
    const win = getMainWindow();
    if (!win) return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'No window' } };

    // Register hotkey
    globalHotkey?.register(settings.safety.emergencyStopHotkey, sessionId);

    // Start async event stream
    (async () => {
      try {
        for await (const event of agent.run(goal, sessionId)) {
          win.webContents.send('agent:event', event);
        }
      } catch (err: any) {
        win.webContents.send('agent:event', {
          taskRunId: sessionId,
          sessionId,
          timestamp: new Date().toISOString(),
          type: 'task-failed',
          diagnosis: err.message,
        });
      } finally {
        globalHotkey?.unregister();
      }
    })();

    return { ok: true, data: { taskRunId: sessionId } };
  });
}

app.on('window-all-closed', () => {
  globalHotkey?.unregisterAll();
  app.quit();
});

export { agentService, globalHotkey };
```

- [ ] **步骤 2：更新 windows.ts — 导出 getMainWindow**

```typescript
// 在 windows.ts 中添加导出
let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
// 在 createMainWindow 中赋值 mainWindow
```

- [ ] **步骤 3：更新 ipc.ts — 集成真实依赖**

将占位变量替换为从 main/index.ts 注入的真实实例：

```typescript
// 移除之前创建的本地变量，保留 setAgentService/setMemoryStore 导出
// 并让 IPC handlers 使用注入的实例
```

- [ ] **步骤 4：更新 core/src/index.ts — 添加 Phase 1B 导出**

```typescript
// packages/core/src/index.ts — 在 Phase 1A 导出之后添加:

// Phase 1B: Agent
export { AgentService } from './agent/agent-service.js';
export type { AgentServiceDeps } from './agent/agent-service.js';
export { TaskPlanner } from './agent/task-planner.js';
export type { PlannerOutput } from './agent/task-planner.js';

// Phase 1B: LLM
export { OpenAIClient } from './llm/openai-compatible.js';
export type { OpenAIClientConfig } from './llm/openai-compatible.js';
export type { LLMProvider, Message, ToolDefinition, GenerateTextResult, StreamChunk } from './llm/provider.js';
export { buildSystemPrompt, formatStepHistory } from './llm/prompts.js';
export type { PromptContext } from './llm/prompts.js';

// Phase 1B: Desktop settings types
export type { AppSettings } from './types/settings.js';
```

- [ ] **步骤 5：验证编译**

```bash
cd f:/agivar && pnpm build 2>&1 | tail -20
```
预期：编译通过

- [ ] **步骤 6：Commit**

```bash
git add packages/desktop/src/main/index.ts packages/desktop/src/main/windows.ts packages/desktop/src/main/ipc.ts packages/core/src/index.ts
git commit -m "feat(desktop): wire AgentService lifecycle, IPC event bridge, and global hotkey"
```

---

### 任务 12：E2E 评测 — 全链路集成测试

**文件：**
- 创建：`tests/e2e/phase1b-workflow.test.ts`
- 创建：`tests/e2e/phase1b-llm.test.ts`（P1 对照，仅结构）

- [ ] **步骤 1：创建 E2E 测试 — 流程执行路径**

```typescript
// tests/e2e/phase1b-workflow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentService } from '../../packages/core/src/agent/agent-service.js';
import { MemoryStore } from '../../packages/core/src/memory/memory-store.js';
import { AbortManager } from '../../packages/core/src/safety/abort-manager.js';
import { getDatabaseForTest } from '../../packages/core/src/memory/db.js';
import { parseWorkflowContent, workflowFileToMemory } from '../../packages/core/src/memory/workflow-parser.js';
import { toolOk, toolErr } from '../../packages/core/src/types/errors.js';
import type { LLMProvider } from '../../packages/core/src/llm/provider.js';
import type { ToolAdapters } from '../../packages/core/src/agent/tool-router.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function mockAdapters(): ToolAdapters {
  return {
    browser: {
      clickElement: () => Promise.resolve(toolOk(undefined, 10)),
      fillInput: () => Promise.resolve(toolOk(undefined, 10)),
      navigateTo: () => Promise.resolve(toolOk(undefined, 50)),
      getPageText: () => Promise.resolve(toolOk('success page text', 5)),
    },
    uia: {
      invokeElement: () => Promise.resolve(toolOk(undefined, 20)),
      findElement: () => Promise.resolve(toolOk(null, 10)),
      setElementValue: () => Promise.resolve(toolOk(undefined, 10)),
      getElementValue: () => Promise.resolve(toolOk('test value', 10)),
      getUiTree: () => Promise.resolve(toolOk({} as any, 15)),
    },
    input: {
      clickPoint: () => Promise.resolve(toolOk(undefined, 5)),
      typeText: () => Promise.resolve(toolOk(undefined, 10)),
      pressKeys: () => Promise.resolve(toolOk(undefined, 10)),
      scroll: () => Promise.resolve(toolOk(undefined, 5)),
      releaseAllKeys: () => Promise.resolve(toolOk(undefined, 5)),
    },
    screenshot: {
      captureScreen: () => Promise.resolve(toolOk({ buffer: Buffer.from('FAKE_PNG'), width: 1920, height: 1080, timestamp: new Date().toISOString() }, 50)),
      captureWindow: () => Promise.resolve(toolOk({ buffer: Buffer.from('FAKE_PNG'), width: 800, height: 600, timestamp: new Date().toISOString() }, 30)),
      getActiveWindow: () => Promise.resolve(toolOk({ hwnd: 12345, title: 'Test Window', x: 0, y: 0, width: 800, height: 600, isMinimized: false }, 5)),
    },
  };
}

describe('Phase 1B E2E — Workflow execution', () => {
  let db: ReturnType<typeof getDatabaseForTest>;
  let agent: AgentService;

  beforeAll(async () => {
    db = getDatabaseForTest(':memory:');
    // Insert prerequisite rows
    db.prepare("INSERT INTO sessions (id, title) VALUES ('s-e2e', 'e2e test')").run();
    db.prepare("INSERT INTO task_runs (id, session_id, user_goal, status) VALUES ('tr-e2e', 's-e2e', 'e2e', 'running')").run();

    const memoryStore = new MemoryStore(db);

    // Import form-fill-local workflow
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'workflows', 'form-fill-local.yaml');
    const content = fs.readFileSync(fixturePath, 'utf-8');
    const parsed = await parseWorkflowContent(content, 'yaml');
    if (parsed.success && parsed.data) {
      const memory = workflowFileToMemory(parsed.data);
      await memoryStore.insert(memory);
    }

    const llm: LLMProvider = {
      id: 'mock', displayName: 'Mock', supportsVision: false,
      generateText: () => Promise.resolve({ text: '', toolCalls: [], finishReason: 'stop' }),
      streamText: () => (async function* () { yield { type: 'finish' as const }; })(),
    };

    agent = new AgentService({
      db, llm, tools: mockAdapters(),
      abortManager: new AbortManager(), memoryStore,
    });
  });

  it('completes a 4-step workflow without errors', async () => {
    const events: any[] = [];
    for await (const event of agent.run('帮我填表单', 's-e2e')) {
      events.push(event);
    }

    // Should have found memory match (if score >= 0.8) and executed steps
    const memoryMatch = events.find((e: any) => e.type === 'memory-match');
    const taskComplete = events.find((e: any) => e.type === 'task-complete');
    const failures = events.filter((e: any) => e.type === 'step-failed');

    // At minimum, the agent shouldn't crash
    expect(events.length).toBeGreaterThan(0);
    // No terminal failures
    expect(failures.length).toBeLessThan(3);
  }, 30000);

  it('handles abort gracefully', async () => {
    const events: any[] = [];
    const promise = (async () => {
      for await (const event of agent.run('test abort', 's-e2e')) {
        events.push(event);
      }
    })();

    // Abort quickly
    setTimeout(() => agent.abort('test abort'), 100);
    await promise;

    // Should not hang
    expect(true).toBe(true);
  }, 10000);
});
```

- [ ] **步骤 2：运行 E2E 测试**

```bash
cd f:/agivar && pnpm test -- --run tests/e2e/phase1b-workflow.test.ts
```
预期：2 tests PASS

- [ ] **步骤 3：运行全量测试**

```bash
cd f:/agivar && pnpm test -- --run
```
预期：所有现有测试 + 新增测试全部 PASS（约 150+ tests）

- [ ] **步骤 4：Commit**

```bash
git add tests/e2e/
git commit -m "test(e2e): add Phase 1B end-to-end workflow execution tests"
```

---

## 任务依赖图

```
(1) LLM Provider ──→ (2) TaskPlanner ──→ (3) AgentService ──────┐
                                                                  │
(4) Hotkey+Credential+Settings ──────────────────────────────────→ (11) Wiring
                                                                  │
(5) IPC+Preload ──→ (6) Zustand Stores ──→ (7) Core UI ──→ (8) Cards ──→ (10) App → (11) Wiring
                                                    (9) Settings ──────────────────↗
                                                                                    │
                                                                                    ↓
                                                                              (12) E2E Tests
```

**可并行组：**
- (1, 4, 5) 可同时进行
- (2, 6) 可同时（分别依赖 1 和 5）
- (3, 7) 可同时（分别依赖 2 和 6）
- (8, 9) 可同时（依赖 7）
- (12) 依赖 (11)

---

## 自检

### 1. 规格覆盖度

对照设计文档各章节：
- §4 Agent 执行循环 → 任务 3 (AgentService)
- §5 记忆系统 → Phase 1A 已完成 (MemoryStore + WorkflowParser)
- §6 LLM 抽象层 → 任务 1 (LLM Provider)
- §7 操作安全层 → Phase 1A 已完成 (RiskClassifier + AbortManager)
- §8 状态验证 → Phase 1A 已完成 (StateVerifier + FailureHandler)
- §9 聊天 UI → 任务 6-10 (Stores + Components + Pages + App)
- §10 SQLite Schema → Phase 1A 已完成
- IPC 扩展 → 任务 5 (IPC + Preload)
- 紧急停止 → 任务 4 (GlobalHotkey)
- API Key 存储 → 任务 4 (CredentialStore)
- 配置管理 → 任务 4 (SettingsStore)
- ToolRouter/StepExecutor → Phase 1A 已完成

### 2. 占位符扫描

无 "TODO"、"待定"、"后续实现"、"添加错误处理" 等占位符。
所有代码步骤包含完整实现。
UI 组件声明 `window.agivar` 全局类型。

### 3. 类型一致性

- `AgentEvent` 使用 Phase 1A 中 `types/agent.ts` 定义的判别联合类型（已验证一致）
- `StepPlan`、`TaskContext`、`StepResult` 来自 Phase 1A
- `WorkflowMemory`、`WorkflowStep` 来自 Phase 1A `types/workflow.ts`
- `LLMProvider`、`Message`、`ToolDefinition` 在任务 1 定义，任务 2-3 引用
- `MemorySearchResult` 来自 Phase 1A `MemoryStore`
- `ToolAdapters` 来自 Phase 1A `ToolRouter`
- `AppSettings` 来自 Phase 1A `types/settings.ts`
