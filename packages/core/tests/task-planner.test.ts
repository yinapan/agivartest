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
