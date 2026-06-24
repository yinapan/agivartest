import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as net from 'node:net';
import { createMainWindow, getMainWindow } from './windows.js';
import { registerIpcHandlers, setAgentService, setMemoryStore, setRecordingStore, setRecordingTeachDeps, setSettingsStore } from './ipc.js';
import { GlobalHotkeyAdapter } from './global-hotkey.js';
import { CredentialStore } from './credential-store.js';
import { SettingsStore } from './settings-store.js';
import {
  AgentService,
  MemoryStore,
  RecordingStore,
  AbortManager,
  getDatabase,
  OpenAIClient,
} from '@agivar/core';
import type { ToolAdapters } from '@agivar/core';
import { screenshot, uia, input, browser, recorder } from '@agivar/core';
import { scanRecordingKeyframeFiles } from './recording-teach-ipc.js';

let agentService: AgentService | null = null;
let globalHotkey: GlobalHotkeyAdapter | null = null;

function getDataDir(): string {
  return process.env.AGIVAR_DATA_DIR ?? path.join(app.getAppPath(), '.agivar-dev');
}

function ensureDataDir(dataDir: string): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

app.whenReady().then(async () => {
  const dataDir = getDataDir();
  ensureDataDir(dataDir);
  const db = getDatabase(path.join(dataDir, 'agivar.db'));
  const memoryStore = new MemoryStore(db);
  const recordingStore = new RecordingStore(db);
  const abortManager = new AbortManager();

  const settingsStore = new SettingsStore(dataDir);
  const settings = settingsStore.load();

  const credentialStore = new CredentialStore(dataDir);
  const apiKey = credentialStore.getApiKey();

  if (!apiKey) {
    console.warn('[main] No API key configured — LLM features disabled');
  }

  const llm = new OpenAIClient({
    apiKey: apiKey ?? '',
    model: settings.llm.model,
    baseURL: settings.llm.baseURL,
  });

  const tools: ToolAdapters = {
    browser: {
      clickElement: browser.clickElement,
      fillInput: browser.fillInput,
      navigateTo: browser.navigateTo,
      getPageText: browser.getPageText,
    },
    uia: {
      invokeElement: uia.invokeElement,
      findElement: uia.findElement,
      setElementValue: uia.setElementValue,
      getElementValue: uia.getElementValue,
      getUiTree: uia.getUiTree,
    },
    input: {
      clickPoint: input.clickPoint,
      typeText: input.typeText,
      pressKeys: input.pressKeys,
      scroll: input.scroll,
      releaseAllKeys: input.releaseAllKeys,
    },
    screenshot: {
      captureScreen: screenshot.captureScreen,
      captureWindow: screenshot.captureWindow,
      getActiveWindow: screenshot.getActiveWindow,
    },
    programmatic: {
      readFile: async (p, scope) => {
        throw new Error('readFile not implemented in desktop adapter');
      },
      copyFile: async (s, t, scope) => {
        throw new Error('copyFile not implemented in desktop adapter');
      },
      readTable: async (p, r, scope) => {
        throw new Error('readTable not implemented in desktop adapter');
      },
    },
  };

  agentService = new AgentService({ db, llm, tools, abortManager, memoryStore });
  globalHotkey = new GlobalHotkeyAdapter(abortManager);

  registerIpcHandlers();
  setAgentService(agentService);
  setMemoryStore(memoryStore);
  setRecordingStore(recordingStore);
  setRecordingTeachDeps({
    recorder,
    screenshot,
    frameScanner: scanRecordingKeyframeFiles,
    artifactRoot: path.join(dataDir, 'recordings'),
  });
  setSettingsStore(settingsStore);

  wireAgentEvents(agentService, settingsStore, credentialStore, globalHotkey);

  createMainWindow();
}).catch((err) => {
  console.error('[main] Failed to initialize app:', err);
  app.quit();
});

const SETTINGS_ALLOWLIST = new Set([
  'llm.model',
  'llm.baseURL',
  'llm.maxTokens',
  'llm.temperature',
  'safety.emergencyStopHotkey',
  'safety.confirmMediumRisk',
  'safety.maxRetries',
  'safety.takeoverTimeoutMs',
  'storage.logRetentionDays',
  'privacy.screenshotOnlyForTask',
  'privacy.logLlmRequests',
]);

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

