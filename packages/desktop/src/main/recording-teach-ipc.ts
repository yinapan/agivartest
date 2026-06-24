import { nanoid } from 'nanoid';
import type {
  RecordingPrivacyMode,
  RecordingRepository,
  RecordingScope,
  RecordingSession,
  RecordingTimeline,
} from '@agivar/core';
import { ipcErr, safeIpc, type IpcResult } from './workflow-ipc.js';

export interface RecordingTeachStartRequest {
  scope: RecordingScope;
  privacyMode: RecordingPrivacyMode;
  goal?: string;
  notes?: string;
  activeSessionId?: string;
}

export async function handleRecordingTeachStart(
  repo: RecordingRepository | null,
  request: unknown,
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
    const session: RecordingSession = {
      id: sessionId,
      scope: request.scope,
      privacyMode: request.privacyMode,
      status: 'recording',
      artifactDir: `artifact://recordings/${sessionId}`,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      ...(request.goal ? { goal: request.goal.trim() } : {}),
      ...(request.notes ? { notes: request.notes.trim() } : {}),
    };
    await repo.saveSession(session);
    return session;
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
