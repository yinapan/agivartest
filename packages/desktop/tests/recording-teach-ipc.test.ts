import { describe, expect, it } from 'vitest';
import {
  handleRecordingTeachGetTimeline,
  handleRecordingTeachStart,
  handleRecordingTeachStatus,
} from '../src/main/recording-teach-ipc.js';
import type { RecordingSession } from '@agivar/core';

class FakeRecordingRepository {
  sessions = new Map<string, RecordingSession>();

  async saveSession(session: RecordingSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async getSession(sessionId: string): Promise<RecordingSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async getTimeline(): Promise<null> {
    return null;
  }
}

describe('recordingTeach IPC helpers', () => {
  it('rejects invalid start payloads with stable IPC errors', async () => {
    const result = await handleRecordingTeachStart(new FakeRecordingRepository() as never, {
      scope: 'bad',
      privacyMode: 'summary',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_PAYLOAD');
  });

  it('starts a local recording teaching session without invoking real recorder', async () => {
    const repo = new FakeRecordingRepository();

    const result = await handleRecordingTeachStart(repo as never, {
      scope: 'active-window',
      privacyMode: 'summary',
      goal: 'Save a note',
      notes: 'Open Notepad and save.',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('recording');
      expect(result.data.artifactDir).toContain(result.data.id);
      expect(await repo.getSession(result.data.id)).toEqual(result.data);
    }
  });

  it('rejects concurrent starts when a session is already active', async () => {
    const active: RecordingSession = {
      id: 'rec-active',
      scope: 'fullscreen',
      privacyMode: 'summary',
      status: 'recording',
      artifactDir: 'artifact://recordings/rec-active',
      createdAt: '2026-06-24T10:00:00.000Z',
      updatedAt: '2026-06-24T10:00:00.000Z',
    };
    const repo = new FakeRecordingRepository();
    await repo.saveSession(active);

    const result = await handleRecordingTeachStart(repo as never, {
      scope: 'fullscreen',
      privacyMode: 'summary',
      activeSessionId: active.id,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RECORDING_ALREADY_ACTIVE');
  });

  it('returns stable missing-session errors for status and timeline reads', async () => {
    const repo = new FakeRecordingRepository();

    const status = await handleRecordingTeachStatus(repo as never, 'missing');
    const timeline = await handleRecordingTeachGetTimeline(repo as never, 'missing');

    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.error.code).toBe('RECORDING_SESSION_NOT_FOUND');
    expect(timeline.ok).toBe(false);
    if (!timeline.ok) expect(timeline.error.code).toBe('RECORDING_SESSION_NOT_FOUND');
  });
});
