# Phase 4A Recording Teaching UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable renderer workflow for recording teaching: setup, start/stop, timeline review, manifest confirmation, draft generation, and handoff into the existing workflow editor.

**Architecture:** Keep recording UI state in a focused renderer model and panel component. `RecordingTeachPanel` calls the existing preload IPC APIs and emits generated drafts to `WorkflowsPage`; `WorkflowsPage` remains responsible for validation and saving through the existing editor path. Main process remains the source of truth for recording lifecycle state so later recording-bar and overlay windows can reuse the same contract.

**Tech Stack:** React, TypeScript, Electron preload IPC, Vitest, existing `@agivar/core` and `@agivar/desktop` packages.

---

## File Structure

- Create `packages/desktop/src/renderer/pages/recording-teach-model.ts`
  - Renderer DTOs for recording sessions, timelines, manifests, draft links, and panel state.
  - Pure helpers for initial state, status labels, timeline summaries, manifest summaries, confirmed manifests, and draft handoff.

- Create `packages/desktop/tests/recording-teach-model.test.ts`
  - Unit tests for all pure helpers.

- Create `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`
  - UI for setup, start/stop, timeline summary, manifest confirmation, draft generation, and resume.
  - Calls `window.agivar.recordingTeach.*`.
  - Emits generated draft through `onDraftGenerated`.
  - Requires explicit acknowledgement before starting in detailed privacy mode.

- Modify `packages/desktop/src/renderer/pages/WorkflowsPage.tsx`
  - Import and render `RecordingTeachPanel`.
  - Add a handoff callback that places generated recording drafts into the existing editor.
  - Default `changeNote` to `recording teaching`.

- Modify `packages/desktop/src/renderer/pages/workflow-editor-model.ts`
  - Extend `WorkflowMemoryVersion.source` to include `recording-teach`.
  - Add a helper if needed for applying generated recording drafts.
  - Ensure recording-generated versions persist with source `recording-teach`, not `text-teach`.

- Modify `packages/desktop/tests/workflow-editor-model.test.ts`
  - Cover recording source type and version source display if helper/type behavior changes.

---

### Task 1: Add Recording Teach Renderer Model

**Files:**
- Create: `packages/desktop/src/renderer/pages/recording-teach-model.ts`
- Create: `packages/desktop/tests/recording-teach-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `packages/desktop/tests/recording-teach-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildConfirmedManifest,
  createInitialRecordingTeachState,
  manifestSummary,
  recordingStatusLabel,
  timelineSummary,
  toEditorDraft,
  type ProviderPayloadManifestDto,
  type RecordingDraftLinkDto,
  type RecordingTimelineDto,
} from '../src/renderer/pages/recording-teach-model.js';

const timeline: RecordingTimelineDto = {
  sessionId: 'rec-1',
  notes: 'Saved a note',
  scope: 'active-window',
  privacyMode: 'summary',
  startedAt: '2026-06-24T10:00:00.000Z',
  stoppedAt: '2026-06-24T10:00:10.000Z',
  keyframes: [{ id: 'kf-1', status: 'active' }],
  events: [{ id: 'ev-1', type: 'click', summary: 'Clicked Save', status: 'active' }],
  context: [{ id: 'ctx-1', kind: 'window', summary: { title: 'Notepad' }, status: 'active' }],
  warnings: ['event capture degraded'],
};

const manifest: ProviderPayloadManifestDto = {
  id: 'manifest-1',
  sessionId: 'rec-1',
  providerName: 'recording-provider',
  selectedArtifactIds: ['kf-1', 'ev-1'],
  redactionPolicy: { privacyMode: 'summary' },
  containsRawText: false,
  containsPreciseCoordinates: false,
  estimatedBytes: 4096,
  createdAt: '2026-06-24T10:00:11.000Z',
  status: 'pending',
};

const draftLink: RecordingDraftLinkDto = {
  id: 'draft-link-1',
  sessionId: 'rec-1',
  status: 'draft_ready',
  draftJson: {
    appName: 'Notepad',
    platform: 'desktop',
    topic: 'Save note',
    triggerExamples: ['save note'],
    summary: 'Save a note.',
    initialState: 'Notepad is open.',
    steps: [{ intent: 'Click Save', targetHint: 'Save button', riskLevel: 'low' }],
    successCriteria: 'The note is saved.',
    riskLevel: 'low',
    sourceType: 'recording',
  },
  evidence: [],
  createdAt: '2026-06-24T10:00:12.000Z',
  updatedAt: '2026-06-24T10:00:12.000Z',
};

