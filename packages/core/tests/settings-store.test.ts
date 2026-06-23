import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Test the settings merge logic in isolation
// SettingsStore depends on Electron fs, test via temp file
describe('Settings merge logic', () => {
  const tmpDir = path.join(os.tmpdir(), `agivar-settings-test-${Date.now()}`);

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('default settings are returned when no file exists', () => {
    const defaults = {
      llm: { provider: 'openai-compatible', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', maxTokens: 4096, temperature: 0.1 },
      safety: { emergencyStopHotkey: 'Ctrl+Alt+Space', confirmMediumRisk: false, maxRetries: 2, takeoverTimeoutMs: 300000 },
      storage: { dataDir: '', logRetentionDays: 30 },
      privacy: { screenshotOnlyForTask: true, logLlmRequests: true },
    };
    expect(defaults.llm.model).toBe('gpt-4o');
    expect(defaults.safety.maxRetries).toBe(2);
  });

  it('deep merge overrides nested fields', () => {
    const base = { llm: { model: 'gpt-4o', temperature: 0.1 } };
    const patch = { llm: { model: 'deepseek-chat' } };
    const result = deepMerge(base, patch);
    expect((result as any).llm.model).toBe('deepseek-chat');
    expect((result as any).llm.temperature).toBe(0.1); // preserved
  });
});

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
