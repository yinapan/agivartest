import { describe, it, expect } from 'vitest';
import { RiskClassifier } from '../src/safety/risk-classifier.js';
import type { StepPlan } from '../src/types/agent.js';

describe('RiskClassifier', () => {
  const classifier = new RiskClassifier();

  it('workflow source uses step.riskLevel directly', () => {
    const step: StepPlan = {
      intent: 'do something dangerous',
      action: { type: 'click', target: { strategy: 'human', hint: 'delete all' } },
      riskLevel: 'low',
      source: 'workflow',
    };
    expect(classifier.classify(step)).toBe('low');
  });

  it('navigate action returns low risk', () => {
    const step: StepPlan = {
      intent: 'go to page',
      action: { type: 'navigate', url: 'https://example.com' },
      riskLevel: 'medium',
      source: 'llm',
    };
    expect(classifier.classify(step)).toBe('low');
  });

  it('observe action returns low risk', () => {
    const step: StepPlan = {
      intent: 'look',
      action: { type: 'observe' },
      riskLevel: 'medium',
      source: 'llm',
    };
    expect(classifier.classify(step)).toBe('low');
  });

  it('scroll action returns low risk', () => {
    const step: StepPlan = {
      intent: 'scroll down',
      action: { type: 'scroll', direction: 'down', amount: 100 },
      riskLevel: 'medium',
      source: 'llm',
    };
    expect(classifier.classify(step)).toBe('low');
  });

  it('intent with "删除" keyword returns high risk', () => {
    const step: StepPlan = {
      intent: '用户要求删除记录',
      action: { type: 'click', target: { strategy: 'human', hint: 'confirm button' } },
      riskLevel: 'low',
      source: 'llm',
    };
    expect(classifier.classify(step)).toBe('high');
  });

  it('intent with "密码" keyword returns forbidden', () => {
    const step: StepPlan = {
      intent: '获取密码',
      action: { type: 'type', text: 'hello' },
      riskLevel: 'low',
      source: 'llm',
    };
    expect(classifier.classify(step)).toBe('forbidden');
  });

  it('takeover action returns forbidden', () => {
    const step: StepPlan = {
      intent: 'need human help',
      action: { type: 'takeover', reason: 'captcha' },
      riskLevel: 'medium',
      source: 'llm',
    };
    expect(classifier.classify(step)).toBe('forbidden');
  });

  it('plain click without keywords returns low risk', () => {
    const step: StepPlan = {
      intent: 'click the save button',
      action: { type: 'click', target: { strategy: 'human', hint: 'save button' } },
      riskLevel: 'medium',
      source: 'llm',
    };
    expect(classifier.classify(step)).toBe('low');
  });
});
