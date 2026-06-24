import { describe, expect, it } from 'vitest';
import {
  buildConfirmedManifest,
  createInitialRecordingTeachState,
  applyProviderList,
  applyDiscardResult,
  applyHistory,
  manifestSummary,
  recordingStatusLabel,
  summarizePreflight,
  timelineSummary,
  toEditorDraft,
  type ProviderPayloadManifestDto,
  type RecordingDraftLinkDto,
  type RecordingTimelineDto,
} from '../src/renderer/pages/recording-teach-model.js';

const timeline: RecordingTimelineDto = {
  sessionId: 'rec-1',
  notes: 'Saved a note',
  scope: 'active-window',
  privacyMode: 'summary',
  startedAt: '2026-06-24T10:00:00.000Z',
  stoppedAt: '2026-06-24T10:00:10.000Z',
  keyframes: [{ id: 'kf-1', status: 'active' }],
  events: [{ id: 'ev-1', type: 'click', summary: 'Clicked Save', status: 'active' }],
  context: [{ id: 'ctx-1', kind: 'window', summary: { title: 'Notepad' }, status: 'active' }],
  warnings: ['event capture degraded'],
};

const manifest: ProviderPayloadManifestDto = {
  id: 'manifest-1',
  sessionId: 'rec-1',
  providerName: 'recording-provider',
  selectedArtifactIds: ['kf-1', 'ev-1'],
  redactionPolicy: { privacyMode: 'summary' },
  containsRawText: false,
  containsPreciseCoordinates: false,
  estimatedBytes: 4096,
  createdAt: '2026-06-24T10:00:11.000Z',
  status: 'pending',
};

const draftLink: RecordingDraftLinkDto = {
  id: 'draft-link-1',
  sessionId: 'rec-1',
  status: 'draft_ready',
  draftJson: {
    appName: 'Notepad',
    platform: 'desktop',
    topic: 'Save note',
    triggerExamples: ['save note'],
    summary: 'Save a note.',
    initialState: 'Notepad is open.',
    steps: [{ intent: 'Click Save', targetHint: 'Save button', riskLevel: 'low' }],
    successCriteria: 'The note is saved.',
    riskLevel: 'low',
    sourceType: 'recording',
  },
  evidence: [],
  createdAt: '2026-06-24T10:00:12.000Z',
  updatedAt: '2026-06-24T10:00:12.000Z',
};

describe('recording teach model', () => {
  it('creates a summary-mode idle initial state', () => {
    expect(createInitialRecordingTeachState()).toMatchObject({
      phase: 'idle',
      scope: 'active-window',
      privacyMode: 'summary',
      providerName: 'recording-teaching-provider',
      session: null,
      timeline: null,
      manifest: null,
      draftLink: null,
      error: '',
    });
  });

  it('applies available provider selections from main process', () => {
    const state = applyProviderList(createInitialRecordingTeachState(), {
      selectedProviderName: 'openai-compatible',
      providers: [
        { name: 'recording-teaching-provider', label: 'Deterministic regression provider', available: true },
        { name: 'openai-compatible', label: 'OpenAI-compatible recording provider', available: true },
      ],
    });

    expect(state.providerName).toBe('openai-compatible');
    expect(state.providers).toHaveLength(2);
  });

  it('applies recording history and discard summaries', () => {
    const initial = createInitialRecordingTeachState();
    const withHistory = applyHistory(initial, [{
      id: 'rec-1',
      scope: 'fullscreen',
      privacyMode: 'summary',
      status: 'ready',
      artifactDir: 'artifact://rec-1',
      createdAt: '2026-06-24T10:00:00.000Z',
      updatedAt: '2026-06-24T10:00:00.000Z',
    }]);
    const discarded = applyDiscardResult(withHistory, {
      session: { ...withHistory.history[0], status: 'discarded' },
      warnings: ['missing frame ignored'],
    });

    expect(discarded.history[0].status).toBe('discarded');
    expect(discarded.discardWarnings).toEqual(['missing frame ignored']);
  });

  it('summarizes preflight readiness and artifact bytes', () => {
    expect(summarizePreflight({
      canRecord: true,
      warnings: ['large artifact dir'],
      artifactBytes: 2 * 1024 * 1024,
    })).toBe('ready / 2 MB / 1 warnings');
  });

  it('builds readable status labels', () => {
    expect(recordingStatusLabel('recording')).toBe('Recording');
    expect(recordingStatusLabel('draft_ready')).toBe('Draft ready');
  });

  it('summarizes timeline evidence counts and warnings', () => {
    expect(timelineSummary(timeline)).toEqual({
      keyframeCount: 1,
      eventCount: 1,
      contextCount: 1,
      warningCount: 1,
      durationSeconds: 10,
    });
  });

  it('summarizes provider manifests for confirmation', () => {
    expect(manifestSummary(manifest)).toEqual({
      artifactCount: 2,
      estimatedKb: 4,
      includesRawText: false,
      includesPreciseCoordinates: false,
      providerName: 'recording-provider',
    });
  });

  it('marks manifests confirmed without mutating the original object', () => {
    const confirmed = buildConfirmedManifest(manifest);

    expect(confirmed.status).toBe('confirmed');
    expect(manifest.status).toBe('pending');
  });

  it('converts a recording draft link into an editor draft', () => {
    expect(toEditorDraft(draftLink)).toMatchObject({
      topic: 'Save note',
      sourceType: 'recording',
      steps: [{ intent: 'Click Save' }],
    });
  });
});
