import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatRecordingStore } from '../src/renderer/stores/chat-recording-store.js';
import { useChatStore } from '../src/renderer/stores/chat-store.js';

describe('chat recording store', () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [],
      activeSessionId: null,
      messages: [],
      messagesBySessionId: {},
      isLoading: false,
    });
    useChatRecordingStore.setState({
      phase: 'idle',
      scope: 'active-window',
      privacyMode: 'summary',
      providerName: 'recording-teaching-provider',
      session: null,
      timeline: null,
      manifest: null,
      draftLink: null,
      error: '',
      elapsedSeconds: 0,
    });
    vi.restoreAllMocks();
  });

  it('preflight failure does not create a recording message', async () => {
    (globalThis as any).window = {
      agivar: {
        recordingTeach: {
          preflight: vi.fn(async () => ({
            ok: false,
            error: { code: 'NO_PERMISSION', message: '权限不足' },
          })),
        },
      },
    };

    await useChatRecordingStore.getState().startRecording({
      scope: 'fullscreen',
      privacyMode: 'summary',
      goal: '播放音乐',
    });

    expect(useChatRecordingStore.getState().phase).toBe('failed');
    expect(useChatRecordingStore.getState().error).toBe('权限不足');
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('stops recording, waits for manifest confirmation, then generates an assistant explanation', async () => {
    const chatSessionId = useChatStore.getState().createSession();
    (globalThis as any).window = {
      agivar: {
        recordingTeach: {
          preflight: vi.fn(async () => ({ ok: true, data: { canRecord: true, warnings: [], artifactBytes: 0 } })),
          start: vi.fn(async () => ({
            ok: true,
            data: {
              id: 'rec-1',
              scope: 'active-window',
              privacyMode: 'detailed',
              status: 'recording',
              goal: '播放音乐',
              artifactDir: 'artifact://rec-1',
              createdAt: '2026-06-25T00:00:00.000Z',
              updatedAt: '2026-06-25T00:00:00.000Z',
            },
          })),
          stop: vi.fn(async () => ({
            ok: true,
            data: {
              id: 'rec-1',
              scope: 'active-window',
              privacyMode: 'detailed',
              status: 'ready',
              goal: '播放音乐',
              artifactDir: 'artifact://rec-1',
              createdAt: '2026-06-25T00:00:00.000Z',
              updatedAt: '2026-06-25T00:00:02.000Z',
            },
          })),
          getTimeline: vi.fn(async () => ({
            ok: true,
            data: {
              sessionId: 'rec-1',
              goal: '播放音乐',
              notes: '',
              scope: 'active-window',
              privacyMode: 'detailed',
              startedAt: '2026-06-25T00:00:00.000Z',
              stoppedAt: '2026-06-25T00:00:02.000Z',
              keyframes: [{ id: 'kf-1', imagePath: 'frame.png', status: 'active' }],
              events: [],
              context: [],
              warnings: [],
            },
          })),
          buildManifest: vi.fn(async () => ({
            ok: true,
            data: {
              id: 'manifest-1',
              sessionId: 'rec-1',
              providerName: 'recording-teaching-provider',
              selectedArtifactIds: ['kf-1'],
              redactionPolicy: {},
              containsRawText: false,
              containsPreciseCoordinates: false,
              estimatedBytes: 100,
              createdAt: '2026-06-25T00:00:03.000Z',
              status: 'pending',
            },
          })),
          generateDraft: vi.fn(async () => ({
            ok: true,
            data: {
              id: 'draft-1',
              sessionId: 'rec-1',
              status: 'draft_ready',
              draftJson: {
                appName: 'QQ Music',
                platform: 'desktop',
                topic: '播放音乐',
                summary: '播放音乐。',
                initialState: 'QQ Music 打开。',
                steps: [{ id: 'step-1', intent: '点击播放', targetHint: '播放按钮', riskLevel: 'low' }],
                riskLevel: 'low',
                sourceType: 'recording',
              },
              evidence: [{ stepId: 'step-1', artifactIds: ['kf-1'] }],
              createdAt: '2026-06-25T00:00:04.000Z',
              updatedAt: '2026-06-25T00:00:04.000Z',
            },
          })),
        },
      },
    };

    await useChatRecordingStore.getState().startRecording({
      scope: 'active-window',
      privacyMode: 'detailed',
      goal: '播放音乐',
    });
    await useChatRecordingStore.getState().stopAndGenerate({
      activeSessionId: chatSessionId,
      content: '我录制一下',
    });

    expect(useChatRecordingStore.getState().phase).toBe('manifest_ready');
    expect(useChatStore.getState().messages[0].metadata?.attachments).toMatchObject([{
      sessionId: 'rec-1',
      status: 'manifest_ready',
    }]);

    await useChatRecordingStore.getState().confirmManifestAndGenerate('rec-1');

    expect(useChatRecordingStore.getState().phase).toBe('idle');
    expect(useChatStore.getState().messages).toHaveLength(2);
    expect(useChatStore.getState().messages[0].metadata?.attachments).toMatchObject([{
      sessionId: 'rec-1',
      status: 'draft_ready',
    }]);
    expect(useChatStore.getState().messages[1].metadata?.recordingExplanation).toMatchObject({
      sessionId: 'rec-1',
      steps: [{ title: '点击播放' }],
    });
  });
});
