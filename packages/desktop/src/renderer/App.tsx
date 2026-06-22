import React, { useState, useCallback } from 'react';

type Status = 'idle' | 'running' | 'passed' | 'failed';
type SafetyLevel = 'direct' | 'confirm' | 'confirm-countdown';

interface PocItem {
  key: string;
  label: string;
  safety: SafetyLevel;
  safetyNote?: string;
  run: () => Promise<any>;
}

declare global {
  interface Window {
    agivar: any;
  }
}

export function App() {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [results, setResults] = useState<Record<string, any>>({});

  const updateStatus = (key: string, status: Status, result?: any) => {
    setStatuses((prev) => ({ ...prev, [key]: status }));
    if (result !== undefined) setResults((prev) => ({ ...prev, [key]: result }));
  };

  const pocs: PocItem[] = [
    {
      key: 'env',
      label: 'Environment Detection',
      safety: 'direct',
      run: async () => {
        const info = window.agivar;
        return { platform: info.platform, versions: info.versions };
      },
    },
    {
      key: 'screenshot',
      label: 'Screenshot',
      safety: 'direct',
      run: () => window.agivar.screenshot.captureScreen(),
    },
    {
      key: 'uia',
      label: 'UIA Read',
      safety: 'direct',
      run: () => window.agivar.screenshot.listWindows().then((r: any) => {
        if (r.ok && r.data.length > 0) {
          return window.agivar.uia.getUiTree(r.data[0].hwnd, { maxDepth: 3 });
        }
        return r;
      }),
    },
    {
      key: 'playwright',
      label: 'Playwright Browser',
      safety: 'direct',
      safetyNote: 'Will launch a browser window',
      run: () => window.agivar.browser.launch({ headless: true }),
    },
    {
      key: 'input',
      label: 'Keyboard/Mouse Input',
      safety: 'confirm-countdown',
      safetyNote: 'Will control your keyboard and mouse. Press Ctrl+Alt+Space to stop.',
      run: () => window.agivar.input.typeText('Agivar Phase 0 test'),
    },
    {
      key: 'recorder',
      label: 'Screen Recording',
      safety: 'confirm',
      safetyNote: 'Will record your screen for 3 seconds.',
      run: async () => {
        const r = await window.agivar.recorder.start({
          backend: 'wgc', fps: 5, outputDir: 'tests/output/ui-recorder-test',
        });
        if (!r.ok) return r;
        await new Promise((res) => setTimeout(res, 3000));
        return window.agivar.recorder.stop(r.data.sessionId);
      },
    },
  ];

  const handleRun = useCallback(async (poc: PocItem) => {
    if (poc.safety === 'confirm' || poc.safety === 'confirm-countdown') {
      const msg = poc.safetyNote
        ? `${poc.safetyNote}\n\nProceed?`
        : 'This action will interact with your desktop. Proceed?';
      if (!confirm(msg)) return;
    }

    updateStatus(poc.key, 'running');
    try {
      const result = await poc.run();
      const ok = result?.ok !== false;
      updateStatus(poc.key, ok ? 'passed' : 'failed', result);
    } catch (err: any) {
      updateStatus(poc.key, 'failed', { error: err.message });
    }
  }, []);

  const statusColor = (s: Status) =>
    s === 'passed' ? '#28a745' : s === 'failed' ? '#dc3545' : s === 'running' ? '#007bff' : '#6c757d';

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, maxWidth: 800 }}>
      <h1>Agivar Phase 0 — PoC Panel</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8 }}>Verification</th>
            <th style={{ width: 100 }}>Action</th>
            <th style={{ width: 80 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {pocs.map((poc) => (
            <tr key={poc.key} style={{ borderTop: '1px solid #ddd' }}>
              <td style={{ padding: 8 }}>
                {poc.label}
                {poc.safetyNote && (
                  <div style={{ fontSize: 11, color: '#999' }}>{poc.safetyNote}</div>
                )}
              </td>
              <td style={{ textAlign: 'center' }}>
                <button
                  onClick={() => handleRun(poc)}
                  disabled={statuses[poc.key] === 'running'}
                  style={{ padding: '4px 12px', cursor: 'pointer' }}
                >
                  Run
                </button>
              </td>
              <td style={{ textAlign: 'center', color: statusColor(statuses[poc.key] || 'idle') }}>
                {(statuses[poc.key] || 'idle').toUpperCase()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {Object.keys(results).length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>Results</h3>
          <pre style={{ background: '#f5f5f5', padding: 12, overflow: 'auto', maxHeight: 400 }}>
            {JSON.stringify(results, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
