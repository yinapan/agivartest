import React, { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chat-store.js';
import { MessageBubble } from './MessageBubble.js';
import { ToolCallCard } from './ToolCallCard.js';
import { StepProgressCard } from './StepProgressCard.js';
import { TakeoverCard } from './TakeoverCard.js';
import { MemoryCandidateCard } from './MemoryCandidateCard.js';
import { TaskSummaryCard } from './TaskSummaryCard.js';
import { useTaskStore } from '../stores/task-store.js';
import type { AgentEvent } from '@agivar/core';

const EMPTY_TASK_EVENTS: AgentEvent[] = [];

export function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);
  const taskEvents = useTaskStore((s) => s.currentTask?.events ?? EMPTY_TASK_EVENTS);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, taskEvents]);

  return (
    <div className="flex-1 overflow-y-auto bg-white px-8 py-8">
      <div className="mx-auto max-w-[920px] space-y-5">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {taskEvents.map((event, i) => {
          const key = `${(event as any).taskRunId}-${i}`;
          switch (event.type) {
            case 'step-start':
            case 'step-result':
            case 'step-failed':
              return <StepProgressCard key={key} event={event} />;
            case 'takeover-required':
              return <TakeoverCard key={key} event={event} />;
            case 'memory-candidates':
              return <MemoryCandidateCard key={key} event={event} />;
            case 'task-complete':
            case 'task-failed':
              return <TaskSummaryCard key={key} event={event} />;
            default:
              return null;
          }
        })}

        {isLoading && (
          <div className="animate-pulse text-sm text-slate-400">思考中...</div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
