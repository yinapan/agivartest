import type { WorkflowDraft } from './workflow-editor-model.js';

export type RecordingScopeDto = 'fullscreen' | 'active-window';
export type RecordingPrivacyModeDto = 'summary' | 'detailed';
export type RecordingPanelPhase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'ready'
  | 'manifest_ready'
  | 'generating'
  | 'draft_ready'
  | 'failed';

export type RecordingSessionDto = {
  id: string;
  scope: RecordingScopeDto;
  privacyMode: RecordingPrivacyModeDto;
  status: 'idle' | 'recording' | 'stopping' | 'ready' | 'draft_ready' | 'failed' | 'discarded';
  goal?: string;
  notes?: string;
  artifactDir: string;
  videoPath?: string;
  activeWindowTitle?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  stoppedAt?: string;
};

export type RecordingTimelineDto = {
  sessionId: string;
  goal?: string;
  notes: string;
  scope: RecordingScopeDto;
  privacyMode: RecordingPrivacyModeDto;
  startedAt: string;
  stoppedAt: string;
  keyframes: Array<{ id: string; imagePath?: string; reason?: string; status: string }>;
  events: Array<{ id: string; type: string; summary: string; status: string }>;
  context: Array<{ id: string; kind: string; summary: Record<string, unknown>; status: string }>;
  warnings: string[];
};

export type ProviderPayloadManifestDto = {
  id: string;
  sessionId: string;
  providerName: string;
  selectedArtifactIds: string[];
  redactionPolicy: Record<string, unknown>;
  containsRawText: boolean;
  containsPreciseCoordinates: boolean;
  estimatedBytes: number;
  createdAt: string;
  status: 'pending' | 'confirmed' | 'sent' | 'failed';
};

export type RecordingDraftLinkDto = {
  id: string;
  sessionId: string;
  draftJson: WorkflowDraft;
  status: 'draft_ready' | 'saved' | 'discarded';
  evidence: unknown[];
  createdAt: string;
  updatedAt: string;
};

export type RecordingTeachState = {
  phase: RecordingPanelPhase;
  scope: RecordingScopeDto;
  privacyMode: RecordingPrivacyModeDto;
  goal: string;
  notes: string;
  session: RecordingSessionDto | null;
  timeline: RecordingTimelineDto | null;
  manifest: ProviderPayloadManifestDto | null;
  draftLink: RecordingDraftLinkDto | null;
  error: string;
};

export function createInitialRecordingTeachState(): RecordingTeachState {
  return {
    phase: 'idle',
    scope: 'active-window',
    privacyMode: 'summary',
    goal: '',
    notes: '',
    session: null,
    timeline: null,
    manifest: null,
    draftLink: null,
    error: '',
  };
}

export function recordingStatusLabel(status: RecordingSessionDto['status']): string {
  const labels: Record<RecordingSessionDto['status'], string> = {
    idle: 'Idle',
    recording: 'Recording',
    stopping: 'Stopping',
    ready: 'Ready',
    draft_ready: 'Draft ready',
    failed: 'Failed',
    discarded: 'Discarded',
  };
  return labels[status];
}

export function timelineSummary(timeline: RecordingTimelineDto): {
  keyframeCount: number;
  eventCount: number;
  contextCount: number;
  warningCount: number;
  durationSeconds: number;
} {
  const started = Date.parse(timeline.startedAt);
  const stopped = Date.parse(timeline.stoppedAt);
  const durationSeconds = Number.isFinite(started) && Number.isFinite(stopped)
    ? Math.max(0, Math.round((stopped - started) / 1000))
    : 0;

  return {
    keyframeCount: timeline.keyframes.length,
    eventCount: timeline.events.length,
    contextCount: timeline.context.length,
    warningCount: timeline.warnings.length,
    durationSeconds,
  };
}

export function manifestSummary(manifest: ProviderPayloadManifestDto): {
  artifactCount: number;
  estimatedKb: number;
  includesRawText: boolean;
  includesPreciseCoordinates: boolean;
  providerName: string;
} {
  return {
    artifactCount: manifest.selectedArtifactIds.length,
    estimatedKb: Math.ceil(manifest.estimatedBytes / 1024),
    includesRawText: manifest.containsRawText,
    includesPreciseCoordinates: manifest.containsPreciseCoordinates,
    providerName: manifest.providerName,
  };
}

export function buildConfirmedManifest(manifest: ProviderPayloadManifestDto): ProviderPayloadManifestDto {
  return { ...manifest, status: 'confirmed' };
}

export function toEditorDraft(link: RecordingDraftLinkDto): WorkflowDraft {
  return {
    ...link.draftJson,
    sourceType: 'recording',
    inputs: link.draftJson.inputs ?? [],
  };
}
