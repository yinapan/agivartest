import React from 'react';
import type { ChatMessage } from '../stores/chat-store.js';
import { ToolCallCard } from './ToolCallCard.js';
import { RecordingAttachmentCard } from './RecordingAttachmentCard.js';
import { RecordingStepList } from './RecordingStepList.js';
import type {
  ChatRecordingAttachment,
  ChatRecordingExplanation,
} from '../features/chat-recording/chat-recording-model.js';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const attachments = getRecordingAttachments(message.metadata?.attachments);
  const explanation = getRecordingExplanation(message.metadata?.recordingExplanation);
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm ${
        isUser
          ? 'bg-slate-100 text-slate-800 rounded-br-md'
          : 'text-slate-800'
      }`}>
        <div className="whitespace-pre-wrap">{message.content}</div>
        {attachments.length > 0 && (
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <RecordingAttachmentCard key={attachment.sessionId} attachment={attachment} />
            ))}
          </div>
        )}
        {explanation && <RecordingStepList explanation={explanation} />}
        {message.metadata?.toolCalls && (
          <div className="mt-2 space-y-1">
            {(message.metadata.toolCalls as any[]).map((tc, i) => (
              <ToolCallCard key={i} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getRecordingAttachments(value: unknown): ChatRecordingAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatRecordingAttachment =>
    Boolean(item)
    && typeof item === 'object'
    && (item as { type?: unknown }).type === 'recording'
    && typeof (item as { sessionId?: unknown }).sessionId === 'string'
    && typeof (item as { title?: unknown }).title === 'string',
  );
}

function getRecordingExplanation(value: unknown): ChatRecordingExplanation | null {
  if (!value || typeof value !== 'object') return null;
  const explanation = value as ChatRecordingExplanation;
  if (explanation.type !== 'recording-explanation' || !Array.isArray(explanation.steps)) return null;
  return explanation;
}
