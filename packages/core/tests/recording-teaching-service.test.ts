import { describe, expect, it } from 'vitest';
import {
  buildRecordingProviderPayload,
  buildProviderPayloadManifest,
  RecordingTeachingService,
  validateRecordingTeachingRequest,
  validateRecordingTimeline,
  type RecordingWorkflowProvider,
} from '../src/memory/recording-teaching-service.js';
import type {
  ProviderPayloadManifest,
  RecordingTimeline,
  WorkflowDraft,
} from '../src/types/workflow.js';

const validDraft: WorkflowDraft = {
  appName: 'Notepad',
  topic: 'Save a note',
  summary: 'Open Notepad, type a note, and save it.',
  initialState: 'Desktop is visible.',
  triggerExamples: ['save a note'],
  steps: [
    {
      intent: 'Open Notepad',
      targetHint: 'Notepad app',
      target: { strategy: 'human', hint: 'Notepad app' },
      expectedState: { all: [{ type: 'window_title_contains', value: 'Notepad' }] },
      riskLevel: 'low',
    },
    {
      intent: 'Save the note',
      targetHint: 'Save dialog',
      target: { strategy: 'human', hint: 'Save dialog' },
      expectedState: { all: [{ type: 'screen_contains_text', value: 'saved' }] },
      riskLevel: 'low',
    },
  ],
  successCriteria: 'The note is saved.',
  riskLevel: 'low',
};

const happyTimeline: RecordingTimeline = {
  sessionId: 'rec-1',
  goal: 'Save a note',
  notes: 'I open Notepad, type a short note, then save it.',
  scope: 'active-window',
  privacyMode: 'summary',
  startedAt: '2026-06-24T10:00:00.000Z',
  stoppedAt: '2026-06-24T10:01:00.000Z',
  keyframes: [
    {
      id: 'kf-1',
      sessionId: 'rec-1',
      timestampMs: 1000,
      imagePath: 'artifact://rec-1/keyframes/kf-1.png',
      reason: 'first-frame',
      redacted: false,
      status: 'active',
      hash: 'sha256-a',
      fileSize: 1024,
      mimeType: 'image/png',
      includedInProvider: true,
    },
  ],
  events: [
    {
      id: 'ev-1',
      sessionId: 'rec-1',
      timestampMs: 1500,
      type: 'type',
      summary: 'Typed a short note.',
      redactionLevel: 'summary',
      windowTitle: 'Untitled - Notepad',
      processName: 'notepad.exe',
      status: 'active',
    },
  ],
  context: [
    {
      id: 'ctx-1',
      sessionId: 'rec-1',
      timestampMs: 1200,
      kind: 'window',
      summary: { title: 'Untitled - Notepad', processName: 'notepad.exe' },
      source: 'active-window',
      status: 'active',
    },
  ],
  warnings: [],
};

const minimalTimeline: RecordingTimeline = {
  ...happyTimeline,
  sessionId: 'rec-min',
  notes: 'Only notes and events are available.',
  keyframes: [],
  context: [],
  warnings: ['no keyframes captured'],
};

const invalidTimeline: RecordingTimeline = {
  ...happyTimeline,
  sessionId: '',
  notes: '',
  keyframes: [],
  events: [],
  context: [],
};

const manifest: ProviderPayloadManifest = {
  id: 'manifest-1',
  sessionId: 'rec-1',
  providerName: 'deterministic-test-provider',
  selectedArtifactIds: ['kf-1', 'ev-1', 'ctx-1'],
  redactionPolicy: { privacyMode: 'summary' },
  containsRawText: false,
  containsPreciseCoordinates: false,
  estimatedBytes: 4096,
  createdAt: '2026-06-24T10:01:01.000Z',
  status: 'pending',
};

