import { toolOk, toolErr, type ToolResult } from '../types/errors.js';
import type { Point } from '../types/coordinates.js';

// @nut-tree-fork/nut-js lazy import to avoid loading when input is not needed
let nutMouse: any = null;
let nutKeyboard: any = null;

async function ensureNut() {
  if (!nutMouse) {
    const nut = await import('@nut-tree-fork/nut-js');
    nutMouse = nut.mouse;
    nutKeyboard = nut.keyboard;
    // Configure nut.js input speed
    nutKeyboard.config.autoDelayMs = 50;
    nutMouse.config.autoDelayMs = 50;
  }
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  doubleClick?: boolean;
}

export async function ensureActiveWindow(hwnd: number): Promise<ToolResult<boolean>> {
  const start = performance.now();
  try {
    // Phase 0: use Windows API to check foreground window
    // Using PowerShell to get foreground window handle (Plan B will replace with native module)
    const { execSync } = await import('node:child_process');
    const out = execSync(
      `powershell -c "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W{[DllImport(\\\"user32.dll\\\")]public static extern IntPtr GetForegroundWindow();}'; [W]::GetForegroundWindow().ToInt64()"`,
      { encoding: 'utf-8' },
    ).trim();
    const currentHwnd = parseInt(out, 10);
    const match = currentHwnd === hwnd;
    if (!match) {
      return toolErr('INPUT_FOCUS_MISMATCH', `Expected hwnd=${hwnd}, got ${currentHwnd}`, performance.now() - start);
    }
    return toolOk(true, performance.now() - start);
  } catch (err: any) {
    return toolErr('INPUT_FOCUS_MISMATCH', err.message, performance.now() - start);
  }
}

/** Map button option string to @nut-tree-fork/nut-js Button enum value */
function mapButton(button?: 'left' | 'right' | 'middle'): number {
  // Button enum: LEFT = 0, MIDDLE = 1, RIGHT = 2
  switch (button) {
    case 'right':
      return 2;
    case 'middle':
      return 1;
    default:
      return 0;
  }
}

export async function click(x: number, y: number, options?: ClickOptions): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    await ensureNut();
    const { straightTo, Point: NutPoint } = await import('@nut-tree-fork/nut-js');
    await nutMouse.move(straightTo(new NutPoint(x, y)));
    const btn = mapButton(options?.button);
    if (options?.doubleClick) {
      await nutMouse.doubleClick(btn);
    } else {
      await nutMouse.click(btn);
    }
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('INPUT_ABORTED', err.message, performance.now() - start);
  }
}

export async function clickPoint(point: Point, options?: ClickOptions): Promise<ToolResult<void>> {
  if (point.space !== 'screen-physical') {
    return toolErr(
      'DPI_MAPPING_FAILED',
      `clickPoint requires screen-physical coordinates, got ${point.space}`,
      0,
    );
  }
  return click(point.x, point.y, options);
}

export async function moveMouse(x: number, y: number): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    await ensureNut();
    const { straightTo, Point: NutPoint } = await import('@nut-tree-fork/nut-js');
    await nutMouse.move(straightTo(new NutPoint(x, y)));
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('INPUT_ABORTED', err.message, performance.now() - start);
  }
}

export async function typeText(text: string): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    await ensureNut();
    await nutKeyboard.type(text);
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('INPUT_ABORTED', err.message, performance.now() - start);
  }
}

export async function pressKeys(keys: string[]): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    await ensureNut();
    const { Key } = await import('@nut-tree-fork/nut-js');
    const mapped = keys.map((k) => {
      const key = (Key as any)[k];
      if (key === undefined) throw new Error(`Unknown key: ${k}`);
      return key;
    });
    await nutKeyboard.pressKey(...mapped);
    await nutKeyboard.releaseKey(...mapped);
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('INPUT_ABORTED', err.message, performance.now() - start);
  }
}

export async function clickAndType(target: Point, text: string): Promise<ToolResult<void>> {
  const clickResult = await clickPoint(target);
  if (!clickResult.ok) return clickResult;
  const timers = await import('node:timers/promises');
  await timers.setTimeout(200);
  return typeText(text);
}
