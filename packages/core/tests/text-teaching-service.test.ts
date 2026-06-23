import { describe, expect, it } from 'vitest';
import { TextTeachingService, type TextTeachingProvider } from '../src/memory/text-teaching-service.js';
import type { WorkflowDraft } from '../src/types/workflow.js';

const validDraft: WorkflowDraft = {
  appName: 'Notepad',
  topic: 'Write note',
  summary: 'Open Notepad and write text.',
  initialState: 'Desktop is visible.',
  triggerExamples: ['write note'],
  steps: [{
    intent: 'Open Notepad',
    targetHint: 'Notepad app',
    target: { strategy: 'human', hint: 'Notepad app' },
    expectedState: { all: [{ type: 'window_title_contains', value: 'Notepad' }] },
    riskLevel: 'low',
  }],
  successCriteria: 'Notepad is open.',
  riskLevel: 'low',
};

describe('TextTeachingService', () => {
  it('builds a validated text-teach draft from provider output', async () => {
    const provider: TextTeachingProvider = {
      generateWorkflowDraft: async (request) => ({
        ...validDraft,
        appName: request.appName ?? validDraft.appName,
      }),
    };

    const result = await new TextTeachingService(provider).teach({
      goal: 'write a note',
      teachingText: 'Open Notepad, then type the note.',
      appName: 'Notepad',
    });

    expect(result.ok).toBe(true);
    expect(result.data!.draft.sourceType).toBe('text-teach');
    expect(result.data!.draft.appName).toBe('Notepad');
    expect(result.data!.warnings).toEqual([]);
  });

  it('returns validation errors for invalid provider output', async () => {
    const provider: TextTeachingProvider = {
      generateWorkflowDraft: async () => ({ ...validDraft, topic: '', steps: [] }),
    };

    const result = await new TextTeachingService(provider).teach({
      goal: 'write a note',
      teachingText: 'Open Notepad.',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('topic is required');
    expect(result.errors).toContain('at least one step is required');
  });

  it('warns when teaching text mentions secrets', async () => {
    const provider: TextTeachingProvider = {
      generateWorkflowDraft: async () => validDraft,
    };

    const result = await new TextTeachingService(provider).teach({
      goal: 'login',
      teachingText: 'Type the password and 2FA code.',
    });

    expect(result.ok).toBe(true);
    expect(result.data!.warnings).toContain('teaching text may contain sensitive instructions');
  });
});
