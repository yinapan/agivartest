import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  RecordingKeyframe,
  RecordingPrivacyMode,
  RecordingRepository,
  RecordingScope,
  RecordingSession,
  RecordingTimeline,
} from '@agivar/core';
import { recorder as defaultRecorder, screenshot as defaultScreenshot } from '@agivar/core';
import { ipcErr, safeIpc, type IpcResult } from './workflow-ipc.js';

export interface RecordingTeachStartRequest {
  scope: RecordingScope;
  privacyMode: RecordingPrivacyMode;
  goal?: string;
  notes?: string;
  activeSessionId?: string;
}

export interface RecordingTeachIpcOptions {
  deps?: RecordingTeachDeps;
}

export interface RecordingTeachDeps {
  recorder: {
    startRecording(config: {
      backend: 'wgc' | 'dxgi';
      fps: number;
      outputDir: string;
      targetHwnd?: number;
    }): Promise<{ ok: true; data: { sessionId: string } } | { ok: false; error: { code: string; message: string } }>;
    stopRecording(sessionId: string): Promise<{
      ok: true;
      data: {
        sessionId: string;
        backend: string;
        frameCount: number;
        durationMs: number;
        outputPath: string;
        droppedFrames: number;
      };
    } | { ok: false; error: { code: string; message: string } }>;
  };
  screenshot: {
    getActiveWindow(): Promise<{
      ok: true;
      data: { hwnd: number; title: string };
    } | { ok: false; error: { code: string; message: string } }>;
  };
  frameScanner(artifactDir: string): Promise<Array<{
    imagePath: string;
    hash: string;
    fileSize: number;
    mimeType: string;
  }>>;
  artifactRoot?: string;
}

export async function handleRecordingTeachStart(
  repo: RecordingRepository | null,
  request: unknown,
  deps?: RecordingTeachDeps,
): Promise<IpcResult<RecordingSession>> {
  if (!repo) return ipcErr('NO_RECORDING_STORE', 'RecordingStore not initialized');

  return safeIpc(async () => {
    assertStartRequest(request);
    if (request.activeSessionId) {
      const active = await repo.getSession(request.activeSessionId);
      if (active && (active.status === 'recording' || active.status === 'stopping')) {
        throw new RecordingTeachIpcError('RECORDING_ALREADY_ACTIVE', 'A recording session is already active');
      }
    }

    const now = new Date().toISOString();
    const sessionId = nanoid();
    const artifactDir = deps?.artifactRoot
      ? join(deps.artifactRoot, sessionId)
      : `artifact://recordings/${sessionId}`;
    let nativeSessionId: string | undefined;
    let nativeTargetHwnd: number | undefined;
    let activeWindowTitle: string | undefined;

    if (deps) {
      const recordConfig: {
        backend: 'wgc';
        fps: number;
        outputDir: string;
        targetHwnd?: number;
      } = {
        backend: 'wgc',
        fps: 1,
        outputDir: artifactDir,
      };

      if (request.scope === 'active-window') {
        const activeWindow = await deps.screenshot.getActiveWindow();
        if (!activeWindow.ok) {
          throw new RecordingTeachIpcError(activeWindow.error.code, activeWindow.error.message);
        }
        nativeTargetHwnd = activeWindow.data.hwnd;
        activeWindowTitle = activeWindow.data.title;
        recordConfig.targetHwnd = activeWindow.data.hwnd;
      }

      const started = await deps.recorder.startRecording(recordConfig);
      if (!started.ok) {
        throw new RecordingTeachIpcError(started.error.code, started.error.message);
      }
      nativeSessionId = started.data.sessionId;
    }

    const session: RecordingSession = {
      id: sessionId,
      scope: request.scope,
      privacyMode: request.privacyMode,
      status: 'recording',
      artifactDir,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      ...(nativeSessionId ? { nativeSessionId } : {}),
      ...(typeof nativeTargetHwnd === 'number' ? { nativeTargetHwnd } : {}),
      ...(activeWindowTitle ? { activeWindowTitle } : {}),
      ...(request.goal ? { goal: request.goal.trim() } : {}),
      ...(request.notes ? { notes: request.notes.trim() } : {}),
    };
    await repo.saveSession(session);
    return session;
  });
}