function isSafeBaseURL(raw: string): boolean {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 0) return false;
    if (parts[0] === 10) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
  }
  if (ipVersion === 6) {
    return false;
  }
  return true;
}

const VALID_MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.\-:@]{0,127}$/;
const VALID_HOTKEY_PATTERN = /^[A-Za-z]+(\+[A-Za-z]+){0,3}$/;

function validateSettingsPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;

    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const sub = v as Record<string, unknown>;
      for (const [sk, sv] of Object.entries(sub)) {
        const fullKey = `${k}.${sk}`;
        if (!SETTINGS_ALLOWLIST.has(fullKey)) continue;
        const valid = validateSettingValue(fullKey, sv);
        if (valid !== undefined) {
          if (!safe[k]) safe[k] = {};
          (safe[k] as Record<string, unknown>)[sk] = valid;
        }
      }
    }
  }

  return safe;
}

function validateSettingValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;

  switch (key) {
    case 'llm.baseURL':
      if (typeof value === 'string' && isSafeBaseURL(value)) return value;
      return undefined;
    case 'llm.model':
      if (typeof value === 'string' && VALID_MODEL_PATTERN.test(value)) return value;
      return undefined;
    case 'llm.maxTokens':
      if (typeof value === 'number' && value >= 256 && value <= 131072) return value;
      return undefined;
    case 'llm.temperature':
      if (typeof value === 'number' && value >= 0 && value <= 2) return value;
      return undefined;
    case 'safety.emergencyStopHotkey':
      if (typeof value === 'string' && VALID_HOTKEY_PATTERN.test(value)) return value;
      return undefined;
    case 'safety.maxRetries':
      if (typeof value === 'number' && value >= 0 && value <= 10) return value;
      return undefined;
    case 'safety.takeoverTimeoutMs':
      if (typeof value === 'number' && value >= 5000 && value <= 3600000) return value;
      return undefined;
    case 'safety.confirmMediumRisk':
    case 'privacy.screenshotOnlyForTask':
    case 'privacy.logLlmRequests':
      if (typeof value === 'boolean') return value;
      return undefined;
    case 'storage.logRetentionDays':
      if (typeof value === 'number' && value >= 1 && value <= 365) return value;
      return undefined;
  }

  return undefined;
}

function wireAgentEvents(
  agent: AgentService,
  settingsStore: SettingsStore,
  credentialStore: CredentialStore,
  hotkey: GlobalHotkeyAdapter,
): void {
  // Override agent:runTask to stream events to renderer
  ipcMain.removeHandler('agent:runTask');
  ipcMain.handle('agent:runTask', async (_event, goal: string, sessionId: string) => {
    const win = getMainWindow();
    if (!win) return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'No window' } };

    const settings = settingsStore.get();
    hotkey.register(settings.safety.emergencyStopHotkey, sessionId);

    (async () => {
      try {
        for await (const event of agent.run(goal, sessionId)) {
          win.webContents.send('agent:event', event);
        }
      } catch (err: any) {
        win.webContents.send('agent:event', {
          taskRunId: sessionId,
          sessionId,
          timestamp: new Date().toISOString(),
          type: 'task-failed',
          diagnosis: err.message,
        });
      } finally {
        hotkey.unregister();
      }
    })();

    return { ok: true, data: { taskRunId: sessionId } };
  });

  // Override settings handlers to use real stores
  ipcMain.removeHandler('settings:get');
  ipcMain.handle('settings:get', async () => {
    return settingsStore.get();
  });

  ipcMain.removeHandler('settings:update');
  ipcMain.handle('settings:update', async (_event, patch: Record<string, unknown>) => {
    return settingsStore.update(validateSettingsPatch(patch));
  });

  ipcMain.removeHandler('settings:getApiKeyMask');
  ipcMain.handle('settings:getApiKeyMask', async () => {
    return credentialStore.getApiKeyMask();
  });

  ipcMain.removeHandler('settings:setApiKey');
  ipcMain.handle('settings:setApiKey', async (_event, key: string) => {
    try {
      credentialStore.setApiKey(key);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } };
    }
  });
}

app.on('window-all-closed', () => {
  globalHotkey?.unregisterAll();
  app.quit();
});

export { agentService, globalHotkey };
