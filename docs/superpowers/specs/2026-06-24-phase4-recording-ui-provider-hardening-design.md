# Phase 4 Recording UI, Provider Quality, And Hardening Design

## Scope

Phase 4 turns the Phase 3 recording-teaching backend into a usable workflow inside the desktop app, then improves draft quality and operational reliability in two later slices.

The phase order is:

1. **Phase 4A: Recording Teaching UI**
2. **Phase 4B: Real Provider And Multimodal Draft Quality**
3. **Phase 4C: Reliability, Cleanup, And Data Governance**

Phase 4A is the immediate implementation target. Phase 4B and Phase 4C are designed here only far enough to keep Phase 4A from painting the project into a corner.

## Goals

- Let a user start and stop recording teaching from the workflow memory page.
- Show recording status, timeline evidence, warnings, and notes in the renderer.
- Let a user review a provider payload manifest before draft generation.
- Inject the generated recording draft into the existing Phase 2 workflow editor.
- Keep generated drafts unsaved until the user validates and saves through the existing editor path.
- Preserve Phase 3 privacy defaults: summary mode by default and explicit user confirmation before provider payload generation.
- Prepare clean seams for Phase 4B provider replacement and Phase 4C lifecycle cleanup.

## Non-Goals

- Phase 4A does not connect a real remote multimodal provider.
- Phase 4A does not add cloud sync, vector retrieval, account features, or sharing.
- Phase 4A does not implement full disk quota cleanup, batch artifact deletion, or orphan recovery. Those belong to Phase 4C.
- Phase 4A does not redesign the entire workflow editor.
- Generated workflows still do not execute automatically.

## Phase 4A User Flow

The recording teaching entry lives in the existing `WorkflowsPage`.

1. **Setup**
   - User chooses scope: `fullscreen` or `active-window`.
   - User chooses privacy mode: `summary` or `detailed`.
   - User enters optional goal and notes.
   - Summary mode remains the default.

2. **Record**
   - User starts recording.
   - UI shows status, scope, privacy mode, session id, and elapsed time.
   - User can stop recording.
   - Start/stop errors are rendered as stable messages from IPC errors.

3. **Review Timeline**
   - UI shows notes, keyframe count, event count, context count, warnings, and a compact evidence list.
   - For Phase 4A, keyframe images may be represented by path/id metadata rather than an image gallery if the renderer cannot safely resolve local artifact paths yet.
   - User can edit notes locally in the panel state. Persisted note editing can be added in Phase 4C with a dedicated IPC.

4. **Confirm Manifest**
   - UI calls `recordingTeach.buildManifest(sessionId, providerName)`.
   - UI displays selected artifact count, estimated bytes, raw text flag, precise coordinate flag, provider name, and redaction policy.
   - User must click confirm before `recordingTeach.generateDraft`.

5. **Generate Draft**
   - UI calls `recordingTeach.generateDraft({ sessionId, manifest: { ...manifest, status: 'confirmed' } })`.
   - Generated `draftJson` is copied into the existing editor draft state.
   - `sourceType` remains `recording`.
   - `changeNote` defaults to `recording teaching`.
   - User saves through existing `memory.saveDraft` or `memory.update`.

6. **Resume Draft**
   - If a session has a persisted `recording_draft_links` entry, UI can call `recordingTeach.resumeDraft(sessionId)` and restore the generated draft into the editor.
   - Phase 4A exposes a simple resume action after draft generation. Startup-wide resume discovery is Phase 4C unless a list endpoint already exists.

## Renderer Architecture

### Files

- `packages/desktop/src/renderer/pages/recording-teach-model.ts`
  - Owns renderer-only DTO types for sessions, timelines, manifests, draft links, and UI state.
  - Provides pure helpers for status labels, manifest summaries, draft handoff, and error messages.
  - Has focused unit tests.

- `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`
  - Owns recording setup and review UI.
  - Calls `window.agivar.recordingTeach.*`.
  - Emits a generated draft to `WorkflowsPage` through a callback.
  - Does not save workflow memories directly.

- `packages/desktop/src/renderer/pages/WorkflowsPage.tsx`
  - Embeds `RecordingTeachPanel`.
  - Receives a generated recording draft and places it into the existing editor.
  - Updates message, warnings, selected state, and change note.

- `packages/desktop/tests/recording-teach-model.test.ts`
  - Tests renderer state helpers without Electron.

### State Model

Phase 4A keeps the UI state local to `RecordingTeachPanel`.

Recommended states:

- `idle`
- `starting`
- `recording`
- `stopping`
- `ready`
- `manifest_ready`
- `generating`
- `draft_ready`
- `failed`

