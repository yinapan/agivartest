import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolOk, toolErr } from '../src/types/errors.js';
import { StateVerifier } from '../src/agent/state-verifier.js';
import type { ToolAdapters } from '../src/agent/tool-router.js';
import type { TaskContext, TaskMode, TaskStatus, ExpectedState } from '../src/types/agent.js';
import type { WindowInfo } from '../src/tools/screenshot.js';
import type { UiaNode } from '../src/tools/uia.js';

function mockWindowInfo(overrides: Partial<WindowInfo> = {}): WindowInfo {
  return {
    hwnd: 12345,
    title: 'My App Dashboard',
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    isMinimized: false,
    ...overrides,
  };
}

function mockUiaNode(overrides: Partial<UiaNode> = {}): UiaNode {
  return {
    name: 'SubmitButton',
    controlType: 'Button',
    automationId: 'btn-submit',
    className: 'Button',
    boundingRect: { x: 100, y: 200, w: 80, h: 30 },
    isEnabled: true,
    isOffscreen: false,
    children: [],
    ...overrides,
  };
}

function createMockAdapters(): ToolAdapters {
  return {
    browser: {
      clickElement: vi.fn(),
      fillInput: vi.fn(),
      navigateTo: vi.fn(),
      getPageText: vi.fn().mockResolvedValue(toolOk('Welcome to Dashboard. Click Submit to continue.', 10)),
    },
    uia: {
      invokeElement: vi.fn(),
      findElement: vi.fn().mockResolvedValue(toolOk(mockUiaNode(), 10)),
      setElementValue: vi.fn(),
      getElementValue: vi.fn(),
      getUiTree: vi.fn(),
    },
    input: {
      clickPoint: vi.fn(),
      typeText: vi.fn(),
      pressKeys: vi.fn(),
      scroll: vi.fn(),
      releaseAllKeys: vi.fn(),
    },
    screenshot: {
      captureScreen: vi.fn(),
      captureWindow: vi.fn(),
      getActiveWindow: vi.fn().mockResolvedValue(toolOk(mockWindowInfo(), 10)),
    },
  };
}

