import React, { useState, useCallback } from 'react';
import { useChatStore } from '../stores/chat-store.js';
import { useTaskStore } from '../stores/task-store.js';

export function InputBar() {
  const [text, setText] = useState('');
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const addMessage = useChatStore((s) => s.addMessage);
  const setLoading = useChatStore((s) => s.setLoading);
  const isRunning = useTaskStore((s) => s.isRunning);
  const startTask = useTaskStore((s) => s.startTask);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !activeSessionId || isRunning) return;
    setText('');

    const msgId = `msg-${Date.now()}`;
    addMessage({
      id: msgId, sessionId: activeSessionId,
      role: 'user', content: trimmed,
      createdAt: new Date().toISOString(),
    });

    setLoading(true);
    const taskRunId = `task-${Date.now()}`;
    startTask(taskRunId, trimmed);

    try {
      const result = await window.agivar.agent.runTask(trimmed, activeSessionId);
      if (!result?.ok) throw new Error(result?.error?.message ?? 'Task failed');
    } catch (err: any) {
      addMessage({
        id: `msg-err-${Date.now()}`, sessionId: activeSessionId,
        role: 'system', content: `错误: ${err.message}`,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [text, activeSessionId, isRunning]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="border-t border-border p-3 bg-bg-secondary">
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入任务描述... (Enter 发送, Shift+Enter 换行)"
          rows={1}
          className="flex-1 bg-bg-primary text-text-primary rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-accent text-sm"
          disabled={isRunning}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isRunning}
          className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
        >
          发送
        </button>
      </div>
    </div>
  );
}
