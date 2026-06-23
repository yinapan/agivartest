import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toolOk, toolErr, type ToolResult } from '../types/errors.js';
import { captureScreen, captureWindow } from './screenshot.js';

// native module — lazy-loaded via createRequire for ESM compatibility
const require_ = createRequire(import.meta.url);

let nativeRecorder: any = null;
const captureSessions = new Map<string, CaptureSession>();

interface CaptureSession {
  timer: ReturnType<typeof setInterval>;
  lastCapture: Promise<void>;
  frameCount: number;
  droppedFrames: number;
  outputDir: string;
  targetHwnd?: number;
  inFlight: boolean;
}

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
    const nativeConfig: {
      backend: RecorderBackend;
      fps: number;
      outputDir: string;
      targetHwnd?: number;
    } = {
      backend: config.backend,
      fps: config.fps ?? 5,
      outputDir: config.outputDir,
    };
    if (typeof config.targetHwnd === 'number') {
      nativeConfig.targetHwnd = config.targetHwnd;
    }

    let sessionId: string;
    if (config.backend === 'wgc') {
      sessionId = native.startRecordingWgc(nativeConfig);
    } else {
      sessionId = native.startRecordingDxgi(nativeConfig);
    }

    await startFrameCapture(sessionId, config);
    return toolOk({ sessionId }, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_BACKEND_UNAVAILABLE', err.message, performance.now() - start);
  }
}

export async function stopRecording(sessionId: string): Promise<ToolResult<RecordResult>> {
  const start = performance.now();
  try {
    const captureSession = captureSessions.get(sessionId);
    if (captureSession) {
      clearInterval(captureSession.timer);
      await captureSession.lastCapture;
      captureSessions.delete(sessionId);
    }

    const native = loadNative();
    const result = native.stopRecording(sessionId);
    return toolOk({
      sessionId: result.sessionId,
      backend: result.backend,
      frameCount: Math.max(result.frameCount, captureSession?.frameCount ?? 0),
      durationMs: result.durationMs,
      outputPath: result.outputPath,
      droppedFrames: result.droppedFrames + (captureSession?.droppedFrames ?? 0),
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
    const captureSession = captureSessions.get(sessionId);
    return toolOk({
      sessionId: status.sessionId,
      isRecording: status.isRecording,
      frameCount: Math.max(status.frameCount, captureSession?.frameCount ?? 0),
      elapsedMs: status.elapsedMs,
    }, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_BACKEND_UNAVAILABLE', err.message, performance.now() - start);
  }
}

export async function forceStopAllRecordings(): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    for (const [sessionId, captureSession] of captureSessions) {
      clearInterval(captureSession.timer);
      await captureSession.lastCapture;
      captureSessions.delete(sessionId);
    }

    const native = loadNative();
    native.forceStopAllRecordings();
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_RESOURCE_LEAK', err.message, performance.now() - start);
  }
}

async function startFrameCapture(sessionId: string, config: RecordConfig): Promise<void> {
  await mkdir(config.outputDir, { recursive: true });

  const fps = Math.max(1, config.fps ?? 5);
  const intervalMs = Math.max(1000 / fps, 50);
  const session: CaptureSession = {
    timer: undefined as unknown as ReturnType<typeof setInterval>,
    lastCapture: Promise.resolve(),
    frameCount: 0,
    droppedFrames: 0,
    outputDir: config.outputDir,
    targetHwnd: config.targetHwnd,
    inFlight: false,
  };

  const captureOnce = async () => {
    if (session.inFlight) {
      session.droppedFrames++;
      return;
    }

    session.inFlight = true;
    try {
      const frameIndex = session.frameCount + 1;
      const frame =
        typeof session.targetHwnd === 'number'
          ? await captureWindow(session.targetHwnd)
          : await captureScreen();

      if (!frame.ok) {
        session.droppedFrames++;
        return;
      }

      const filePath = join(session.outputDir, `frame-${String(frameIndex).padStart(6, '0')}.png`);
      await writeFile(filePath, frame.data.buffer);
      session.frameCount = frameIndex;
    } catch {
      session.droppedFrames++;
    } finally {
      session.inFlight = false;
    }
  };

  session.lastCapture = captureOnce();
  session.timer = setInterval(() => {
    session.lastCapture = captureOnce();
  }, intervalMs);
  captureSessions.set(sessionId, session);
}
