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
  {
    name: 'read_file',
    description: '读取文件内容（仅限授权目录）',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        scope: { type: 'string', enum: ['app-data', 'user-approved'] },
      },
      required: ['path', 'scope'],
    },
  },
  {
    name: 'read_table',
    description: '读取 CSV/Excel 表格数据',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '表格文件路径' },
        range: { type: 'string', description: '可选的单元格范围，如 A1:C10' },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_page_text',
    description: '获取当前浏览器页面的文本内容',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '可选的 CSS 选择器，限定提取范围' },
      },
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
      case 'read_file':
        return {
          intent: `读取文件 ${args.path}`,
          action: { type: 'read_file', path: (args.path as string) ?? '', scope: (args.scope as 'app-data' | 'user-approved') ?? 'user-approved' },
          riskLevel: 'low',
          source: 'llm',
        };
      case 'read_table':
        return {
          intent: `读取表格 ${args.path}`,
          action: { type: 'read_table', path: (args.path as string) ?? '', range: args.range as string | undefined },
          riskLevel: 'low',
          source: 'llm',
        };
      case 'get_page_text':
        return {
          intent: '获取页面文本',
          action: { type: 'get_page_text', selector: args.selector as string | undefined },
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

  async summarizeHistory(goal: string, steps: StepPlan[]): Promise<string> {
    const lines = steps.map((s, i) => `${i + 1}. [${s.source}] ${s.intent} → ${s.action.type}`).join('\n');
    const result = await this.llm.generateText({
      messages: [
        { role: 'system', content: '你是任务执行摘要器。将已执行的步骤压缩为简洁的进度摘要，保留关键操作和结果。用中文回答。' },
        { role: 'user', content: `目标: ${goal}\n\n已执行步骤:\n${lines}\n\n请用 2-3 句话总结进度。` },
      ],
      maxTokens: 256,
      temperature: 0,
    });
    return result.text || '已执行若干步骤';
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
