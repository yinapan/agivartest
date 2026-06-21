import { createRequire } from 'node:module';
import { toolOk, toolErr, type ToolResult } from '../types/errors.js';

// native module — lazy-loaded via createRequire for ESM compatibility
const require_ = createRequire(import.meta.url);

let nativeDpi: any = null;

function loadNative() {
  if (!nativeDpi) {
    const native = require_('@agivar/native');
    nativeDpi = {
      getSystemDpi: native.getSystemDpi,
      getDpiForMonitor: native.getDpiForMonitor,
      getMonitorCount: native.getMonitorCount,
    };
  }
  return nativeDpi;
}

export async function getScaleFactor(monitorIndex: number = 0): Promise<ToolResult<number>> {
  const start = performance.now();
  try {
    const native = loadNative();
    const dpi = native.getDpiForMonitor(monitorIndex);
    const scale = dpi / 96;
    return toolOk(scale, performance.now() - start);
  } catch (err: any) {
    return toolErr('DPI_MAPPING_FAILED', err.message, performance.now() - start);
  }
}

export function logicalToPhysical(
  x: number,
  y: number,
  scale: number,
): { x: number; y: number } {
  return { x: Math.round(x * scale), y: Math.round(y * scale) };
}

export function physicalToLogical(
  x: number,
  y: number,
  scale: number,
): { x: number; y: number } {
  return { x: Math.round(x / scale), y: Math.round(y / scale) };
}

export async function toPhysicalCoords(
  logicalX: number,
  logicalY: number,
): Promise<ToolResult<{ x: number; y: number }>> {
  const scaleResult = await getScaleFactor();
  if (!scaleResult.ok) return scaleResult as ToolResult<{ x: number; y: number }>;
  const coords = logicalToPhysical(logicalX, logicalY, scaleResult.data);
  return toolOk(coords, scaleResult.durationMs);
}

export async function getMonitorCount(): Promise<ToolResult<number>> {
  const start = performance.now();
  try {
    const native = loadNative();
    return toolOk(native.getMonitorCount(), performance.now() - start);
  } catch (err: any) {
    return toolErr('DPI_MAPPING_FAILED', err.message, performance.now() - start);
  }
}
