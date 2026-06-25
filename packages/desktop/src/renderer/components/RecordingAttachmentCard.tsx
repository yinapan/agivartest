import React from 'react';
import type { ChatRecordingAttachment } from '../features/chat-recording/chat-recording-model.js';

const STATUS_LABELS: Record<ChatRecordingAttachment['status'], string> = {
  recording: '录制中',
  stopped: '已停止',
  manifesting: '整理中',
  manifest_ready: '待确认',
  generating: '生成中',
  draft_ready: '已解析',
  failed: '失败',
  discarded: '已删除',
};

export function RecordingAttachmentCard({
  attachment,
  onRetry,
  onDiscard,
  onConfirmManifest,
}: {
  attachment: ChatRecordingAttachment;
  onRetry?: (sessionId: string) => void;
  onDiscard?: (sessionId: string) => void;
  onConfirmManifest?: (sessionId: string) => void;
}) {
  const showThumbnail = attachment.status !== 'discarded' && Boolean(attachment.thumbnailPath);
  return (
    <div className="mt-2 flex w-[270px] max-w-full items-center gap-3 rounded-lg border border-slate-200 bg-white p-2 text-left text-slate-800 shadow-sm">
      <div className="h-12 w-14 shrink-0 overflow-hidden rounded-md bg-slate-100">
        {showThumbnail ? (
          <img
            src={attachment.thumbnailPath}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
            REC
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{attachment.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {typeof attachment.durationSeconds === 'number' && <span>{attachment.durationSeconds}s</span>}
          <span>{attachment.scope}</span>
          {typeof attachment.keyframeCount === 'number' && <span>{attachment.keyframeCount} frames</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {STATUS_LABELS[attachment.status]}
          </span>
          {attachment.status === 'manifest_ready' && onConfirmManifest && (
            <button
              type="button"
              onClick={() => onConfirmManifest(attachment.sessionId)}
              className="rounded-full bg-accent px-2 py-0.5 text-xs text-white"
            >
              确认并生成
            </button>
          )}
          {attachment.status === 'failed' && onRetry && (
            <button
              type="button"
              onClick={() => onRetry(attachment.sessionId)}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
            >
              重试
            </button>
          )}
          {attachment.status !== 'discarded' && onDiscard && (
            <button
              type="button"
              onClick={() => onDiscard(attachment.sessionId)}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