The state machine is advisory; the source of truth for persisted session/timeline/draft data remains main-process IPC and core storage.

## IPC Contract

Phase 4A uses the IPC APIs already exposed in preload:

- `recordingTeach.start(request)`
- `recordingTeach.stop(sessionId)`
- `recordingTeach.status(sessionId)`
- `recordingTeach.getTimeline(sessionId)`
- `recordingTeach.buildManifest(sessionId, providerName?)`
- `recordingTeach.generateDraft(request)`
- `recordingTeach.resumeDraft(sessionId)`

Renderer DTOs must not depend on broad `Record<string, unknown>` once the panel is implemented. The model file should define explicit DTO shapes matching the current preload surface.

Phase 4A should also introduce, or explicitly reserve, a state-event subscription such as `recordingTeach.onStateChanged(listener)`. The embedded panel may still refresh after start/stop in the first implementation, but richer UI surfaces such as a compact recording bar window must consume main-process state events instead of inventing a second polling path.

## Privacy And Safety

- Summary mode is selected by default.
- Detailed mode requires an explicit acknowledgement before start.
- Manifest confirmation is required before draft generation.
- UI displays `containsRawText` and `containsPreciseCoordinates`.
- UI does not claim screenshots are redacted.
- Generated drafts enter the editor before save.
- Main/core must treat renderer manifest confirmation as advisory. Provider generation must re-derive or verify the manifest, or use a persisted manifest id plus confirmation state, before any remote provider payload is built.

## Phase 4B Provider Quality

Phase 4B replaces the deterministic provider used in Phase 3E with a real provider path while preserving the Phase 4A UI contract.

Expected work:

- Add provider configuration selection in main process.
- Build a provider payload from the confirmed manifest rather than sending loose timeline data.
- Include selected keyframes, event summaries, context summaries, notes, and redaction policy.
- Add first-class annotations / explanations as optional evidence inputs, then map them into provider payloads.
- Keep deterministic provider tests for regression.
- Add provider failure retry and stable validation errors.
- Improve evidence mapping from provider output to step ids.
- Add benchmark reporting for the five representative recordings.
- Add cancel, retry, and reprocess semantics for long-running provider generation.

Phase 4B must not bypass manifest confirmation.

## Phase 4C Reliability And Data Governance

Phase 4C completes lifecycle reliability.

Expected work:

- Add `recordingTeach.discard`.
- Add `recordingTeach.cancelProcessing` and `recordingTeach.reprocess`.
- Add artifact delete/exclude IPC and renderer controls.
- Add persisted note update IPC.
- Add persisted annotation update IPC if Phase 4B introduces annotations.
- Add recording history list, rename, delete, and lazy keyframe preview.
- Add a compact recording bar window backed by the same main-process recording state.
- Add startup orphan cleanup for `recording` and `stopping` sessions.
- Add app quit cleanup for active teaching sessions.
- Add recording artifact directory size checks and cleanup prompts.
- Add permission preflight, selected screen-scope preference, and data-root settings.
- Add evidence invalidation or hiding when artifacts are deleted.
- Add tests for cleanup idempotency and missing files.

Phase 4C must preserve local-first behavior and never silently upload artifacts.

## Testing Strategy

Phase 4A tests:

- Model tests for initial state, status transitions, manifest summary, draft handoff, and IPC error normalization.
- Renderer integration-level tests are not required for Phase 4A because the project does not currently have a component test harness.
- Existing IPC tests remain the source of truth for main-process behavior.
- Build checks must include `@agivar/core` and `@agivar/desktop`.

Phase 4B tests:

- Provider payload builder tests.
- Deterministic provider regression tests.
- Provider failure and malformed output tests.
- Five-recording benchmark report test.

Phase 4C tests:

- Discard/delete/exclude persistence tests.
- Artifact missing-file cleanup tests.
- Startup orphan cleanup tests.
- App quit force-stop tests.

## Acceptance Criteria For Phase 4A

- The workflow page has a visible recording teaching panel.
- User can start and stop a recording session through renderer controls.
- After stop, the timeline summary is visible in the renderer.
- User can build and inspect a provider payload manifest.
- User must confirm the manifest before draft generation.
- Generated recording drafts populate the existing workflow editor.
- Save still goes through the existing validation and save path.
- Renderer helper tests cover the Phase 4A state and handoff logic.
- `pnpm vitest run packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/workflow-editor-model.test.ts packages/desktop/tests/recording-teach-ipc.test.ts` passes.
- `pnpm --filter @agivar/desktop build` passes.
