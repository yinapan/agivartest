import { describe, expect, it } from 'vitest';
import {
  handleMemoryListVersions,
  handleMemoryRollback,
  handleMemorySaveDraft,
  handleMemoryTeachText,
  handleMemoryValidateDraft,
  splitTeachingTextIntoSteps,
} from '../src/main/workflow-ipc.js';
import type { TextTeachingProvider, WorkflowDraft } from '@agivar/core';

const draft: WorkflowDraft = {
  appName: 'Notepad',
  platform: 'desktop',
  topic: 'Write note',
  triggerExamples: ['write note'],
  summary: 'Open Notepad and write text.',
  initialState: 'Desktop is visible.',
  steps: [{
    intent: 'Open Notepad',
    targetHint: 'Notepad app',
    target: { strategy: 'human', hint: 'Notepad app' },
    expectedState: { all: [{ type: 'window_title_contains', value: 'Notepad' }] },
    riskLevel: 'low',
  }],
  successCriteria: 'Notepad is open.',
  riskLevel: 'low',
  sourceType: 'text-teach',
};

describe('workflow IPC helpers', () => {
  it('splits fallback teaching text on newline and sentence delimiters', () => {
    expect(splitTeachingTextIntoSteps('打开记事本。输入文字.\r\n保存;关闭')).toEqual([
      '打开记事本',
      '输入文字',
      '保存',
      '关闭',
    ]);
  });

  it('returns stable validation errors for invalid teachText payloads', async () => {
    const provider: TextTeachingProvider = {
      generateWorkflowDraft: async () => draft,
    };

    const result = await handleMemoryTeachText({}, provider);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_PAYLOAD');
      expect(result.error.message).toContain('goal');
    }
  });

  it('rejects oversized teachText payloads before invoking the provider', async () => {
    let invoked = false;
    const provider: TextTeachingProvider = {
      generateWorkflowDraft: async () => {
        invoked = true;
        return draft;
      },
    };

    const result = await handleMemoryTeachText({
      goal: 'write',
      teachingText: 'x'.repeat(20001),
    }, provider);

    expect(result.ok).toBe(false);
    expect(invoked).toBe(false);
  });

  it('wraps provider failures as stable IPC errors', async () => {
    const provider: TextTeachingProvider = {
      generateWorkflowDraft: async () => {
        throw new Error('provider unavailable');
      },
    };

    const result = await handleMemoryTeachText({
      goal: 'write',
      teachingText: 'Open Notepad.',
    }, provider);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('IPC_HANDLER_FAILED');
      expect(result.error.message).toContain('provider unavailable');
    }
  });

  it('returns a stable error when saving without a memory store', async () => {
    const result = await handleMemorySaveDraft(null, draft, 'note');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_MEMORY_STORE');
    }
  });

  it('wraps draft validation in the IPC result shape', async () => {
    const result = await handleMemoryValidateDraft({ ...draft, topic: '' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ok).toBe(false);
      expect(result.data.errors).toContain('topic is required');
    }
  });

  it('maps duplicate workflow ids to WORKFLOW_ALREADY_EXISTS', async () => {
    const store = {
      saveWithVersion: () => {
        throw new Error('workflow memory duplicate-workflow-id already exists');
      },
    };

    const result = await handleMemorySaveDraft(store as never, draft, 'note');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('WORKFLOW_ALREADY_EXISTS');
    }
  });

  it('wraps listVersions and rollback results in the IPC result shape', async () => {
    const store = {
      listVersions: () => [],
      rollback: () => ({ id: 'mem-1' }),
    };

    expect(await handleMemoryListVersions(store as never, 'mem-1')).toEqual({ ok: true, data: [] });
    expect(await handleMemoryRollback(store as never, 'mem-1', 1, 'restore')).toEqual({
      ok: true,
      data: { id: 'mem-1' },
    });
  });
});
