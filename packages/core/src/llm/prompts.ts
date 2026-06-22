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
