import React from 'react';
import type { ChatRecordingExplanation } from '../features/chat-recording/chat-recording-model.js';
import { ToolStatusPill } from './ToolStatusPill.js';

export function RecordingStepList({ explanation }: { explanation: ChatRecordingExplanation }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="text-sm text-slate-800">{explanation.summary}</div>
      {explanation.steps.map((step, index) => (
        <div key={step.id} className="border-l border-slate-200 pl-3">
          <div className="text-sm font-semibold text-slate-800">
            {index + 1}. {step.title}
          </div>
          <div className="mt-1 text-sm text-slate-600">{step.instruction}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {step.toolPills.map((pill, pillIndex) => (
              <ToolStatusPill key={`${step.id}-${pillIndex}`} pill={pill} />
            ))}
            {step.evidenceIds.length > 0 && (
              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-500">
                {step.evidenceIds.length} evidence
              </span>
            )}
          </div>
        </div>
      ))}
      {explanation.warnings.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {explanation.warnings.join('; ')}
        </div>
      )}
    </div>
  );
}
