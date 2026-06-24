# Phase 4C Recording History Cleanup Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 4C by adding recording history, persisted rename, discard cleanup, orphan cleanup, recording preflight, and benchmark hardening reports.

**Architecture:** Extend the existing local-first recording repository instead of adding a second persistence path. Desktop IPC exposes focused handlers over the repository, renderer state consumes those handlers, and benchmark reporting stays in core tests with deterministic fixtures. Cleanup is best-effort and idempotent so missing files or repeated calls do not break the user flow.

**Tech Stack:** TypeScript, Electron main/preload IPC, React renderer, Vitest, Node filesystem APIs, existing `@agivar/core` storage and recording-teaching services.

---

## File Structure

- Modify `packages/core/src/types/workflow.ts`
  - Extend `RecordingRepository` with history, metadata update, and discard methods.
  - Add small result types for discard and benchmark report if they are shared.

- Modify `packages/core/src/memory/recording-store.ts`
  - Implement `listSessions`, `updateSessionMetadata`, and `discardSession`.
  - Add local-path deletion helpers.

- Modify `packages/core/tests/recording-store.test.ts`
  - Cover history listing, rename, discard idempotency, and missing-file cleanup.

- Modify `packages/core/tests/recording-benchmark.test.ts`
  - Add a structured five-recording benchmark report assertion.

- Modify `packages/desktop/src/main/recording-teach-ipc.ts`
  - Add `handleRecordingTeachListSessions`.
  - Add `handleRecordingTeachUpdateSessionMetadata`.
  - Add `handleRecordingTeachDiscard`.
  - Add `handleRecordingTeachCleanupOrphans`.
  - Add `handleRecordingTeachPreflight`.

- Modify `packages/desktop/src/main/ipc.ts`
  - Register the new IPC handlers.

- Modify `packages/desktop/src/main/index.ts`
  - Run startup orphan cleanup after store/deps wiring.
  - Run app quit cleanup before shutdown.

- Modify `packages/desktop/src/preload.ts`
  - Expose the new `recordingTeach` methods.

- Modify `packages/desktop/src/renderer/pages/recording-teach-model.ts`
  - Add DTOs and helpers for history, discard, and preflight summaries.

- Modify `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`
  - Add history list controls, rename controls, discard action, and preflight display.

- Modify `packages/desktop/tests/recording-teach-ipc.test.ts`
  - Cover new IPC behavior.

- Modify `packages/desktop/tests/recording-teach-model.test.ts`
  - Cover renderer helpers.

---

### Task 1: Core Store History, Rename, And Discard

**Files:**
- Modify: `packages/core/src/types/workflow.ts`
- Modify: `packages/core/src/memory/recording-store.ts`
- Test: `packages/core/tests/recording-store.test.ts`

- [ ] **Step 1: Run the existing red tests**

Run:

```powershell
pnpm vitest run packages/core/tests/recording-store.test.ts
```

Expected before implementation:

- `store.listSessions is not a function`
- `store.updateSessionMetadata is not a function`
- `store.discardSession is not a function`

- [ ] **Step 2: Extend repository types**

In `packages/core/src/types/workflow.ts`, extend `RecordingRepository` with:

```ts
listSessions(options?: { includeActive?: boolean; limit?: number }): Promise<RecordingSession[]>;
updateSessionMetadata(
  sessionId: string,
  patch: { goal?: string; notes?: string; updatedAt: string },
): Promise<RecordingSession | null>;
discardSession(
  sessionId: string,
  options: { now: string },
): Promise<{ session: RecordingSession | null; warnings: string[] }>;
```

- [ ] **Step 3: Implement `RecordingStore.listSessions`**

Add to `packages/core/src/memory/recording-store.ts`:

```ts
async listSessions(options: { includeActive?: boolean; limit?: number } = {}): Promise<RecordingSession[]> {
  const where = options.includeActive ? '' : "WHERE status NOT IN ('recording', 'stopping')";
  const limit = typeof options.limit === 'number' && options.limit > 0 ? ' LIMIT ?' : '';
  const params = limit ? [options.limit] : [];
  const rows = this.db
    .prepare(`SELECT * FROM recording_sessions ${where} ORDER BY updated_at DESC${limit}`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => this.rowToSession(row));
}
```

- [ ] **Step 4: Implement `updateSessionMetadata`**

Add:

```ts
async updateSessionMetadata(
  sessionId: string,
  patch: { goal?: string; notes?: string; updatedAt: string },
): Promise<RecordingSession | null> {
  const current = await this.getSession(sessionId);
  if (!current) return null;
  const updated = {
    ...current,
    goal: patch.goal,
    notes: patch.notes,
    updatedAt: patch.updatedAt,
  };
  await this.updateSession(updated);
  return updated;
}
```

- [ ] **Step 5: Implement `discardSession`**

Add local path cleanup helpers and:

