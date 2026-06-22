import { describe, it, expect } from 'vitest';
import { TakeoverRequest } from '../src/types/agent.js';
import { DEFAULT_SETTINGS } from '../src/types/settings.js';
import type { StepAction, TargetDescriptor } from '../src/types/agent.js';

describe('StepAction discriminated union', () => {
  it('discriminates on type=click', () => {
    const action: StepAction = { type: 'click', target: { strategy: 'human', hint: 'the submit button' } };
    if (action.type === 'click') {
      expect(action.target.strategy).toBe('human');
    } else {
      throw new Error('expected click');
    }
  });

  it('discriminates on type=type', () => {
    const action: StepAction = { type: 'type', text: 'hello world' };
    if (action.type === 'type') {
      expect(action.text).toBe('hello world');
    } else {
      throw new Error('expected type');
    }
  });

  it('discriminates on type=done', () => {
    const action: StepAction = { type: 'done', summary: 'all done' };
    if (action.type === 'done') {
      expect(action.summary).toBe('all done');
    } else {
      throw new Error('expected done');
    }
  });
});

describe('TargetDescriptor discriminated union', () => {
  it('discriminates on strategy=playwright', () => {
    const td: TargetDescriptor = { strategy: 'playwright', selector: 'button.submit' };
    if (td.strategy === 'playwright') {
      expect(td.selector).toBe('button.submit');
    } else {
      throw new Error('expected playwright');
    }
  });

  it('discriminates on strategy=uia', () => {
    const td: TargetDescriptor = { strategy: 'uia', query: { automationId: 'btn1' } };
    if (td.strategy === 'uia') {
      expect(td.query.automationId).toBe('btn1');
    } else {
      throw new Error('expected uia');
    }
  });

  it('discriminates on strategy=coordinate', () => {
    const td: TargetDescriptor = {
      strategy: 'coordinate',
      point: { x: 100, y: 200, space: 'screen-physical' },
    };
    if (td.strategy === 'coordinate') {
      expect(td.point.x).toBe(100);
      expect(td.point.y).toBe(200);
    } else {
      throw new Error('expected coordinate');
    }
  });

  it('discriminates on strategy=human', () => {
    const td: TargetDescriptor = { strategy: 'human', hint: 'click the big red button' };
    if (td.strategy === 'human') {
      expect(td.hint).toBe('click the big red button');
    } else {
      throw new Error('expected human');
    }
  });
});

describe('TakeoverRequest', () => {
  it('is an instance of Error', () => {
    const err = new TakeoverRequest('unsafe operation detected');
    expect(err).toBeInstanceOf(Error);
  });

  it('has correct name', () => {
    const err = new TakeoverRequest('test');
    expect(err.name).toBe('TakeoverRequest');
  });

  it('exposes the reason property', () => {
    const err = new TakeoverRequest('user confirmation needed');
    expect(err.reason).toBe('user confirmation needed');
  });

  it('has a message containing the reason', () => {
    const err = new TakeoverRequest('risky step');
    expect(err.message).toContain('risky step');
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('has maxRetries=2', () => {
    expect(DEFAULT_SETTINGS.safety.maxRetries).toBe(2);
  });

  it('has provider=openai-compatible', () => {
    expect(DEFAULT_SETTINGS.llm.provider).toBe('openai-compatible');
  });

  it('has expected safety defaults', () => {
    expect(DEFAULT_SETTINGS.safety.emergencyStopHotkey).toBe('Ctrl+Alt+Space');
    expect(DEFAULT_SETTINGS.safety.takeoverTimeoutMs).toBe(300000);
    expect(DEFAULT_SETTINGS.safety.confirmMediumRisk).toBe(false);
  });

  it('has expected llm defaults', () => {
    expect(DEFAULT_SETTINGS.llm.model).toBe('gpt-4o');
    expect(DEFAULT_SETTINGS.llm.maxTokens).toBe(4096);
    expect(DEFAULT_SETTINGS.llm.temperature).toBe(0.1);
  });
});
