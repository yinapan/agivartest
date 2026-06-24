import type {
  ProviderPayloadManifest,
  RecordingProviderPayload,
  RecordingTeachingRequest,
  RecordingTeachingResult,
  RecordingTimeline,
  RecordingWorkflowProviderResult,
  WorkflowValidationResult,
} from '../types/workflow.js';
import { validateWorkflowDraft } from './workflow-draft.js';

export interface RecordingWorkflowProvider {
  generateWorkflowDraft(
    payload: RecordingProviderPayload,
  ): Promise<RecordingWorkflowProviderResult>;
}

export class RecordingTeachingService {
  constructor(private provider: RecordingWorkflowProvider) {}

  async generateDraft(
    request: RecordingTeachingRequest,
  ): Promise<WorkflowValidationResult<RecordingTeachingResult>> {
    const requestValidation = validateRecordingTeachingRequest(request);
    if (!requestValidation.ok) {
      return {
        ok: false,
        errors: requestValidation.errors,
        warnings: requestValidation.warnings,
      };
    }

    const providerResult = await this.provider.generateWorkflowDraft(
      buildRecordingProviderPayload(request.timeline, request.manifest),
    );
    const draft = {
      ...providerResult.draft,
      sourceType: 'recording' as const,
    };

    const draftValidation = validateWorkflowDraft(draft);
    const evidenceNormalization = normalizeProviderEvidence(
      providerResult.evidence,
      request.timeline,
      draft,
    );
    const warnings = [
      ...request.timeline.warnings,
      ...providerResult.warnings,
      ...evidenceNormalization.warnings,
      ...draftValidation.warnings,
    ];

    if (!draftValidation.ok) {
      return {
        ok: false,
        errors: draftValidation.errors,
        warnings,
      };
    }

    return {
      ok: true,
      data: {
        draft,
        evidence: evidenceNormalization.evidence,
        warnings,
        rawResponse: providerResult.rawResponse,
      },
      errors: [],
      warnings,
    };
  }
}

function normalizeProviderEvidence(
  evidence: RecordingWorkflowProviderResult['evidence'],
  timeline: RecordingTimeline,
  draft: RecordingWorkflowProviderResult['draft'],
): { evidence: RecordingWorkflowProviderResult['evidence']; warnings: string[] } {
  const warnings: string[] = [];
  const stepIds = draft.steps.map((step, index) => step.id ?? `step-${index + 1}`);
  const fallbackStepId = stepIds[0] ?? 'step-1';
  const eventIds = new Set(timeline.events.filter((event) => event.status === 'active').map((event) => event.id));
  const keyframeIds = new Set(timeline.keyframes
    .filter((keyframe) => keyframe.status === 'active' && keyframe.includedInProvider)
    .map((keyframe) => keyframe.id));
  const contextIds = new Set(timeline.context.filter((context) => context.status === 'active').map((context) => context.id));

  return {
    evidence: evidence.map((link) => {
      let stepId = link.stepId;
      if (!stepIds.includes(stepId)) {
        warnings.push(`provider evidence stepId ${stepId} was not found; linked to ${fallbackStepId}`);
        stepId = fallbackStepId;
      }

      return {
        ...link,
        sessionId: timeline.sessionId,
        stepId,
        eventIds: filterEvidenceIds(link.eventIds, eventIds, 'event', warnings),
        keyframeIds: filterEvidenceIds(link.keyframeIds, keyframeIds, 'keyframe', warnings),
        contextIds: filterEvidenceIds(link.contextIds, contextIds, 'context', warnings),
        confidence: clampConfidence(link.confidence),
      };
    }),
    warnings,
  };
}

