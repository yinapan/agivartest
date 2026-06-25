import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '../src/renderer/stores/chat-store.js';
import type { ChatRecordingAttachment } from '../src/renderer/features/chat-recording/chat-recording-model.js';

const attachment: ChatRecordingAttachment = {
  type: 'recording',
  sessionId: 'rec-1',
  title: '录屏',
  scope: 'fullscreen',
  privacyMode: 'summary',
  status: 'recording',
};

describe('chat store phase4d recording helpers', () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [],
      activeSessionId: null,
      messages: [],
      messagesBySessionId: {},
      isLoading: false,
    });
  });

  it('keeps messages isolated per chat session while exposing active messages', () => {
    const first = useChatStore.getState().createSession();
    useChatStore.getState().addMessage({
      id: 'm1',
      sessionId: first,
      role: 'user',
      content: 'first',
      createdAt: '2026-06-25T00:00:00.000Z',
    });

    const second = useChatStore.getState().createSession();
    useChatStore.getState().addMessage({
      id: 'm2',
      sessionId: second,
      role: 'user',
      content: 'second',
      createdAt: '2026-06-25T00:00:01.000Z',
    });

    expect(useChatStore.getState().messages.map((msg) => msg.content)).toEqual(['second']);

    useChatStore.getState().switchSession(first);

    expect(useChatStore.getState().messages.map((msg) => msg.content)).toEqual(['first']);
    expect(useChatStore.getState().messagesBySessionId[second].map((msg) => msg.content)).toEqual(['second']);
  });

  it('adds and updates one recording attachment message per recording session', () => {
    const chatSessionId = useChatStore.getState().createSession();

    const messageId = useChatStore.getState().addOrUpdateRecordingAttachment(chatSessionId, attachment);
    const updatedId = useChatStore.getState().addOrUpdateRecordingAttachment(chatSessionId, {
      sessionId: 'rec-1',
      status: 'draft_ready',
      keyframeCount: 3,
    });

    const state = useChatStore.getState();
    expect(updatedId).toBe(messageId);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].metadata?.attachments).toMatchObject([{
      sessionId: 'rec-1',
      status: 'draft_ready',
      keyframeCount: 3,
    }]);
  });

  it('adds assistant recording explanations to the active session', () => {
    const chatSessionId = useChatStore.getState().createSession();

    const messageId = useChatStore.getState().addRecordingAssistantMessage({
      sessionId: chatSessionId,
      content: '解析完成',
      explanation: {
        type: 'recording-explanation',
        sessionId: 'rec-1',
        summary: '解析完成',
        steps: [],
        warnings: [],
      },
    });

    const message = useChatStore.getState().messages.find((item) => item.id === messageId);
    expect(message).toMatchObject({
      role: 'assistant',
      content: '解析完成',
      metadata: {
        recordingExplanation: {
          sessionId: 'rec-1',
        },
      },
    });
  });
});
