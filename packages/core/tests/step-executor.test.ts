import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolOk } from '../src/types/errors.js';
import { ToolRouter } from '../src/agent/tool-router.js';
import type { ToolAdapters } from '../src/agent/tool-router.js';
import { StateVerifier } from '../src/agent/state-verifier.js';
import { RiskClassifier } from '../src/safety/risk-classifier.js';
import { ExecutionLog } from '../src/safety/execution-log.js';
import { StepExecutor } from '../src/agent/step-executor.js';
import { getDatabaseForTest } from '../src/memory/db.js';
import type { DatabaseLike } from '../src/memory/schema.js';
import type {
  StepPlan,
  TaskContext,
  TaskMode,
  TaskStatus,
  ExpectedState,
} from '../src/types/agent.js';
import type { ScreenshotResult, WindowInfo } from '../src/tools/screenshot.js';
import type { UiaNode } from '../src/tools/uia.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function mockScreenshotResult(overrides: Partial<ScreenshotResult> = {}): ScreenshotResult {
  return {
    buffer: Buffer.from('fake-png-data'),
    width: 1920,
    height: 1080,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

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
    name: 'TestButton',
    controlType: 'Button',
    automationId: 'btn-1',
    className: 'Button',
    boundingRect: { x: 0, y: 0, w: 100, h: 40 },
    isEnabled: true,
    isOffscreen: false,
    children: [],
    ...overrides,
  };
}

function createMockAdapters(): ToolAdapters {
  return {
    browser: {
      clickElement: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      fillInput: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      navigateTo: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      getPageText: vi.fn().mockResolvedValue(toolOk('Welcome to Dashboard.', 10)),
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
    programmatic: {
      readFile: vi.fn().mockResolvedValue(toolOk('file content', 5)),
      copyFile: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      readTable: vi.fn().mockResolvedValue(toolOk([], 10)),
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

function setupDb(): DatabaseLike {
  const db = getDatabaseForTest(':memory:');
  // Insert parent rows required by foreign keys
  db.prepare("INSERT INTO sessions (id) VALUES (?)").run('test-session-1');
  db.prepare(
    "INSERT INTO task_runs (id, session_id, user_goal, mode) VALUES (?, ?, ?, ?)",
  ).run('test-run-1', 'test-session-1', 'test goal', 'workflow');
  return db;
}

describe('StepExecutor', () => {
  let adapters: ToolAdapters;
  let executor: StepExecutor;
  let db: DatabaseLike;
  let tmpDir: string;

  beforeEach(() => {
    adapters = createMockAdapters();
    db = setupDb();

    const toolRouter = new ToolRouter(adapters);
    const stateVerifier = new StateVerifier(adapters);
    const riskClassifier = new RiskClassifier();
    const executionLog = new ExecutionLog(db);

    executor = new StepExecutor({
      toolRouter,
      stateVerifier,
      riskClassifier,
      executionLog,
      tools: adapters,
    });

    // Create a real temp directory for screenshot output
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-executor-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('executes a type action successfully', async () => {
    const step: StepPlan = {
      intent: 'type hello',
      action: { type: 'type', text: 'hello world' },
      riskLevel: 'low',
      source: 'workflow',
    };

    const ctx = createTaskContext({ outputDir: tmpDir });

    const result = await executor.execute(step, ctx);

    expect(result.success).toBe(true);
    expect(result.toolResult).toBeDefined();
    expect(result.toolResult!.ok).toBe(true);
    expect(adapters.input.typeText).toHaveBeenCalledWith('hello world');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.verification).toBeDefined();
    expect(result.verification!.passed).toBe(true);
  });

  it('captures before and after screenshots', async () => {
    const step: StepPlan = {
      intent: 'type text',
      action: { type: 'type', text: 'sample' },
      riskLevel: 'low',
      source: 'workflow',
    };

    const ctx = createTaskContext({ outputDir: tmpDir, stepIndex: 1 });

    const result = await executor.execute(step, ctx);

    expect(result.beforeScreenshot).toBeDefined();
    expect(result.afterScreenshot).toBeDefined();
    expect(result.beforeScreenshot).toBe(path.join(tmpDir, 'step-1-before.png'));
    expect(result.afterScreenshot).toBe(path.join(tmpDir, 'step-1-after.png'));

    // Verify files were actually written
    expect(fs.existsSync(result.beforeScreenshot!)).toBe(true);
    expect(fs.existsSync(result.afterScreenshot!)).toBe(true);
    expect(adapters.screenshot.captureScreen).toHaveBeenCalledTimes(2);
  });

  it('reports failure when verification fails', async () => {
    const step: StepPlan = {
      intent: 'type text then check window',
      action: { type: 'type', text: 'some text' },
      riskLevel: 'low',
      source: 'workflow',
      expectedState: {
        all: [{ type: 'window_title_contains', value: 'NonExistentWindowTitle' }],
      },
    };

    const ctx = createTaskContext({ outputDir: tmpDir, activeWindowTitle: 'Actual Title' });

    const result = await executor.execute(step, ctx);

    expect(result.success).toBe(false);
    expect(result.toolResult).toBeDefined();
    expect(result.toolResult!.ok).toBe(true); // tool succeeded but verification failed
    expect(result.verification).toBeDefined();
    expect(result.verification!.passed).toBe(false);
    expect(result.beforeScreenshot).toBeDefined();
  });
});
