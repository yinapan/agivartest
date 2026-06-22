import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolOk } from '../src/types/errors.js';
import { ToolRouter } from '../src/agent/tool-router.js';
import type { ToolAdapters } from '../src/agent/tool-router.js';
import { TakeoverRequest } from '../src/types/agent.js';
import type { TaskContext, TaskMode, TaskStatus } from '../src/types/agent.js';
import type { ElementQuery, UiaNode } from '../src/tools/uia.js';
import type { ScreenshotResult, WindowInfo } from '../src/tools/screenshot.js';
import type { Point } from '../src/types/coordinates.js';

function mockPage() {
  return {} as any;
}

function mockUiaNode(): UiaNode {
  return {
    name: 'TestButton',
    controlType: 'Button',
    automationId: 'btn-1',
    className: 'Button',
    boundingRect: { x: 0, y: 0, w: 100, h: 40 },
    isEnabled: true,
    isOffscreen: false,
    children: [],
  };
}

function mockScreenshotResult(): ScreenshotResult {
  return {
    buffer: Buffer.from('fake-png'),
    width: 1920,
    height: 1080,
    timestamp: new Date().toISOString(),
  };
}

function mockWindowInfo(): WindowInfo {
  return {
    hwnd: 12345,
    title: 'Test Window',
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    isMinimized: false,
  };
}

function createMockAdapters(): ToolAdapters {
  return {
    browser: {
      clickElement: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      fillInput: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      navigateTo: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      getPageText: vi.fn().mockResolvedValue(toolOk('test page text', 10)),
    },
    uia: {
      invokeElement: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      findElement: vi.fn().mockResolvedValue(toolOk(mockUiaNode(), 10)),
      setElementValue: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      getElementValue: vi.fn().mockResolvedValue(toolOk('test value', 10)),
      getUiTree: vi.fn().mockResolvedValue(toolOk(mockUiaNode(), 10)),
    },
    input: {
      clickPoint: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      typeText: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      pressKeys: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      scroll: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      releaseAllKeys: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
    },
    screenshot: {
      captureScreen: vi.fn().mockResolvedValue(toolOk(mockScreenshotResult(), 10)),
      captureWindow: vi.fn().mockResolvedValue(toolOk(mockScreenshotResult(), 10)),
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

describe('ToolRouter.dispatch', () => {
  let adapters: ToolAdapters;
  let router: ToolRouter;

  beforeEach(() => {
    adapters = createMockAdapters();
    router = new ToolRouter(adapters);
  });

  it('click/playwright → calls browser.clickElement with correct page and selector', async () => {
    const page = mockPage();
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

    const result = await router.dispatch(
      { type: 'click', target: { strategy: 'playwright', selector: '#my-btn' } },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(adapters.browser.clickElement).toHaveBeenCalledWith(page, '#my-btn');
  });

  it('click/uia → calls uia.invokeElement with correct hwnd and query', async () => {
    const ctx = createTaskContext({ activeHwnd: 9999 });
    const query: ElementQuery = { automationId: 'submit-btn' };

    const result = await router.dispatch(
      { type: 'click', target: { strategy: 'uia', query } },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(adapters.uia.invokeElement).toHaveBeenCalledWith(9999, query);
  });

  it('click/coordinate → calls input.clickPoint with correct point', async () => {
    const ctx = createTaskContext();
    const point: Point = { x: 500, y: 300, space: 'screen-physical' };

    const result = await router.dispatch(
      { type: 'click', target: { strategy: 'coordinate', point } },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(adapters.input.clickPoint).toHaveBeenCalledWith(point);
  });

  it('click/human → throws TakeoverRequest', async () => {
    const ctx = createTaskContext();

    await expect(
      router.dispatch(
        { type: 'click', target: { strategy: 'human', hint: 'manually click the button' } },
        ctx,
      ),
    ).rejects.toThrow(TakeoverRequest);
  });

  it('type → calls input.typeText with correct text', async () => {
    const ctx = createTaskContext();

    const result = await router.dispatch(
      { type: 'type', text: 'hello world' },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(adapters.input.typeText).toHaveBeenCalledWith('hello world');
  });

  it('navigate → calls browser.navigateTo with correct page and url', async () => {
    const page = mockPage();
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

    const result = await router.dispatch(
      { type: 'navigate', url: 'https://example.com' },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(adapters.browser.navigateTo).toHaveBeenCalledWith(page, 'https://example.com');
  });

  it('navigate without browser session → returns error (ok=false)', async () => {
    const ctx = createTaskContext(); // no browserSession

    const result = await router.dispatch(
      { type: 'navigate', url: 'https://example.com' },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BROWSER_ACTION_FAILED');
    }
  });

  it('already-aborted signal → returns TASK_ABORTED error', async () => {
    const ac = new AbortController();
    ac.abort();
    const ctx = createTaskContext({ abortController: ac, signal: ac.signal });

    const result = await router.dispatch(
      { type: 'type', text: 'should not run' },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TASK_ABORTED');
    }
    // typeText should NOT have been called
    expect(adapters.input.typeText).not.toHaveBeenCalled();
  });

  it('observe → calls captureScreen and getActiveWindow', async () => {
    const ctx = createTaskContext();

    const result = await router.dispatch({ type: 'observe' }, ctx);

    expect(result.ok).toBe(true);
    expect(adapters.screenshot.captureScreen).toHaveBeenCalled();
    expect(adapters.screenshot.getActiveWindow).toHaveBeenCalled();

    if (result.ok) {
      const data = result.data as any;
      expect(data.screenshot).toEqual({ width: 1920, height: 1080 });
      expect(data.window).toEqual({ title: 'Test Window', hwnd: 12345 });
    }
  });

  it('done → returns { done: true, summary }', async () => {
    const ctx = createTaskContext();

    const result = await router.dispatch(
      { type: 'done', summary: 'Task completed successfully' },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as any;
      expect(data.done).toBe(true);
      expect(data.summary).toBe('Task completed successfully');
    }
  });
});
