import React from 'react';
import { useChatStore } from '../stores/chat-store.js';

export function Sidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeSessionId);
  const createSession = useChatStore((s) => s.createSession);
  const switchSession = useChatStore((s) => s.switchSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 text-slate-900">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
            本
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">本地用户</div>
            <div className="truncate text-xs text-slate-500">UID: local-****</div>
            <div className="text-xs text-slate-500">积分: --</div>
          </div>
          <button type="button" className="ml-auto rounded-full px-2 py-1 text-slate-500 hover:bg-slate-200">
            ⚙
          </button>
        </div>
      </div>
      <div className="p-3">
        <button
          onClick={createSession}
          className="w-full rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
        >
          + 新对话
        </button>
      </div>
      <div className="px-4 pb-2 text-xs font-semibold text-slate-400">最近</div>
      <div className="flex-1 overflow-y-auto px-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => switchSession(s.id)}
            className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm
              ${s.id === activeId ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <span className="truncate flex-1">{s.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
              className="ml-2 text-slate-400 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="p-4 text-center text-xs text-slate-400">暂无对话</div>
        )}
      </div>
    </aside>
  );
}
