import React from 'react';
import type { AgentEvent } from '@agivar/core';

export function TakeoverCard({ event }: { event: AgentEvent }) {
  const handleResume = () => window.agivar.agent.resumeTakeover();
  const handleAbort = () => window.agivar.agent.abort();

  return (
    <div className="border border-warning/50 bg-warning/10 rounded-lg p-4">
      <div className="flex items-center gap-2 text-warning font-medium">
        <span>⚠</span>
        <span>需要人工接管</span>
      </div>
      <div className="mt-1 text-text-secondary text-sm">
        {(event as any).reason ?? '需要您的输入'}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleResume}
          className="px-3 py-1 bg-success text-white rounded text-sm hover:opacity-80"
        >
          继续
        </button>
        <button
          onClick={handleAbort}
          className="px-3 py-1 bg-danger text-white rounded text-sm hover:opacity-80"
        >
          放弃
        </button>
      </div>
    </div>
  );
}