import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { getDatabaseForTest } from '../src/memory/db.js';
import { RecordingStore } from '../src/memory/recording-store.js';
import type { DatabaseLike } from '../src/memory/schema.js';
import type { RecordingDraftLink, RecordingSession, RecordingTimeline } from '../src/types/workflow.js';

const session: RecordingSession = {
  id: 'rec-1',
  scope: 'active-window',
  privacyMode: 'summary',
  status: 'recording',
  goal: 'Save a note',
  notes: 'Open Notepad and save a note.',
  artifactDir: 'artifact://rec-1',
  startedAt: '2026-06-24T10:00:00.000Z',
  createdAt: '2026-06-24T10:00:00.000Z',
  updatedAt: '2026-06-24T10:00:00.000Z',
};

const timeline: RecordingTimeline = {
  sessionId: 'rec-1',
  goal: 'Save a note',
  notes: 'Open Notepad and save a note.',
  scope: 'active-window',
  privacyMode: 'summary',
  startedAt: '2026-06-24T10:00:00.000Z',
  stoppedAt: '2026-06-24T10:01:00.000Z',
  keyframes: [
    {
      id: 'kf-1',
      sessionId: 'rec-1',
      timestampMs: 1000,
      imagePath: 'artifact://rec-1/keyframes/kf-1.png',
      reason: 'interval',
      redacted: false,
      status: 'active',
      hash: 'sha256-kf-1',
      fileSize: 2048,
      mimeType: 'image/png',
      includedInProvider: true,
    },
  ],
  events: [
    {
      id: 'ev-1',
      sessionId: 'rec-1',
      timestampMs: 900,
      type: 'window-change',
      summary: 'Notepad became active.',
      redactionLevel: 'summary',
      windowTitle: 'Untitled - Notepad',
      processName: 'notepad.exe',
      status: 'active',
    },
  ],
  context: [
    {
      id: 'ctx-1',
      sessionId: 'rec-1',
      timestampMs: 950,
      kind: 'window',
      summary: { title: 'Untitled - Notepad' },
      source: 'active-window',
      status: 'active',
    },
  ],
  warnings: [],
};

const draftLink: RecordingDraftLink = {
  id: 'draft-link-1',
  sessionId: 'rec-1',
  draftJson: {
    appName: 'Notepad',
    platform: 'desktop',
    topic: 'Save note',
    triggerExamples: ['save note'],
    summary: 'Save a note from the recording.',
    initialState: 'Notepad is open.',
    steps: [
      {
        id: 'step-1',
        order: 1,
        intent: 'Save the note',
        targetHint: 'Save command',
        target: { strategy: 'human', hint: 'Save command' },
        riskLevel: 'low',
      },
    ],
    successCriteria: 'The note is saved.',
    riskLevel: 'low',
    sourceType: 'recording',
  },
  status: 'draft_ready',
  evidence: [
    {
      id: 'evidence-1',
      sessionId: 'rec-1',
      stepId: 'step-1',
      eventIds: ['ev-1'],
      keyframeIds: ['kf-1'],
      contextIds: ['ctx-1'],
      confidence: 0.87,
      rationale: 'The event and keyframe show the save action.',
    },
  ],
  createdAt: '2026-06-24T10:02:00.000Z',
  updatedAt: '2026-06-24T10:02:00.000Z',
};

