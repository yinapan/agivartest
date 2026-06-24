import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  scanRecordingKeyframeFiles,
  handleRecordingTeachCancelDraftGeneration,
  handleRecordingTeachBuildManifest,
  handleRecordingTeachCleanupOrphans,
  handleRecordingTeachDiscard,
  handleRecordingTeachGenerateDraft,
  handleRecordingTeachListSessions,
  handleRecordingTeachListProviders,
  handleRecordingTeachPreflight,
  handleRecordingTeachReprocessDraft,
  handleRecordingTeachResumeDraft,
  handleRecordingTeachRetryDraftGeneration,
  handleRecordingTeachStop,
  handleRecordingTeachGetTimeline,
  handleRecordingTeachStart,
  handleRecordingTeachGenerationStatus,
  handleRecordingTeachStatus,
  handleRecordingTeachUpdateSessionMetadata,
  resetRecordingTeachProvider,
  setRecordingTeachProvider,
} from '../src/main/recording-teach-ipc.js';
import type { RecordingDraftLink, RecordingSession, RecordingTimeline } from '@agivar/core';

class FakeRecordingRepository {
  sessions = new Map<string, RecordingSession>();
  timelines = new Map<string, RecordingTimeline>();

  async saveSession(session: RecordingSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async getSession(sessionId: string): Promise<RecordingSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async updateSession(session: RecordingSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async saveTimeline(timeline: RecordingTimeline): Promise<void> {
    this.timelines.set(timeline.sessionId, timeline);
  }

  async getTimeline(sessionId: string): Promise<RecordingTimeline | null> {
    return this.timelines.get(sessionId) ?? null;
  }

  async saveDraftLink(link: RecordingDraftLink): Promise<void> {
    this.draftLinks.set(link.sessionId, link);
  }

  async getDraftLink(sessionId: string): Promise<RecordingDraftLink | null> {
    return this.draftLinks.get(sessionId) ?? null;
  }

  draftLinks = new Map<string, RecordingDraftLink>();

  async listActiveSessions(): Promise<RecordingSession[]> {
    return [...this.sessions.values()].filter((session) =>
      session.status === 'recording' || session.status === 'stopping');
  }

  async listSessions(options?: { includeActive?: boolean }): Promise<RecordingSession[]> {
    return [...this.sessions.values()]
      .filter((session) => options?.includeActive || (session.status !== 'recording' && session.status !== 'stopping'))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateSessionMetadata(sessionId: string, patch: { goal?: string; notes?: string; updatedAt: string }): Promise<RecordingSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const updated = { ...session, goal: patch.goal, notes: patch.notes, updatedAt: patch.updatedAt };
    this.sessions.set(sessionId, updated);
    const timeline = this.timelines.get(sessionId);
    if (timeline) this.timelines.set(sessionId, { ...timeline, goal: patch.goal, notes: patch.notes ?? '' });
    return updated;
  }

  async discardSession(sessionId: string, options: { now: string }): Promise<{ session: RecordingSession | null; warnings: string[] }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { session: null, warnings: [] };
    const timeline = this.timelines.get(sessionId);
    for (const keyframe of timeline?.keyframes ?? []) {
      await rm(keyframe.imagePath, { force: true });
    }
    if (session.videoPath) await rm(session.videoPath, { force: true });
    const discarded = { ...session, status: 'discarded' as const, updatedAt: options.now };
    this.sessions.set(sessionId, discarded);
    const link = this.draftLinks.get(sessionId);
    if (link) this.draftLinks.set(sessionId, { ...link, status: 'discarded', discardedAt: options.now, updatedAt: options.now });
    return { session: discarded, warnings: [] };
  }
}

function makeDeps() {
  const calls: string[] = [];
  return {
    calls,
    recorder: {
      startRecording: async (config: unknown) => {
        calls.push(`start:${JSON.stringify(config)}`);
        return { ok: true as const, data: { sessionId: 'native-rec-1' }, durationMs: 1 };
      },
      stopRecording: async (sessionId: string) => {
        calls.push(`stop:${sessionId}`);
        return {
          ok: true as const,
          data: {
            sessionId,
            backend: 'wgc',
            frameCount: 2,
            durationMs: 1000,
            outputPath: 'artifact://video/native-rec-1.mp4',
            droppedFrames: 0,
          },
          durationMs: 1,
        };
      },
    },
    screenshot: {
      getActiveWindow: async () => ({
        ok: true as const,
        data: { hwnd: 42, title: 'Notepad', x: 0, y: 0, width: 800, height: 600, isMinimized: false },
        durationMs: 1,
      }),
    },
    frameScanner: async () => [
      {
        imagePath: 'artifact://recordings/session/frame-000001.png',
        hash: 'sha256-frame-1',
        fileSize: 123,
        mimeType: 'image/png',
      },
      {
        imagePath: 'artifact://recordings/session/frame-000002.png',
        hash: 'sha256-frame-2',
        fileSize: 456,
        mimeType: 'image/png',
      },
    ],
    eventCapture: {
      startEventCapture: async (sessionId: string, config: unknown) => {
        calls.push(`events:start:${sessionId}:${JSON.stringify(config)}`);
        return { ok: true as const, data: undefined, durationMs: 1 };
      },
      stopEventCapture: async (sessionId: string) => {
        calls.push(`events:stop:${sessionId}`);
        return { ok: true as const, data: undefined, durationMs: 1 };
      },
      drainEvents: async (sessionId: string) => {
        calls.push(`events:drain:${sessionId}`);
        return {
          ok: true as const,
          data: [
            {
              id: 'evt-1',
              sessionId,
              timestampMs: 120,
              type: 'click' as const,
              summary: 'Clicked primary action',
              redactionLevel: 'summary' as const,
              windowTitle: 'Notepad',
              processName: 'notepad.exe',
              status: 'active' as const,
            },
          ],
          durationMs: 1,
        };
      },
    },
    preflight: async () => ({ ok: true as const, data: { canRecord: true, warnings: [], artifactBytes: 0 }, durationMs: 1 }),
  };
}

function ok<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`expected ok: ${JSON.stringify(result.error)}`);
  expect(result.ok).toBe(true);
  return result.data;
}

