import { createRequire } from 'node:module';
import { toolOk, toolErr, type ToolResult } from '../types/errors.js';

// node-screenshots is a CommonJS native addon — use createRequire in ESM context
const require_ = createRequire(import.meta.url);
const Screenshots = require_('node-screenshots');

export interface WindowInfo {
  hwnd: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
}

export interface ScreenshotResult {
  buffer: Buffer;
  width: number;
  height: number;
  timestamp: string;
}

export async function getActiveWindow(): Promise<ToolResult<WindowInfo>> {
  const start = performance.now();
  try {
    const monitors = Screenshots.Monitor.all();
    const monitor = monitors[0];
    if (!monitor) {
      return toolErr('WINDOW_NOT_FOUND', 'No monitor found', performance.now() - start);
    }
    return toolOk(
      {
        hwnd: 0,
        title: `Monitor ${monitor.id()}`,
        x: monitor.x(),
        y: monitor.y(),
        width: monitor.width(),
        height: monitor.height(),
        isMinimized: false,
      },
      performance.now() - start,
    );
  } catch (err: any) {
    return toolErr('WINDOW_NOT_FOUND', err.message, performance.now() - start);
  }
}

export async function captureScreen(monitorIndex: number = 0): Promise<ToolResult<ScreenshotResult>> {
  const start = performance.now();
  try {
    const monitors = Screenshots.Monitor.all();
    const monitor = monitors[monitorIndex];
    if (!monitor) {
      return toolErr('WINDOW_NOT_FOUND', `Monitor ${monitorIndex} not found`, performance.now() - start);
    }
    const image = monitor.captureImageSync();
    const buffer = image.toPngSync();
    return toolOk(
      {
        buffer,
        width: image.width,
        height: image.height,
        timestamp: new Date().toISOString(),
      },
      performance.now() - start,
    );
  } catch (err: any) {
    return toolErr('WINDOW_NOT_FOUND', err.message, performance.now() - start);
  }
}

export async function captureWindow(hwnd: number): Promise<ToolResult<ScreenshotResult>> {
  const start = performance.now();
  try {
    const windows = Screenshots.Window.all();
    const target = windows.find((w: any) => w.id() === hwnd);
    if (!target) {
      return toolErr('WINDOW_NOT_FOUND', `Window hwnd=${hwnd} not found`, performance.now() - start);
    }
    const image = target.captureImageSync();
    const buffer = image.toPngSync();
    return toolOk(
      {
        buffer,
        width: image.width,
        height: image.height,
        timestamp: new Date().toISOString(),
      },
      performance.now() - start,
    );
  } catch (err: any) {
    return toolErr('WINDOW_NOT_FOUND', err.message, performance.now() - start);
  }
}

export async function listWindows(): Promise<ToolResult<WindowInfo[]>> {
  const start = performance.now();
  try {
    const windows = Screenshots.Window.all();
    const infos: WindowInfo[] = windows.map((w: any) => ({
      hwnd: w.id(),
      title: w.title() || '',
      x: w.x() ?? 0,
      y: w.y() ?? 0,
      width: w.width() ?? 0,
      height: w.height() ?? 0,
      isMinimized: w.isMinimized() ?? false,
    }));
    return toolOk(infos, performance.now() - start);
  } catch (err: any) {
    return toolErr('WINDOW_NOT_FOUND', err.message, performance.now() - start);
  }
}

export async function saveScreenshot(filePath: string, monitorIndex: number = 0): Promise<ToolResult<string>> {
  const result = await captureScreen(monitorIndex);
  if (!result.ok) return result as ToolResult<string>;
  const fs = await import('node:fs');
  fs.writeFileSync(filePath, result.data.buffer);
  return toolOk(filePath, result.durationMs);
}
