import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_ATTACHMENTS,
  createRecordingAttachmentFromTimeline,
  createRecordingExplanationFromDraftLink,
  markRecordingAttachmentDiscarded,
  mergeRecordingAttachments,
  normalizeToolPill,
  requiresManifestConfirmation,
  toChatRecordingStatus,
  type ChatRecordingAttachment,
} from '../src/renderer/features/chat-recording/chat-recording-model.js';
import type {
  ProviderPayloadManifestDto,
  RecordingDraftLinkDto,
  RecordingSessionDto,
  RecordingTimelineDto,
} from '../src/renderer/pages/recording-teach-model.js';

const session: RecordingSessionDto = {
  id: 'rec-1',
  scope: 'active-window',
  privacyMode: 'summary',
  status: 'ready',
  goal: '打开音乐',
  artifactDir: 'artifact://rec-1',
  createdAt: '2026-06-24T08:55:00.000Z',
  updatedAt: '2026-06-24T08:55:15.000Z',
  startedAt: '2026-06-24T08:55:00.000Z',
  stoppedAt: '2026-06-24T08:55:14.300Z',
};

const timeline: RecordingTimelineDto = {
  sessionId: 'rec-1',
  goal: '打开音乐',
  notes: '',
  scope: 'active-window',
  privacyMode: 'summary',
  startedAt: '2026-06-24T08:55:00.000Z',
  stoppedAt: '2026-06-24T08:55:14.300Z',
  keyframes: [
    { id: 'kf-1', imagePath: 'frame-1.png', reason: 'stop', status: 'active' },
    { id: 'kf-2', imagePath: 'frame-2.png', reason: 'event', status: 'active' },
  ],
  events: [{ id: 'ev-1', type: 'click', summary: 'Clicked music icon', status: 'active' }],
  context: [],
  warnings: ['event capture degraded'],
};

const manifest: ProviderPayloadManifestDto = {
  id: 'manifest-1',
  sessionId: 'rec-1',
  providerName: 'recording-teaching-provider',
  selectedArtifactIds: ['kf-1', 'ev-1'],
  redactionPolicy: { privacyMode: 'summary' },
  containsRawText: false,
  containsPreciseCoordinates: false,
  estimatedBytes: 4096,
  createdAt: '2026-06-24T08:55:15.000Z',
  status: 'pending',
};

const draftLink: RecordingDraftLinkDto = {
  id: 'draft-1',
  sessionId: 'rec-1',
  status: 'draft_ready',
  draftJson: {
    appName: 'QQ Music',
    platform: 'desktop',
    topic: '播放每日推荐',
    triggerExamples: ['播放每日推荐'],
    summary: '打开 QQ 音乐并播放每日推荐。',
    initialState: 'QQ 音乐已经打开。',
    steps: [
      { id: 'step-1', intent: '点击首页', targetHint: '左侧首页图标', riskLevel: 'low' },
      { id: 'step-2', intent: '播放每日推荐', targetHint: '每日 30 首歌单', riskLevel: 'low' },
    ],
    successCriteria: '每日推荐开始播放。',
    riskLevel: 'low',
    sourceType: 'recording',
  },
  evidence: [
    { stepId: 'step-1', artifactIds: ['kf-1'] },
    { stepId: 'step-2', artifactIds: ['kf-2'] },
  ],
  createdAt: '2026-06-24T08:55:16.000Z',
  updatedAt: '2026-06-24T08:55:16.000Z',
};

