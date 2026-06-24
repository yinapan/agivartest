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

interface ScreenshotWindowLike {
  id(): number;
  title(): string;
  x(): number;
  y(): number;
  width(): number;
  height(): number;
  isMinimized(): boolean;
  isFocused?(): boolean;
}

export async function getActiveWindow(): Promise<ToolResult<WindowInfo>> {
  const start = performance.now();
  try {
    const active = selectActiveWindowCandidate(Screenshots.Window.all() as ScreenshotWindowLike[]);
    if (!active) {
      return toolErr('WINDOW_NOT_FOUND', 'No active window candidate found', performance.now() - start);
    }
    return toolOk(active, performance.now() - start);
  } catch (err: any) {
    return toolErr('WINDOW_NOT_FOUND', err.message, performance.now() - start);
  }
}

export function selectActiveWindowCandidate(windows: ScreenshotWindowLike[]): WindowInfo | null {
  const visible = windows
    .map((window) => windowToInfo(window))
    .filter((window): window is WindowCandidate => window !== null);
  const selected = visible.find((window) => window.focused === true) ?? visible[0] ?? null;
  if (!selected) return null;
  const { focused, ...info } = selected;
  return info;
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

type WindowCandidate = WindowInfo & { focused?: boolean };

function windowToInfo(window: ScreenshotWindowLike): WindowCandidate | null {
  const hwnd = safeNumber(() => window.id());
  const title = safeString(() => window.title()).trim();
  const x = safeNumber(() => window.x());
  const y = safeNumber(() => window.y());
  const width = safeNumber(() => window.width());
  const height = safeNumber(() => window.height());
  const isMinimized = safeBoolean(() => window.isMinimized());
  const focused = typeof window.isFocused === 'function' ? safeBoolean(() => window.isFocused!()) : false;

  if (!hwnd || !title || isMinimized || width <= 0 || height <= 0) return null;
  if (x <= -20000 || y <= -20000) return null;
  if (height < 80 || width < 120) return null;

  return {
    hwnd,
    title,
    x,
    y,
    width,
    height,
    isMinimized,
    focused,
  };
}

function safeNumber(read: () => number): number {
  try {
    const value = read();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function safeString(read: () => string): string {
  try {
    return read() ?? '';
  } catch {
    return '';
  }
}

function safeBoolean(read: () => boolean): boolean {
  try {
    return Boolean(read());
  } catch {
    return false;
  }
}

export async function saveScreenshot(filePath: string, monitorIndex: number = 0): Promise<ToolResult<string>> {
  const result = await captureScreen(monitorIndex);
  if (!result.ok) return result as ToolResult<string>;
  const fs = await import('node:fs');
  fs.writeFileSync(filePath, result.data.buffer);
  return toolOk(filePath, result.durationMs);
}
