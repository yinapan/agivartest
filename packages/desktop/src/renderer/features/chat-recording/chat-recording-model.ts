import type {
  ProviderPayloadManifestDto,
  RecordingDraftLinkDto,
  RecordingSessionDto,
  RecordingTimelineDto,
} from '../../pages/recording-teach-model.js';

export type ChatRecordingStatus =
  | 'recording'
  | 'stopped'
  | 'manifesting'
  | 'manifest_ready'
  | 'generating'
  | 'draft_ready'
  | 'failed'
  | 'discarded';

export type ChatRecordingAttachment = {
  type: 'recording';
  sessionId: string;
  title: string;
  durationSeconds?: number;
  thumbnailPath?: string;
  scope: 'fullscreen' | 'active-window';
  privacyMode: 'summary' | 'detailed';
  status: ChatRecordingStatus;
  keyframeCount?: number;
  warningCount?: number;
};

export type ChatToolPill = {
  kind: 'wait' | 'click' | 'type' | 'observe' | 'other';
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
};

export type ChatRecordingExplanation = {
  type: 'recording-explanation';
  sessionId: string;
  summary: string;
  steps: Array<{
    id: string;
    title: string;
    instruction: string;
    evidenceIds: string[];
    toolPills: ChatToolPill[];
  }>;
  warnings: string[];
};

export const MAX_CHAT_ATTACHMENTS = 5;

export function createRecordingAttachmentFromTimeline(input: {
  session: RecordingSessionDto;
  timeline: RecordingTimelineDto;
}): ChatRecordingAttachment {
  const { session, timeline } = input;
  const firstFrame = timeline.keyframes.find((frame) => frame.imagePath);
  return {
    type: 'recording',
    sessionId: session.id,
    title: session.goal?.trim() || timeline.goal?.trim() || formatRecordingTitle(session.createdAt),
    durationSeconds: calculateDurationSeconds(timeline.startedAt, timeline.stoppedAt),
    thumbnailPath: firstFrame?.imagePath,
    scope: session.scope,
    privacyMode: session.privacyMode,
    status: toChatRecordingStatus({ sessionStatus: session.status }),
    keyframeCount: timeline.keyframes.length,
    warningCount: timeline.warnings.length,
  };
}

export function requiresManifestConfirmation(input: {
  privacyMode: 'summary' | 'detailed';
  includesRawText?: boolean;
  includesPreciseCoordinates?: boolean;
} | ProviderPayloadManifestDto): boolean {
  const includesRawText = 'containsRawText' in input ? input.containsRawText : input.includesRawText;
  const includesPreciseCoordinates = 'containsPreciseCoordinates' in input
    ? input.containsPreciseCoordinates
    : input.includesPreciseCoordinates;
  return input.privacyMode === 'detailed' || Boolean(includesRawText) || Boolean(includesPreciseCoordinates);
}

export function createRecordingExplanationFromDraftLink(link: RecordingDraftLinkDto): ChatRecordingExplanation {
  if (!isWorkflowDraftLike(link.draftJson)) {
    return {
      type: 'recording-explanation',
      sessionId: link.sessionId,
      summary: '录屏解析结果不可用。',
      steps: [],
      warnings: ['Draft JSON 解析失败'],
    };
  }

  return {
    type: 'recording-explanation',
    sessionId: link.sessionId,
    summary: link.draftJson.summary || link.draftJson.topic || '已根据录屏生成操作步骤。',
    steps: link.draftJson.steps.map((step, index) => {
      const id = step.id ?? `step-${index + 1}`;
      return {
        id,
        title: step.intent || `步骤 ${index + 1}`,
        instruction: step.targetHint || step.inputHint || step.intent || '',
        evidenceIds: evidenceIdsForStep(link.evidence, id),
        toolPills: [normalizeToolPill({ type: inferToolKind(step), label: inferToolKind(step), status: 'done' })],
      };
    }),
    warnings: [],
  };
}

