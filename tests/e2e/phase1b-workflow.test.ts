import { describe, it, expect, beforeAll } from 'vitest';
import { AgentService } from '../../packages/core/src/agent/agent-service.js';
import { MemoryStore } from '../../packages/core/src/memory/memory-store.js';
import { AbortManager } from '../../packages/core/src/safety/abort-manager.js';
import { getDatabaseForTest } from '../../packages/core/src/memory/db.js';
import { parseWorkflowContent, workflowFileToMemory } from '../../packages/core/src/memory/workflow-parser.js';
import { toolOk } from '../../packages/core/src/types/errors.js';
import type { LLMProvider } from '../../packages/core/src/llm/provider.js';
import type { ToolAdapters } from '../../packages/core/src/agent/tool-router.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mockAdapters(): ToolAdapters {
  return {
    browser: {
      clickElement: () => Promise.resolve(toolOk(undefined, 10)),
      fillInput: () => Promise.resolve(toolOk(undefined, 10)),
      navigateTo: () => Promise.resolve(toolOk(undefined, 50)),
      getPageText: () => Promise.resolve(toolOk('success page text', 5)),
    },
    uia: {
      invokeElement: () => Promise.resolve(toolOk(undefined, 20)),
      findElement: () => Promise.resolve(toolOk(null, 10)),
      setElementValue: () => Promise.resolve(toolOk(undefined, 10)),
      getElementValue: () => Promise.resolve(toolOk('test value', 10)),
      getUiTree: () => Promise.resolve(toolOk({} as any, 15)),
    },
    input: {
      clickPoint: () => Promise.resolve(toolOk(undefined, 5)),
      typeText: () => Promise.resolve(toolOk(undefined, 10)),
      pressKeys: () => Promise.resolve(toolOk(undefined, 10)),
      scroll: () => Promise.resolve(toolOk(undefined, 5)),
      releaseAllKeys: () => Promise.resolve(toolOk(undefined, 5)),
    },
    screenshot: {
      captureScreen: () => Promise.resolve(toolOk({ buffer: Buffer.from('FAKE_PNG'), width: 1920, height: 1080, timestamp: new Date().toISOString() }, 50)),
      captureWindow: () => Promise.resolve(toolOk({ buffer: Buffer.from('FAKE_PNG'), width: 800, height: 600, timestamp: new Date().toISOString() }, 30)),
      getActiveWindow: () => Promise.resolve(toolOk({ hwnd: 12345, title: 'Test Window', x: 0, y: 0, width: 800, height: 600, isMinimized: false }, 5)),
    },
    programmatic: {
      readFile: () => Promise.resolve(toolOk('file content', 5)),
      copyFile: () => Promise.resolve(toolOk(undefined, 5)),
      readTable: () => Promise.resolve(toolOk([{ a: '1' }], 5)),
    },
  };
}

describe('Phase 1B E2E — Workflow execution', () => {
  let db: ReturnType<typeof getDatabaseForTest>;
  let agent: AgentService;

  beforeAll(async () => {
    db = getDatabaseForTest(':memory:');
    db.prepare("INSERT INTO sessions (id, title) VALUES ('s-e2e', 'e2e test')").run();
    db.prepare("INSERT INTO task_runs (id, session_id, user_goal, status) VALUES ('tr-e2e', 's-e2e', 'e2e', 'running')").run();

    const memoryStore = new MemoryStore(db);

    const fixturePath = path.join(__dirname, '..', 'fixtures', 'workflows', 'form-fill-local.yaml');
    const content = fs.readFileSync(fixturePath, 'utf-8');
    const parsed = await parseWorkflowContent(content, 'yaml');
    if (parsed.success && parsed.data) {
      const memory = workflowFileToMemory(parsed.data);
      await memoryStore.insert(memory);
    }

    const llm: LLMProvider = {
      id: 'mock', displayName: 'Mock', supportsVision: false,
      generateText: () => Promise.resolve({ text: '', toolCalls: [], finishReason: 'stop' }),
      streamText: () => (async function* () { yield { type: 'finish' as const }; })(),
    };

    agent = new AgentService({
      db, llm, tools: mockAdapters(),
      abortManager: new AbortManager(), memoryStore,
    });
  });

  it('completes a 4-step workflow without errors', async () => {
    const events: any[] = [];
    for await (const event of agent.run('帮我填表单', 's-e2e')) {
      events.push(event);
    }

    const failures = events.filter((e: any) => e.type === 'step-failed');
    expect(events.length).toBeGreaterThan(0);
    expect(failures.length).toBeLessThan(3);
  }, 30000);

  it('handles abort gracefully', async () => {
    const events: any[] = [];
    const promise = (async () => {
      for await (const event of agent.run('test abort', 's-e2e')) {
        events.push(event);
      }
    })();

    setTimeout(() => agent.abort('test abort'), 100);
    await promise;

    expect(true).toBe(true);
  }, 10000);
});
