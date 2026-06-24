import { ipcMain, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {
  screenshot,
  uia,
  input,
  browser,
  recorder,
  dpi,
  parseWorkflowContent,
  workflowFileToMemory,
  type WorkflowDraft,
  type ToolResult,
  type AgentService,
  type MemoryStore,
  type RecordingStore,
} from '@agivar/core';
import { SettingsStore } from './settings-store.js';
import {
  createFallbackTeachingProvider,
  handleMemoryGetVersion,
  handleMemoryListVersions,
  handleMemoryRollback,
  handleMemorySaveDraft,
  handleMemoryTeachText,
  handleMemoryUpdate,
  handleMemoryValidateDraft,
} from './workflow-ipc.js';
import {
  handleRecordingTeachGetTimeline,
  handleRecordingTeachStart,
  handleRecordingTeachStatus,
} from './recording-teach-ipc.js';

let agentService: AgentService | null = null;
let memoryStore: MemoryStore | null = null;
let recordingStore: RecordingStore | null = null;
let settingsStore: SettingsStore | null = null;

const fallbackTeachingProvider = createFallbackTeachingProvider();

export function setAgentService(agent: AgentService): void {
  agentService = agent;
}

export function setMemoryStore(store: MemoryStore): void {
  memoryStore = store;
}

export function setRecordingStore(store: RecordingStore): void {
  recordingStore = store;
}

export function setSettingsStore(store: SettingsStore): void {
  settingsStore = store;
}

function wrapHandler<T>(fn: (...args: any[]) => Promise<ToolResult<T>>) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    const result = await fn(...args);
    return result;
  };
}

export function registerIpcHandlers(): void {
  // Screenshot
  ipcMain.handle('screenshot:captureScreen', wrapHandler(
    (monitorIndex?: number) => screenshot.captureScreen(monitorIndex),
  ));
  ipcMain.handle('screenshot:getActiveWindow', wrapHandler(
    () => screenshot.getActiveWindow(),
  ));
  ipcMain.handle('screenshot:listWindows', wrapHandler(
    () => screenshot.listWindows(),
  ));

  // UIA
  ipcMain.handle('uia:getUiTree', wrapHandler(
    (hwnd: number, options?: any) => uia.getUiTree(hwnd, options),
  ));
  ipcMain.handle('uia:findElement', wrapHandler(
    (hwnd: number, query: any, options?: any) => uia.findElement(hwnd, query, options),
  ));

  // Input
  ipcMain.handle('input:click', wrapHandler(
    (x: number, y: number, options?: any) => input.click(x, y, options),
  ));
  ipcMain.handle('input:typeText', wrapHandler(
    (text: string) => input.typeText(text),
  ));
  ipcMain.handle('input:pressKeys', wrapHandler(
    (keys: string[]) => input.pressKeys(keys),
  ));

  // Browser
  ipcMain.handle('browser:launch', wrapHandler(
    (options?: any) => browser.launchManagedBrowser(options),
  ));

  // Recorder
  ipcMain.handle('recorder:start', wrapHandler(
    (config: any) => recorder.startRecording(config),
  ));
  ipcMain.handle('recorder:stop', wrapHandler(
    (sessionId: string) => recorder.stopRecording(sessionId),
  ));
  ipcMain.handle('recorder:forceStopAll', wrapHandler(
    () => recorder.forceStopAllRecordings(),
  ));

  // DPI
  ipcMain.handle('dpi:getScaleFactor', wrapHandler(
    (monitorIndex?: number) => dpi.getScaleFactor(monitorIndex),
  ));

  // Agent
  registerAgentIpcHandlers();
}

