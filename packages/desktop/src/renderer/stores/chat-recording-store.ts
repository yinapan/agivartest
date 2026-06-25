import { create } from 'zustand';
import {
  createRecordingAttachmentFromTimeline,
  createRecordingExplanationFromDraftLink,
  requiresManifestConfirmation,
} from '../features/chat-recording/chat-recording-model.js';
import type {
  ProviderPayloadManifestDto,
  RecordingDraftLinkDto,
  RecordingPrivacyModeDto,
  RecordingScopeDto,
  RecordingSessionDto,
  RecordingTimelineDto,
} from '../pages/recording-teach-model.js';
import { getIpcErrorMessage, type IpcResult } from '../pages/workflow-editor-model.js';
import { useChatStore } from './chat-store.js';

export type ChatRecordingPhase =
  | 'idle'
  | 'preflight'
  | 'recording'
  | 'stopping'
  | 'manifesting'
  | 'manifest_ready'
  | 'generating'
  | 'failed';

type StartRecordingInput = {
  scope: RecordingScopeDto;
  privacyMode: RecordingPrivacyModeDto;
  goal?: string;
};

type StopAndGenerateInput = {
  activeSessionId: string;
  content: string;
};

type ChatRecordingStore = {
  phase: ChatRecordingPhase;
  scope: RecordingScopeDto;
  privacyMode: RecordingPrivacyModeDto;
  providerName: string;
  session: RecordingSessionDto | null;
  timeline: RecordingTimelineDto | null;
  manifest: ProviderPayloadManifestDto | null;
  draftLink: RecordingDraftLinkDto | null;
  error: string;
  elapsedSeconds: number;

  startRecording: (input: StartRecordingInput) => Promise<void>;
  stopAndGenerate: (input: StopAndGenerateInput) => Promise<void>;
  confirmManifestAndGenerate: (sessionId: string) => Promise<void>;
  retryGeneration: (sessionId: string) => Promise<void>;
  discardAttachment: (sessionId: string) => Promise<void>;
};

export const useChatRecordingStore = create<ChatRecordingStore>((set, get) => ({
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

  startRecording: async (input) => {
    set({
      phase: 'preflight',
      scope: input.scope,
      privacyMode: input.privacyMode,
      error: '',
    });

    const preflight = await window.agivar.recordingTeach.preflight() as IpcResult<unknown>;
    if (!preflight.ok) {
      set({ phase: 'failed', error: getIpcErrorMessage(preflight) });
      return;
    }

    const started = await window.agivar.recordingTeach.start({
      scope: input.scope,
      privacyMode: input.privacyMode,
      goal: input.goal,
    }) as IpcResult<RecordingSessionDto>;
    if (!started.ok) {
      set({ phase: 'failed', error: getIpcErrorMessage(started) });
      return;
    }

    set({
      phase: 'recording',
      session: started.data,
      error: '',
      elapsedSeconds: 0,
    });
  },

  stopAndGenerate: async (input) => {
    const current = get();
    if (!current.session) {
      set({ phase: 'failed', error: '没有正在录制的 session' });
      return;
    }

    set({ phase: 'stopping', error: '' });
    const stopped = await window.agivar.recordingTeach.stop(current.session.id) as IpcResult<RecordingSessionDto>;
    if (!stopped.ok) {
      set({ phase: 'failed', error: getIpcErrorMessage(stopped) });
      return;
    }

    const timeline = await window.agivar.recordingTeach.getTimeline(stopped.data.id) as IpcResult<RecordingTimelineDto>;
    if (!timeline.ok) {
      set({ phase: 'failed', error: getIpcErrorMessage(timeline) });
      return;
    }

    const attachment = createRecordingAttachmentFromTimeline({
      session: stopped.data,
      timeline: timeline.data,
    });
    useChatStore.getState().addOrUpdateRecordingAttachment(input.activeSessionId, {
      ...attachment,
      title: input.content.trim() || attachment.title,
    });

    set({ phase: 'manifesting', session: stopped.data, timeline: timeline.data });
    const manifest = await window.agivar.recordingTeach.buildManifest(
      stopped.data.id,
      current.providerName,
    ) as IpcResult<ProviderPayloadManifestDto>;
    if (!manifest.ok) {
      useChatStore.getState().addOrUpdateRecordingAttachment(input.activeSessionId, {
        sessionId: stopped.data.id,
        status: 'failed',
      });
      set({ phase: 'failed', error: getIpcErrorMessage(manifest) });
      return;
    }

    set({ manifest: manifest.data });
    if (requiresManifestConfirmation({
      privacyMode: stopped.data.privacyMode,
      includesRawText: manifest.data.containsRawText,
      includesPreciseCoordinates: manifest.data.containsPreciseCoordinates,
    })) {
      useChatStore.getState().addOrUpdateRecordingAttachment(input.activeSessionId, {
        sessionId: stopped.data.id,
        status: 'manifest_ready',
      });
      set({ phase: 'manifest_ready' });
      return;
    }

    await get().confirmManifestAndGenerate(stopped.data.id);
  },

  confirmManifestAndGenerate: async (sessionId) => {
    const current = get();
    if (!current.manifest || !current.session) {
      set({ phase: 'failed', error: 'manifest 不可用' });
      return;
    }
    const chatSessionId = useChatStore.getState().activeSessionId;
    if (!chatSessionId) {
      set({ phase: 'failed', error: '没有活动对话' });
      return;
    }

    set({ phase: 'generating', error: '' });
    useChatStore.getState().addOrUpdateRecordingAttachment(chatSessionId, {
      sessionId,
      status: 'generating',
    });

    const generated = await window.agivar.recordingTeach.generateDraft({
      sessionId,
      manifest: { ...current.manifest, status: 'confirmed' },
    }) as IpcResult<RecordingDraftLinkDto>;
    if (!generated.ok) {
      useChatStore.getState().addOrUpdateRecordingAttachment(chatSessionId, {
        sessionId,
        status: 'failed',
      });
      set({ phase: 'failed', error: getIpcErrorMessage(generated) });
      return;
    }

    const explanation = createRecordingExplanationFromDraftLink(generated.data);
    useChatStore.getState().addOrUpdateRecordingAttachment(chatSessionId, {
      sessionId,
      status: 'draft_ready',
    });
    useChatStore.getState().addRecordingAssistantMessage({
      sessionId: chatSessionId,
      content: explanation.summary,
      explanation,
    });

    set({
      phase: 'idle',
      draftLink: generated.data,
      error: '',
    });
  },

  retryGeneration: async (sessionId) => {
    await get().confirmManifestAndGenerate(sessionId);
  },

  discardAttachment: async (sessionId) => {
    const result = await window.agivar.recordingTeach.discard(sessionId) as IpcResult<unknown>;
    if (!result.ok) {
      set({ phase: 'failed', error: getIpcErrorMessage(result) });
      return;
    }
    const chatSessionId = useChatStore.getState().activeSessionId;
    if (chatSessionId) {
      useChatStore.getState().addOrUpdateRecordingAttachment(chatSessionId, {
        sessionId,
        status: 'discarded',
      });
    }
  },
}));