function filterEvidenceIds(
  ids: string[],
  allowed: Set<string>,
  kind: string,
  warnings: string[],
): string[] {
  return ids.filter((id) => {
    if (allowed.has(id)) return true;
    warnings.push(`provider evidence referenced unavailable ${kind} ${id}`);
    return false;
  });
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function buildRecordingProviderPayload(
  timeline: RecordingTimeline,
  manifest: ProviderPayloadManifest,
): RecordingProviderPayload {
  const selected = new Set(manifest.selectedArtifactIds);
  const includeRawPayload =
    manifest.status === 'confirmed' &&
    manifest.containsRawText &&
    timeline.privacyMode === 'detailed';

  return {
    sessionId: timeline.sessionId,
    providerName: manifest.providerName,
    goal: timeline.goal,
    notes: timeline.notes,
    scope: timeline.scope,
    privacyMode: timeline.privacyMode,
    redactionPolicy: manifest.redactionPolicy,
    containsRawText: manifest.containsRawText,
    containsPreciseCoordinates: manifest.containsPreciseCoordinates,
    keyframes: timeline.keyframes
      .filter((keyframe) => selected.has(keyframe.id) && keyframe.status === 'active')
      .map((keyframe) => ({
        id: keyframe.id,
        timestampMs: keyframe.timestampMs,
        imagePath: keyframe.imagePath,
        reason: keyframe.reason,
        redacted: keyframe.redacted,
        hash: keyframe.hash,
        fileSize: keyframe.fileSize,
        mimeType: keyframe.mimeType,
      })),
    events: timeline.events
      .filter((event) => selected.has(event.id) && event.status === 'active')
      .map((event) => ({
        id: event.id,
        timestampMs: event.timestampMs,
        type: event.type,
        summary: event.summary,
        redactionLevel: event.redactionLevel,
        windowTitle: event.windowTitle,
        processName: event.processName,
        ...(includeRawPayload && event.rawPayload !== undefined ? { rawPayload: event.rawPayload } : {}),
      })),
    context: timeline.context
      .filter((context) => selected.has(context.id) && context.status === 'active')
      .map((context) => ({
        id: context.id,
        timestampMs: context.timestampMs,
        kind: context.kind,
        summary: context.summary,
        source: context.source,
        warning: context.warning,
      })),
    warnings: timeline.warnings,
  };
}

export function validateRecordingTeachingRequest(
  request: RecordingTeachingRequest,
): WorkflowValidationResult {
  const timelineValidation = validateRecordingTimeline(request.timeline);
  const errors = [...timelineValidation.errors];
  const warnings = [...timelineValidation.warnings];

  if (!request.manifest.id?.trim()) errors.push('manifest id is required');
  if (!request.manifest.providerName?.trim()) errors.push('manifest providerName is required');
  if (request.manifest.status !== 'confirmed') {
    errors.push('manifest must be confirmed before draft generation');
  }
  if (request.manifest.sessionId !== request.timeline.sessionId) {
    errors.push('manifest sessionId must match timeline sessionId');
  }
  if (request.manifest.containsRawText) warnings.push('manifest includes raw text');
  if (request.manifest.containsPreciseCoordinates) {
    warnings.push('manifest includes precise coordinates');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateRecordingTimeline(timeline: RecordingTimeline): WorkflowValidationResult {
  const errors: string[] = [];

  if (!timeline.sessionId?.trim()) errors.push('timeline sessionId is required');
  if (!timeline.startedAt?.trim()) errors.push('timeline startedAt is required');
  if (!timeline.stoppedAt?.trim()) errors.push('timeline stoppedAt is required');
  if (timeline.scope !== 'fullscreen' && timeline.scope !== 'active-window') {
    errors.push('timeline scope is invalid');
  }
  if (timeline.privacyMode !== 'summary' && timeline.privacyMode !== 'detailed') {
    errors.push('timeline privacyMode is invalid');
  }

  const hasTimelineContent =
    Boolean(timeline.notes?.trim()) ||
    timeline.events.length > 0 ||
    timeline.keyframes.length > 0 ||
    timeline.context.length > 0;
  if (!hasTimelineContent) {
    errors.push('timeline must include notes, events, keyframes, or context');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings: timeline.warnings ?? [],
  };
}

export interface ProviderPayloadManifestBuildOptions {
  id: string;
  providerName: string;
  createdAt: string;
}

export function buildProviderPayloadManifest(
  timeline: RecordingTimeline,
  options: ProviderPayloadManifestBuildOptions,
): ProviderPayloadManifest {
  const selectedKeyframes = timeline.keyframes.filter((keyframe) =>
    keyframe.status === 'active' && keyframe.includedInProvider);
  const selectedEvents = timeline.events.filter((event) => event.status === 'active');
  const selectedContext = timeline.context.filter((context) => context.status === 'active');
  const selectedArtifactIds = [
    ...selectedKeyframes.map((keyframe) => keyframe.id),
    ...selectedEvents.map((event) => event.id),
    ...selectedContext.map((context) => context.id),
  ];

  return {
    id: options.id,
    sessionId: timeline.sessionId,
    providerName: options.providerName,
    selectedArtifactIds,
    redactionPolicy: {
      privacyMode: timeline.privacyMode,
      rawPayload: timeline.privacyMode === 'detailed' ? 'allowed-after-confirmation' : 'excluded',
      coordinates: timeline.privacyMode === 'detailed' ? 'allowed-after-confirmation' : 'summarized',
    },
    containsRawText: timeline.privacyMode === 'detailed' && timeline.events.some((event) => event.rawPayload !== undefined),
    containsPreciseCoordinates: timeline.privacyMode === 'detailed',
    estimatedBytes: estimateProviderPayloadBytes(timeline, selectedArtifactIds),
    createdAt: options.createdAt,
    status: 'pending',
  };
}

function estimateProviderPayloadBytes(timeline: RecordingTimeline, selectedArtifactIds: string[]): number {
  const keyframeBytes = timeline.keyframes
    .filter((keyframe) => selectedArtifactIds.includes(keyframe.id))
    .reduce((total, keyframe) => total + keyframe.fileSize, 0);
  const jsonBytes = Buffer.byteLength(JSON.stringify({
    notes: timeline.notes,
    events: timeline.events.filter((event) => selectedArtifactIds.includes(event.id)),
    context: timeline.context.filter((context) => selectedArtifactIds.includes(context.id)),
  }), 'utf8');
  return keyframeBytes + jsonBytes;
}
