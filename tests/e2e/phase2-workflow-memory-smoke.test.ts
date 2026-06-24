import { describe, expect, it } from 'vitest';
import { MemoryStore, getDatabaseForTest, type TextTeachingProvider, type WorkflowDraft } from '../../packages/core/src/index.js';
import {
  handleMemoryListVersions,
  handleMemoryRollback,
  handleMemorySaveDraft,
  handleMemoryTeachText,
  handleMemoryUpdate,
} from '../../packages/desktop/src/main/workflow-ipc.js';

const provider: TextTeachingProvider = {
  async generateWorkflowDraft(request) {
    return {
      appName: request.appName ?? 'Desktop',
      platform: request.platform ?? 'desktop',
      topic: request.goal,
      triggerExamples: [request.goal],
      summary: request.teachingText,
      initialState: 'Desktop is ready.',
      inputs: [{ name: 'noteText', type: 'string', required: true, prompt: 'Note text' }],
      steps: [{
        intent: 'Open Notepad',
        targetHint: 'Notepad app',
        target: { strategy: 'human', hint: 'Notepad app' },
        inputHint: '{{noteText}}',
        expectedState: { all: [{ type: 'window_title_contains', value: 'Notepad' }] },
        riskLevel: 'low',
      }],
      successCriteria: 'The note is visible.',
      riskLevel: 'low',
      sourceType: 'text-teach',
    };
  },
};

describe('Phase 2 E2E - workflow memory smoke', () => {
  it('teaches, saves, edits, lists versions, and rolls back a workflow', async () => {
    const db = getDatabaseForTest(':memory:');
    const store = new MemoryStore(db);

    try {
      const taught = await handleMemoryTeachText({
        goal: 'write a note',
        teachingText: 'Open Notepad. Type the note.',
        appName: 'Notepad',
        platform: 'desktop',
      }, provider);

      expect(taught.ok).toBe(true);
      if (!taught.ok) throw new Error(taught.error.message);

      const save = await handleMemorySaveDraft(store, taught.data.draft, 'text teaching');
      expect(save.ok).toBe(true);
      if (!save.ok) throw new Error(save.error.message);
      expect(save.data.version).toBe(1);

      const edited: WorkflowDraft = {
        ...save.data,
        topic: 'write an edited note',
        steps: [{ ...save.data.steps[0], intent: 'Search Notepad from Start' }],
      };
      const update = await handleMemoryUpdate(store, edited as never, 'edit workflow');
      expect(update.ok).toBe(true);
      if (!update.ok) throw new Error(update.error.message);
      expect(update.data.version).toBe(2);
      expect(update.data.searchText).toContain('write an edited note');

      const versions = await handleMemoryListVersions(store, save.data.id);
      expect(versions.ok).toBe(true);
      if (!versions.ok) throw new Error(versions.error.message);
      expect(versions.data.map((version) => version.version)).toEqual([2, 1]);
      expect(versions.data[0].snapshot.topic).toBe('write an edited note');

      const rollback = await handleMemoryRollback(store, save.data.id, 1, 'rollback to v1');
      expect(rollback.ok).toBe(true);
      if (!rollback.ok) throw new Error(rollback.error.message);
      expect(rollback.data.version).toBe(3);
      expect(rollback.data.topic).toBe('write a note');

      const afterRollback = await handleMemoryListVersions(store, save.data.id);
      expect(afterRollback.ok).toBe(true);
      if (!afterRollback.ok) throw new Error(afterRollback.error.message);
      expect(afterRollback.data.map((version) => version.version)).toEqual([3, 2, 1]);
    } finally {
      db.close();
    }
  });
});
