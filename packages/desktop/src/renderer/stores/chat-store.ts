import { create } from 'zustand';
import type {
  ChatRecordingAttachment,
  ChatRecordingExplanation,
} from '../features/chat-recording/chat-recording-model.js';

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface ChatStore {
  sessions: Session[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  messagesBySessionId: Record<string, ChatMessage[]>;
  isLoading: boolean;

  loadSessions: (sessions: Session[]) => void;
  createSession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  addRecordingUserMessage: (input: {
    sessionId: string;
    content: string;
    attachment: ChatRecordingAttachment;
  }) => string;
  addRecordingAssistantMessage: (input: {
    sessionId: string;
    content: string;
    explanation: ChatRecordingExplanation;
  }) => string;
  addOrUpdateRecordingAttachment: (
    sessionId: string,
    patch: Partial<ChatRecordingAttachment> & { sessionId: string },
  ) => string;
  setLoading: (loading: boolean) => void;
}

let counter = 0;

export const useChatStore = create<ChatStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  messagesBySessionId: {},
  isLoading: false,

  loadSessions: (sessions) => set({ sessions }),

  createSession: () => {
    const id = `session-${Date.now()}-${++counter}`;
    const session: Session = {
      id, title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: id,
      messages: s.messagesBySessionId[id] ?? [],
      messagesBySessionId: { ...s.messagesBySessionId, [id]: s.messagesBySessionId[id] ?? [] },
    }));
    return id;
  },

  switchSession: (id) => set((s) => ({
    activeSessionId: id,
    messages: s.messagesBySessionId[id] ?? [],
  })),

  deleteSession: (id) => set((s) => {
    const sessions = s.sessions.filter((x) => x.id !== id);
    const { [id]: _deleted, ...messagesBySessionId } = s.messagesBySessionId;
    const activeSessionId = s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId;
    return {
      sessions,
      activeSessionId,
      messagesBySessionId,
      messages: activeSessionId ? (messagesBySessionId[activeSessionId] ?? []) : [],
    };
  }),

  addMessage: (msg) => set((s) => writeSessionMessages(s, msg.sessionId, [
    ...(s.messagesBySessionId[msg.sessionId] ?? []),
    msg,
  ])),

  updateMessage: (id, patch) => set((s) => {
    const sessionId = Object.keys(s.messagesBySessionId).find((key) =>
      s.messagesBySessionId[key].some((message) => message.id === id),
    ) ?? s.activeSessionId;
    if (!sessionId) return s;
    const messages = (s.messagesBySessionId[sessionId] ?? s.messages)
      .map((message) => (message.id === id ? { ...message, ...patch } : message));
    return writeSessionMessages(s, sessionId, messages);
  }),

  addRecordingUserMessage: (input) => {
    const id = `msg-recording-${Date.now()}-${++counter}`;
    useChatStore.getState().addMessage({
      id,
      sessionId: input.sessionId,
      role: 'user',
      content: input.content,
      metadata: { attachments: [input.attachment] },
      createdAt: new Date().toISOString(),
    });
    return id;
  },

  addRecordingAssistantMessage: (input) => {
    const id = `msg-recording-assistant-${Date.now()}-${++counter}`;
    useChatStore.getState().addMessage({
      id,
      sessionId: input.sessionId,
      role: 'assistant',
      content: input.content,
      metadata: { recordingExplanation: input.explanation },
      createdAt: new Date().toISOString(),
    });
    return id;
  },

  addOrUpdateRecordingAttachment: (sessionId, patch) => {
    const state = useChatStore.getState();
    const messages = state.messagesBySessionId[sessionId] ?? [];
    const existingMessage = messages.find((message) =>
      getRecordingAttachments(message).some((attachment) => attachment.sessionId === patch.sessionId),
    );

    if (!existingMessage) {
      const attachment = normalizeAttachmentPatch(patch);
      return state.addRecordingUserMessage({
        sessionId,
        content: attachment.title,
        attachment,
      });
    }

    const nextAttachments = getRecordingAttachments(existingMessage).map((attachment) =>
      attachment.sessionId === patch.sessionId ? normalizeAttachmentPatch({ ...attachment, ...patch }) : attachment,
    );
    state.updateMessage(existingMessage.id, {
      metadata: {
        ...(existingMessage.metadata ?? {}),
        attachments: nextAttachments,
      },
    });
    return existingMessage.id;
  },

  setLoading: (loading) => set({ isLoading: loading }),
}));

function writeSessionMessages(
  state: ChatStore,
  sessionId: string,
  messages: ChatMessage[],
): Partial<ChatStore> {
  const messagesBySessionId = {
    ...state.messagesBySessionId,
    [sessionId]: messages,
  };
  return {
    messagesBySessionId,
    messages: state.activeSessionId === sessionId ? messages : state.messages,
    sessions: state.sessions.map((session) =>
      session.id === sessionId ? { ...session, updatedAt: new Date().toISOString() } : session,
    ),
  };
}

function getRecordingAttachments(message: ChatMessage): ChatRecordingAttachment[] {
  const value = message.metadata?.attachments;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatRecordingAttachment =>
    Boolean(item)
    && typeof item === 'object'
    && (item as { type?: unknown }).type === 'recording'
    && typeof (item as { sessionId?: unknown }).sessionId === 'string',
  );
}

function normalizeAttachmentPatch(
  patch: Partial<ChatRecordingAttachment> & { sessionId: string },
): ChatRecordingAttachment {
  return {
    type: 'recording',
    title: patch.title ?? '录屏',
    scope: patch.scope ?? 'fullscreen',
    privacyMode: patch.privacyMode ?? 'summary',
    status: patch.status ?? 'stopped',
    ...patch,
  };
}
