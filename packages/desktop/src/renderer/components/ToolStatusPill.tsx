import React from 'react';
import type { ChatToolPill } from '../features/chat-recording/chat-recording-model.js';

const KIND_CLASSES: Record<ChatToolPill['kind'], string> = {
  wait: 'bg-violet-500/15 text-violet-200 border-violet-400/30',
  click: 'bg-sky-500/15 text-sky-200 border-sky-400/30',
  type: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30',
  observe: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
  other: 'bg-slate-100 text-slate-500 border-slate-200',
};

export function ToolStatusPill({ pill }: { pill: ChatToolPill }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${KIND_CLASSES[pill.kind]}`}
      title={`${pill.label} / ${pill.status}`}
    >
      <span className="truncate">{pill.label}</span>
    </span>
  );
}
