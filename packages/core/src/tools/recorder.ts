import { createRequire } from 'node:module';
import { toolOk, toolErr, type ToolResult } from '../types/errors.js';

// native module — lazy-loaded via createRequire for ESM compatibility
const require_ = createRequire(import.meta.url);

let nativeRecorder: any = null;

function loadNative() {
  if (!nativeRecorder) {
    const native = require_('@agivar/native');
    nativeRecorder = {
      startRecordingWgc: native.startRecordingWgc,
      startRecordingDxgi: native.startRecordingDxgi,
      stopRecording: native.stopRecording,
      getRecordingStatus: native.getRecordingStatus,
      forceStopAllRecordings: native.forceStopAllRecordings,
    };
  }
  return nativeRecorder;
}

export type RecorderBackend = 'dxgi' | 'wgc';

export interface RecordConfig {
  backend: RecorderBackend;
  targetHwnd?: number;
  fps?: number;
  outputDir: string;
}

export interface RecordResult {
  sessionId: string;
  backend: string;
  frameCount: number;
  durationMs: number;
  outputPath: string;
  droppedFrames: number;
}

export interface RecordingStatus {
  sessionId: string;
  isRecording: boolean;
  frameCount: number;
  elapsedMs: number;
}

export async function startRecording(config: RecordConfig): Promise<ToolResult<{ sessionId: string }>> {
  const start = performance.now();
  try {
    const native = loadNative();
    const nativeConfig = {
      backend: config.backend,
      targetHwnd: config.targetHwnd ?? null,
      fps: config.fps ?? 5,
      outputDir: config.outputDir,
    };

    let sessionId: string;
    if (config.backend === 'wgc') {
      sessionId = native.startRecordingWgc(nativeConfig);
    } else {
      sessionId = native.startRecordingDxgi(nativeConfig);
    }

    return toolOk({ sessionId }, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_BACKEND_UNAVAILABLE', err.message, performance.now() - start);
  }
}

export async function stopRecording(sessionId: string): Promise<ToolResult<RecordResult>> {
  const start = performance.now();
  try {
    const native = loadNative();
    const result = native.stopRecording(sessionId);
    return toolOk({
      sessionId: result.sessionId,
      backend: result.backend,
      frameCount: result.frameCount,
      durationMs: result.durationMs,
      outputPath: result.outputPath,
      droppedFrames: result.droppedFrames,
    }, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_RESOURCE_LEAK', err.message, performance.now() - start);
  }
}

export async function getRecordingStatus(sessionId: string): Promise<ToolResult<RecordingStatus>> {
  const start = performance.now();
  try {
    const native = loadNative();
    const status = native.getRecordingStatus(sessionId);
    return toolOk({
      sessionId: status.sessionId,
      isRecording: status.isRecording,
      frameCount: status.frameCount,
      elapsedMs: status.elapsedMs,
    }, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_BACKEND_UNAVAILABLE', err.message, performance.now() - start);
  }
}

export async function forceStopAllRecordings(): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    const native = loadNative();
    native.forceStopAllRecordings();
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_RESOURCE_LEAK', err.message, performance.now() - start);
  }
}
