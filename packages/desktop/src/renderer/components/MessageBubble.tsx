import React from 'react';
import type { ChatMessage } from '../stores/chat-store.js';
import { ToolCallCard } from './ToolCallCard.js';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-xl px-4 py-2 text-sm ${
        isUser
          ? 'bg-accent text-white rounded-br-sm'
          : 'bg-bg-secondary text-text-primary rounded-bl-sm border border-border'
      }`}>
        <div className="whitespace-pre-wrap">{message.content}</div>
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