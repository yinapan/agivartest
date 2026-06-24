import type {
  RecordingTeachingRequest,
  RecordingTeachingResult,
  RecordingTimeline,
  RecordingWorkflowProviderResult,
  WorkflowValidationResult,
} from '../types/workflow.js';
import { validateWorkflowDraft } from './workflow-draft.js';

export interface RecordingWorkflowProvider {
  generateWorkflowDraft(
    timeline: RecordingTeachingRequest['timeline'],
    manifest: RecordingTeachingRequest['manifest'],
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
      request.timeline,
      request.manifest,
    );
    const draft = {
      ...providerResult.draft,
      sourceType: 'recording' as const,
    };

    const draftValidation = validateWorkflowDraft(draft);
    const warnings = [
      ...request.timeline.warnings,
      ...providerResult.warnings,
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
        evidence: providerResult.evidence,
        warnings,
        rawResponse: providerResult.rawResponse,
      },
      errors: [],
      warnings,
    };
  }
}

export function validateRecordingTeachingRequest(
  request: RecordingTeachingRequest,
): WorkflowValidationResult {
  const timelineValidation = validateRecordingTimeline(request.timeline);
  const errors = [...timelineValidation.errors];
  const warnings = [...timelineValidation.warnings];

  if (!request.manifest.id?.trim()) errors.push('manifest id is required');
  if (!request.manifest.providerName?.trim()) errors.push('manifest providerName is required');
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