```ts
async discardSession(
  sessionId: string,
  options: { now: string },
): Promise<{ session: RecordingSession | null; warnings: string[] }> {
  const session = await this.getSession(sessionId);
  if (!session) return { session: null, warnings: [] };
  const timeline = await this.getTimeline(sessionId);
  const warnings: string[] = [];

  for (const keyframe of timeline?.keyframes ?? []) {
    await removeLocalPath(keyframe.imagePath, warnings);
    await this.markArtifactStatus(sessionId, 'keyframe', keyframe.id, 'deleted', options.now);
  }
  for (const event of timeline?.events ?? []) {
    await this.markArtifactStatus(sessionId, 'event', event.id, 'deleted', options.now);
  }
  for (const context of timeline?.context ?? []) {
    await this.markArtifactStatus(sessionId, 'context', context.id, 'deleted', options.now);
  }
  await removeLocalPath(session.videoPath, warnings);
  await removeLocalPath(session.artifactDir, warnings);

  const link = await this.getDraftLink(sessionId);
  if (link) {
    await this.saveDraftLink({
      ...link,
      status: 'discarded',
      discardedAt: options.now,
      updatedAt: options.now,
    });
  }
  const discarded = { ...session, status: 'discarded' as const, updatedAt: options.now };
  await this.updateSession(discarded);
  return { session: discarded, warnings };
}
```

- [ ] **Step 6: Verify core store tests**

Run:

```powershell
pnpm vitest run packages/core/tests/recording-store.test.ts
```

Expected: all tests in the file pass.

### Task 2: Desktop IPC For History, Rename, Discard, Orphans, And Preflight

**Files:**
- Modify: `packages/desktop/src/main/recording-teach-ipc.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/tests/recording-teach-ipc.test.ts`

- [ ] **Step 1: Run the existing red IPC tests**

Run:

```powershell
pnpm vitest run packages/desktop/tests/recording-teach-ipc.test.ts
```

Expected before implementation:

- missing exported handlers for list, update, discard, cleanup, and preflight.

- [ ] **Step 2: Add handler exports**

In `packages/desktop/src/main/recording-teach-ipc.ts`, add:

```ts
export async function handleRecordingTeachListSessions(repo: RecordingRepository | null, options?: unknown): Promise<IpcResult<RecordingSession[]>>;
export async function handleRecordingTeachUpdateSessionMetadata(repo: RecordingRepository | null, request: unknown): Promise<IpcResult<RecordingSession>>;
export async function handleRecordingTeachDiscard(repo: RecordingRepository | null, sessionId: unknown): Promise<IpcResult<{ session: RecordingSession | null; warnings: string[] }>>;
export async function handleRecordingTeachCleanupOrphans(repo: RecordingRepository | null, deps?: RecordingTeachDeps): Promise<IpcResult<{ cleanedSessionIds: string[]; warnings: string[] }>>;
export async function handleRecordingTeachPreflight(deps?: RecordingTeachDeps): Promise<IpcResult<{ canRecord: boolean; warnings: string[]; artifactBytes: number }>>;
```

- [ ] **Step 3: Implement stable payload validation**

Use existing helpers:

- `assertSessionId`
- `assertString`
- `isRecord`

Validation rules:

- `goal` max length: 500
- `notes` max length: 20000
- `limit` range: 1 to 200

- [ ] **Step 4: Register IPC handlers**

In `packages/desktop/src/main/ipc.ts`, register:

```ts
ipcMain.handle('recordingTeach:listSessions', async (_event, options) =>
  handleRecordingTeachListSessions(recordingStore, options));
ipcMain.handle('recordingTeach:updateSessionMetadata', async (_event, request) =>
  handleRecordingTeachUpdateSessionMetadata(recordingStore, request));
ipcMain.handle('recordingTeach:discard', async (_event, sessionId) =>
  handleRecordingTeachDiscard(recordingStore, sessionId));
ipcMain.handle('recordingTeach:preflight', async () =>
  handleRecordingTeachPreflight(recordingTeachDeps));
```

- [ ] **Step 5: Verify IPC tests**

Run:

```powershell
pnpm vitest run packages/desktop/tests/recording-teach-ipc.test.ts
```

Expected: all tests in the file pass.

### Task 3: Startup And App Quit Cleanup

**Files:**
- Modify: `packages/desktop/src/main/index.ts`
- Test: `packages/desktop/tests/recording-teach-ipc.test.ts`

- [ ] **Step 1: Implement startup orphan cleanup call**

After `setRecordingTeachDeps(...)` and `setRecordingStore(recordingStore)`, call:

```ts
await handleRecordingTeachCleanupOrphans(recordingStore, defaultDeps);
```

Use the actual deps object already passed to `setRecordingTeachDeps`.

- [ ] **Step 2: Implement app quit cleanup**

Register:

