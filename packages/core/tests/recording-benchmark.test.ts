import { describe, expect, it } from 'vitest';
import {
  buildProviderPayloadManifest,
  RecordingTeachingService,
  type RecordingWorkflowProvider,
} from '../src/index.js';
import type { RecordingTimeline, WorkflowDraft } from '../src/types/workflow.js';

const provider: RecordingWorkflowProvider = {
  async generateWorkflowDraft(payload) {
    const firstEvent = payload.events[0];
    const topic = payload.goal ?? payload.notes.split(/[.。\n]/)[0] ?? 'Recorded workflow';
    const draft: WorkflowDraft = {
      appName: (payload.context[0]?.summary.title as string | undefined) ?? 'Recorded app',
      platform: payload.scope === 'active-window' ? 'desktop' : 'hybrid',
      topic,
      triggerExamples: [topic],
      summary: payload.notes || `Recorded ${topic}.`,
      initialState: payload.context[0]?.summary.title
        ? `Window "${payload.context[0].summary.title}" is active.`
        : 'The recording starts from a ready desktop state.',
      steps: [
        {
          intent: firstEvent?.summary ?? topic,
          targetHint: firstEvent?.windowTitle ?? 'recorded target',
          target: { strategy: 'human', hint: firstEvent?.summary ?? 'recorded target' },
          riskLevel: 'low',
        },
      ],
      successCriteria: `Complete ${topic}.`,
      riskLevel: payload.events.some((event) => event.type === 'type') ? 'medium' : 'low',
      sourceType: 'recording',
    };
    return {
      draft,
      evidence: [{
        id: `${payload.sessionId}-evidence-1`,
        sessionId: payload.sessionId,
        stepId: 'step-1',
        eventIds: payload.events.slice(0, 2).map((event) => event.id),
        keyframeIds: payload.keyframes.slice(0, 2).map((keyframe) => keyframe.id),
        contextIds: payload.context.slice(0, 2).map((context) => context.id),
        confidence: 0.6,
        rationale: `Benchmark provider ${payload.providerName} generated draft evidence.`,
      }],
      warnings: [],
    };
  },
};

describe('recording teaching benchmark hardening', () => {
  it('excludes deleted or provider-disabled artifacts from benchmark manifests', () => {
    const timeline = representativeTimelines()[0];
    const manifest = buildProviderPayloadManifest({
      ...timeline,
      keyframes: [
        { ...timeline.keyframes[0], status: 'deleted', includedInProvider: false },
        { ...timeline.keyframes[1], status: 'active', includedInProvider: false },
        timeline.keyframes[2],
      ],
      events: [
        { ...timeline.events[0], status: 'excluded' },
        timeline.events[1],
      ],
      context: [
        { ...timeline.context[0], status: 'deleted' },
      ],
    }, {
      id: 'manifest-hardening',
      providerName: 'benchmark-provider',
      createdAt: '2026-06-24T12:00:00.000Z',
    });

    expect(manifest.selectedArtifactIds).toEqual([
      timeline.keyframes[2].id,
      timeline.events[1].id,
    ]);
  });

  it('produces at least three structurally complete drafts across five representative recordings', async () => {
    const service = new RecordingTeachingService(provider);
    const results = [];

    for (const timeline of representativeTimelines()) {
      const manifest = buildProviderPayloadManifest(timeline, {
        id: `manifest-${timeline.sessionId}`,
        providerName: 'benchmark-provider',
        createdAt: '2026-06-24T12:00:00.000Z',
      });
      results.push(await service.generateDraft({
        timeline,
        manifest: { ...manifest, status: 'confirmed' },
      }));
    }

    const complete = results.filter((result) =>
      result.ok &&
      result.data?.draft.sourceType === 'recording' &&
      result.data.draft.steps.length > 0 &&
      result.data.evidence.length > 0);

    expect(results).toHaveLength(5);
    expect(complete).toHaveLength(5);
    expect(complete.length).toBeGreaterThanOrEqual(3);
  });
});

function representativeTimelines(): RecordingTimeline[] {
  return [
    makeTimeline('rec-notepad-save', 'active-window', 'Save Notepad note', ['window-change', 'type', 'hotkey']),
    makeTimeline('rec-browser-form', 'fullscreen', 'Submit browser form', ['click', 'type', 'click']),
    makeTimeline('rec-file-rename', 'active-window', 'Rename a downloaded file', ['click', 'type', 'hotkey']),
    makeTimeline('rec-settings-toggle', 'fullscreen', 'Toggle application setting', ['click', 'click']),
    makeTimeline('rec-table-filter', 'active-window', 'Filter spreadsheet table', ['click', 'type', 'hotkey']),
  ];
}

function makeTimeline(
  sessionId: string,
  scope: RecordingTimeline['scope'],
  goal: string,
  eventTypes: RecordingTimeline['events'][number]['type'][],
): RecordingTimeline {
  return {
    sessionId,
    goal,
    notes: `${goal}. Review the generated draft before saving.`,
    scope,
    privacyMode: 'summary',
    startedAt: '2026-06-24T12:00:00.000Z',
    stoppedAt: '2026-06-24T12:01:00.000Z',
    keyframes: eventTypes.map((_, index) => ({
      id: `${sessionId}-kf-${index + 1}`,
      sessionId,
      timestampMs: index * 1000,
      imagePath: `artifact://${sessionId}/frame-${index + 1}.png`,
      reason: 'interval',
      redacted: false,
      status: 'active',
      hash: `sha256-${sessionId}-${index + 1}`,
      fileSize: 4096 + index,
      mimeType: 'image/png',
      includedInProvider: true,
    })),
    events: eventTypes.map((type, index) => ({
      id: `${sessionId}-evt-${index + 1}`,
      sessionId,
      timestampMs: index * 1000 + 250,
      type,
      summary: `${goal} event ${index + 1}`,
      redactionLevel: 'summary',
      windowTitle: goal,
      processName: 'benchmark.exe',
      status: 'active',
    })),
    context: [{
      id: `${sessionId}-ctx-1`,
      sessionId,
      timestampMs: 0,
      kind: 'window',
      summary: { title: goal, processName: 'benchmark.exe' },
      source: scope,
      status: 'active',
    }],
    warnings: [],
  };
}
