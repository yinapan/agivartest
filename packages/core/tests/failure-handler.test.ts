import { describe, it, expect } from 'vitest';
import { FailureHandler } from '../src/agent/failure-handler.js';
import type {
  FailureInfo,
  FailureErrorType,
  StepPlan,
  TaskContext,
  TaskMode,
  TaskStatus,
} from '../src/types/agent.js';

function createTaskContext(overrides: Partial<TaskContext> = {}): TaskContext {
  const ac = new AbortController();
  return {
    taskRunId: 'test-run-1',
    sessionId: 'test-session-1',
    goal: 'Submit expense report',
    mode: 'workflow' as TaskMode,
    status: 'running' as TaskStatus,
    stepIndex: 2,
    retryCountByStep: new Map(),
    browserSession: undefined,
    activeHwnd: undefined,
    activeWindowTitle: undefined,
    maxRetries: 3,
    outputDir: '/tmp/test',
    abortController: ac,
    signal: ac.signal,
    startedPids: [],
    createdTempDirs: [],
    humanTakeoverEvents: [],
    ...overrides,
  };
}

describe('FailureHandler.classify', () => {
  const handler = new FailureHandler();

  it('timeout → retryable', () => {
    const failure: FailureInfo = {
      stepIndex: 0,
      message: 'Operation timed out after 15000ms',
    };
    expect(handler.classify(failure)).toBe('retryable');
  });

  it('not visible → retryable', () => {
    const failure: FailureInfo = {
      stepIndex: 0,
      message: 'Element is not visible yet',
    };
    expect(handler.classify(failure)).toBe('retryable');
  });

  it('not ready → retryable', () => {
    const failure: FailureInfo = {
      stepIndex: 0,
      message: 'Application is not ready',
    };
    expect(handler.classify(failure)).toBe('retryable');
  });

  it('element_not_found → degradable', () => {
    const failure: FailureInfo = {
      stepIndex: 0,
      message: 'UIA_ELEMENT_NOT_FOUND: could not locate button',
    };
    expect(handler.classify(failure)).toBe('degradable');
  });

  it('selector → degradable', () => {
    const failure: FailureInfo = {
      stepIndex: 0,
      message: 'Invalid selector: #missing-element',
    };
    expect(handler.classify(failure)).toBe('degradable');
  });

  it('password → takeover', () => {
    const failure: FailureInfo = {
      stepIndex: 0,
      message: 'Password field requires manual entry',
    };
    expect(handler.classify(failure)).toBe('takeover');
  });

  it('captcha → takeover', () => {
    const failure: FailureInfo = {
      stepIndex: 0,
      message: 'CAPTCHA detected, cannot proceed automatically',
    };
    expect(handler.classify(failure)).toBe('takeover');
  });

  it('login → takeover', () => {
    const failure: FailureInfo = {
      stepIndex: 0,
      message: 'Login required, please authenticate',
    };
    expect(handler.classify(failure)).toBe('takeover');
  });

  it('unknown message → terminal', () => {
    const failure: FailureInfo = {
      stepIndex: 0,
      message: 'Unexpected system crash: segmentation fault',
    };
    expect(handler.classify(failure)).toBe('terminal');
  });
});

