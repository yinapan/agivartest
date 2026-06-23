import { ipcMain } from 'electron';
import {
  screenshot,
  uia,
  input,
  browser,
  recorder,
  dpi,
  parseWorkflowContent,
  workflowFileToMemory,
  type ToolResult,
  type AgentService,
  type MemoryStore,
} from '@agivar/core';
import fs from 'node:fs';
import { SettingsStore } from './settings-store.js';

let agentService: AgentService | null = null;
let memoryStore: MemoryStore | null = null;
let settingsStore: SettingsStore | null = null;

export function setAgentService(agent: AgentService): void {
  agentService = agent;
}

export function setMemoryStore(store: MemoryStore): void {
  memoryStore = store;
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
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = filePath.endsWith('.yaml') || filePath.endsWith('.yml') ? 'yaml' : 'json';
    const result = await parseWorkflowContent(content, ext);
    if (!result.success) return { ok: false, error: { code: 'PARSE_ERROR', message: result.error || 'Parse failed' } };
    const memory = workflowFileToMemory(result.data!);
    await memoryStore.insert(memory);
    return { ok: true, data: memory };
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
