import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  RecordingKeyframe,
  RecordingContextSnapshot,
  ProviderPayloadManifest,
  RecordingDraftLink,
  RecordingEvent,
  RecordingPrivacyMode,
  RecordingRepository,
  RecordingScope,
  RecordingSession,
  RecordingTimeline,
  RecordingWorkflowProvider,
} from '@agivar/core';
import {
  buildProviderPayloadManifest,
  eventCapture as defaultEventCapture,
  recorder as defaultRecorder,
  RecordingTeachingService,
  screenshot as defaultScreenshot,
} from '@agivar/core';
import { ipcErr, safeIpc, type IpcResult } from './workflow-ipc.js';

export interface RecordingTeachStartRequest {
  scope: RecordingScope;
  privacyMode: RecordingPrivacyMode;
  goal?: string;
  notes?: string;
  activeSessionId?: string;
}

export interface RecordingTeachGenerateDraftRequest {
  sessionId: string;
  manifest: ProviderPayloadManifest;
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
  eventCapture?: {
    startEventCapture(sessionId: string, config: {
      scope: RecordingScope;
      privacyMode: RecordingPrivacyMode;
      targetHwnd?: number;
      windowTitle?: string;
    }): Promise<{ ok: true; data: void; durationMs: number } | { ok: false; error: { code: string; message: string }; durationMs: number }>;
    stopEventCapture(sessionId: string): Promise<{ ok: true; data: void; durationMs: number } | { ok: false; error: { code: string; message: string }; durationMs: number }>;
    drainEvents(sessionId: string): Promise<{ ok: true; data: RecordingEvent[]; durationMs: number } | { ok: false; error: { code: string; message: string }; durationMs: number }>;
  };
  artifactRoot?: string;
}

interface RecordingTeachProviderSelection {
  name: string;
  provider: RecordingWorkflowProvider;
}

const deterministicProviderName = 'recording-teaching-provider';
let recordingTeachProviderSelection: RecordingTeachProviderSelection = {
  name: deterministicProviderName,
  provider: createDeterministicRecordingProvider(deterministicProviderName),
};

export function setRecordingTeachProvider(name: string, provider: RecordingWorkflowProvider): void {
  recordingTeachProviderSelection = { name, provider };
}

export function resetRecordingTeachProvider(): void {
  recordingTeachProviderSelection = {
    name: deterministicProviderName,
    provider: createDeterministicRecordingProvider(deterministicProviderName),
  };
}

export async function handleRecordingTeachStart(
  repo: RecordingRepository | null,
  request: unknown,
  deps?: RecordingTeachDeps,
): Promise<IpcResult<RecordingSession>> {
  if (!repo) return ipcErr('NO_RECORDING_STORE', 'RecordingStore not initialized');

  return safeIpc(async () => {
    assertStartRequest(request);
    const activeSession = await findActiveRecordingSession(repo, request.activeSessionId);
    if (activeSession) {
      throw new RecordingTeachIpcError('RECORDING_ALREADY_ACTIVE', 'A recording session is already active');
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

    if (deps?.eventCapture) {
      const eventStarted = await deps.eventCapture.startEventCapture(session.id, {
        scope: session.scope,
        privacyMode: session.privacyMode,
        ...(typeof session.nativeTargetHwnd === 'number' ? { targetHwnd: session.nativeTargetHwnd } : {}),
        ...(session.activeWindowTitle ? { windowTitle: session.activeWindowTitle } : {}),
      });
      if (!eventStarted.ok && eventStarted.error.code !== 'EVENT_CAPTURE_UNAVAILABLE') {
        throw new RecordingTeachIpcError(eventStarted.error.code, eventStarted.error.message);
      }
    }

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
    if (deps?.eventCapture) {
      const eventStopped = await deps.eventCapture.stopEventCapture(session.id);
      if (!eventStopped.ok && eventStopped.error.code !== 'EVENT_CAPTURE_UNAVAILABLE') {
        const failed = {
          ...stopping,
          status: 'failed' as const,
          updatedAt: new Date().toISOString(),
        };
        await repo.updateSession(failed);
        throw new RecordingTeachIpcError(eventStopped.error.code, eventStopped.error.message);
      }
    }
    const eventDrainResult = deps?.eventCapture
      ? await deps.eventCapture.drainEvents(session.id)
      : null;
    if (eventDrainResult && !eventDrainResult.ok && eventDrainResult.error.code !== 'EVENT_CAPTURE_UNAVAILABLE') {
      throw new RecordingTeachIpcError(eventDrainResult.error.code, eventDrainResult.error.message);
    }
    const events = eventDrainResult?.ok ? eventDrainResult.data : [];
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
    const context = buildContextSnapshots(session);

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
      events,
      context,
      warnings: [],
    });

    return ready;
  });
}