describe('chat recording model', () => {
  it('summarizes a stopped timeline as a recording attachment', () => {
    const attachment = createRecordingAttachmentFromTimeline({ session, timeline });

    expect(attachment).toMatchObject({
      type: 'recording',
      sessionId: 'rec-1',
      title: '打开音乐',
      durationSeconds: 14,
      thumbnailPath: 'frame-1.png',
      scope: 'active-window',
      privacyMode: 'summary',
      status: 'stopped',
      keyframeCount: 2,
      warningCount: 1,
    });
  });

  it('requires confirmation only for detailed or sensitive manifests', () => {
    expect(requiresManifestConfirmation({
      privacyMode: 'summary',
      includesRawText: false,
      includesPreciseCoordinates: false,
    })).toBe(false);
    expect(requiresManifestConfirmation({
      privacyMode: 'detailed',
      includesRawText: false,
      includesPreciseCoordinates: false,
    })).toBe(true);
    expect(requiresManifestConfirmation({
      privacyMode: 'summary',
      includesRawText: true,
      includesPreciseCoordinates: false,
    })).toBe(true);
    expect(requiresManifestConfirmation({
      privacyMode: 'summary',
      includesRawText: false,
      includesPreciseCoordinates: true,
    })).toBe(true);
    expect(requiresManifestConfirmation(manifest)).toBe(false);
  });

  it('maps draft links into assistant explanations with evidence and tool pills', () => {
    const explanation = createRecordingExplanationFromDraftLink(draftLink);

    expect(explanation).toMatchObject({
      type: 'recording-explanation',
      sessionId: 'rec-1',
      summary: '打开 QQ 音乐并播放每日推荐。',
      warnings: [],
    });
    expect(explanation.steps).toHaveLength(2);
    expect(explanation.steps[0]).toMatchObject({
      id: 'step-1',
      title: '点击首页',
      instruction: '左侧首页图标',
      evidenceIds: ['kf-1'],
      toolPills: [{ kind: 'click', label: 'click', status: 'done' }],
    });
  });

  it('returns a warning explanation when draft JSON is invalid', () => {
    const explanation = createRecordingExplanationFromDraftLink({
      ...draftLink,
      draftJson: null,
    } as unknown as RecordingDraftLinkDto);

    expect(explanation.summary).toBe('录屏解析结果不可用。');
    expect(explanation.steps).toEqual([]);
    expect(explanation.warnings).toEqual(['Draft JSON 解析失败']);
  });

  it('normalizes tool pills and status names for the chat UI', () => {
    expect(normalizeToolPill({ type: 'wait', label: 'wait', status: 'running' })).toEqual({
      kind: 'wait',
      label: 'wait',
      status: 'running',
    });
    expect(normalizeToolPill({ type: 'unknown-action', label: '', status: 'weird' })).toEqual({
      kind: 'other',
      label: 'unknown-action',
      status: 'pending',
    });

    expect(toChatRecordingStatus({ sessionStatus: 'recording' })).toBe('recording');
    expect(toChatRecordingStatus({ sessionStatus: 'ready', generationStatus: 'running' })).toBe('generating');
    expect(toChatRecordingStatus({ sessionStatus: 'ready', generationStatus: 'draft_ready' })).toBe('draft_ready');
    expect(toChatRecordingStatus({ sessionStatus: 'discarded' })).toBe('discarded');
  });

  it('merges recording attachments by session id and keeps the newest bounded set', () => {
    const existing = new Map<string, ChatRecordingAttachment>();
    for (let index = 1; index <= MAX_CHAT_ATTACHMENTS; index += 1) {
      existing.set(`rec-${index}`, {
        type: 'recording',
        sessionId: `rec-${index}`,
        title: `录屏 ${index}`,
        scope: 'fullscreen',
        privacyMode: 'summary',
        status: 'stopped',
      });
    }

    const merged = mergeRecordingAttachments(existing, [
      {
        type: 'recording',
        sessionId: 'rec-2',
        title: '录屏 2 更新',
        scope: 'fullscreen',
        privacyMode: 'summary',
        status: 'draft_ready',
        keyframeCount: 3,
      },
      {
        type: 'recording',
        sessionId: 'rec-6',
        title: '录屏 6',
        scope: 'active-window',
        privacyMode: 'summary',
        status: 'stopped',
      },
    ]);

    expect(Array.from(merged.keys())).toEqual(['rec-3', 'rec-4', 'rec-5', 'rec-2', 'rec-6']);
    expect(merged.get('rec-2')).toMatchObject({
      title: '录屏 2 更新',
      status: 'draft_ready',
      keyframeCount: 3,
    });
  });

  it('marks discarded attachments without retaining local thumbnails', () => {
    const discarded = markRecordingAttachmentDiscarded({
      type: 'recording',
      sessionId: 'rec-1',
      title: '录屏',
      thumbnailPath: 'frame.png',
      scope: 'fullscreen',
      privacyMode: 'summary',
      status: 'draft_ready',
    });

    expect(discarded.status).toBe('discarded');
    expect(discarded.thumbnailPath).toBeUndefined();
  });
});
