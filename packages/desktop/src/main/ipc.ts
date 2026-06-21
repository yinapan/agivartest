import { ipcMain } from 'electron';
import {
  screenshot,
  uia,
  input,
  browser,
  recorder,
  dpi,
  type ToolResult,
} from '@agivar/core';

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
}
