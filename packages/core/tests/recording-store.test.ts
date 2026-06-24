import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('returns null for unknown sessions and timelines', async () => {
    expect(await store.getSession('missing')).toBeNull();
    expect(await store.getTimeline('missing')).toBeNull();
  });
});
