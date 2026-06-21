import React from 'react';

declare global {
  interface Window {
    agivar: {
      platform: string;
      versions: { node: string; electron: string; chrome: string };
    };
  }
}

export function App() {
  const info = window.agivar;
  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h1>Agivar — Phase 0 PoC</h1>
      <pre>
        {JSON.stringify(info, null, 2)}
      </pre>
      <p>Electron shell loaded. PoC panel will be added in Plan C.</p>
    </div>
  );
}