export async function handleRecordingTeachStop(
  repo: RecordingRepository | null,
  sessionId: unknown,
  deps?: RecordingTeachDeps,
): Promise<IpcResult<RecordingSession>> {
  if (!repo) return ipcErr('NO_RECORDING_STORE', 'RecordingStore not initialized');

  return safeIpc(async () => {
    assertSessionId(sessionId);
    const session = await repo.getSession(sessionId);
    if (!session) {
      throw new RecordingTeachIpcError('RECORDING_SESSION_NOT_FOUND', 'Recording session not found');
    }
    if (session.status !== 'recording' && session.status !== 'stopping') {
      throw new RecordingTeachIpcError('RECORDING_SESSION_NOT_ACTIVE', 'Recording session is not active');
    }

    const stopping = {
      ...session,
      status: 'stopping' as const,
      updatedAt: new Date().toISOString(),
    };
    await repo.updateSession(stopping);

    const stopResult = deps && session.nativeSessionId
      ? await deps.recorder.stopRecording(session.nativeSessionId)
      : null;
    if (stopResult && !stopResult.ok) {
      const failed = {
        ...stopping,
        status: 'failed' as const,
        updatedAt: new Date().toISOString(),
      };
      await repo.updateSession(failed);
      throw new RecordingTeachIpcError(stopResult.error.code, stopResult.error.message);
    }

    const stoppedAt = new Date().toISOString();
    const frames = deps ? await deps.frameScanner(session.artifactDir) : [];
    const keyframes: RecordingKeyframe[] = frames.map((frame, index) => ({
      id: nanoid(),
      sessionId: session.id,
      timestampMs: index * 1000,
      imagePath: frame.imagePath,
      reason: 'interval',
      redacted: false,
      status: 'active',
      hash: frame.hash,
      fileSize: frame.fileSize,
      mimeType: frame.mimeType,
      includedInProvider: true,
    }));

    const ready: RecordingSession = {
      ...stopping,
      status: 'ready',
      videoPath: stopResult?.ok ? stopResult.data.outputPath : stopping.videoPath,
      stoppedAt,
      updatedAt: stoppedAt,
    };
    await repo.updateSession(ready);
    await repo.saveTimeline({
      sessionId: ready.id,
      goal: ready.goal,
      notes: ready.notes ?? '',
      scope: ready.scope,
      privacyMode: ready.privacyMode,
      startedAt: ready.startedAt ?? ready.createdAt,
      stoppedAt,
      keyframes,
      events: [],
      context: [],
      warnings: [],
    });

    return ready;
  });
}

export async function handleRecordingTeachStatus(
  repo: RecordingRepository | null,
  sessionId: unknown,
): Promise<IpcResult<RecordingSession>> {
  if (!repo) return ipcErr('NO_RECORDING_STORE', 'RecordingStore not initialized');

  return safeIpc(async () => {
    assertSessionId(sessionId);
    const session = await repo.getSession(sessionId);
    if (!session) {
      throw new RecordingTeachIpcError('RECORDING_SESSION_NOT_FOUND', 'Recording session not found');
    }
    return session;
  });
}

export async function handleRecordingTeachGetTimeline(
  repo: RecordingRepository | null,
  sessionId: unknown,
): Promise<IpcResult<RecordingTimeline>> {
  if (!repo) return ipcErr('NO_RECORDING_STORE', 'RecordingStore not initialized');

  return safeIpc(async () => {
    assertSessionId(sessionId);
    const session = await repo.getSession(sessionId);
    if (!session) {
      throw new RecordingTeachIpcError('RECORDING_SESSION_NOT_FOUND', 'Recording session not found');
    }
    const timeline = await repo.getTimeline(sessionId);
    if (!timeline) {
      throw new RecordingTeachIpcError('RECORDING_TIMELINE_NOT_FOUND', 'Recording timeline not found');
    }
    return timeline;
  });
}

class RecordingTeachIpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function assertStartRequest(value: unknown): asserts value is RecordingTeachStartRequest {
  if (!isRecord(value)) throw new Error('request must be an object');
  if (value.scope !== 'fullscreen' && value.scope !== 'active-window') {
    throw new Error('scope is invalid');
  }
  if (value.privacyMode !== 'summary' && value.privacyMode !== 'detailed') {
    throw new Error('privacyMode is invalid');
  }
  if ('goal' in value && value.goal !== undefined) assertString(value.goal, 'goal', 500);
  if ('notes' in value && value.notes !== undefined) assertString(value.notes, 'notes', 20000);
  if ('activeSessionId' in value && value.activeSessionId !== undefined) {
    assertString(value.activeSessionId, 'activeSessionId', 200);
  }
}

function assertSessionId(value: unknown): asserts value is string {
  assertString(value, 'sessionId', 200);
}

function assertString(value: unknown, field: string, max: number): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (value.trim().length > max) throw new Error(`${field} is too long`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function recordingTeachErrorToIpcResult(err: unknown): IpcResult<never> | null {
  if (err instanceof RecordingTeachIpcError) {
    return ipcErr(err.code, err.message);
  }
  return null;
}

export async function scanRecordingKeyframeFiles(artifactDir: string): Promise<Array<{
  imagePath: string;
  hash: string;
  fileSize: number;
  mimeType: string;
}>> {
  const files = await readdir(artifactDir);
  const frameFiles = files
    .filter((file) => /^frame-\d+\.png$/i.test(file))
    .sort((a, b) => a.localeCompare(b));

  const frames = [];
  for (const file of frameFiles) {
    const imagePath = join(artifactDir, file);
    const [info, buffer] = await Promise.all([
      stat(imagePath),
      readFile(imagePath),
    ]);
    frames.push({
      imagePath,
      hash: createHash('sha256').update(buffer).digest('hex'),
      fileSize: info.size,
      mimeType: 'image/png',
    });
  }
  return frames;
}

export const defaultRecordingTeachDeps: RecordingTeachDeps = {
  recorder: defaultRecorder,
  screenshot: defaultScreenshot,
  frameScanner: scanRecordingKeyframeFiles,
};