function makeActiveSession(overrides?: Partial<RecordingSession>): RecordingSession {
  return {
    id: 'rec-active',
    scope: 'fullscreen',
    privacyMode: 'summary',
    status: 'recording',
    artifactDir: 'artifact://recordings/rec-active',
    createdAt: '2026-06-24T10:00:00.000Z',
    updatedAt: '2026-06-24T10:00:00.000Z',
    startedAt: '2026-06-24T10:00:00.000Z',
    nativeSessionId: 'native-rec-1',
    ...overrides,
  };
}

async function startAndStop(repo: FakeRecordingRepository, deps = makeDeps()) {
  const started = ok(await handleRecordingTeachStart(repo as never, {
    scope: 'fullscreen',
    privacyMode: 'summary',
  }, deps as never));
  const stopped = ok(await handleRecordingTeachStop(repo as never, started.id, deps as never));
  return { started, stopped, deps };
}

describe('recordingTeach IPC helpers - real recorder orchestration', () => {
  it('scans frame files as interval keyframe inputs with SHA-256 hashes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agivar-keyframes-'));
    try {
      await writeFile(join(dir, 'frame-000002.png'), Buffer.from('two'));
      await writeFile(join(dir, 'frame-000001.png'), Buffer.from('one'));
      await writeFile(join(dir, 'notes.txt'), 'ignore me');

      const frames = await scanRecordingKeyframeFiles(dir);

      expect(frames.map((frame) => frame.imagePath)).toEqual([
        join(dir, 'frame-000001.png'),
        join(dir, 'frame-000002.png'),
      ]);
      expect(frames[0].hash).toHaveLength(64);
      expect(frames[0].fileSize).toBe(3);
      expect(frames[0].mimeType).toBe('image/png');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('starts fullscreen recording through the recorder adapter', async () => {
    const repo = new FakeRecordingRepository();
    const deps = makeDeps();

    const session = ok(await handleRecordingTeachStart(repo as never, {
      scope: 'fullscreen',
      privacyMode: 'summary',
    }, deps as never));

    expect(session.nativeSessionId).toBe('native-rec-1');
    expect(deps.calls[0]).toContain('"backend":"wgc"');
    expect(deps.calls[0]).toContain('"outputDir"');
  });

  it('starts passive event capture with privacy and scope metadata', async () => {
    const repo = new FakeRecordingRepository();
    const deps = makeDeps();

    const session = ok(await handleRecordingTeachStart(repo as never, {
      scope: 'fullscreen',
      privacyMode: 'summary',
    }, deps as never));

    expect(deps.calls).toContainEqual(expect.stringContaining(`events:start:${session.id}`));
    expect(deps.calls.find((call) => call.startsWith('events:start'))).toContain('"privacyMode":"summary"');
    expect(deps.calls.find((call) => call.startsWith('events:start'))).toContain('"scope":"fullscreen"');
  });

  it('resolves active-window HWND before starting active-window recording', async () => {
    const repo = new FakeRecordingRepository();
    const deps = makeDeps();

    const session = ok(await handleRecordingTeachStart(repo as never, {
      scope: 'active-window',
      privacyMode: 'summary',
    }, deps as never));

    expect(session.nativeTargetHwnd).toBe(42);
    expect(session.activeWindowTitle).toBe('Notepad');
    expect(deps.calls[0]).toContain('"targetHwnd":42');
  });

  it('stops recorder and persists interval keyframes into the timeline', async () => {
    const repo = new FakeRecordingRepository();
    const { started, stopped } = await startAndStop(repo);

    const timeline = await repo.getTimeline(started.id);

    expect(stopped.status).toBe('ready');
    expect(stopped.videoPath).toBe('artifact://video/native-rec-1.mp4');
    expect(timeline!.keyframes).toHaveLength(2);
    expect(timeline!.keyframes[0].reason).toBe('interval');
    expect(timeline!.keyframes[0].includedInProvider).toBe(true);
  });

  it('stops passive event capture and persists captured events', async () => {
    const repo = new FakeRecordingRepository();
    const { started, deps } = await startAndStop(repo);

    const timeline = await repo.getTimeline(started.id);

    expect(deps.calls).toContain(`events:stop:${started.id}`);
    expect(deps.calls).toContain(`events:drain:${started.id}`);
    expect(timeline!.events).toHaveLength(1);
    expect(timeline!.events[0]).toMatchObject({
      type: 'click',
      summary: 'Clicked primary action',
      redactionLevel: 'summary',
    });
  });

  it('persists active-window context snapshots into the timeline', async () => {
    const repo = new FakeRecordingRepository();
    const deps = makeDeps();

    const started = ok(await handleRecordingTeachStart(repo as never, {
      scope: 'active-window',
      privacyMode: 'summary',
    }, deps as never));
    await handleRecordingTeachStop(repo as never, started.id, deps as never);

    const timeline = await repo.getTimeline(started.id);

    expect(timeline!.context).toHaveLength(1);
    expect(timeline!.context[0]).toMatchObject({
      kind: 'window',
      summary: {
        title: 'Notepad',
        hwnd: 42,
      },
      source: 'active-window',
      status: 'active',
    });
  });

  it('keeps no recording sessions active after five start-stop cycles', async () => {
    const repo = new FakeRecordingRepository();

    for (let i = 0; i < 5; i++) {
      await startAndStop(repo, makeDeps());
    }

    const active = [...repo.sessions.values()].filter((session) =>
      session.status === 'recording' || session.status === 'stopping');
    expect(active).toEqual([]);
  });
});

