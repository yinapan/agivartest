# Phase 4C Recording History, Cleanup, And Hardening Design

## Scope

Phase 4C finishes the local recording-teaching lifecycle after Phase 4A UI and Phase 4B provider generation work.

This slice covers:

1. Recording history management.
2. Session rename and persisted notes / goal edits.
3. Discard and delete cleanup for local recording artifacts.
4. Startup orphan cleanup and app quit active-recording cleanup.
5. Recording preflight, artifact size checks, and cleanup prompts.
6. Five representative recording benchmark reporting.

Phase 4C keeps the product local-first. It must not add cloud sync, vector retrieval, account sharing, or silent artifact upload.

## Goals

- Let the renderer list completed recording sessions beyond the current session.
- Let a user resume or reprocess a historical recording draft through the existing Phase 4B provider path.
- Let a user rename a recording goal and notes without mutating captured evidence.
- Let a user discard a recording and remove associated local artifacts best-effort.
- Make discard idempotent: repeated cleanup and missing files must not fail the user workflow.
- Mark stale `recording` and `stopping` sessions as failed on startup with clear metadata.
- Force-stop active native recordings during app shutdown.
- Preflight recording readiness before start: active-window availability, recorder availability, artifact directory writability, and artifact directory size.
- Produce benchmark hardening output for five representative recordings: complete draft count, provider payload audit, and failure reasons.

## Non-Goals

- Phase 4C does not implement cloud backup or remote sync.
- Phase 4C does not add vector search over recordings.
- Phase 4C does not automatically save generated workflow drafts to memory.
- Phase 4C does not guarantee secure screenshot redaction beyond existing summary / detailed manifest policy.
- Phase 4C does not build a separate floating recording bar unless the core lifecycle APIs are already stable enough. The embedded panel remains the primary UI.

## Current Baseline

Already implemented before Phase 4C:

- `recordingTeach.start`, `stop`, `status`, `getTimeline`, `buildManifest`, `generateDraft`, `resumeDraft`.
- Phase 4B provider selection, OpenAI-compatible adapter, deterministic fallback.
- Provider generation status, cancel, retry, and reprocess controls.
- Main/core manifest verification before provider invocation.
- Provider evidence normalization.

Known gaps entering Phase 4C:

- No persisted recording history list.
- No persisted goal / notes rename endpoint.
- No discard endpoint that removes draft links, timeline artifacts, video files, and keyframes together.
- No startup orphan cleanup.
- No app quit cleanup for active teaching recordings.
- No recording preflight or artifact size reporting.
- Benchmark tests exist, but there is no structured report object with pass rate, payload audit, and failure reasons.

## Architecture

### Core Storage

`RecordingStore` remains the local source of truth for recording sessions, timelines, draft links, and artifact metadata.

New repository capabilities:

- `listSessions(options?: { includeActive?: boolean; limit?: number })`
- `updateSessionMetadata(sessionId, patch)`
- `discardSession(sessionId, options)`

Discard updates database state and removes local files best-effort:

- session status becomes `discarded`;
- draft link status becomes `discarded`;
- keyframes, events, and context records are marked `deleted`;
- `videoPath`, keyframe `imagePath`, and the session `artifactDir` are removed if they are filesystem paths;
- missing files produce warnings, not failures.

The store only deletes paths that are local filesystem paths. `artifact://` pseudo paths are treated as metadata and skipped.

### Desktop Main IPC

New recording teaching IPC handlers:

- `recordingTeach.listSessions(options?)`
- `recordingTeach.updateSessionMetadata(request)`
- `recordingTeach.discard(sessionId)`
- `recordingTeach.preflight()`
- `recordingTeach.cleanupOrphans()`

Startup calls orphan cleanup after stores and deps are wired. App quit calls recorder cleanup and marks active sessions failed if needed.

IPC responses use the existing `IpcResult<T>` shape and stable error codes:

- `RECORDING_SESSION_NOT_FOUND`
- `RECORDING_DISCARD_FAILED`
- `RECORDING_PREFLIGHT_FAILED`
- `RECORDING_CLEANUP_FAILED`
- `INVALID_PAYLOAD`

### Renderer

`RecordingTeachPanel` expands from a single-session flow into a compact history-aware panel.

Renderer state gains:

