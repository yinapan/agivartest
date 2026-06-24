import { describe, expect, it } from 'vitest';
import {
  createEmptyDraft,
  draftHasHighRisk,
  getIpcErrorMessage,
  setStepExpectedState,
  versionPreview,
  type WorkflowDraft,
} from '../src/renderer/pages/workflow-editor-model.js';

const draft: WorkflowDraft = {
  appName: 'Desktop',
  platform: 'desktop',
  topic: 'Write note',
  triggerExamples: ['write note'],
  summary: 'Open Notepad.',
  initialState: 'Desktop is visible.',
  inputs: [],
  steps: [{
    intent: 'Open Notepad',
    targetHint: 'Notepad app',
    target: { strategy: 'human', hint: 'Notepad app' },
    riskLevel: 'low',
  }],
  successCriteria: 'Notepad is open.',
  riskLevel: 'low',
  sourceType: 'text-teach',
};

describe('workflow editor model', () => {
  it('creates independent empty drafts', () => {
    const a = createEmptyDraft();
    const b = createEmptyDraft();

    a.steps.push({ intent: 'changed', targetHint: 'changed', riskLevel: 'low' });

    expect(b.steps).toEqual([]);
  });

  it('detects high-risk workflows and steps', () => {
    expect(draftHasHighRisk(draft)).toBe(false);
    expect(draftHasHighRisk({ ...draft, riskLevel: 'high' })).toBe(true);
    expect(draftHasHighRisk({
      ...draft,
      steps: [{ ...draft.steps[0], riskLevel: 'forbidden' }],
    })).toBe(true);
  });

  it('sets expected state with the current ExpectedState shape', () => {
    const step = setStepExpectedState(draft.steps[0], 'page_text_contains', 'Saved');

    expect(step.expectedState).toEqual({
      all: [{ type: 'page_text_contains', value: 'Saved' }],
    });
  });

  it('removes expected state when value is empty', () => {
    const step = setStepExpectedState({
      ...draft.steps[0],
      expectedState: { all: [{ type: 'window_title_contains', value: 'Notepad' }] },
    }, 'window_title_contains', '   ');

    expect(step.expectedState).toBeUndefined();
  });

  it('builds readable rollback version previews', () => {
    const preview = versionPreview({
      id: 'version-1',
      memoryId: 'mem-1',
      version: 2,
      source: 'edit',
      changeNote: 'rename',
      createdAt: '2026-06-24T00:00:00.000Z',
      snapshot: {
        ...draft,
        topic: 'Customer lookup',
        summary: 'Find a customer record.',
        steps: Array.from({ length: 6 }, (_, index) => ({
          intent: `Step ${index + 1}`,
          targetHint: `Target ${index + 1}`,
          riskLevel: 'low',
        })),
      },
    });

    expect(preview.topic).toBe('Customer lookup');
    expect(preview.summary).toBe('Find a customer record.');
    expect(preview.stepIntents).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5']);
  });

  it('previews recording-created workflow versions', () => {
    const preview = versionPreview({
      id: 'version-recording',
      memoryId: 'mem-recording',
      version: 1,
      source: 'recording-teach',
      changeNote: 'recording teaching',
      createdAt: '2026-06-24T00:00:00.000Z',
      snapshot: { ...draft, sourceType: 'recording', topic: 'Recorded workflow' },
    });

    expect(preview.topic).toBe('Recorded workflow');
  });

  it('normalizes IPC error messages', () => {
    expect(getIpcErrorMessage({ ok: false, error: { code: 'INVALID', message: 'Bad payload' } })).toBe('Bad payload');
    expect(getIpcErrorMessage({ ok: false, error: 'legacy error' })).toBe('legacy error');
    expect(getIpcErrorMessage({ ok: true, data: {} })).toBe('');
  });
});
