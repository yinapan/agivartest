import React from 'react';
import { useChatStore } from '../stores/chat-store.js';

export function Sidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeSessionId);
  const createSession = useChatStore((s) => s.createSession);
  const switchSession = useChatStore((s) => s.switchSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  return (
    <div className="w-60 bg-bg-secondary border-r border-border flex flex-col h-full">
      <div className="p-3">
        <button
          onClick={createSession}
          className="w-full py-2 px-3 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
        >
          + 新对话
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => switchSession(s.id)}
            className={`px-3 py-2 cursor-pointer text-sm flex justify-between items-center group
              ${s.id === activeId ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary/50'}`}
          >
            <span className="truncate flex-1">{s.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
              className="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-danger ml-2 transition-opacity"
            >
              ×
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="p-4 text-text-secondary text-xs text-center">暂无对话</div>
        )}
      </div>
    </div>
  );
}