describe('recording teach model', () => {
  it('creates a summary-mode idle initial state', () => {
    expect(createInitialRecordingTeachState()).toMatchObject({
      phase: 'idle',
      scope: 'active-window',
      privacyMode: 'summary',
      session: null,
      timeline: null,
      manifest: null,
      draftLink: null,
      error: '',
    });
  });

  it('builds readable status labels', () => {
    expect(recordingStatusLabel('recording')).toBe('Recording');
    expect(recordingStatusLabel('draft_ready')).toBe('Draft ready');
  });

  it('summarizes timeline evidence counts and warnings', () => {
    expect(timelineSummary(timeline)).toEqual({
      keyframeCount: 1,
      eventCount: 1,
      contextCount: 1,
      warningCount: 1,
      durationSeconds: 10,
    });
  });

  it('summarizes provider manifests for confirmation', () => {
    expect(manifestSummary(manifest)).toEqual({
      artifactCount: 2,
      estimatedKb: 4,
      includesRawText: false,
      includesPreciseCoordinates: false,
      providerName: 'recording-provider',
    });
  });

  it('marks manifests confirmed without mutating the original object', () => {
    const confirmed = buildConfirmedManifest(manifest);

    expect(confirmed.status).toBe('confirmed');
    expect(manifest.status).toBe('pending');
  });

  it('converts a recording draft link into an editor draft', () => {
    expect(toEditorDraft(draftLink)).toMatchObject({
      topic: 'Save note',
      sourceType: 'recording',
      steps: [{ intent: 'Click Save' }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run packages/desktop/tests/recording-teach-model.test.ts
```

Expected: FAIL because `recording-teach-model.ts` does not exist.

- [ ] **Step 3: Implement the model**

Create `packages/desktop/src/renderer/pages/recording-teach-model.ts`:

```ts
import type { WorkflowDraft } from './workflow-editor-model.js';

export type RecordingScopeDto = 'fullscreen' | 'active-window';
export type RecordingPrivacyModeDto = 'summary' | 'detailed';
export type RecordingPanelPhase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'ready'
  | 'manifest_ready'
  | 'generating'
  | 'draft_ready'
  | 'failed';

export type RecordingSessionDto = {
  id: string;
  scope: RecordingScopeDto;
  privacyMode: RecordingPrivacyModeDto;
  status: 'idle' | 'recording' | 'stopping' | 'ready' | 'draft_ready' | 'failed' | 'discarded';
  goal?: string;
  notes?: string;
  artifactDir: string;
  videoPath?: string;
  activeWindowTitle?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  stoppedAt?: string;
};

export type RecordingTimelineDto = {
  sessionId: string;
  goal?: string;
  notes: string;
  scope: RecordingScopeDto;
  privacyMode: RecordingPrivacyModeDto;
  startedAt: string;
  stoppedAt: string;
  keyframes: Array<{ id: string; imagePath?: string; reason?: string; status: string }>;
  events: Array<{ id: string; type: string; summary: string; status: string }>;
  context: Array<{ id: string; kind: string; summary: Record<string, unknown>; status: string }>;
  warnings: string[];
};

export type ProviderPayloadManifestDto = {
  id: string;
  sessionId: string;
  providerName: string;
  selectedArtifactIds: string[];
  redactionPolicy: Record<string, unknown>;
  containsRawText: boolean;
  containsPreciseCoordinates: boolean;
  estimatedBytes: number;
  createdAt: string;
  status: 'pending' | 'confirmed' | 'sent' | 'failed';
};

export type RecordingDraftLinkDto = {
  id: string;
  sessionId: string;
  draftJson: WorkflowDraft;
  status: 'draft_ready' | 'saved' | 'discarded';
  evidence: unknown[];
  createdAt: string;
  updatedAt: string;
};

export type RecordingTeachState = {
  phase: RecordingPanelPhase;
  scope: RecordingScopeDto;
  privacyMode: RecordingPrivacyModeDto;
  goal: string;
  notes: string;
  session: RecordingSessionDto | null;
  timeline: RecordingTimelineDto | null;
  manifest: ProviderPayloadManifestDto | null;
  draftLink: RecordingDraftLinkDto | null;
  error: string;
};

export function createInitialRecordingTeachState(): RecordingTeachState {
  return {
    phase: 'idle',
    scope: 'active-window',
    privacyMode: 'summary',
    goal: '',
    notes: '',
    session: null,
    timeline: null,
    manifest: null,
    draftLink: null,
    error: '',
  };
}

export function recordingStatusLabel(status: RecordingSessionDto['status']): string {
  const labels: Record<RecordingSessionDto['status'], string> = {
    idle: 'Idle',
    recording: 'Recording',
    stopping: 'Stopping',
    ready: 'Ready',
    draft_ready: 'Draft ready',
    failed: 'Failed',
    discarded: 'Discarded',
  };
  return labels[status];
}

export function timelineSummary(timeline: RecordingTimelineDto): {
  keyframeCount: number;
  eventCount: number;
  contextCount: number;
  warningCount: number;
  durationSeconds: number;
} {
  const started = Date.parse(timeline.startedAt);
  const stopped = Date.parse(timeline.stoppedAt);
  const durationSeconds = Number.isFinite(started) && Number.isFinite(stopped)
    ? Math.max(0, Math.round((stopped - started) / 1000))
    : 0;
  return {
    keyframeCount: timeline.keyframes.length,
    eventCount: timeline.events.length,
    contextCount: timeline.context.length,
    warningCount: timeline.warnings.length,
    durationSeconds,
  };
}

export function manifestSummary(manifest: ProviderPayloadManifestDto): {
  artifactCount: number;
  estimatedKb: number;
  includesRawText: boolean;
  includesPreciseCoordinates: boolean;
  providerName: string;
} {
  return {
    artifactCount: manifest.selectedArtifactIds.length,
    estimatedKb: Math.ceil(manifest.estimatedBytes / 1024),
    includesRawText: manifest.containsRawText,
    includesPreciseCoordinates: manifest.containsPreciseCoordinates,
    providerName: manifest.providerName,
  };
}

export function buildConfirmedManifest(manifest: ProviderPayloadManifestDto): ProviderPayloadManifestDto {
  return { ...manifest, status: 'confirmed' };
}

export function toEditorDraft(link: RecordingDraftLinkDto): WorkflowDraft {
  return {
    ...link.draftJson,
    sourceType: 'recording',
    inputs: link.draftJson.inputs ?? [],
  };
}
```

- [ ] **Step 4: Run model test to verify it passes**

Run:

```bash
pnpm vitest run packages/desktop/tests/recording-teach-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/desktop/src/renderer/pages/recording-teach-model.ts packages/desktop/tests/recording-teach-model.test.ts
git commit -m "feat: add recording teach renderer model"
```

---

### Task 2: Add RecordingTeachPanel Component

**Files:**
- Create: `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`

- [ ] **Step 1: Create the panel component**

Create `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { getIpcErrorMessage, type IpcResult, type WorkflowDraft } from './workflow-editor-model.js';
import {
  buildConfirmedManifest,
  createInitialRecordingTeachState,
  manifestSummary,
  recordingStatusLabel,
  timelineSummary,
  toEditorDraft,
  type ProviderPayloadManifestDto,
  type RecordingDraftLinkDto,
  type RecordingSessionDto,
  type RecordingTimelineDto,
} from './recording-teach-model.js';

export interface RecordingTeachPanelProps {
  disabled?: boolean;
  onDraftGenerated(draft: WorkflowDraft, changeNote: string): void;
}

export function RecordingTeachPanel({ disabled, onDraftGenerated }: RecordingTeachPanelProps) {
  const [state, setState] = useState(createInitialRecordingTeachState);
  const [detailedModeAcknowledged, setDetailedModeAcknowledged] = useState(false);
  const isBusy = disabled || state.phase === 'starting' || state.phase === 'stopping' || state.phase === 'generating';
  const requiresDetailedAck = state.privacyMode === 'detailed' && !detailedModeAcknowledged;
  const timelineInfo = state.timeline ? timelineSummary(state.timeline) : null;
  const manifestInfo = state.manifest ? manifestSummary(state.manifest) : null;
  const detailWarning = state.privacyMode === 'detailed'
    ? 'Detailed mode may retain raw text or precise coordinates locally. Review the manifest before generating a draft.'
    : '';

  async function startRecording() {
    if (requiresDetailedAck) {
      setState((current) => ({ ...current, error: 'Acknowledge detailed mode before starting.' }));
      return;
    }
    setState((current) => ({ ...current, phase: 'starting', error: '', session: null, timeline: null, manifest: null, draftLink: null }));
    const result = await window.agivar.recordingTeach.start({
      scope: state.scope,
      privacyMode: state.privacyMode,
      goal: state.goal || undefined,
      notes: state.notes || undefined,
      activeSessionId: state.session?.id,
    }) as IpcResult<RecordingSessionDto>;

    if (!result.ok) {
      setState((current) => ({ ...current, phase: 'failed', error: getIpcErrorMessage(result) }));
      return;
    }
    setState((current) => ({ ...current, phase: 'recording', session: result.data, error: '' }));
  }

  async function stopRecording() {
    if (!state.session) return;
    setState((current) => ({ ...current, phase: 'stopping', error: '' }));
    const stopped = await window.agivar.recordingTeach.stop(state.session.id) as IpcResult<RecordingSessionDto>;
    if (!stopped.ok) {
      setState((current) => ({ ...current, phase: 'failed', error: getIpcErrorMessage(stopped) }));
      return;
    }

    const timeline = await window.agivar.recordingTeach.getTimeline(stopped.data.id) as IpcResult<RecordingTimelineDto>;
    if (!timeline.ok) {
      setState((current) => ({ ...current, phase: 'failed', session: stopped.data, error: getIpcErrorMessage(timeline) }));
      return;
    }
    setState((current) => ({ ...current, phase: 'ready', session: stopped.data, timeline: timeline.data, error: '' }));
  }

  async function buildManifest() {
    if (!state.session) return;
    const result = await window.agivar.recordingTeach.buildManifest(state.session.id, 'recording-teaching-provider') as IpcResult<ProviderPayloadManifestDto>;
    if (!result.ok) {
      setState((current) => ({ ...current, error: getIpcErrorMessage(result) }));
      return;
    }
    setState((current) => ({ ...current, phase: 'manifest_ready', manifest: result.data, error: '' }));
  }

  async function generateDraft() {
    if (!state.session || !state.manifest) return;
    setState((current) => ({ ...current, phase: 'generating', error: '' }));
    const result = await window.agivar.recordingTeach.generateDraft({
      sessionId: state.session.id,
      manifest: buildConfirmedManifest(state.manifest),
    }) as IpcResult<RecordingDraftLinkDto>;
    if (!result.ok) {
      setState((current) => ({ ...current, phase: 'manifest_ready', error: getIpcErrorMessage(result) }));
      return;
    }
    const draft = toEditorDraft(result.data);
    onDraftGenerated(draft, 'recording teaching');
    setState((current) => ({ ...current, phase: 'draft_ready', draftLink: result.data, error: '' }));
  }

  async function resumeDraft() {
    if (!state.session) return;
    const result = await window.agivar.recordingTeach.resumeDraft(state.session.id) as IpcResult<RecordingDraftLinkDto>;
    if (!result.ok) {
      setState((current) => ({ ...current, error: getIpcErrorMessage(result) }));
      return;
    }
    onDraftGenerated(toEditorDraft(result.data), 'recording teaching');
    setState((current) => ({ ...current, phase: 'draft_ready', draftLink: result.data, error: '' }));
  }

  const recentEvents = useMemo(() => state.timeline?.events.slice(0, 5) ?? [], [state.timeline]);

  return (
    <section className="border border-border rounded p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Recording teaching</h2>
        <span className="text-xs text-text-secondary">{state.session ? recordingStatusLabel(state.session.status) : state.phase}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select disabled={isBusy} value={state.scope} onChange={(e) => setState((current) => ({ ...current, scope: e.target.value as typeof current.scope }))} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm">
          <option value="active-window">active-window</option>
          <option value="fullscreen">fullscreen</option>
        </select>
        <select disabled={isBusy} value={state.privacyMode} onChange={(e) => {
          const privacyMode = e.target.value as typeof state.privacyMode;
          setDetailedModeAcknowledged(privacyMode !== 'detailed');
          setState((current) => ({ ...current, privacyMode }));
        }} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm">
          <option value="summary">summary</option>
          <option value="detailed">detailed</option>
        </select>
        <input disabled={isBusy} value={state.goal} onChange={(e) => setState((current) => ({ ...current, goal: e.target.value }))} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Recording goal" />
        <input disabled={isBusy} value={state.notes} onChange={(e) => setState((current) => ({ ...current, notes: e.target.value }))} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Recording notes" />
      </div>

      {detailWarning && <div className="text-xs text-yellow-300">{detailWarning}</div>}
      {state.privacyMode === 'detailed' && (
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={detailedModeAcknowledged} onChange={(e) => setDetailedModeAcknowledged(e.target.checked)} disabled={isBusy} />
          I understand detailed mode may keep raw local evidence until I delete it.
        </label>
      )}

      <div className="flex gap-2">
        <button disabled={isBusy || state.phase === 'recording' || requiresDetailedAck} onClick={startRecording} className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm py-2 px-3 rounded">
          {state.phase === 'starting' ? 'Starting...' : 'Start'}
        </button>
        <button disabled={isBusy || state.phase !== 'recording'} onClick={stopRecording} className="border border-border disabled:opacity-50 text-sm py-2 px-3 rounded">
          {state.phase === 'stopping' ? 'Stopping...' : 'Stop'}
        </button>
        <button disabled={isBusy || !state.timeline} onClick={buildManifest} className="border border-border disabled:opacity-50 text-sm py-2 px-3 rounded">
          Build manifest
        </button>
        <button disabled={isBusy || !state.manifest} onClick={generateDraft} className="border border-border disabled:opacity-50 text-sm py-2 px-3 rounded">
          {state.phase === 'generating' ? 'Generating...' : 'Confirm & generate'}
        </button>
        <button disabled={isBusy || !state.session} onClick={resumeDraft} className="border border-border disabled:opacity-50 text-sm py-2 px-3 rounded">
          Resume draft
        </button>
      </div>

      {state.error && <div className="text-sm text-red-400">{state.error}</div>}

      {timelineInfo && (
        <div className="grid grid-cols-5 gap-2 text-xs text-text-secondary">
          <div>Frames: {timelineInfo.keyframeCount}</div>
          <div>Events: {timelineInfo.eventCount}</div>
          <div>Context: {timelineInfo.contextCount}</div>
          <div>Warnings: {timelineInfo.warningCount}</div>
          <div>{timelineInfo.durationSeconds}s</div>
        </div>
      )}

      {recentEvents.length > 0 && (
        <ul className="space-y-1 text-xs text-text-secondary">
          {recentEvents.map((event) => <li key={event.id} className="truncate">{event.type}: {event.summary}</li>)}
        </ul>
      )}

      {manifestInfo && (
        <div className="border border-border rounded p-2 text-xs text-text-secondary grid grid-cols-2 gap-1">
          <div>Provider: {manifestInfo.providerName}</div>
          <div>Artifacts: {manifestInfo.artifactCount}</div>
          <div>Size: {manifestInfo.estimatedKb} KB</div>
          <div>Raw text: {manifestInfo.includesRawText ? 'yes' : 'no'}</div>
          <div>Coordinates: {manifestInfo.includesPreciseCoordinates ? 'yes' : 'no'}</div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Run desktop build**

Run:

```bash
pnpm --filter @agivar/desktop build
```

Expected: PASS with only existing Vite/Rollup warnings.

- [ ] **Step 3: Record state-event follow-up**

If the current preload already exposes a recording state event, subscribe to it and keep panel state aligned with main-process state. If it does not, add a TODO in the component or model that names the intended future API, for example `recordingTeach.onStateChanged(listener)`, so the later compact recording bar does not introduce a second lifecycle contract.

- [ ] **Step 4: Commit Task 2**

```bash
git add packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx
git commit -m "feat: add recording teach panel"
```

---

### Task 3: Wire RecordingTeachPanel Into WorkflowsPage

**Files:**
- Modify: `packages/desktop/src/renderer/pages/WorkflowsPage.tsx`
- Modify: `packages/desktop/src/renderer/pages/workflow-editor-model.ts`
- Modify: `packages/desktop/tests/workflow-editor-model.test.ts`

- [ ] **Step 1: Update WorkflowMemoryVersion source type**

Modify `packages/desktop/src/renderer/pages/workflow-editor-model.ts`:

```ts
export type WorkflowMemoryVersion = {
  id: string;
  memoryId: string;
  version: number;
  snapshot: WorkflowDraft;
  changeNote?: string;
  source: 'create' | 'edit' | 'rollback' | 'import' | 'text-teach' | 'recording-teach';
  createdAt: string;
};
```

- [ ] **Step 2: Add a recording source test**

Append to `packages/desktop/tests/workflow-editor-model.test.ts`:

```ts
it('previews recording-created workflow versions', () => {
  const preview = versionPreview({
    id: 'version-recording',
    memoryId: 'mem-recording',
    version: 1,
    source: 'recording-teach',
    changeNote: 'recording teaching',
    createdAt: '2026-06-24T00:00:00.000Z',
    snapshot: { ...draft, sourceType: 'recording', topic: 'Recorded workflow' },
  });

  expect(preview.topic).toBe('Recorded workflow');
});
```

- [ ] **Step 3: Run the workflow model test**

Run:

```bash
pnpm vitest run packages/desktop/tests/workflow-editor-model.test.ts
```

Expected: PASS.

- [ ] **Step 4: Verify recording source persistence**

Trace the save path from generated recording draft handoff through `memory.saveDraft` / `memory.update`. If any renderer save helper defaults to `text-teach`, add a source parameter or helper so recording-generated versions persist as `recording-teach`.

- [ ] **Step 5: Render RecordingTeachPanel in WorkflowsPage**

Modify `packages/desktop/src/renderer/pages/WorkflowsPage.tsx`:

```ts
import { RecordingTeachPanel } from './RecordingTeachPanel.js';
```

Add this function inside `WorkflowsPage`:

```ts
function applyRecordingDraft(recordingDraft: WorkflowDraft, note: string) {
  setDraft({ ...createEmptyDraft(), ...recordingDraft, sourceType: 'recording', inputs: recordingDraft.inputs ?? [] });
  setSelected(null);
  setChangeNote(note);
  setValidationErrors([]);
  setValidationWarnings([]);
  setMessage('Recording draft generated');
}
```

Render the panel at the top of `<main>` before the text teaching section:

```tsx
<RecordingTeachPanel disabled={isBusy} onDraftGenerated={applyRecordingDraft} />
```

- [ ] **Step 6: Run desktop build**

Run:

```bash
pnpm --filter @agivar/desktop build
```

Expected: PASS with only existing Vite/Rollup warnings.

- [ ] **Step 7: Commit Task 3**

```bash
git add packages/desktop/src/renderer/pages/WorkflowsPage.tsx packages/desktop/src/renderer/pages/workflow-editor-model.ts packages/desktop/tests/workflow-editor-model.test.ts
git commit -m "feat: wire recording teach panel into workflows"
```

---

### Task 4: Run Phase 4A Verification

**Files:**
- Verify: `packages/desktop/src/renderer/pages/recording-teach-model.ts`
- Verify: `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`
- Verify: `packages/desktop/src/renderer/pages/WorkflowsPage.tsx`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/workflow-editor-model.test.ts packages/desktop/tests/recording-teach-ipc.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run builds**

Run:

```bash
pnpm --filter @agivar/core build
pnpm --filter @agivar/desktop build
```

Expected: both PASS. Desktop build may print existing external/eval warnings.

- [ ] **Step 3: Check git diff**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors; branch only contains intended Phase 4A commits.

- [ ] **Step 4: Required manual smoke**

Run the app with the project’s normal dev command:

```bash
pnpm dev
```

Manual smoke:

- Open Workflows page.
- Verify recording teaching panel is visible.
- Start active-window recording.
- Stop recording.
- Verify timeline counts appear.
- Build manifest.
- Confirm and generate draft.
- Verify editor fields populate with `sourceType: recording`.
- Verify detailed mode cannot start until the user acknowledges the privacy warning.
- Verify saved recording-generated versions use `recording-teach`.

- [ ] **Step 5: Record Phase 4A+/4C follow-up work**

Before closing Phase 4A, create or update the follow-up checklist for:

- Compact recording bar window backed by main-process state events.
- Recording history with list, rename, delete, and lazy keyframe preview.
- Discard, cancel-processing, and reprocess controls.
- Permission preflight and selected screen-scope preference.
- Persisted note / annotation editing instead of local-only panel edits.

- [ ] **Step 6: Push branch only when requested**

```bash
git push
```

Expected: remote `master` receives Phase 4A commits only if the user explicitly asks to push.

---

## Self-Review

- Spec coverage: Phase 4A setup, recording, timeline summary, manifest confirmation, draft generation, and editor handoff are covered.
- Intentional gaps: real provider work is Phase 4B; discard/cleanup/orphan recovery is Phase 4C.
- Placeholder scan: no task uses unspecified implementation instructions.
- Type consistency: DTO names match the current preload IPC names and existing workflow editor model patterns.
