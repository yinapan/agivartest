import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as net from 'node:net';
import { createMainWindow, getMainWindow } from './windows.js';
import { registerIpcHandlers, setAgentService, setMemoryStore, setRecordingStore, setRecordingTeachDeps, setSettingsStore } from './ipc.js';
import { GlobalHotkeyAdapter } from './global-hotkey.js';
import { CredentialStore } from './credential-store.js';
import { SettingsStore } from './settings-store.js';
import { migrateLegacyDataDir, resolveDataDir, resolveLegacyAppPathDataDir } from './data-dir.js';
import {
  AgentService,
  MemoryStore,
  RecordingStore,
  AbortManager,
  getDatabase,
  OpenAIClient,
  OpenAICompatibleRecordingProvider,
} from '@agivar/core';
import type { ToolAdapters } from '@agivar/core';
import { screenshot, uia, input, browser, recorder, eventCapture } from '@agivar/core';
import { handleRecordingTeachCleanupOrphans, scanRecordingKeyframeFiles, setRecordingTeachProvider, type RecordingTeachDeps } from './recording-teach-ipc.js';

let agentService: AgentService | null = null;
let globalHotkey: GlobalHotkeyAdapter | null = null;
let recordingStoreForCleanup: RecordingStore | null = null;
let recordingTeachDepsForCleanup: RecordingTeachDeps | undefined;
let quitCleanupStarted = false;

const RECORDING_ARTIFACT_WARNING_BYTES = 20 * 1024 * 1024 * 1024;
const QUIT_CLEANUP_TIMEOUT_MS = 3000;

function ensureDataDir(dataDir: string): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

app.whenReady().then(async () => {
  const appPath = app.getAppPath();
  const dataDir = resolveDataDir({
    envDataDir: process.env.AGIVAR_DATA_DIR,
    appPath,
    userDataDir: app.getPath('userData'),
    isPackaged: app.isPackaged,
  });
  const migration = await migrateLegacyDataDir({
    legacyDir: resolveLegacyAppPathDataDir(appPath),
    targetDir: dataDir,
  });
  if (migration.migrated) {
    console.info(`[main] Migrated legacy data dir from ${migration.from} to ${migration.to}`);
  }
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
  const recordingTeachDeps: RecordingTeachDeps = {
    recorder,
    screenshot,
    frameScanner: scanRecordingKeyframeFiles,
    eventCapture,
    preflight: () => preflightRecordingTeach(path.join(dataDir, 'recordings')),
    artifactRoot: path.join(dataDir, 'recordings'),
  };
  setRecordingTeachDeps(recordingTeachDeps);
  recordingStoreForCleanup = recordingStore;
  recordingTeachDepsForCleanup = recordingTeachDeps;
  await handleRecordingTeachCleanupOrphans(recordingStore, recordingTeachDeps);
  if (apiKey) {
    setRecordingTeachProvider('openai-compatible', new OpenAICompatibleRecordingProvider(llm));
  }
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

app.on('before-quit', (event) => {
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  event.preventDefault();
  void runRecordingQuitCleanup().finally(() => app.quit());
});

export { agentService, globalHotkey };

async function preflightRecordingTeach(artifactRoot: string): Promise<{
  ok: true;
  data: { canRecord: boolean; warnings: string[]; artifactBytes: number };
  durationMs: number;
} | {
  ok: false;
  error: { code: string; message: string };
  durationMs: number;
}> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  try {
    ensureDataDir(artifactRoot);
    const probePath = path.join(artifactRoot, `.preflight-${Date.now()}.tmp`);
    await fs.promises.writeFile(probePath, 'ok', 'utf8');
    await fs.promises.rm(probePath, { force: true });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'RECORDING_ARTIFACT_DIR_UNAVAILABLE',
        message: err instanceof Error ? err.message : String(err),
      },
      durationMs: Date.now() - startedAt,
    };
  }

  let artifactBytes = 0;
  try {
    artifactBytes = await getDirectorySize(artifactRoot);
    if (artifactBytes > RECORDING_ARTIFACT_WARNING_BYTES) {
      warnings.push('recording artifact directory is larger than 20 GB');
    }
  } catch (err) {
    warnings.push(`failed to inspect recording artifact directory: ${err instanceof Error ? err.message : String(err)}`);
  }

  const activeWindow = await screenshot.getActiveWindow();
  if (!activeWindow.ok) warnings.push(`active window probe failed: ${activeWindow.error.message}`);

  return {
    ok: true,
    data: {
      canRecord: true,
      warnings,
      artifactBytes,
    },
    durationMs: Date.now() - startedAt,
  };
}

async function getDirectorySize(dir: string): Promise<number> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      total += (await fs.promises.stat(entryPath)).size;
    }
  }
  return total;
}

async function runRecordingQuitCleanup(): Promise<void> {
  const cleanupTasks: Array<Promise<unknown>> = [
    recorder.forceStopAllRecordings(),
  ];
  if (recordingStoreForCleanup) {
    cleanupTasks.push(handleRecordingTeachCleanupOrphans(recordingStoreForCleanup, recordingTeachDepsForCleanup));
  }

  await Promise.race([
    Promise.allSettled(cleanupTasks),
    new Promise((resolve) => setTimeout(resolve, QUIT_CLEANUP_TIMEOUT_MS)),
  ]);
}