describe('RecordingStore', () => {
  let db: DatabaseLike;
  let store: RecordingStore;

  beforeEach(() => {
    db = getDatabaseForTest(':memory:');
    store = new RecordingStore(db);
  });

  afterEach(() => {
    if (db) {
      (db as DatabaseLike & { close(): void }).close();
    }
  });

  it('persists and retrieves recording sessions', async () => {
    await store.saveSession(session);

    const fetched = await store.getSession(session.id);

    expect(fetched).toEqual(session);
  });

  it('updates recording session status and timestamps', async () => {
    await store.saveSession(session);
    await store.updateSession({
      ...session,
      status: 'ready',
      stoppedAt: '2026-06-24T10:01:00.000Z',
      updatedAt: '2026-06-24T10:01:00.000Z',
    });

    const fetched = await store.getSession(session.id);

    expect(fetched!.status).toBe('ready');
    expect(fetched!.stoppedAt).toBe('2026-06-24T10:01:00.000Z');
  });

  it('persists and rebuilds a timeline from events, keyframes, and context', async () => {
    await store.saveSession(session);
    await store.saveTimeline(timeline);

    const fetched = await store.getTimeline(session.id);

    expect(fetched).toEqual(timeline);
  });

  it('marks deleted artifacts unavailable for provider selection', async () => {
    await store.saveSession(session);
    await store.saveTimeline(timeline);

    await store.markArtifactStatus(session.id, 'keyframe', 'kf-1', 'deleted', '2026-06-24T10:02:00.000Z');

    const fetched = await store.getTimeline(session.id);

    expect(fetched!.keyframes[0].status).toBe('deleted');
    expect(fetched!.keyframes[0].deletedAt).toBe('2026-06-24T10:02:00.000Z');
    expect(fetched!.keyframes[0].includedInProvider).toBe(false);
  });

  it('persists and resumes draft generation links', async () => {
    await store.saveSession(session);

    await store.saveDraftLink(draftLink);

    expect(await store.getDraftLink(session.id)).toEqual(draftLink);
  });

  it('lists non-active recording history newest first', async () => {
    await store.saveSession({ ...session, id: 'rec-old', status: 'ready', updatedAt: '2026-06-24T10:01:00.000Z' });
    await store.saveSession({ ...session, id: 'rec-active', status: 'recording', updatedAt: '2026-06-24T10:02:00.000Z' });
    await store.saveSession({ ...session, id: 'rec-new', status: 'draft_ready', updatedAt: '2026-06-24T10:03:00.000Z' });

    const history = await store.listSessions({ includeActive: false });

    expect(history.map((item) => item.id)).toEqual(['rec-new', 'rec-old']);
  });

  it('renames recording goal and notes without changing evidence', async () => {
    await store.saveSession(session);
    await store.saveTimeline(timeline);

    const updated = await store.updateSessionMetadata(session.id, {
      goal: 'Updated goal',
      notes: 'Updated notes',
      updatedAt: '2026-06-24T10:03:00.000Z',
    });

    expect(updated!.goal).toBe('Updated goal');
    expect(updated!.notes).toBe('Updated notes');
    expect((await store.getTimeline(session.id))!.events).toHaveLength(1);
  });

  it('preserves omitted metadata fields during partial rename', async () => {
    await store.saveSession(session);

    const notesOnly = await store.updateSessionMetadata(session.id, {
      notes: 'Only notes changed',
      updatedAt: '2026-06-24T10:03:00.000Z',
    });
    const goalOnly = await store.updateSessionMetadata(session.id, {
      goal: 'Only goal changed',
      updatedAt: '2026-06-24T10:04:00.000Z',
    });

    expect(notesOnly!.goal).toBe('Save a note');
    expect(notesOnly!.notes).toBe('Only notes changed');
    expect(goalOnly!.goal).toBe('Only goal changed');
    expect(goalOnly!.notes).toBe('Only notes changed');
  });

  it('discards a recording idempotently and removes local artifacts best-effort', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agivar-recording-discard-'));
    const artifactDir = join(root, 'rec-1');
    const framePath = join(artifactDir, 'frame-000001.png');
    const videoPath = join(artifactDir, 'capture.mp4');
    await mkdir(artifactDir, { recursive: true });
    await writeFile(framePath, 'frame');
    await writeFile(videoPath, 'video');
    try {
      await store.saveSession({ ...session, artifactDir, videoPath });
      await store.saveTimeline({
        ...timeline,
        keyframes: [{ ...timeline.keyframes[0], imagePath: framePath }],
      });
      await store.saveDraftLink(draftLink);

      const first = await store.discardSession(session.id, { now: '2026-06-24T10:04:00.000Z', artifactRoot: root });
      const second = await store.discardSession(session.id, { now: '2026-06-24T10:05:00.000Z', artifactRoot: root });

      expect(first.session?.status).toBe('discarded');
      expect(second.session?.status).toBe('discarded');
      await expect(access(framePath)).rejects.toThrow();
      await expect(access(videoPath)).rejects.toThrow();
      expect(await store.getDraftLink(session.id)).toMatchObject({ status: 'discarded' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to delete discard paths outside the artifact root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agivar-recording-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'agivar-recording-outside-'));
    const outsideFrame = join(outside, 'do-not-delete.png');
    await writeFile(outsideFrame, 'outside');
    try {
      await store.saveSession({ ...session, artifactDir: root });
      await store.saveTimeline({
        ...timeline,
        keyframes: [{ ...timeline.keyframes[0], imagePath: outsideFrame }],
      });

      const result = await store.discardSession(session.id, {
        now: '2026-06-24T10:04:00.000Z',
        artifactRoot: root,
      });

      await expect(access(outsideFrame)).resolves.toBeUndefined();
      expect(result.warnings.join('\n')).toContain('outside artifact root');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('returns null for unknown sessions and timelines', async () => {
    expect(await store.getSession('missing')).toBeNull();
    expect(await store.getTimeline('missing')).toBeNull();
  });
});