describe('RecordingTeachingService', () => {
  it('builds a provider payload manifest from active selected artifacts', () => {
    const result = buildProviderPayloadManifest(happyTimeline, {
      id: 'manifest-built',
      providerName: 'deterministic-test-provider',
      createdAt: '2026-06-24T10:01:01.000Z',
    });

    expect(result.selectedArtifactIds).toEqual(['kf-1', 'ev-1', 'ctx-1']);
    expect(result.containsRawText).toBe(false);
    expect(result.containsPreciseCoordinates).toBe(false);
    expect(result.status).toBe('pending');
    expect(result.estimatedBytes).toBeGreaterThan(1024);
  });

  it('builds a provider payload from a confirmed manifest without leaking unselected or summary-redacted raw data', () => {
    const timeline: RecordingTimeline = {
      ...happyTimeline,
      events: [
        {
          ...happyTimeline.events[0],
          rawPayload: { text: 'sensitive typed text' },
        },
        {
          ...happyTimeline.events[0],
          id: 'ev-deleted',
          status: 'deleted',
          summary: 'Deleted event should not be sent.',
          rawPayload: { text: 'deleted raw text' },
        },
      ],
      keyframes: [
        happyTimeline.keyframes[0],
        {
          ...happyTimeline.keyframes[0],
          id: 'kf-excluded',
          includedInProvider: false,
          imagePath: 'artifact://rec-1/keyframes/excluded.png',
        },
      ],
    };
    const selectedManifest = buildProviderPayloadManifest(timeline, {
      id: 'manifest-payload',
      providerName: 'real-provider',
      createdAt: '2026-06-24T10:01:01.000Z',
    });

    const payload = buildRecordingProviderPayload(timeline, {
      ...selectedManifest,
      status: 'confirmed',
    });

    expect(payload.providerName).toBe('real-provider');
    expect(payload.sessionId).toBe('rec-1');
    expect(payload.notes).toBe(timeline.notes);
    expect(payload.redactionPolicy).toEqual(selectedManifest.redactionPolicy);
    expect(payload.keyframes.map((keyframe) => keyframe.id)).toEqual(['kf-1']);
    expect(payload.events.map((event) => event.id)).toEqual(['ev-1']);
    expect(payload.events[0]).not.toHaveProperty('rawPayload');
    expect(payload.context.map((context) => context.id)).toEqual(['ctx-1']);
  });

  it('does not include provider-disabled keyframes even if a manifest selects them', () => {
    const disabledTimeline: RecordingTimeline = {
      ...happyTimeline,
      keyframes: [
        { ...happyTimeline.keyframes[0], id: 'kf-disabled', includedInProvider: false },
      ],
    };

    const payload = buildRecordingProviderPayload(disabledTimeline, {
      ...manifest,
      selectedArtifactIds: ['kf-disabled', 'ev-1', 'ctx-1'],
      status: 'confirmed',
    });

    expect(payload.keyframes).toEqual([]);
    expect(payload.events.map((event) => event.id)).toEqual(['ev-1']);
  });

  it('includes raw event payload only when a confirmed detailed manifest allows raw text', () => {
    const timeline: RecordingTimeline = {
      ...happyTimeline,
      privacyMode: 'detailed',
      events: [{ ...happyTimeline.events[0], rawPayload: { text: 'visible after confirmation' } }],
    };
    const selectedManifest = buildProviderPayloadManifest(timeline, {
      id: 'manifest-detailed',
      providerName: 'real-provider',
      createdAt: '2026-06-24T10:01:01.000Z',
    });

    const payload = buildRecordingProviderPayload(timeline, {
      ...selectedManifest,
      status: 'confirmed',
    });

    expect(payload.events[0].rawPayload).toEqual({ text: 'visible after confirmation' });
    expect(payload.containsRawText).toBe(true);
    expect(payload.containsPreciseCoordinates).toBe(true);
  });

  it('requires explicit manifest confirmation before provider draft generation', async () => {
    let providerCalled = false;
    const provider: RecordingWorkflowProvider = {
      generateWorkflowDraft: async () => {
        providerCalled = true;
        return { draft: validDraft, evidence: [], warnings: [] };
      },
    };

    const result = await new RecordingTeachingService(provider).generateDraft({
      timeline: happyTimeline,
      manifest,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('manifest must be confirmed before draft generation');
    expect(providerCalled).toBe(false);
  });

  it('validates simulated timeline fixtures before provider use', () => {
    expect(validateRecordingTimeline(happyTimeline).ok).toBe(true);
    expect(validateRecordingTimeline(minimalTimeline).warnings).toContain('no keyframes captured');

    const result = validateRecordingTimeline(invalidTimeline);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('timeline sessionId is required');
    expect(result.errors).toContain('timeline must include notes, events, keyframes, or context');
  });

  it('rejects provider manifests that do not match the timeline session', () => {
    const result = validateRecordingTeachingRequest({
      timeline: happyTimeline,
      manifest: { ...manifest, sessionId: 'different-session' },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('manifest sessionId must match timeline sessionId');
  });

  it('warns when manifest includes raw text or precise coordinates', () => {
    const result = validateRecordingTeachingRequest({
      timeline: happyTimeline,
      manifest: {
        ...manifest,
        status: 'confirmed',
        containsRawText: true,
        containsPreciseCoordinates: true,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('manifest includes raw text');
    expect(result.warnings).toContain('manifest includes precise coordinates');
  });

  it('builds a validated recording draft from a complete simulated timeline', async () => {
    let receivedPayloadProviderName = '';
    let receivedPayloadKeyframes: string[] = [];
    const provider: RecordingWorkflowProvider = {
      generateWorkflowDraft: async (payload) => {
        receivedPayloadProviderName = payload.providerName;
        receivedPayloadKeyframes = payload.keyframes.map((keyframe) => keyframe.id);
        return ({
        draft: { ...validDraft, appName: payload.context[0]?.summary.title ?? validDraft.appName },
        evidence: [
          {
            id: 'evidence-1',
            sessionId: payload.sessionId,
            stepId: 'step-1',
            eventIds: ['ev-1'],
            keyframeIds: ['kf-1'],
            contextIds: ['ctx-1'],
            confidence: 0.9,
            rationale: 'The first step is visible in the first keyframe.',
          },
        ],
        warnings: [`provider:${payload.providerName}`],
        rawResponse: { provider: payload.providerName },
      });
      },
    };

    const result = await new RecordingTeachingService(provider).generateDraft({
      timeline: happyTimeline,
      manifest: { ...manifest, status: 'confirmed' },
    });

    expect(result.ok).toBe(true);
    expect(result.data!.draft.sourceType).toBe('recording');
    expect(result.data!.evidence[0].keyframeIds).toEqual(['kf-1']);
    expect(result.data!.warnings).toContain('provider:deterministic-test-provider');
    expect(receivedPayloadProviderName).toBe('deterministic-test-provider');
    expect(receivedPayloadKeyframes).toEqual(['kf-1']);
  });

  it('normalizes provider evidence to valid draft steps and selected artifacts', async () => {
    const provider: RecordingWorkflowProvider = {
      generateWorkflowDraft: async () => ({
        draft: {
          ...validDraft,
          steps: [
            { ...validDraft.steps[0], id: 'open-step', order: 1 },
            { ...validDraft.steps[1], id: 'save-step', order: 2 },
          ],
        },
        evidence: [
          {
            id: 'evidence-1',
            sessionId: 'rec-1',
            stepId: 'missing-step',
            eventIds: ['ev-1', 'ev-missing'],
            keyframeIds: ['kf-1', 'kf-missing'],
            contextIds: ['ctx-1', 'ctx-missing'],
            confidence: 2,
            rationale: 'Provider linked one valid and one invalid artifact.',
          },
        ],
        warnings: [],
      }),
    };

    const result = await new RecordingTeachingService(provider).generateDraft({
      timeline: happyTimeline,
      manifest: { ...manifest, status: 'confirmed' },
    });

    expect(result.ok).toBe(true);
    expect(result.data!.evidence).toEqual([{
      id: 'evidence-1',
      sessionId: 'rec-1',
      stepId: 'open-step',
      eventIds: ['ev-1'],
      keyframeIds: ['kf-1'],
      contextIds: ['ctx-1'],
      confidence: 1,
      rationale: 'Provider linked one valid and one invalid artifact.',
    }]);
    expect(result.data!.warnings).toContain('provider evidence stepId missing-step was not found; linked to open-step');
    expect(result.data!.warnings).toContain('provider evidence referenced unavailable event ev-missing');
    expect(result.data!.warnings).toContain('provider evidence referenced unavailable keyframe kf-missing');
    expect(result.data!.warnings).toContain('provider evidence referenced unavailable context ctx-missing');
  });

  it('supports a minimal simulated timeline by preserving timeline warnings', async () => {
    const provider: RecordingWorkflowProvider = {
      generateWorkflowDraft: async () => ({
        draft: validDraft,
        evidence: [],
        warnings: [],
      }),
    };

    const result = await new RecordingTeachingService(provider).generateDraft({
      timeline: minimalTimeline,
      manifest: { ...manifest, sessionId: minimalTimeline.sessionId, selectedArtifactIds: [], status: 'confirmed' },
    });

    expect(result.ok).toBe(true);
    expect(result.data!.warnings).toContain('no keyframes captured');
  });

  it('rejects an invalid simulated timeline before invoking the provider', async () => {
    let providerCalled = false;
    const provider: RecordingWorkflowProvider = {
      generateWorkflowDraft: async () => {
        providerCalled = true;
        return { draft: validDraft, evidence: [], warnings: [] };
      },
    };

    const result = await new RecordingTeachingService(provider).generateDraft({
      timeline: invalidTimeline,
      manifest: { ...manifest, sessionId: invalidTimeline.sessionId, status: 'confirmed' },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('timeline sessionId is required');
    expect(result.errors).toContain('timeline must include notes, events, keyframes, or context');
    expect(providerCalled).toBe(false);
  });

  it('returns validation errors for malformed provider output', async () => {
    const provider: RecordingWorkflowProvider = {
      generateWorkflowDraft: async () => ({
        draft: { ...validDraft, topic: '', steps: [] },
        evidence: [],
        warnings: ['provider warning'],
      }),
    };

    const result = await new RecordingTeachingService(provider).generateDraft({
      timeline: happyTimeline,
      manifest: { ...manifest, status: 'confirmed' },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('topic is required');
    expect(result.errors).toContain('at least one step is required');
    expect(result.warnings).toContain('provider warning');
  });
});
