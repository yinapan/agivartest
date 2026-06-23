import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from '../src/agent/agent-service.js';
import { MemoryStore } from '../src/memory/memory-store.js';
import { AbortManager } from '../src/safety/abort-manager.js';
import { getDatabaseForTest } from '../src/memory/db.js';
import { toolOk } from '../src/types/errors.js';
import type { LLMProvider, GenerateTextResult } from '../src/llm/provider.js';
import type { ToolAdapters } from '../src/agent/tool-router.js';
import type { AgentEvent } from '../src/types/agent.js';

function mockAdapters(): ToolAdapters {
  return {
    browser: {
      clickElement: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      fillInput: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      navigateTo: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      getPageText: vi.fn().mockResolvedValue(toolOk('success', 5)),
    },
    uia: {
      invokeElement: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      findElement: vi.fn().mockResolvedValue(toolOk(null, 5)),
      setElementValue: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      getElementValue: vi.fn().mockResolvedValue(toolOk('', 5)),
      getUiTree: vi.fn().mockResolvedValue(toolOk({} as any, 5)),
    },
    input: {
      clickPoint: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      typeText: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      pressKeys: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      scroll: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      releaseAllKeys: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
    },
    screenshot: {
      captureScreen: vi.fn().mockResolvedValue(toolOk({ buffer: Buffer.from('PNG'), width: 100, height: 100, timestamp: '' }, 5)),
      captureWindow: vi.fn().mockResolvedValue(toolOk({ buffer: Buffer.from('PNG'), width: 100, height: 100, timestamp: '' }, 5)),
      getActiveWindow: vi.fn().mockResolvedValue(toolOk({ hwnd: 1, title: 'Test', x: 0, y: 0, width: 800, height: 600, isMinimized: false }, 5)),
    },
  };
}

function mockLLM(): LLMProvider {
  return {
    id: 'test', displayName: 'Test', supportsVision: false,
    generateText: vi.fn().mockResolvedValue({
      text: 'done',
      toolCalls: [{ id: 't1', type: 'function', function: { name: 'task_complete', arguments: '{"summary":"done"}' } }],
      finishReason: 'tool_calls',
    } as GenerateTextResult),
    streamText: vi.fn().mockReturnValue((async function* () { yield { type: 'finish' as const }; })()),
  };
}

describe('AgentService', () => {
  let agent: AgentService;
  let db: ReturnType<typeof getDatabaseForTest>;
  let memoryStore: MemoryStore;
  let abortManager: AbortManager;

  beforeEach(() => {
    db = getDatabaseForTest(':memory:');
    db.pragma('foreign_keys = OFF');
    db.prepare("INSERT INTO sessions (id, title) VALUES ('s-1', 'test')").run();
    db.prepare("INSERT INTO task_runs (id, session_id, user_goal, status) VALUES ('tr-1', 's-1', 'test', 'running')").run();

    memoryStore = new MemoryStore(db);
    abortManager = new AbortManager();
    agent = new AgentService({
      db, llm: mockLLM(), tools: mockAdapters(), abortManager, memoryStore,
    });
  });

  it('constructs without error', () => {
    expect(agent).toBeDefined();
  });

  it('run yields thinking event then completes when LLM returns task_complete', async () => {
    const events: AgentEvent[] = [];
    for await (const ev of agent.run('test task', 's-1')) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('thinking');
    expect(events.some(e => e.type === 'task-complete')).toBe(true);
  });

  it('abort marks task as aborted via AbortManager', () => {
    const signal = abortManager.createTaskSignal('manual-task');
    expect(signal.aborted).toBe(false);
    agent.abort('manual-task');
    expect(signal.aborted).toBe(true);
  });

  it('resumeWithMemory returns null for non-existent id', async () => {
    const result = await agent.resumeWithMemory('nonexistent', {} as any);
    expect(result).toBeNull();
  });

  it('emits task-failed when step budget exceeded', async () => {
    let callCount = 0;
    const llm = mockLLM();
    (llm.generateText as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return {
        text: `step ${callCount}`,
        toolCalls: [{ id: `t${callCount}`, type: 'function', function: { name: 'type_text', arguments: '{"text":"a"}' } }],
        finishReason: 'tool_calls',
      };
    });
    const budgetAgent = new AgentService({
      db, llm, tools: mockAdapters(), abortManager, memoryStore,
    });
    const events: AgentEvent[] = [];
    for await (const ev of budgetAgent.run('infinite task', 's-1')) {
      events.push(ev);
      if (events.length > 500) break;
    }
    const failEvent = events.find(e => e.type === 'task-failed');
    expect(failEvent).toBeDefined();
    expect((failEvent as any).diagnosis).toContain('步骤预算');
  });
});
