import React, { useState, useCallback } from 'react';
import { useChatStore } from '../stores/chat-store.js';
import { useChatRecordingStore } from '../stores/chat-recording-store.js';
import { useTaskStore } from '../stores/task-store.js';

export function InputBar() {
  const [text, setText] = useState('');
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const addMessage = useChatStore((s) => s.addMessage);
  const setLoading = useChatStore((s) => s.setLoading);
  const isRunning = useTaskStore((s) => s.isRunning);
  const startTask = useTaskStore((s) => s.startTask);
  const recordingPhase = useChatRecordingStore((s) => s.phase);
  const recordingSession = useChatRecordingStore((s) => s.session);
  const recordingError = useChatRecordingStore((s) => s.error);
  const startRecording = useChatRecordingStore((s) => s.startRecording);
  const stopAndGenerate = useChatRecordingStore((s) => s.stopAndGenerate);
  const confirmManifestAndGenerate = useChatRecordingStore((s) => s.confirmManifestAndGenerate);
  const recordingBusy = recordingPhase === 'preflight'
    || recordingPhase === 'stopping'
    || recordingPhase === 'manifesting'
    || recordingPhase === 'generating'
    || recordingPhase === 'manifest_ready';
  const sendDisabled = !text.trim() || isRunning || recordingBusy;

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !activeSessionId || isRunning || recordingBusy) return;
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
  }, [text, activeSessionId, isRunning, recordingBusy]);

  const handleRecording = useCallback(async () => {
    if (!activeSessionId) return;
    const trimmed = text.trim();
    if (recordingPhase === 'recording') {
      await stopAndGenerate({
        activeSessionId,
        content: trimmed || '我录制了一段操作',
      });
      return;
    }
    if (recordingPhase === 'manifest_ready' && recordingSession) {
      await confirmManifestAndGenerate(recordingSession.id);
      return;
    }
    if (recordingBusy) return;
    await startRecording({
      scope: 'active-window',
      privacyMode: 'summary',
      goal: trimmed || undefined,
    });
  }, [
    activeSessionId,
    confirmManifestAndGenerate,
    recordingBusy,
    recordingPhase,
    recordingSession,
    startRecording,
    stopAndGenerate,
    text,
  ]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="bg-white px-8 pb-5 pt-2">
      <div className="mx-auto max-w-[920px] rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息......"
          rows={2}
          className="w-full resize-none bg-transparent px-1 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          disabled={isRunning}
        />
        {recordingError && (
          <div className="mt-1 text-xs text-danger">{recordingError}</div>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button type="button" className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500">
              任务模式
            </button>
            <button type="button" className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500">
              Fast 模型
            </button>
            <button
              type="button"
              onClick={handleRecording}
              disabled={recordingBusy && recordingPhase !== 'manifest_ready'}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700 disabled:opacity-40"
            >
              {recordingPhase === 'recording'
                ? '停止录屏'
                : recordingPhase === 'manifest_ready'
                  ? '确认并生成'
                  : '录屏'}
            </button>
            <button type="button" className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500">
              图片
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500">
              语音
            </button>
            <button
              onClick={handleSend}
              disabled={sendDisabled}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
