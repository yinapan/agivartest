# Task 2: TaskPlanner — LLM 规划 + 流程编排

**Files:**
- Create: `packages/core/src/agent/task-planner.ts`
- Test: `packages/core/tests/task-planner.test.ts`

## Step 1: Create task-planner.ts

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

## Step 2: Write task-planner.test.ts

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

## Step 3: Run tests

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/task-planner.test.ts
```
Expected: 6 tests PASS

## Step 4: Commit

```bash
git add packages/core/src/agent/task-planner.ts packages/core/tests/task-planner.test.ts
git commit -m "feat(core): add TaskPlanner for LLM-driven and workflow-driven step planning"
```

## Global Constraints

- **ESM strict**: `type: "module"`, all relative imports use `.js` extension
- **Agent does NOT depend on Electron**: pure Node.js
- **LLM plans only, never executes**: LLM produces StepPlan only
- **Phase 1A interfaces zero-change**: Do NOT modify existing Phase 1A files
- **Test DB uses `:memory:`**
- **UI components don't get unit tests**: Unit tests only for core layer

## Context

Task 2 of 12. The LLM provider layer (Task 1) is complete at `packages/core/src/llm/`:
- `provider.ts` — LLMProvider, Message, ToolCall, ToolDefinition, GenerateTextResult, StreamChunk
- `openai-compatible.ts` — OpenAIClient implementing LLMProvider
- `prompts.ts` — buildSystemPrompt, formatStepHistory, PromptContext

The TaskPlanner depends on these LLM types. Existing Phase 1A types used:
- `types/agent.ts` — StepPlan, StepAction, TaskContext, ExpectedState, TargetDescriptor
- `types/workflow.ts` — WorkflowMemory, WorkflowStep

The `buildStepPlanFromWorkflow` method duplicates some logic from Phase 1A's `workflow-executor.ts` `buildStepPlan`. This is intentional — TaskPlanner is the unified planner that replaces it. The Phase 1A function remains untouched (global constraint).

## Report

Write full report to: `f:/agivar/.claude/briefs/task-2-report.md`
