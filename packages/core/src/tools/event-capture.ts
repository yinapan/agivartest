import { createRequire } from 'node:module';
import { toolErr, toolOk, type ToolResult } from '../types/errors.js';
import type {
  RecordingEvent,
  RecordingPrivacyMode,
  RecordingScope,
} from '../types/workflow.js';

const require_ = createRequire(import.meta.url);

let nativeEventCapture: any = null;

export interface EventCaptureConfig {
  scope: RecordingScope;
  privacyMode: RecordingPrivacyMode;
  targetHwnd?: number;
  windowTitle?: string;
}

function loadNativeEventCapture() {
  if (!nativeEventCapture) {
    const native = require_('@agivar/native');
    nativeEventCapture = {
      startEventCapture: native.startEventCapture,
      stopEventCapture: native.stopEventCapture,
      drainEvents: native.drainEvents,
    };
  }
  return nativeEventCapture;
}

export async function startEventCapture(
  sessionId: string,
  config: EventCaptureConfig,
): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    const native = loadNativeEventCapture();
    if (typeof native.startEventCapture !== 'function') {
      return unavailable(start);
    }
    native.startEventCapture(sessionId, config);
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('EVENT_CAPTURE_UNAVAILABLE', err.message, performance.now() - start);
  }
}

export async function stopEventCapture(sessionId: string): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    const native = loadNativeEventCapture();
    if (typeof native.stopEventCapture !== 'function') {
      return unavailable(start);
    }
    native.stopEventCapture(sessionId);
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('EVENT_CAPTURE_UNAVAILABLE', err.message, performance.now() - start);
  }
}

export async function drainEvents(sessionId: string): Promise<ToolResult<RecordingEvent[]>> {
  const start = performance.now();
  try {
    const native = loadNativeEventCapture();
    if (typeof native.drainEvents !== 'function') {
      return toolOk([], performance.now() - start);
    }
    return toolOk(native.drainEvents(sessionId), performance.now() - start);
  } catch (err: any) {
    return toolErr('EVENT_CAPTURE_UNAVAILABLE', err.message, performance.now() - start);
  }
}

function unavailable<T>(start: number): ToolResult<T> {
  return toolErr(
    'EVENT_CAPTURE_UNAVAILABLE',
    'Native passive event capture is not available in this build',
    performance.now() - start,
  );
}
