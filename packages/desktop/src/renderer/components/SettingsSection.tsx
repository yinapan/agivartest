import React from 'react';

export function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg p-4 bg-bg-secondary">
      <h2 className="text-sm font-semibold text-text-primary mb-3">{title}</h2>
      {children}
    </div>
  );
}