function createTaskContext(overrides: Partial<TaskContext> = {}): TaskContext {
  const ac = new AbortController();
  return {
    taskRunId: 'test-run-1',
    sessionId: 'test-session-1',
    goal: 'test goal',
    mode: 'workflow' as TaskMode,
    status: 'running' as TaskStatus,
    stepIndex: 0,
    retryCountByStep: new Map(),
    browserSession: undefined,
    activeHwnd: 12345,
    activeWindowTitle: 'My App Dashboard',
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

describe('StateVerifier', () => {
  let verifier: StateVerifier;
  let adapters: ToolAdapters;

  beforeEach(() => {
    adapters = createMockAdapters();
    verifier = new StateVerifier(adapters);
  });

  it('undefined ExpectedState → passed with empty conditions', async () => {
    const ctx = createTaskContext();
    const result = await verifier.verify(undefined, ctx);
    expect(result.passed).toBe(true);
    expect(result.conditions).toEqual([]);
  });

  it('any with window_title_contains matching → passed', async () => {
    const expected: ExpectedState = {
      any: [{ type: 'window_title_contains', value: 'Dashboard' }],
    };
    const ctx = createTaskContext();

    const result = await verifier.verify(expected, ctx);

    expect(result.passed).toBe(true);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].passed).toBe(true);
    expect(result.conditions[0].actual).toBe('My App Dashboard');
  });

  it('any with window_title_contains not matching → failed', async () => {
    const expected: ExpectedState = {
      any: [{ type: 'window_title_contains', value: 'Notepad' }],
    };
    const ctx = createTaskContext();

    const result = await verifier.verify(expected, ctx);

    expect(result.passed).toBe(false);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].passed).toBe(false);
    expect(result.conditions[0].actual).toBe('My App Dashboard');
  });

  it('any with page_text_contains matching → passed', async () => {
    const page = {} as any;
    const expected: ExpectedState = {
      any: [{ type: 'page_text_contains', value: 'Welcome' }],
    };
    const ctx = createTaskContext({
      browserSession: {
        browser: {} as any,
        context: {} as any,
        page,
        userDataDir: '/tmp',
        isManaged: true,
        cleanupOnClose: true,
        serverUrl: 'http://localhost',
      },
    });

    const result = await verifier.verify(expected, ctx);

    expect(result.passed).toBe(true);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].passed).toBe(true);
  });

  it('any with uia_element_exists (element found) → passed', async () => {
    const expected: ExpectedState = {
      any: [{ type: 'uia_element_exists', query: { automationId: 'btn-submit' } }],
    };
    const ctx = createTaskContext({ activeHwnd: 12345 });

    const result = await verifier.verify(expected, ctx);

    expect(result.passed).toBe(true);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].passed).toBe(true);
    expect(result.conditions[0].actual).toBe('SubmitButton');
  });

  it('any with uia_element_exists (element NOT found) → failed', async () => {
    adapters.uia.findElement = vi.fn().mockResolvedValue(toolOk(null, 10));
    verifier = new StateVerifier(adapters);

    const expected: ExpectedState = {
      any: [{ type: 'uia_element_exists', query: { automationId: 'btn-missing' } }],
    };
    const ctx = createTaskContext({ activeHwnd: 12345 });

    const result = await verifier.verify(expected, ctx);

    expect(result.passed).toBe(false);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].passed).toBe(false);
    expect(result.conditions[0].actual).toBe('not found');
  });

  it('all with window_title_contains and page_text_contains both matching → passed', async () => {
    const page = {} as any;
    const expected: ExpectedState = {
      all: [
        { type: 'window_title_contains', value: 'Dashboard' },
        { type: 'page_text_contains', value: 'Welcome' },
      ],
    };
    const ctx = createTaskContext({
      browserSession: {
        browser: {} as any,
        context: {} as any,
        page,
        userDataDir: '/tmp',
        isManaged: true,
        cleanupOnClose: true,
        serverUrl: 'http://localhost',
      },
    });

    const result = await verifier.verify(expected, ctx);

    expect(result.passed).toBe(true);
    expect(result.conditions).toHaveLength(2);
    expect(result.conditions[0].passed).toBe(true);
    expect(result.conditions[1].passed).toBe(true);
  });

  it('all with one failing condition → overall failed', async () => {
    const page = {} as any;
    const expected: ExpectedState = {
      all: [
        { type: 'window_title_contains', value: 'Dashboard' },
        { type: 'page_text_contains', value: 'NotFoundText' },
      ],
    };
    const ctx = createTaskContext({
      browserSession: {
        browser: {} as any,
        context: {} as any,
        page,
        userDataDir: '/tmp',
        isManaged: true,
        cleanupOnClose: true,
        serverUrl: 'http://localhost',
      },
    });

    const result = await verifier.verify(expected, ctx);

    expect(result.passed).toBe(false);
    expect(result.conditions).toHaveLength(2);
    expect(result.conditions[0].passed).toBe(true);
    expect(result.conditions[1].passed).toBe(false);
  });

  it('any with multiple conditions where one matches → overall passed', async () => {
    const page = {} as any;
    const expected: ExpectedState = {
      any: [
        { type: 'window_title_contains', value: 'Notepad' },
        { type: 'page_text_contains', value: 'Welcome' },
      ],
    };
    const ctx = createTaskContext({
      browserSession: {
        browser: {} as any,
        context: {} as any,
        page,
        userDataDir: '/tmp',
        isManaged: true,
        cleanupOnClose: true,
        serverUrl: 'http://localhost',
      },
    });

    const result = await verifier.verify(expected, ctx);

    expect(result.passed).toBe(true);
    expect(result.conditions).toHaveLength(2);
    // First condition failed
    expect(result.conditions[0].passed).toBe(false);
    // Second condition passed → overall passes because of 'any'
    expect(result.conditions[1].passed).toBe(true);
  });
});