```ts
app.on('before-quit', () => {
  void handleRecordingTeachCleanupOrphans(recordingStore, recordingTeachDeps);
  void recorder.forceStopAllRecordings();
});
```

The cleanup is best-effort and must not throw from the event handler.

- [ ] **Step 3: Verify IPC cleanup tests**

Run:

```powershell
pnpm vitest run packages/desktop/tests/recording-teach-ipc.test.ts
```

Expected: orphan cleanup test passes and remains idempotent.

### Task 4: Preload And Renderer History UI

**Files:**
- Modify: `packages/desktop/src/preload.ts`
- Modify: `packages/desktop/src/renderer/pages/recording-teach-model.ts`
- Modify: `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`
- Test: `packages/desktop/tests/recording-teach-model.test.ts`
- Test: `packages/desktop/tests/phase4a-recording-ui-smoke.test.ts`

- [ ] **Step 1: Expose preload APIs**

Add:

```ts
listSessions: (options?: { includeActive?: boolean; limit?: number }) =>
  ipcRenderer.invoke('recordingTeach:listSessions', options),
updateSessionMetadata: (request: { sessionId: string; goal?: string; notes?: string }) =>
  ipcRenderer.invoke('recordingTeach:updateSessionMetadata', request),
discard: (sessionId: string) =>
  ipcRenderer.invoke('recordingTeach:discard', sessionId),
preflight: () =>
  ipcRenderer.invoke('recordingTeach:preflight'),
```

- [ ] **Step 2: Add renderer DTO helpers**

Add DTOs:

```ts
export type RecordingDiscardResultDto = {
  session: RecordingSessionDto | null;
  warnings: string[];
};

export type RecordingPreflightDto = {
  canRecord: boolean;
  warnings: string[];
  artifactBytes: number;
};
```

- [ ] **Step 3: Add panel controls**

Add buttons:

- Refresh history
- Save notes
- Discard

Reuse existing button style and keep text compact.

- [ ] **Step 4: Verify renderer tests and smoke**

Run:

```powershell
pnpm vitest run packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/phase4a-recording-ui-smoke.test.ts
```

Expected: both files pass.

### Task 5: Benchmark Report

**Files:**
- Modify: `packages/core/tests/recording-benchmark.test.ts`

- [ ] **Step 1: Add report helper in the test file**

Add a local helper:

```ts
function summarizeBenchmark(results: Array<{ ok: boolean; data?: { draft: WorkflowDraft; evidence: unknown[] }; errors: string[] }>) {
  const completeDrafts = results.filter((result) =>
    result.ok && result.data && result.data.draft.steps.length > 0 && result.data.evidence.length > 0);
  return {
    totalRecordings: results.length,
    completeDrafts: completeDrafts.length,
    passRate: completeDrafts.length / results.length,
    failureReasons: results.flatMap((result) => result.ok ? [] : result.errors),
  };
}
```

- [ ] **Step 2: Assert five-recording report fields**

Expected:

- `totalRecordings` equals 5
- `completeDrafts` is at least 3
- `passRate` is at least 0.6
- `failureReasons` is an array

- [ ] **Step 3: Verify benchmark test**

Run:

```powershell
pnpm vitest run packages/core/tests/recording-benchmark.test.ts
```

Expected: benchmark tests pass.

### Task 6: Final Verification And Commit

**Files:**
- All files changed in Phase 4C.

- [ ] **Step 1: Run Phase 4C verification**

Run:

```powershell
pnpm vitest run packages/core/tests/recording-store.test.ts packages/core/tests/recording-benchmark.test.ts packages/desktop/tests/recording-teach-ipc.test.ts packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/phase4a-recording-ui-smoke.test.ts
pnpm --filter @agivar/core build
pnpm --filter @agivar/desktop build
git diff --check
```

Expected:

- all listed tests pass;
- both builds exit 0;
- `git diff --check` reports no whitespace errors.

- [ ] **Step 2: Commit**

Run:

```powershell
git add docs/superpowers/specs/2026-06-24-phase4c-recording-history-cleanup-hardening-design.md docs/superpowers/plans/2026-06-24-phase4c-recording-history-cleanup-hardening.md packages/core/src/types/workflow.ts packages/core/src/memory/recording-store.ts packages/core/tests/recording-store.test.ts packages/core/tests/recording-benchmark.test.ts packages/desktop/src/main/recording-teach-ipc.ts packages/desktop/src/main/ipc.ts packages/desktop/src/main/index.ts packages/desktop/src/preload.ts packages/desktop/src/renderer/pages/recording-teach-model.ts packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx packages/desktop/tests/recording-teach-ipc.test.ts packages/desktop/tests/recording-teach-model.test.ts
git commit -m "feat(phase4c): 完善录屏历史和清理治理"
```

- [ ] **Step 3: Push when requested**

Run:

```powershell
git push origin master
```

Expected: remote `master` receives the Phase 4C commit.