function buildContextSnapshots(session: RecordingSession): RecordingContextSnapshot[] {
  if (!session.activeWindowTitle && typeof session.nativeTargetHwnd !== 'number') return [];
  return [{
    id: nanoid(),
    sessionId: session.id,
    timestampMs: 0,
    kind: 'window',
    summary: {
      ...(session.activeWindowTitle ? { title: session.activeWindowTitle } : {}),
      ...(typeof session.nativeTargetHwnd === 'number' ? { hwnd: session.nativeTargetHwnd } : {}),
    },
    source: 'active-window',
    status: 'active',
  }];
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

export async function handleRecordingTeachBuildManifest(
  repo: RecordingRepository | null,
  sessionId: unknown,
  providerName = recordingTeachProviderSelection.name,
): Promise<IpcResult<ProviderPayloadManifest>> {
  if (!repo) return ipcErr('NO_RECORDING_STORE', 'RecordingStore not initialized');

  return safeIpc(async () => {
    assertSessionId(sessionId);
    const timeline = await repo.getTimeline(sessionId);
    if (!timeline) {
      throw new RecordingTeachIpcError('RECORDING_TIMELINE_NOT_FOUND', 'Recording timeline not found');
    }
    return buildProviderPayloadManifest(timeline, {
      id: nanoid(),
      providerName,
      createdAt: new Date().toISOString(),
    });
  });
}

export async function handleRecordingTeachGenerateDraft(
  repo: RecordingRepository | null,
  request: unknown,
  provider: RecordingWorkflowProvider = recordingTeachProviderSelection.provider,
): Promise<IpcResult<RecordingDraftLink>> {
  if (!repo) return ipcErr('NO_RECORDING_STORE', 'RecordingStore not initialized');

  return safeIpc(async () => {
    assertGenerateDraftRequest(request);
    const timeline = await repo.getTimeline(request.sessionId);
    if (!timeline) {
      throw new RecordingTeachIpcError('RECORDING_TIMELINE_NOT_FOUND', 'Recording timeline not found');
    }
    verifySubmittedManifest(timeline, request.manifest);

    const result = await new RecordingTeachingService(provider).generateDraft({
      timeline,
      manifest: request.manifest,
    });
    if (!result.ok || !result.data) {
      throw new RecordingTeachIpcError('RECORDING_DRAFT_INVALID', result.errors.join('; '));
    }

    const now = new Date().toISOString();
    const link: RecordingDraftLink = {
      id: nanoid(),
      sessionId: request.sessionId,
      draftJson: result.data.draft,
      status: 'draft_ready',
      evidence: result.data.evidence,
      createdAt: now,
      updatedAt: now,
    };
    await repo.saveDraftLink(link);
    return link;
  });
}

export async function handleRecordingTeachResumeDraft(
  repo: RecordingRepository | null,
  sessionId: unknown,
): Promise<IpcResult<RecordingDraftLink>> {
  if (!repo) return ipcErr('NO_RECORDING_STORE', 'RecordingStore not initialized');

  return safeIpc(async () => {
    assertSessionId(sessionId);
    const link = await repo.getDraftLink(sessionId);
    if (!link) {
      throw new RecordingTeachIpcError('RECORDING_DRAFT_NOT_FOUND', 'Recording draft link not found');
    }
    return link;
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

async function findActiveRecordingSession(
  repo: RecordingRepository,
  activeSessionId?: string,
): Promise<RecordingSession | null> {
  if (typeof repo.listActiveSessions === 'function') {
    const activeSessions = await repo.listActiveSessions();
    return activeSessions.find((session) =>
      session.status === 'recording' || session.status === 'stopping') ?? null;
  }

  if (!activeSessionId) return null;
  const active = await repo.getSession(activeSessionId);
  if (!active) return null;
  return active.status === 'recording' || active.status === 'stopping' ? active : null;
}

function verifySubmittedManifest(
  timeline: RecordingTimeline,
  manifest: ProviderPayloadManifest,
): void {
  const expected = buildProviderPayloadManifest(timeline, {
    id: manifest.id,
    providerName: manifest.providerName,
    createdAt: manifest.createdAt,
  });
  const expectedConfirmed = { ...expected, status: 'confirmed' as const };
  const normalizedExpected = normalizeManifestForComparison(expectedConfirmed);
  const normalizedSubmitted = normalizeManifestForComparison(manifest);

  if (JSON.stringify(normalizedExpected) !== JSON.stringify(normalizedSubmitted)) {
    throw new RecordingTeachIpcError('PROVIDER_MANIFEST_TAMPERED', 'Provider payload manifest no longer matches recording timeline');
  }
}

function normalizeManifestForComparison(manifest: ProviderPayloadManifest): ProviderPayloadManifest {
  return {
    ...manifest,
    selectedArtifactIds: [...manifest.selectedArtifactIds].sort(),
    redactionPolicy: sortRecord(manifest.redactionPolicy),
  };
}

function sortRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
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

function assertGenerateDraftRequest(value: unknown): asserts value is RecordingTeachGenerateDraftRequest {
  if (!isRecord(value)) throw new Error('request must be an object');
  assertString(value.sessionId, 'sessionId', 200);
  if (!isRecord(value.manifest)) throw new Error('manifest must be an object');
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
  eventCapture: defaultEventCapture,
};

function createDeterministicRecordingProvider(providerName: string): RecordingWorkflowProvider {
  return {
    async generateWorkflowDraft(payload) {
      const topic = payload.goal?.trim() || payload.notes.split(/[.。\n]/)[0]?.trim() || 'Recorded workflow';
      const firstEvidence = {
        id: nanoid(),
        sessionId: payload.sessionId,
        stepId: 'step-1',
        eventIds: payload.events.slice(0, 3).map((event) => event.id),
        keyframeIds: payload.keyframes.slice(0, 3).map((keyframe) => keyframe.id),
        contextIds: payload.context.slice(0, 3).map((context) => context.id),
        confidence: 0.55,
        rationale: 'Draft generated from confirmed recording artifacts.',
      };
      return {
        draft: {
          appName: (payload.context[0]?.summary.title as string | undefined) ?? 'Recorded app',
          platform: 'desktop',
          topic,
          triggerExamples: [topic],
          summary: payload.notes || `Recorded ${topic}.`,
          initialState: payload.context[0]?.summary.title
            ? `Window "${payload.context[0].summary.title}" is active.`
            : 'The recorded application is ready.',
          steps: [{
            id: 'step-1',
            order: 1,
            intent: topic,
            targetHint: payload.events[0]?.summary ?? payload.context[0]?.source ?? 'recorded workflow',
            target: { strategy: 'human', hint: payload.events[0]?.summary ?? 'recorded target' },
            riskLevel: 'low',
          }],
          successCriteria: `Complete ${topic}.`,
          riskLevel: 'low',
          sourceType: 'recording',
        },
        evidence: [firstEvidence],
        warnings: [`provider:${providerName}`],
      };
    },
  };
}
