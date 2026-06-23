import { create } from 'zustand';

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
  isLoading: boolean;

  loadSessions: (sessions: Session[]) => void;
  createSession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  setLoading: (loading: boolean) => void;
}

let counter = 0;

export const useChatStore = create<ChatStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
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
      messages: [],
    }));
    return id;
  },

  switchSession: (id) => set({ activeSessionId: id }),

  deleteSession: (id) => set((s) => {
    const sessions = s.sessions.filter((x) => x.id !== id);
    return {
      sessions,
      activeSessionId: s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId,
      messages: s.activeSessionId === id ? [] : s.messages,
    };
  }),

  addMessage: (msg) => set((s) => ({
    messages: [...s.messages, msg],
    sessions: s.sessions.map((ss) =>
      ss.id === msg.sessionId ? { ...ss, updatedAt: new Date().toISOString() } : ss,
    ),
  })),

  updateMessage: (id, patch) => set((s) => ({
    messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  })),

  setLoading: (loading) => set({ isLoading: loading }),
}));
