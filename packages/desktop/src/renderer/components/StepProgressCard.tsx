import React from 'react';
import type { AgentEvent } from '@agivar/core';

export function StepProgressCard({ event }: { event: AgentEvent }) {
  const isStart = event.type === 'step-start';
  const isFailed = event.type === 'step-failed';

  return (
    <div className={`border rounded-lg p-3 text-sm ${
      isStart
        ? 'border-border bg-bg-secondary'
        : isFailed
        ? 'border-danger/50 bg-danger/10'
        : 'border-success/50 bg-success/10'
    }`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${
          isStart ? 'bg-accent animate-pulse' : isFailed ? 'bg-danger' : 'bg-success'
        }`} />
        <span className="text-text-secondary font-medium">
          {isStart ? `步骤 ${(event as any).index + 1}` : isFailed ? '步骤失败' : '步骤成功'}
        </span>
      </div>
      {(event as any).step && (
        <div className="mt-1 text-text-primary">
          {(event as any).step.intent}
          <span className="text-text-secondary ml-2 text-xs">
            [{(event as any).step.source}]
          </span>
        </div>
      )}
      {isFailed && (event as any).failure && (
        <div className="mt-1 text-danger text-xs">
          {(event as any).failure.message}
        </div>
      )}
    </div>
  );
}