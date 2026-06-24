import type { TargetDescriptor, ExpectedState, RiskLevel } from './agent.js';

export interface WorkflowMemory {
  id: string;
  appName: string;
  platform: 'desktop' | 'browser' | 'hybrid';
  topic: string;
  triggerExamples: string[];
  summary: string;
  initialState: string;
  inputs?: WorkflowInput[];
  steps: WorkflowStep[];
  successCriteria: string;
  riskLevel: RiskLevel;
  sourceType: 'manual' | 'text-teach' | 'recording';
  version: number;
  searchText: string;
  embeddingStatus: 'not_indexed';
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInput {
  name: string;
  type: 'string' | 'number';
  required: boolean;
  prompt: string;
  secret?: boolean;
  humanOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
}

export interface WorkflowStep {
  id: string;
  order: number;
  intent: string;
  targetHint: string;
  target: TargetDescriptor;
  inputHint?: string;
  expectedState?: ExpectedState;
  fallback?: 'retry' | 'degrade' | 'takeover' | 'terminal';
  riskLevel: RiskLevel;
}

export type WorkflowDraftInput = WorkflowInput;

export type WorkflowDraftStep = Omit<WorkflowStep, 'id' | 'order'> & {
  id?: string;
  order?: number;
};

export interface WorkflowDraft {
  appName: string;
  platform?: 'desktop' | 'browser' | 'hybrid';
  topic: string;
  triggerExamples?: string[];
  summary: string;
  initialState: string;
  inputs?: WorkflowDraftInput[];
  steps: WorkflowDraftStep[];
  successCriteria?: string;
  riskLevel: RiskLevel;
  sourceType?: 'manual' | 'text-teach' | 'recording';
}

export interface WorkflowValidationResult<T = WorkflowDraft> {
  ok: boolean;
  data?: T;
  errors: string[];
  warnings: string[];
}

export interface WorkflowMemoryVersion {
  id: string;
  memoryId: string;
  version: number;
  snapshot: WorkflowMemory;
  changeNote?: string;
  source: 'create' | 'edit' | 'rollback' | 'import' | 'text-teach' | 'recording-teach';
  createdAt: string;
}

export interface TextTeachingRequest {
  goal: string;
  teachingText: string;
  appName?: string;
  platform?: 'desktop' | 'browser' | 'hybrid';
}

export interface TextTeachingResult {
  draft: WorkflowDraft;
  warnings: string[];
  rawResponse?: unknown;
}

export type RecordingScope = 'fullscreen' | 'active-window';
export type RecordingPrivacyMode = 'summary' | 'detailed';
export type RecordingSessionStatus =
  | 'idle'
  | 'recording'
  | 'stopping'
  | 'ready'
  | 'draft_ready'
  | 'failed'
  | 'discarded';
export type RecordingArtifactStatus = 'active' | 'excluded' | 'deleted';
export type RecordingRedactionLevel = 'summary' | 'detailed';

export interface RecordingSession {
  id: string;
  scope: RecordingScope;
  privacyMode: RecordingPrivacyMode;
  status: RecordingSessionStatus;
  goal?: string;
  notes?: string;
  videoPath?: string;
  artifactDir: string;
  nativeSessionId?: string;
  nativeTargetHwnd?: number;
  activeWindowTitle?: string;
  startedAt?: string;
  stoppedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecordingEvent {
  id: string;
  sessionId: string;
  timestampMs: number;
  type: 'click' | 'double-click' | 'type' | 'hotkey' | 'scroll' | 'window-change';
  summary: string;
  redactionLevel: RecordingRedactionLevel;
  rawPayload?: unknown;
  windowTitle?: string;
  processName?: string;
  status: RecordingArtifactStatus;
  deletedAt?: string;
}

export interface RecordingKeyframe {
  id: string;
  sessionId: string;
  timestampMs: number;
  imagePath: string;
  reason: string;
  eventId?: string;
  redacted: boolean;
  status: RecordingArtifactStatus;
  deletedAt?: string;
  hash: string;
  fileSize: number;
  mimeType: string;
  includedInProvider: boolean;
}

export interface RecordingContextSnapshot {
  id: string;
  sessionId: string;
  timestampMs: number;
  kind: 'window' | 'uia' | 'screenshot' | 'note';
  summary: Record<string, unknown>;
  source: string;
  warning?: string;
  status: RecordingArtifactStatus;
}

export interface RecordingTimeline {
  sessionId: string;
  goal?: string;
  notes: string;
  scope: RecordingScope;
  privacyMode: RecordingPrivacyMode;
  startedAt: string;
  stoppedAt: string;
  keyframes: RecordingKeyframe[];
  events: RecordingEvent[];
  context: RecordingContextSnapshot[];
  warnings: string[];
}

export interface ProviderPayloadManifest {
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
}

export interface RecordingProviderPayload {
  sessionId: string;
  providerName: string;
  goal?: string;
  notes: string;
  scope: RecordingScope;
  privacyMode: RecordingPrivacyMode;
  redactionPolicy: Record<string, unknown>;
  containsRawText: boolean;
  containsPreciseCoordinates: boolean;
  keyframes: Array<{
    id: string;
    timestampMs: number;
    imagePath: string;
    reason: string;
    redacted: boolean;
    hash: string;
    fileSize: number;
    mimeType: string;
  }>;
  events: Array<{
    id: string;
    timestampMs: number;
    type: RecordingEvent['type'];
    summary: string;
    redactionLevel: RecordingRedactionLevel;
    windowTitle?: string;
    processName?: string;
    rawPayload?: unknown;
  }>;
  context: Array<{
    id: string;
    timestampMs: number;
    kind: RecordingContextSnapshot['kind'];
    summary: Record<string, unknown>;
    source: string;
    warning?: string;
  }>;
  warnings: string[];
}

export interface StepEvidenceLink {
  id: string;
  sessionId: string;
  stepId: string;
  eventIds: string[];
  keyframeIds: string[];
  contextIds: string[];
  confidence: number;
  rationale: string;
}

export interface RecordingWorkflowProviderResult {
  draft: WorkflowDraft;
  evidence: StepEvidenceLink[];
  warnings: string[];
  rawResponse?: unknown;
}

export interface RecordingTeachingRequest {
  timeline: RecordingTimeline;
  manifest: ProviderPayloadManifest;
}

export interface RecordingTeachingResult {
  draft: WorkflowDraft;
  evidence: StepEvidenceLink[];
  warnings: string[];
  rawResponse?: unknown;
}

export interface RecordingDraftLink {
  id: string;
  sessionId: string;
  draftJson: WorkflowDraft;
  status: 'draft_ready' | 'saved' | 'discarded';
  evidence: StepEvidenceLink[];
  createdAt: string;
  updatedAt: string;
  discardedAt?: string;
}

export interface RecordingRepository {
  saveSession(session: RecordingSession): Promise<void>;
  getSession(sessionId: string): Promise<RecordingSession | null>;
  listActiveSessions(): Promise<RecordingSession[]>;
  updateSession(session: RecordingSession): Promise<void>;
  saveTimeline(timeline: RecordingTimeline): Promise<void>;
  getTimeline(sessionId: string): Promise<RecordingTimeline | null>;
  saveDraftLink(link: RecordingDraftLink): Promise<void>;
  getDraftLink(sessionId: string): Promise<RecordingDraftLink | null>;
}