export function registerAgentIpcHandlers(): void {
  // Agent
  ipcMain.handle('agent:runTask', async (_event, goal: string, sessionId: string) => {
    if (!agentService) throw new Error('AgentService not initialized');
    return { ok: true, taskRunId: sessionId };
  });

  ipcMain.handle('agent:abort', async () => {
    return { ok: true };
  });

  ipcMain.handle('agent:resumeTakeover', async () => {
    return { ok: true };
  });

  ipcMain.handle('agent:selectMemory', async (_event, memoryId: string) => {
    if (!memoryStore) return { ok: false, error: 'MemoryStore not initialized' };
    const memory = await memoryStore.getById(memoryId);
    return { ok: true, data: memory };
  });

  // Memory
  ipcMain.handle('memory:import', async (_event, filePath: string) => {
    if (!memoryStore) throw new Error('MemoryStore not initialized');

    // Validate extension before touching FS
    if (!/\.(yaml|yml|json)$/i.test(filePath)) {
      return { ok: false, error: { code: 'INVALID_FILE', message: '仅支持 .yaml/.yml/.json 文件' } };
    }

    // Resolve symlinks and restrict to allowed directories
    let resolved: string;
    try {
      resolved = fs.realpathSync(filePath);
    } catch {
      return { ok: false, error: { code: 'FILE_NOT_FOUND', message: '文件不存在' } };
    }

    const allowed = [app.getPath('documents'), app.getPath('downloads'), app.getPath('desktop')];
    if (!allowed.some(dir => resolved.startsWith(dir + path.sep))) {
      return { ok: false, error: { code: 'FILE_ACCESS_DENIED', message: '文件不在允许的目录中' } };
    }

    const ext = filePath.endsWith('.yaml') || filePath.endsWith('.yml') ? 'yaml' : 'json';
    const content = fs.readFileSync(resolved, 'utf-8');
    const result = await parseWorkflowContent(content, ext);
    if (!result.success) return { ok: false, error: { code: 'PARSE_ERROR', message: result.error || 'Parse failed' } };
    const memory = workflowFileToMemory(result.data!);
    await memoryStore.insert(memory);
    return { ok: true, data: memory };
  });

  ipcMain.handle('memory:teachText', async (_event, request) => {
    return handleMemoryTeachText(request, fallbackTeachingProvider);
  });

  ipcMain.handle('memory:validateDraft', async (_event, draft: WorkflowDraft) => {
    return handleMemoryValidateDraft(draft);
  });

  ipcMain.handle('memory:saveDraft', async (_event, draft: WorkflowDraft, changeNote?: string) => {
    return handleMemorySaveDraft(memoryStore, draft, changeNote);
  });

  ipcMain.handle('memory:update', async (_event, memory, changeNote?: string) => {
    return handleMemoryUpdate(memoryStore, memory, changeNote);
  });

  ipcMain.handle('memory:listVersions', async (_event, memoryId: string) => {
    return handleMemoryListVersions(memoryStore, memoryId);
  });

  ipcMain.handle('memory:getVersion', async (_event, memoryId: string, version: number) => {
    return handleMemoryGetVersion(memoryStore, memoryId, version);
  });

  ipcMain.handle('memory:rollback', async (_event, memoryId: string, version: number, changeNote?: string) => {
    return handleMemoryRollback(memoryStore, memoryId, version, changeNote);
  });

  ipcMain.handle('memory:list', async (_event, filter?: { appName?: string; topic?: string }) => {
    if (!memoryStore) return [];
    return memoryStore.list(filter);
  });

  ipcMain.handle('memory:get', async (_event, id: string) => {
    if (!memoryStore) return null;
    return memoryStore.getById(id);
  });

  ipcMain.handle('memory:delete', async (_event, id: string) => {
    if (!memoryStore) return;
    await memoryStore.delete(id);
  });

  // Recording teaching
  ipcMain.handle('recordingTeach:start', async (_event, request) => {
    return handleRecordingTeachStart(recordingStore, request);
  });

  ipcMain.handle('recordingTeach:status', async (_event, sessionId: string) => {
    return handleRecordingTeachStatus(recordingStore, sessionId);
  });

  ipcMain.handle('recordingTeach:getTimeline', async (_event, sessionId: string) => {
    return handleRecordingTeachGetTimeline(recordingStore, sessionId);
  });

  // Session
  ipcMain.handle('session:list', async () => {
    return [];
  });

  ipcMain.handle('session:create', async () => {
    return { id: '', title: '', createdAt: '', updatedAt: '' };
  });

  ipcMain.handle('session:delete', async () => {
  });

  ipcMain.handle('session:getMessages', async () => {
    return [];
  });

  // Settings
  ipcMain.handle('settings:get', async () => {
    if (!settingsStore) return {};
    return settingsStore.get();
  });

  ipcMain.handle('settings:update', async (_event, patch: Record<string, unknown>) => {
    if (!settingsStore) return {};
    return settingsStore.update(patch);
  });

  ipcMain.handle('settings:getApiKeyMask', async () => {
    return '(未设置)';
  });

  ipcMain.handle('settings:setApiKey', async () => {
    return { ok: true };
  });
}
