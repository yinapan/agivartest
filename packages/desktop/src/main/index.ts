import { app, ipcMain } from 'electron';
import path from 'node:path';
import { createMainWindow, getMainWindow } from './windows.js';
import { registerIpcHandlers, setAgentService, setMemoryStore, setSettingsStore, registerAgentIpcHandlers } from './ipc.js';
import { GlobalHotkeyAdapter } from './global-hotkey.js';
import { CredentialStore } from './credential-store.js';
import { SettingsStore } from './settings-store.js';
import {
  AgentService,
  MemoryStore,
  AbortManager,
  getDatabase,
  OpenAIClient,
} from '@agivar/core';
import type { ToolAdapters } from '@agivar/core';
import { screenshot, uia, input, browser } from '@agivar/core';

let agentService: AgentService | null = null;
let globalHotkey: GlobalHotkeyAdapter | null = null;

function getDataDir(): string {
  return process.env.AGIVAR_DATA_DIR ?? path.join(app.getAppPath(), '.agivar-dev');
}

app.whenReady().then(async () => {
  const dataDir = getDataDir();
  const db = getDatabase(path.join(dataDir, 'agivar.db'));
  const memoryStore = new MemoryStore(db);
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
  registerAgentIpcHandlers();
  setAgentService(agentService);
  setMemoryStore(memoryStore);
  setSettingsStore(settingsStore);

  wireAgentEvents(agentService, settingsStore, credentialStore, globalHotkey);

  createMainWindow();
});

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
    return settingsStore.update(patch);
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