describe('recordingTeach IPC helpers', () => {
  afterEach(() => {
    resetRecordingTeachProvider();
  });

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

  it('rejects concurrent starts from repository state without renderer activeSessionId', async () => {
    const repo = new FakeRecordingRepository();
    await repo.saveSession(makeActiveSession());

    const result = await handleRecordingTeachStart(repo as never, {
      scope: 'fullscreen',
      privacyMode: 'summary',
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

  it('builds a pending provider manifest for user confirmation', async () => {
    const repo = new FakeRecordingRepository();
    await repo.saveSession(makeActiveSession({ status: 'ready' }));
    await repo.saveTimeline({
      sessionId: 'rec-active',
      notes: 'Saved a note',
      scope: 'fullscreen',
      privacyMode: 'summary',
      startedAt: '2026-06-24T10:00:00.000Z',
      stoppedAt: '2026-06-24T10:00:05.000Z',
      keyframes: [{
        id: 'kf-1',
        sessionId: 'rec-active',
        timestampMs: 0,
        imagePath: 'artifact://kf-1.png',
        reason: 'interval',
        redacted: false,
        status: 'active',
        hash: 'sha256-kf-1',
        fileSize: 1234,
        mimeType: 'image/png',
        includedInProvider: true,
      }],
      events: [],
      context: [],
      warnings: [],
    });

    const result = ok(await handleRecordingTeachBuildManifest(repo as never, 'rec-active', 'test-provider'));

    expect(result.status).toBe('pending');
    expect(result.selectedArtifactIds).toEqual(['kf-1']);
  });

  it('uses the configured recording provider name for manifests and draft generation', async () => {
    const repo = new FakeRecordingRepository();
    await repo.saveSession(makeActiveSession({ status: 'ready' }));
    await repo.saveTimeline({
      sessionId: 'rec-active',
      goal: 'Save note',
      notes: 'Saved a note',
      scope: 'fullscreen',
      privacyMode: 'summary',
      startedAt: '2026-06-24T10:00:00.000Z',
      stoppedAt: '2026-06-24T10:00:05.000Z',
      keyframes: [],
      events: [{
        id: 'evt-1',
        sessionId: 'rec-active',
        timestampMs: 100,
        type: 'click',
        summary: 'Clicked Save',
        redactionLevel: 'summary',
        status: 'active',
      }],
      context: [],
      warnings: [],
    });
    let providerNameSeen = '';
    setRecordingTeachProvider('openai-compatible', {
      async generateWorkflowDraft(payload) {
        providerNameSeen = payload.providerName;
        return {
          draft: {
            appName: 'Notepad',
            platform: 'desktop',
            topic: 'Save note',
            triggerExamples: ['save note'],
            summary: 'Saved a note',
            initialState: 'Notepad is open',
            steps: [{ intent: 'Click Save', targetHint: 'Save', target: { strategy: 'human', hint: 'Save' }, riskLevel: 'low' }],
            successCriteria: 'The note is saved.',
            riskLevel: 'low',
            sourceType: 'recording',
          },
          evidence: [],
          warnings: [],
        };
      },
    });

    const manifest = ok(await handleRecordingTeachBuildManifest(repo as never, 'rec-active'));
    const generated = ok(await handleRecordingTeachGenerateDraft(repo as never, {
      sessionId: 'rec-active',
      manifest: { ...manifest, status: 'confirmed' },
    }));

    expect(manifest.providerName).toBe('openai-compatible');
    expect(providerNameSeen).toBe('openai-compatible');
    expect(generated.draftJson.topic).toBe('Save note');
  });

  it('lists deterministic and configured recording providers for renderer selection', async () => {
    setRecordingTeachProvider('openai-compatible', {
      async generateWorkflowDraft() {
        throw new Error('not used');
      },
    });

    const result = ok(await handleRecordingTeachListProviders());

    expect(result).toEqual({
      selectedProviderName: 'openai-compatible',
      providers: [
        { name: 'recording-teaching-provider', label: 'Deterministic regression provider', available: true },
        { name: 'openai-compatible', label: 'OpenAI-compatible recording provider', available: true },
      ],
    });
  });

  it('supports draft generation retry, reprocess, status, and cancellation semantics', async () => {
    const repo = new FakeRecordingRepository();
    await repo.saveSession(makeActiveSession({ status: 'ready' }));
    await repo.saveTimeline({
      sessionId: 'rec-active',
      goal: 'Save note',
      notes: 'Saved a note',
      scope: 'fullscreen',
      privacyMode: 'summary',
      startedAt: '2026-06-24T10:00:00.000Z',
      stoppedAt: '2026-06-24T10:00:05.000Z',
      keyframes: [],
      events: [{
        id: 'evt-1',
        sessionId: 'rec-active',
        timestampMs: 100,
        type: 'click',
        summary: 'Clicked Save',
        redactionLevel: 'summary',
        status: 'active',
      }],
      context: [],
      warnings: [],
    });
    let attempts = 0;
    setRecordingTeachProvider('openai-compatible', {
      async generateWorkflowDraft() {
        attempts += 1;
        if (attempts === 1) throw new Error('provider unavailable');
        return {
          draft: {
            appName: 'Notepad',
            platform: 'desktop',
            topic: `Save note attempt ${attempts}`,
            triggerExamples: ['save note'],
            summary: 'Saved a note',
            initialState: 'Notepad is open',
            steps: [{ id: 'step-1', intent: 'Click Save', targetHint: 'Save', target: { strategy: 'human', hint: 'Save' }, riskLevel: 'low' }],
            successCriteria: 'The note is saved.',
            riskLevel: 'low',
            sourceType: 'recording',
          },
          evidence: [],
          warnings: [],
        };
      },
    });

    const manifest = ok(await handleRecordingTeachBuildManifest(repo as never, 'rec-active'));
    const failed = await handleRecordingTeachGenerateDraft(repo as never, {
      sessionId: 'rec-active',
      manifest: { ...manifest, status: 'confirmed' },
    });
    const afterFailure = ok(await handleRecordingTeachGenerationStatus('rec-active'));
    const retried = ok(await handleRecordingTeachRetryDraftGeneration(repo as never, 'rec-active'));
    const reprocessed = ok(await handleRecordingTeachReprocessDraft(repo as never, {
      sessionId: 'rec-active',
      providerName: 'openai-compatible',
    }));
    const cancelled = ok(await handleRecordingTeachCancelDraftGeneration('rec-active'));
    const afterCancel = ok(await handleRecordingTeachGenerationStatus('rec-active'));

    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('RECORDING_PROVIDER_FAILED');
    expect(afterFailure.status).toBe('failed');
    expect(afterFailure.canRetry).toBe(true);
    expect(retried.draftJson.topic).toBe('Save note attempt 2');
    expect(reprocessed.draftJson.topic).toBe('Save note attempt 3');
    expect(cancelled.status).toBe('cancelled');
    expect(afterCancel.status).toBe('cancelled');
    expect(afterCancel.canRetry).toBe(true);
  });

  it('lists and edits non-active recording history sessions', async () => {
    const repo = new FakeRecordingRepository();
    await repo.saveSession(makeActiveSession({ id: 'rec-active', status: 'recording', updatedAt: '2026-06-24T10:04:00.000Z' }));
    await repo.saveSession(makeActiveSession({ id: 'rec-old', status: 'ready', goal: 'Old', updatedAt: '2026-06-24T10:01:00.000Z' }));
    await repo.saveSession(makeActiveSession({ id: 'rec-new', status: 'draft_ready', goal: 'New', updatedAt: '2026-06-24T10:03:00.000Z' }));

    const history = ok(await handleRecordingTeachListSessions(repo as never, { includeActive: false }));
    const updated = ok(await handleRecordingTeachUpdateSessionMetadata(repo as never, {
      sessionId: 'rec-old',
      goal: 'Updated old',
      notes: 'Updated notes',
    }));

    expect(history.map((session) => session.id)).toEqual(['rec-new', 'rec-old']);
    expect(updated.goal).toBe('Updated old');
    expect(updated.notes).toBe('Updated notes');
  });

  it('discards recording sessions and tolerates repeated cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agivar-ipc-discard-'));
    const artifactDir = join(root, 'rec-active');
    const framePath = join(artifactDir, 'frame-000001.png');
    const videoPath = join(artifactDir, 'capture.mp4');
    await mkdir(artifactDir, { recursive: true });
    await writeFile(framePath, 'frame');
    await writeFile(videoPath, 'video');
    try {
      const repo = new FakeRecordingRepository();
      await repo.saveSession(makeActiveSession({ status: 'ready', artifactDir, videoPath }));
      await repo.saveTimeline({
        sessionId: 'rec-active',
        notes: 'Saved a note',
        scope: 'fullscreen',
        privacyMode: 'summary',
        startedAt: '2026-06-24T10:00:00.000Z',
        stoppedAt: '2026-06-24T10:00:05.000Z',
        keyframes: [{
          id: 'kf-1',
          sessionId: 'rec-active',
          timestampMs: 0,
          imagePath: framePath,
          reason: 'interval',
          redacted: false,
          status: 'active',
          hash: 'sha256-kf-1',
          fileSize: 1234,
          mimeType: 'image/png',
          includedInProvider: true,
        }],
        events: [],
        context: [],
        warnings: [],
      });

      const first = ok(await handleRecordingTeachDiscard(repo as never, 'rec-active'));
      const second = ok(await handleRecordingTeachDiscard(repo as never, 'rec-active'));

      expect(first.session!.status).toBe('discarded');
      expect(second.session!.status).toBe('discarded');
      await expect(access(framePath)).rejects.toThrow();
      await expect(access(videoPath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleans startup orphan sessions and force-stops native recordings on quit', async () => {
    const repo = new FakeRecordingRepository();
    const deps = makeDeps();
    await repo.saveSession(makeActiveSession({ id: 'rec-recording', status: 'recording', nativeSessionId: 'native-recording' }));
    await repo.saveSession(makeActiveSession({ id: 'rec-stopping', status: 'stopping', nativeSessionId: 'native-stopping' }));

    const cleanup = ok(await handleRecordingTeachCleanupOrphans(repo as never, deps as never));

    expect(cleanup.cleanedSessionIds).toEqual(['rec-recording', 'rec-stopping']);
    expect((await repo.getSession('rec-recording'))!.status).toBe('failed');
    expect((await repo.getSession('rec-stopping'))!.status).toBe('failed');
    expect(deps.calls).toContain('stop:native-recording');
    expect(deps.calls).toContain('stop:native-stopping');
  });

  it('preflights recording permissions and artifact storage before start', async () => {
    const deps = makeDeps();

    const result = ok(await handleRecordingTeachPreflight(deps as never));

    expect(result.canRecord).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.artifactBytes).toBe(0);
  });

  it('generates and resumes a persisted recording draft after manifest confirmation', async () => {
    const repo = new FakeRecordingRepository();
    await repo.saveSession(makeActiveSession({ status: 'ready' }));
    await repo.saveTimeline({
      sessionId: 'rec-active',
      goal: 'Save note',
      notes: 'Saved a note',
      scope: 'fullscreen',
      privacyMode: 'summary',
      startedAt: '2026-06-24T10:00:00.000Z',
      stoppedAt: '2026-06-24T10:00:05.000Z',
      keyframes: [],
      events: [{
        id: 'evt-1',
        sessionId: 'rec-active',
        timestampMs: 100,
        type: 'click',
        summary: 'Clicked Save',
        redactionLevel: 'summary',
        status: 'active',
      }],
      context: [],
      warnings: [],
    });
    const manifest = ok(await handleRecordingTeachBuildManifest(repo as never, 'rec-active', 'test-provider'));

    const generated = ok(await handleRecordingTeachGenerateDraft(repo as never, {
      sessionId: 'rec-active',
      manifest: { ...manifest, status: 'confirmed' },
    }));
    const resumed = ok(await handleRecordingTeachResumeDraft(repo as never, 'rec-active'));

    expect(generated.status).toBe('draft_ready');
    expect(generated.draftJson.sourceType).toBe('recording');
    expect(resumed).toEqual(generated);
  });

  it('rejects tampered provider manifests before provider invocation', async () => {
    const repo = new FakeRecordingRepository();
    await repo.saveSession(makeActiveSession({ status: 'ready' }));
    await repo.saveTimeline({
      sessionId: 'rec-active',
      goal: 'Save note',
      notes: 'Saved a note',
      scope: 'fullscreen',
      privacyMode: 'summary',
      startedAt: '2026-06-24T10:00:00.000Z',
      stoppedAt: '2026-06-24T10:00:05.000Z',
      keyframes: [{
        id: 'kf-1',
        sessionId: 'rec-active',
        timestampMs: 0,
        imagePath: 'artifact://kf-1.png',
        reason: 'interval',
        redacted: false,
        status: 'active',
        hash: 'sha256-kf-1',
        fileSize: 1234,
        mimeType: 'image/png',
        includedInProvider: true,
      }],
      events: [],
      context: [],
      warnings: [],
    });
    const manifest = ok(await handleRecordingTeachBuildManifest(repo as never, 'rec-active', 'test-provider'));
    let providerInvoked = false;

    const result = await handleRecordingTeachGenerateDraft(repo as never, {
      sessionId: 'rec-active',
      manifest: {
        ...manifest,
        status: 'confirmed',
        selectedArtifactIds: [],
      },
    }, {
      async generateWorkflowDraft() {
        providerInvoked = true;
        throw new Error('should not invoke provider');
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_MANIFEST_TAMPERED');
    expect(providerInvoked).toBe(false);
  });
});
