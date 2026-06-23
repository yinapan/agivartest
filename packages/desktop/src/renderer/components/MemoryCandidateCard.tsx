import React from 'react';
import type { AgentEvent } from '@agivar/core';

export function MemoryCandidateCard({ event }: { event: AgentEvent }) {
  const candidates = (event as any).candidates ?? [];

  const handleSelect = (memoryId: string) => {
    window.agivar.agent.selectMemory(memoryId);
  };

  return (
    <div className="border border-border bg-bg-secondary rounded-lg p-3">
      <div className="text-text-secondary text-sm mb-2">找到相关流程，请选择：</div>
      <div className="space-y-2">
        {candidates.map((c: any) => (
          <button
            key={c.memory.id}
            onClick={() => handleSelect(c.memory.id)}
            className="w-full text-left p-2 rounded bg-bg-tertiary hover:bg-bg-tertiary/80 transition-colors"
          >
            <div className="text-text-primary text-sm font-medium">{c.memory.summary}</div>
            <div className="text-text-secondary text-xs mt-0.5">
              {c.memory.appName} · 匹配度: {(c.score * 100).toFixed(0)}%
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}