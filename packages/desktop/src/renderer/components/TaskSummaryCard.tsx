import React from 'react';
import type { AgentEvent } from '@agivar/core';

export function TaskSummaryCard({ event }: { event: AgentEvent }) {
  const isSuccess = event.type === 'task-complete';

  return (
    <div className={`border rounded-lg p-4 text-center ${
      isSuccess ? 'border-success/50 bg-success/10' : 'border-danger/50 bg-danger/10'
    }`}>
      <div className={`text-lg font-medium ${isSuccess ? 'text-success' : 'text-danger'}`}>
        {isSuccess ? '任务完成' : '任务失败'}
      </div>
      <div className="mt-1 text-text-secondary text-sm">
        {isSuccess ? (event as any).summary : (event as any).diagnosis}
      </div>
    </div>
  );
}