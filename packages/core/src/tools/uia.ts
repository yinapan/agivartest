import { createRequire } from 'node:module';
import { toolOk, toolErr, type ToolResult, type ToolErrorCode } from '../types/errors.js';

// native module — lazy-loaded via createRequire for ESM compatibility
const require_ = createRequire(import.meta.url);

let nativeUia: any = null;

function loadNative() {
  if (!nativeUia) {
    const native = require_('@agivar/native');
    nativeUia = {
      getUiTree: native.getUiTree,
      findElement: native.findElement,
      getElementValue: native.getElementValue,
      setElementValue: native.setElementValue,
      invokeElement: native.invokeElement,
    };
  }
  return nativeUia;
}

export interface UiaOptions {
  timeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
  includeOffscreen?: boolean;
}

export interface ElementQuery {
  automationId?: string;
  name?: string;
  controlType?: string;
  className?: string;
  nameMatch?: 'exact' | 'contains';
  maxDepth?: number;
  maxNodes?: number;
  includeOffscreen?: boolean;
}

export interface UiaNode {
  name: string;
  controlType: string;
  automationId: string;
  className: string;
  boundingRect: { x: number; y: number; w: number; h: number };
  isEnabled: boolean;
  isOffscreen: boolean;
  value?: string;
  children: UiaNode[];
}

const DEFAULT_OPTIONS: Required<UiaOptions> = {
  timeoutMs: 2000,
  maxDepth: 8,
  maxNodes: 1000,
  includeOffscreen: false,
};

let consecutiveTimeouts = 0;
let backendUnreliable = false;

function resetTimeoutCounter() {
  consecutiveTimeouts = 0;
}

function handleTimeout(): ToolErrorCode {
  consecutiveTimeouts++;
  if (consecutiveTimeouts >= 3) {
    backendUnreliable = true;
    return 'UIA_BACKEND_UNRELIABLE';
  }
  return 'UIA_TIMEOUT';
}

export function isBackendUnreliable(): boolean {
  return backendUnreliable;
}

export function resetBackendStatus(): void {
  backendUnreliable = false;
  consecutiveTimeouts = 0;
}

export async function getUiTree(
  hwnd: number,
  options?: UiaOptions,
): Promise<ToolResult<UiaNode>> {
  if (backendUnreliable) {
    return toolErr('UIA_BACKEND_UNRELIABLE', 'UIA backend marked unreliable after 3 consecutive timeouts', 0);
  }

  const start = performance.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const native = loadNative();
    const result = native.getUiTree(hwnd, {
      timeoutMs: opts.timeoutMs,
      maxDepth: opts.maxDepth,
      maxNodes: opts.maxNodes,
      includeOffscreen: opts.includeOffscreen,
    });
    resetTimeoutCounter();
    return toolOk(result, performance.now() - start);
  } catch (err: any) {
    const duration = performance.now() - start;
    if (err.message.includes('UIA_TIMEOUT') || duration > opts.timeoutMs) {
      const code = handleTimeout();
      return toolErr(code, err.message, duration);
    }
    return toolErr('UIA_PATTERN_UNSUPPORTED', err.message, duration);
  }
}

function buildNativeQuery(query: ElementQuery, fallbackOpts: Required<UiaOptions>) {
  return {
    automationId: query.automationId ?? null,
    name: query.name ?? null,
    controlType: query.controlType ?? null,
    className: query.className ?? null,
    nameMatch: query.nameMatch ?? 'exact',
    maxDepth: query.maxDepth ?? fallbackOpts.maxDepth,
    maxNodes: query.maxNodes ?? fallbackOpts.maxNodes,
    includeOffscreen: query.includeOffscreen ?? fallbackOpts.includeOffscreen,
  };
}

export async function findElement(
  hwnd: number,
  query: ElementQuery,
  options?: UiaOptions,
): Promise<ToolResult<UiaNode | null>> {
  if (backendUnreliable) {
    return toolErr('UIA_BACKEND_UNRELIABLE', 'UIA backend marked unreliable', 0);
  }

  const start = performance.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const native = loadNative();
    const result = native.findElement(
      hwnd,
      buildNativeQuery(query, opts),
      {
        timeoutMs: opts.timeoutMs,
        maxDepth: opts.maxDepth,
        maxNodes: opts.maxNodes,
        includeOffscreen: opts.includeOffscreen,
      },
    );
    resetTimeoutCounter();
    return toolOk(result ?? null, performance.now() - start);
  } catch (err: any) {
    const duration = performance.now() - start;
    const code = err.message.includes('UIA_TIMEOUT') ? handleTimeout() : 'UIA_PATTERN_UNSUPPORTED';
    return toolErr(code, err.message, duration);
  }
}

export async function getElementValue(
  hwnd: number,
  query: ElementQuery,
): Promise<ToolResult<string>> {
  if (backendUnreliable) {
    return toolErr('UIA_BACKEND_UNRELIABLE', 'UIA backend marked unreliable after 3 consecutive timeouts', 0);
  }

  const start = performance.now();
  try {
    const native = loadNative();
    const result = native.getElementValue(hwnd, buildNativeQuery(query, DEFAULT_OPTIONS));
    return toolOk(result, performance.now() - start);
  } catch (err: any) {
    const code = err.message.includes('UIA_ELEMENT_NOT_FOUND') ? 'UIA_ELEMENT_NOT_FOUND' : 'UIA_PATTERN_UNSUPPORTED';
    return toolErr(code, err.message, performance.now() - start);
  }
}

export async function setElementValue(
  hwnd: number,
  query: ElementQuery,
  value: string,
): Promise<ToolResult<void>> {
  if (backendUnreliable) {
    return toolErr('UIA_BACKEND_UNRELIABLE', 'UIA backend marked unreliable after 3 consecutive timeouts', 0);
  }

  const start = performance.now();
  try {
    const native = loadNative();
    native.setElementValue(hwnd, buildNativeQuery(query, DEFAULT_OPTIONS), value);
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    const code = err.message.includes('UIA_ELEMENT_NOT_FOUND') ? 'UIA_ELEMENT_NOT_FOUND' : 'UIA_PATTERN_UNSUPPORTED';
    return toolErr(code, err.message, performance.now() - start);
  }
}

export async function invokeElement(
  hwnd: number,
  query: ElementQuery,
): Promise<ToolResult<void>> {
  if (backendUnreliable) {
    return toolErr('UIA_BACKEND_UNRELIABLE', 'UIA backend marked unreliable after 3 consecutive timeouts', 0);
  }

  const start = performance.now();
  try {
    const native = loadNative();
    native.invokeElement(hwnd, buildNativeQuery(query, DEFAULT_OPTIONS));
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    const code = err.message.includes('UIA_ELEMENT_NOT_FOUND') ? 'UIA_ELEMENT_NOT_FOUND' : 'UIA_PATTERN_UNSUPPORTED';
    return toolErr(code, err.message, performance.now() - start);
  }
}

export async function dumpUiTree(
  hwnd: number,
  options?: UiaOptions,
): Promise<ToolResult<string>> {
  const result = await getUiTree(hwnd, options);
  if (!result.ok) return result as ToolResult<string>;
  return toolOk(JSON.stringify(result.data, null, 2), result.durationMs);
}
