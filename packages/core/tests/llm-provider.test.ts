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
