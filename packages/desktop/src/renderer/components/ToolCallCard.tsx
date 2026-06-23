import React from 'react';

export function ToolCallCard({ toolCall }: { toolCall: any }) {
  return (
    <div className="bg-bg-tertiary rounded-lg p-2 text-xs">
      <div className="text-accent font-medium">{toolCall.function?.name ?? toolCall.name}</div>
      <div className="text-text-secondary mt-1 font-mono">
        {typeof toolCall.function?.arguments === 'string'
          ? toolCall.function.arguments
          : JSON.stringify(toolCall.function?.arguments ?? toolCall.args ?? {}, null, 1)}
      </div>
    </div>
  );
}