- `history: RecordingSessionDto[]`
- `selectedHistorySessionId?: string`
- `preflight?: RecordingPreflightDto`
- `discardResult?: RecordingDiscardResultDto`

User-facing controls:

- refresh history;
- select a historical recording;
- resume draft for selected history;
- reprocess selected history;
- edit goal / notes;
- discard selected recording.

The UI remains explicit and conservative. Discard is a button action; no automatic deletion happens on navigation.

### Cleanup And Safety

Startup orphan cleanup:

- finds sessions with status `recording` or `stopping`;
- attempts to stop native recorder when a native session id exists;
- marks sessions `failed`;
- appends or updates notes with a short cleanup warning;
- is idempotent.

App quit cleanup:

- calls the same native stop path for active sessions where possible;
- calls `recorder.forceStopAllRecordings` if available;
- does not block app quit forever.

Preflight:

- confirms artifact root exists or can be created;
- checks artifact root total bytes;
- checks active-window availability for active-window scope;
- reports warnings instead of blocking when the app can still record.

## Data Flow

### History

1. Renderer calls `recordingTeach.listSessions({ includeActive: false })`.
2. Main delegates to `RecordingStore.listSessions`.
3. Store returns newest non-active sessions first.
4. Renderer shows goal, notes, status, updated time, scope, and privacy mode.

### Rename

1. Renderer sends `{ sessionId, goal, notes }`.
2. Main validates string lengths.
3. Store updates `recording_sessions` and keeps timeline notes aligned.
4. Renderer refreshes history and current timeline if the edited session is selected.

### Discard

1. Renderer sends `recordingTeach.discard(sessionId)`.
2. Main asks store to discard session and local artifacts.
3. Store marks metadata discarded / deleted and removes local paths best-effort.
4. Main returns `{ session, warnings }`.
5. Renderer removes or marks the discarded row and displays cleanup warnings.

### Orphan Cleanup

1. App startup runs `cleanupOrphans`.
2. Store lists active sessions.
3. Main attempts native stop for each active native recording.
4. Store marks each active session failed with cleanup notes.
5. Result contains cleaned session ids and warnings.

### Benchmark Report

1. Five representative timelines are generated in tests.
2. Each timeline builds a manifest and draft through the deterministic benchmark provider.
3. The report captures:
   - `totalRecordings`
   - `completeDrafts`
   - `passRate`
   - `payloadAudit`
   - `failureReasons`
4. Acceptance requires at least three structurally complete drafts and zero raw payload leaks in summary mode.

## Testing Strategy

Core tests:

- `packages/core/tests/recording-store.test.ts`
  - history list excludes active sessions by default;
  - metadata rename preserves evidence;
  - discard is idempotent and removes filesystem artifacts best-effort.

- `packages/core/tests/recording-benchmark.test.ts`
  - benchmark report summarizes five recordings;
  - report includes pass rate, payload audit, and failure reasons.

Desktop tests:

- `packages/desktop/tests/recording-teach-ipc.test.ts`
  - list and edit history sessions;
  - discard is idempotent;
  - startup orphan cleanup marks active sessions failed;
  - preflight returns can-record status and artifact bytes.

Renderer tests:

- `packages/desktop/tests/recording-teach-model.test.ts`
  - history state helpers;
  - discard result summaries;
  - preflight summaries.

Verification commands:

```powershell
pnpm vitest run packages/core/tests/recording-store.test.ts packages/core/tests/recording-benchmark.test.ts packages/desktop/tests/recording-teach-ipc.test.ts packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/phase4a-recording-ui-smoke.test.ts
pnpm --filter @agivar/core build
pnpm --filter @agivar/desktop build
git diff --check
```

## Acceptance Criteria

- Historical non-active recordings are listable newest first.
- Historical sessions can be resumed and reprocessed through existing Phase 4B APIs.
- Goal and notes edits persist and do not mutate evidence links.
- Discard marks DB rows and draft links discarded, deletes local files best-effort, and succeeds when files are already missing.
- Startup orphan cleanup is idempotent and marks active sessions failed.
- App quit cleanup attempts native force-stop for active recordings.
- Preflight reports recording readiness and artifact directory bytes.
- Five-recording benchmark report includes structural completeness rate, payload audit, and failure reasons.
- All Phase 4C verification commands pass.