export function normalizeToolPill(input: {
  type?: unknown;
  kind?: unknown;
  label?: unknown;
  status?: unknown;
}): ChatToolPill {
  const rawKind = String(input.kind ?? input.type ?? 'other');
  const kind = isToolKind(rawKind) ? rawKind : 'other';
  const rawStatus = String(input.status ?? 'pending');
  const status = isToolStatus(rawStatus) ? rawStatus : 'pending';
  const label = typeof input.label === 'string' && input.label.trim()
    ? input.label.trim()
    : rawKind;

  return { kind, label, status };
}

export function toChatRecordingStatus(input: {
  sessionStatus?: RecordingSessionDto['status'];
  generationStatus?: 'idle' | 'running' | 'failed' | 'draft_ready' | 'cancelled';
  phase?: 'manifesting' | 'manifest_ready' | 'generating';
}): ChatRecordingStatus {
  if (input.sessionStatus === 'discarded') return 'discarded';
  if (input.generationStatus === 'running' || input.phase === 'generating') return 'generating';
  if (input.generationStatus === 'draft_ready' || input.sessionStatus === 'draft_ready') return 'draft_ready';
  if (input.generationStatus === 'failed' || input.sessionStatus === 'failed') return 'failed';
  if (input.phase === 'manifesting') return 'manifesting';
  if (input.phase === 'manifest_ready') return 'manifest_ready';
  if (input.sessionStatus === 'recording') return 'recording';
  return 'stopped';
}

export function mergeRecordingAttachments(
  existing: Map<string, ChatRecordingAttachment>,
  incoming: ChatRecordingAttachment[],
): Map<string, ChatRecordingAttachment> {
  const next = new Map(existing);

  for (const attachment of incoming) {
    const previous = next.get(attachment.sessionId);
    if (previous) next.delete(attachment.sessionId);
    next.set(attachment.sessionId, { ...previous, ...attachment });
  }

  return new Map(Array.from(next.entries()).slice(-MAX_CHAT_ATTACHMENTS));
}

export function markRecordingAttachmentDiscarded(
  attachment: ChatRecordingAttachment,
): ChatRecordingAttachment {
  const { thumbnailPath: _thumbnailPath, ...rest } = attachment;
  return {
    ...rest,
    status: 'discarded',
  };
}

function calculateDurationSeconds(startedAt: string, stoppedAt: string): number {
  const started = Date.parse(startedAt);
  const stopped = Date.parse(stoppedAt);
  if (!Number.isFinite(started) || !Number.isFinite(stopped)) return 0;
  return Math.max(0, Math.round((stopped - started) / 1000));
}

function formatRecordingTitle(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '录屏';
  return `录屏 ${date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function isWorkflowDraftLike(value: unknown): value is NonNullable<RecordingDraftLinkDto['draftJson']> {
  return typeof value === 'object'
    && value !== null
    && Array.isArray((value as { steps?: unknown }).steps);
}

function evidenceIdsForStep(evidence: unknown[], stepId: string): string[] {
  return evidence.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as { stepId?: unknown; artifactIds?: unknown };
    if (entry.stepId !== stepId || !Array.isArray(entry.artifactIds)) return [];
    return entry.artifactIds.filter((id): id is string => typeof id === 'string');
  });
}

function inferToolKind(step: { targetHint?: string; inputHint?: string; intent?: string }): ChatToolPill['kind'] {
  const text = `${step.intent ?? ''} ${step.targetHint ?? ''} ${step.inputHint ?? ''}`.toLowerCase();
  if (text.includes('wait') || text.includes('等待')) return 'wait';
  if (step.inputHint || text.includes('type') || text.includes('输入')) return 'type';
  if (text.includes('observe') || text.includes('查看')) return 'observe';
  return 'click';
}

function isToolKind(value: string): value is ChatToolPill['kind'] {
  return value === 'wait' || value === 'click' || value === 'type' || value === 'observe' || value === 'other';
}

function isToolStatus(value: string): value is ChatToolPill['status'] {
  return value === 'pending' || value === 'running' || value === 'done' || value === 'failed';
}