describe('FailureHandler.handle', () => {
  const handler = new FailureHandler();

  it('retryable within maxRetries → retry, increments count', async () => {
    const step: StepPlan = {
      intent: 'click submit button',
      action: { type: 'click', target: { strategy: 'playwright', selector: '#submit' } },
      riskLevel: 'low',
      source: 'workflow',
    };
    const ctx = createTaskContext();

    const failure: FailureInfo = {
      stepIndex: 2,
      message: 'Element timed out',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('retry');
    expect(ctx.retryCountByStep.get(2)).toBe(1);
  });

  it('retryable exhausted (retry count >= maxRetries) → degrade', async () => {
    const step: StepPlan = {
      intent: 'click submit button',
      action: { type: 'click', target: { strategy: 'playwright', selector: '#submit' } },
      riskLevel: 'low',
      source: 'workflow',
    };
    const ctx = createTaskContext();
    ctx.retryCountByStep.set(2, 3); // already at max

    const failure: FailureInfo = {
      stepIndex: 2,
      message: 'Element timed out again',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('degrade');
    if (result.action === 'degrade') {
      expect(result.newStrategy).toBe('uia');
    }
  });

  it('retryable exhausted on non-click action (no degradation target) → takeover', async () => {
    const step: StepPlan = {
      intent: 'type text',
      action: { type: 'type', text: 'hello' },
      riskLevel: 'low',
      source: 'workflow',
    };
    const ctx = createTaskContext();
    ctx.retryCountByStep.set(2, 3); // already at max

    const failure: FailureInfo = {
      stepIndex: 2,
      message: 'Operation timed out on type action',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('takeover');
    if (result.action === 'takeover') {
      expect(result.reason).toBe('重试用尽且无可用降级策略');
    }
  });

  it('retryable exhausted on last click strategy (coordinate) → takeover', async () => {
    const step: StepPlan = {
      intent: 'click button',
      action: { type: 'click', target: { strategy: 'coordinate', point: { x: 100, y: 200, space: 'screen-physical' } } },
      riskLevel: 'low',
      source: 'workflow',
    };
    const ctx = createTaskContext();
    ctx.retryCountByStep.set(2, 3); // already at max

    const failure: FailureInfo = {
      stepIndex: 2,
      message: 'Operation timed out on coordinate click',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('takeover');
    if (result.action === 'takeover') {
      expect(result.reason).toBe('重试用尽且无可用降级策略');
    }
  });

  it('degradable with click (playwright strategy) → returns next strategy uia', async () => {
    const step: StepPlan = {
      intent: 'click submit button',
      action: { type: 'click', target: { strategy: 'playwright', selector: '#submit' } },
      riskLevel: 'low',
      source: 'workflow',
    };
    const ctx = createTaskContext();

    const failure: FailureInfo = {
      stepIndex: 2,
      message: 'UIA_ELEMENT_NOT_FOUND for selector',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('degrade');
    if (result.action === 'degrade') {
      expect(result.newStrategy).toBe('uia');
    }
  });

  it('degradable with click (uia strategy) → returns next strategy coordinate', async () => {
    const step: StepPlan = {
      intent: 'click save button',
      action: { type: 'click', target: { strategy: 'uia', query: { automationId: 'btn-save' } } },
      riskLevel: 'low',
      source: 'workflow',
    };
    const ctx = createTaskContext();

    const failure: FailureInfo = {
      stepIndex: 2,
      message: 'element_not_found for uia query',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('degrade');
    if (result.action === 'degrade') {
      expect(result.newStrategy).toBe('coordinate');
    }
  });

  it('degradable on last strategy (coordinate) → takeover', async () => {
    const step: StepPlan = {
      intent: 'click button',
      action: { type: 'click', target: { strategy: 'coordinate', point: { x: 100, y: 200, space: 'screen-physical' } } },
      riskLevel: 'low',
      source: 'workflow',
    };
    const ctx = createTaskContext();

    const failure: FailureInfo = {
      stepIndex: 2,
      message: 'selector not found after all attempts',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('takeover');
    if (result.action === 'takeover') {
      expect(result.reason).toBe('所有定位策略均失败');
    }
  });

  it('degradable on non-click action → takeover (no next strategy)', async () => {
    const step: StepPlan = {
      intent: 'type text',
      action: { type: 'type', text: 'hello' },
      riskLevel: 'low',
      source: 'workflow',
    };
    const ctx = createTaskContext();

    const failure: FailureInfo = {
      stepIndex: 2,
      message: 'selector not found',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('takeover');
  });

  it('takeover (password) → takeover with reason', async () => {
    const step: StepPlan = {
      intent: 'log in',
      action: { type: 'click', target: { strategy: 'human', hint: 'enter password' } },
      riskLevel: 'forbidden',
      source: 'workflow',
    };
    const ctx = createTaskContext();

    const failure: FailureInfo = {
      stepIndex: 2,
      message: 'Password required for login',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('takeover');
    if (result.action === 'takeover') {
      expect(result.reason).toBe('Password required for login');
    }
  });

  it('terminal → abort with diagnosis', async () => {
    const step: StepPlan = {
      intent: 'do something',
      action: { type: 'observe' },
      riskLevel: 'low',
      source: 'workflow',
    };
    const ctx = createTaskContext();

    const failure: FailureInfo = {
      stepIndex: 3,
      message: 'Segmentation fault in native module',
      screenshot: '/tmp/screenshots/crash.png',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('abort');
    if (result.action === 'abort') {
      expect(result.diagnosis).toContain('Step 3: Segmentation fault in native module');
      expect(result.diagnosis).toContain('Task: Submit expense report');
      expect(result.diagnosis).toContain('Mode: workflow');
      expect(result.diagnosis).toContain('Screenshot: /tmp/screenshots/crash.png');
    }
  });

  it('uses explicit errorType over classify', async () => {
    const step: StepPlan = {
      intent: 'click',
      action: { type: 'click', target: { strategy: 'playwright', selector: '#btn' } },
      riskLevel: 'low',
      source: 'workflow',
    };
    const ctx = createTaskContext();

    // Even though message says "timeout", explicit errorType is 'terminal'
    const failure: FailureInfo = {
      stepIndex: 0,
      errorType: 'terminal',
      message: 'timeout occurred',
    };

    const result = await handler.handle(failure, step, ctx);

    expect(result.action).toBe('abort');
  });
});
