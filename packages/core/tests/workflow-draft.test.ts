import { describe, expect, it } from 'vitest';
import { draftToMemory, normalizeWorkflowDraft, validateWorkflowDraft } from '../src/memory/workflow-draft.js';
import type { WorkflowDraft } from '../src/types/workflow.js';

function makeDraft(overrides: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    appName: 'Notepad',
    platform: 'desktop',
    topic: 'Write a short note',
    triggerExamples: ['write a note', 'create a notepad memo'],
    summary: 'Open Notepad and write a short note.',
    initialState: 'Windows desktop is visible.',
    inputs: [{ name: 'noteText', type: 'string', required: true, prompt: 'Text to write' }],
    steps: [
      {
        intent: 'Open Notepad',
        targetHint: 'Start menu search result for Notepad',
        target: { strategy: 'human', hint: 'Notepad app' },
        riskLevel: 'low',
      },
      {
        intent: 'Type the note text',
        targetHint: 'Notepad editor',
        inputHint: '{{noteText}}',
        target: { strategy: 'human', hint: 'Notepad editor' },
        expectedState: { all: [{ type: 'window_title_contains', value: 'Notepad' }] },
        riskLevel: 'low',
      },
    ],
    successCriteria: 'The note text is visible in Notepad.',
    riskLevel: 'low',
    sourceType: 'text-teach',
    ...overrides,
  };
}

describe('workflow draft validation', () => {
  it('normalizes a valid text teaching draft with stable ids and search text', () => {
    const result = normalizeWorkflowDraft(makeDraft(), {
      id: 'mem-1',
      now: '2026-06-24T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(result.data!.id).toBe('mem-1');
    expect(result.data!.version).toBe(1);
    expect(result.data!.sourceType).toBe('text-teach');
    expect(result.data!.steps.map((s) => s.id)).toEqual(['step-1', 'step-2']);
    expect(result.data!.steps.map((s) => s.order)).toEqual([1, 2]);
    expect(result.data!.searchText).toContain('Notepad');
    expect(result.data!.searchText).toContain('write a note');
    expect(result.data!.embeddingStatus).toBe('not_indexed');
  });

  it('converts a valid draft to WorkflowMemory', () => {
    const memory = draftToMemory(makeDraft(), {
      id: 'mem-2',
      now: '2026-06-24T01:00:00.000Z',
    });

    expect(memory.id).toBe('mem-2');
    expect(memory.createdAt).toBe('2026-06-24T01:00:00.000Z');
    expect(memory.updatedAt).toBe('2026-06-24T01:00:00.000Z');
    expect(memory.triggerExamples).toEqual(['write a note', 'create a notepad memo']);
  });

  it('rejects empty topic and missing steps', () => {
    const result = validateWorkflowDraft(makeDraft({ topic: ' ', steps: [] }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('topic is required');
    expect(result.errors).toContain('at least one step is required');
  });

  it('warns about weak expected states and coordinate-only target hints', () => {
    const result = validateWorkflowDraft(makeDraft({
      steps: [{
        intent: 'Click save',
        targetHint: 'x=10 y=20',
        target: { strategy: 'coordinate', point: { x: 10, y: 20 } },
        riskLevel: 'medium',
      }],
    }));

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('step 1 has no expected state');
    expect(result.warnings).toContain('step 1 appears to rely on coordinates');
  });
});
