# Phase 3 Recording Teaching Design

## Scope

Phase 3 adds full recording-based workflow teaching on top of the Phase 2 workflow editor and local memory system.

The user can record a desktop workflow, capture screen context and interaction events, add teaching notes, and ask the system to generate a structured `WorkflowDraft`. The generated draft must enter the existing Phase 2 editor for review, correction, validation, versioning, and save. Generated workflows never execute automatically.

This phase includes both full-screen and active-window recording. It also includes multimodal parsing from recording artifacts, event summaries, UIA/window context, and user notes.

This phase does not include cloud sync, vector retrieval, team sharing, billing, account management, or automatic background uploading.

## Goals

- Record a workflow demonstration from full screen or active window.
- Capture mouse, keyboard, window, screenshot, and UIA context on a shared timeline.
- Support hybrid event privacy: safe summaries by default, with explicit opt-in for raw coordinates and raw text.
- Persist recording sessions, artifacts, keyframes, event timelines, and generated drafts locally.
- Generate a Phase 2-compatible `WorkflowDraft` from recording artifacts and user notes.
- Let users preview timeline evidence and generated workflow steps before saving.
- Validate generated drafts through existing Phase 2 workflow validation and versioning.
- Provide a measurable quality target: 5 representative recordings should produce at least 3 structurally complete, editable drafts.

## Non-Goals

- No cloud sync or remote storage.
- No vector database, embedding index, or semantic retrieval service.
- No automatic execution of a generated workflow.
- No silent capture. Recording must be started explicitly by the user.
- No automatic upload of full raw videos.
- No background training dataset collection.
- No promise that generated drafts are executable without user review.

## User Experience

Phase 3 adds a recording teaching flow to the workflow memory area:

1. **Prepare**
   - User chooses recording scope: full screen or active window.
   - User chooses privacy level:
     - summary mode: store event summaries only
     - detailed mode: store raw coordinates and raw text where needed
   - User enters optional goal and teaching notes.

2. **Record**
   - App shows recording state, elapsed time, scope, and privacy mode.
   - User performs the workflow.
   - User can stop recording at any time.
   - Failure to capture a frame, UIA tree, or event must not crash Electron.

3. **Review Timeline**
   - User sees keyframes, event summaries, active window changes, and notes.
   - User can delete sensitive frames or events before parsing.
   - User can add or edit teaching notes.

4. **Generate Draft**
   - User clicks generate draft.
   - App sends selected keyframes, event summaries, UIA/window context, and notes to the configured parser provider.
   - App shows parser warnings and the generated draft.

5. **Edit And Save**
   - Generated draft opens in the existing Phase 2 editor.
   - User edits steps, inputs, expected states, risk levels, fallback, platform, and trigger examples.
   - Save creates a local workflow memory version with `sourceType: 'recording'`.

## Architecture

### Responsibility Boundaries

Phase 3 keeps the same ownership style as Phase 2, but recording adds more low-level adapters. The boundary is:

| Layer | Owns | Must Not Own |
| --- | --- | --- |
| Core | Types, state machines, redaction policy, timeline builder, extractor interface, draft validation, repository interfaces | Native hooks, Electron IPC, arbitrary local file reads from renderer |
| Desktop main | IPC, user permission gates, artifact directory management, adapter wiring, provider payload assembly, app quit cleanup | Workflow draft validation rules duplicated from Core |
| native | Low-level recording, screenshots, UIA, window enumeration, input event capture | Business session state, provider payload decisions, workflow memory writes |
| Renderer | DTO display, setup choices, timeline review, user confirmation, draft handoff to Phase 2 editor | Direct local path access, provider calls, raw artifact mutation |
| Provider | Parse an explicit manifest-filtered payload into a draft response | Access to loose artifact directories or unfiltered raw session files |

### RecordingSessionService

Core owns session lifecycle and metadata, while Desktop owns platform-specific capture through existing recorder, screenshot, input, and UIA tools.

`RecordingSessionService` wraps the existing low-level recorder instead of replacing it. Video capture is delegated to `recorder.startRecording`, `recorder.stopRecording`, `recorder.getRecordingStatus`, and `recorder.forceStopAllRecordings`. The service owns the teaching session state machine, metadata persistence, artifact directory lifecycle, and cross-adapter status aggregation.

Responsibilities:

- Start full-screen or active-window recording.
- Track session id, scope, privacy mode, timestamps, artifact paths, and status.
- Stop recording and finalize metadata.
- Force-stop all active sessions.
- Surface degraded capture states without crashing the app.

Session states:

- `idle`
- `recording`
- `stopping`
- `ready`
- `draft_ready`
- `failed`
- `discarded`

### Native Event Capture Dependency

Existing input helpers are active automation tools, such as click, type, and hotkey simulation. They do not passively listen to the user's real mouse and keyboard events.

Passive event capture for Phase 3D requires native Windows support, such as low-level mouse and keyboard hooks or Raw Input. The native layer must expose:

```ts
startEventCapture(sessionId: string, config: EventCaptureConfig): Promise<void>;
stopEventCapture(sessionId: string): Promise<void>;
```

Event callbacks must cross into Node.js through a thread-safe mechanism and preserve session id, timestamp, event type, and redaction boundary. Phase 3D depends on this native capability. If the native event-capture work is not ready, Phase 3D must start with simulated/manual events and keep real passive capture behind an explicit implementation task.

### EventCaptureService

Event capture records user interactions on the same clock as recording.

Default summary mode stores:

- event type: click, double-click, type, hotkey, scroll, window-change
- timestamp
- active window title and process name when available
- coarse target description
- text length or redacted input marker

Detailed mode may additionally store:

- exact coordinates with coordinate space
- raw typed text
- key names
- selected UIA node summary

Detailed mode must require explicit user opt-in per recording session.

### ContextSampler

ContextSampler aligns screen, window, and UIA context around important moments.

Inputs:

- recording session timestamps
- interaction events
- screenshot frames or keyframes
- active window snapshots
- UIA tree snapshots where available

Outputs:

- keyframe records
- UIA/window summaries
- event-to-frame references
- warnings for missing context

Sampling strategy:

- capture first and last frame
- capture after window changes
- Phase 3C captures interval keyframes only, plus first and last frames
- Phase 3D adds capture around interaction events after passive event capture exists
- deduplicate by timestamp thresholds first, and by exact file hash when keyframes are persisted
- consider perceptual deduplication only in later iterations

### MultimodalTimeline

The timeline is the parser input boundary. It prevents providers from receiving a loose bag of unrelated files.

Recommended shape:

```ts
interface RecordingTimeline {
  sessionId: string;
  goal?: string;
  notes: string;
  scope: 'fullscreen' | 'active-window';
  privacyMode: 'summary' | 'detailed';
  startedAt: string;
  stoppedAt: string;
  keyframes: RecordingKeyframe[];
  events: RecordingEvent[];
  context: RecordingContextSnapshot[];
  warnings: string[];
}
```

The timeline should include references to local artifact ids and paths, but provider payload preparation decides which artifacts are sent out of process. Providers must never receive a loose artifact directory or unfiltered timeline object.

### RecordingWorkflowExtractor

The extractor converts a timeline into a `WorkflowDraft`.

It uses an injected provider interface, similar to Phase 2 `TextTeachingService`, so tests can use deterministic providers.

Provider interface:

```ts
export interface RecordingWorkflowProvider {
  generateWorkflowDraft(
    timeline: RecordingTimeline,
    manifest: ProviderPayloadManifest,
  ): Promise<RecordingWorkflowProviderResult>;
}

export interface RecordingWorkflowProviderResult {
  draft: WorkflowDraft;
  evidence: StepEvidenceLink[];
  warnings: string[];
  rawResponse?: unknown;
}

export interface StepEvidenceLink {
  id: string;
  sessionId: string;
  stepId: string;
  eventIds: string[];
  keyframeIds: string[];
  contextIds: string[];
  confidence: number;
  rationale: string;
}
```

Inputs:

- `RecordingTimeline`
- selected keyframe images
- event summaries
- user notes
- app/window metadata

Outputs:

- `WorkflowDraft`
- warnings
- evidence mapping from generated steps back to timeline events/keyframes
- raw provider response metadata when available

Rules:

- Output must validate with existing workflow draft validation.
- Generated drafts use `sourceType: 'recording'`.
- Drafts must preserve evidence links for review where practical.
- Invalid output returns stable validation errors and does not create workflow memory.
- `recordingTeach:generateDraft` returns an unsaved draft wrapper and evidence mapping. It must not write `workflow_memories`.
- The generated draft wrapper is persisted locally and the session moves to `draft_ready` so it can be recovered after app restart.
- App startup checks for `draft_ready` sessions and can restore the user to the draft review state.
- `recordingTeach:discard` removes draft links, marks the session discarded, and deletes physical artifacts best-effort.
- Saving still goes through the Phase 2 editor and existing save path.
- Workflow version source must add `recording-teach` in types, persistence, and schema constraints so version history preserves the creation source clearly.

## Data Model

Add local tables or equivalent storage records:

- `recording_sessions`
- `recording_events`
- `recording_keyframes`
- `recording_context_snapshots`
- `recording_draft_links`
- `provider_payload_manifests`

Migration allocation:

| Migration | Phase | Tables |
| --- | --- | --- |
| v4 | 3A | Extend `workflow_memory_versions.source` to include `recording-teach` |
| v5 | 3B | `recording_sessions`, `recording_events`, `recording_keyframes`, `recording_context_snapshots` |
| v6 | 3C | Native recorder linkage fields on `recording_sessions` |
| v7 | 3E | `recording_draft_links`, `provider_payload_manifests` |

Minimum session fields:

- `id`
- `scope`
- `privacy_mode`
- `status`
- `goal`
- `notes`
- `video_path`
- `artifact_dir`
- `started_at`
- `stopped_at`
- `created_at`
- `updated_at`

Minimum event fields:

- `id`
- `session_id`
- `timestamp_ms`
- `type`
- `summary`
- `redaction_level`
- `raw_payload_json`
- `window_title`
- `process_name`
- `status`
- `deleted_at`

Minimum keyframe fields:

- `id`
- `session_id`
- `timestamp_ms`
- `image_path`
- `reason`
- `event_id`
- `redacted`
- `status`
- `deleted_at`
- `hash`
- `file_size`
- `mime_type`
- `included_in_provider`

`hash` is SHA-256 of the image file contents for exact deduplication. If visual-near-duplicate detection becomes necessary later, add a separate `perceptual_hash` field instead of changing the meaning of `hash`.

Minimum context snapshot fields:

- `id`
- `session_id`
- `timestamp_ms`
- `kind`
- `summary_json`
- `source`
- `warning`
- `status`

Minimum generated draft wrapper fields in `recording_draft_links`:

- `id`
- `session_id`
- `draft_json`
- `status`
- `created_at`
- `updated_at`
- `discarded_at`

Minimum draft evidence fields:

- `id`
- `session_id`
- `draft_id` or `memory_id` plus `version`
- `step_id`
- `event_ids_json`
- `keyframe_ids_json`
- `context_ids_json`
- `confidence`
- `rationale`

Minimum provider payload manifest fields:

- `id`
- `session_id`
- `provider_name`
- `selected_artifact_ids_json`
- `redaction_policy_json`
- `contains_raw_text`
- `contains_precise_coordinates`
- `estimated_bytes`
- `created_at`
- `status`

Artifact lifecycle uses:

- `active`: available for review and payload selection
- `excluded`: retained locally but not included in provider payload
- `deleted`: removed from local review, provider selection, and evidence preview; physical files should be deleted best-effort and marked with `deleted_at`

Deleting an artifact must update timeline metadata, provider selections, draft evidence links, and local files. Deleted artifacts must not be shown in evidence preview or sent to a provider.

The implementation may start with JSON files under an artifact directory if schema churn is high, but the design should keep a clear migration path to SQLite tables.

## Provider Payload Policy

Recording artifacts are local-first. The app must not send anything to a provider until the user explicitly clicks generate draft.

Provider invocation is a two-step flow:

1. Build a `ProviderPayloadManifest`.
2. Show the manifest to the user and invoke the provider only after confirmation.

The manifest must include:

- data classes included: notes, event summaries, keyframes, UIA/window summaries
- selected keyframe ids, event ids, and context ids
- whether raw text is included
- whether precise coordinates are included
- estimated payload size
- provider name
- redaction mode and policy

Provider payload rules:

- never send full raw video by default
- allow user to deselect sensitive keyframes or events before manifest confirmation
- respect summary mode redactions
- do not send artifacts with `excluded` or `deleted` status
- enforce payload size limits before provider invocation
- fail closed if manifest generation cannot prove whether raw text or precise coordinates are included

Detailed mode does not mean automatic upload of raw text or coordinates. It means the local timeline may retain them. Provider payload assembly still applies filtering.

Summary mode only redacts event payloads by default. It does not guarantee that keyframe pixels are safe. Keyframes require user selection or confirmation before they can enter the provider payload.

## Desktop Integration

### IPC

Add recording teaching handlers under a new namespace:

- `recordingTeach:start`
- `recordingTeach:stop`
- `recordingTeach:status`
- `recordingTeach:discard`
- `recordingTeach:getTimeline`
- `recordingTeach:updateNotes`
- `recordingTeach:deleteArtifact`
- `recordingTeach:generateDraft`

Namespace meaning:

- `recorder:*` remains the low-level video/frame capture API backed by native capture tools.
- `recordingTeach:*` is the teaching orchestration API. It delegates to `recorder:*` where needed and combines recording, passive event capture, context sampling, timeline persistence, provider payload confirmation, and draft handoff.

Handlers should return stable `{ ok, data, error }` results and must validate payloads at runtime.

Preload and renderer APIs should use explicit DTO/result types. Runtime validation must cover enum values, string lengths, session ids, artifact ids, version ids, path-like ids, and provider payload manifest requests.

Agivar reference alignment:

- Reserve a main-to-renderer recording state event, for example `recordingTeach:onStateChanged`, even if the first UI refreshes after commands. Main/core remains the only source of truth for active recording state.
- Do not make active session ownership a renderer concern. Concurrent `start` must be rejected or resumed from repository/main state.
- Keep low-level `recorder:*` APIs usable by future capture/recording-bar pages, while `recordingTeach:*` remains the product workflow API.

Active-window recording resolves the current foreground HWND before starting capture:

1. Call `screenshot.getActiveWindow()`.
2. Read `hwnd`, title, and process metadata for the timeline.
3. Pass `targetHwnd` into `recorder.startRecording({ targetHwnd })`.
4. Fail before start or enter degraded capture if the HWND is missing or invalid.

### Renderer

Add a recording teaching view connected from the workflow memory area.

Required panels:

- setup panel: scope, privacy mode, goal, notes
- recording panel: status, elapsed time, stop button
- timeline review panel: keyframes, events, warnings, notes editor
- draft generation panel: selected evidence, provider warnings, generated draft entry point

The generated draft should reuse the existing Phase 2 editor instead of creating a separate raw JSON editor.

The workflow list should support filtering or grouping by `sourceType: 'recording'`. If the existing `memory:list` query only supports app or topic filters, Phase 3E should add an optional `sourceType` filter before surfacing recording-generated workflows as a distinct category.

Phase 3 does not need to build the final recording bar or recording history UI, but it must not block them. The session/timeline APIs should support later consumers:

- compact recording bar: start/stop/cancel/status and elapsed time
- recording history: list/rename/delete/preview/reprocess
- timeline review: lazy keyframe metadata first, binary image payload on demand
- provider generation: cancel/retry/reprocess from a persisted manifest or draft link

## Safety And Privacy

- Recording requires explicit user action.
- Recording scope and privacy mode must remain visible while recording.
- Summary mode is the default.
- Detailed mode requires explicit opt-in and clear warning.
- User can delete recording sessions and artifacts locally.
- Sensitive frames/events can be removed before parsing.
- Summary mode does not mean screenshots are visually redacted. It means raw event payloads are redacted unless the user opts into detailed capture.
- Provider payload manifests must be previewed and confirmed before any keyframe, event, or context leaves the process.
- Raw typed text and precise coordinates are never included in provider payloads unless both detailed capture and manifest confirmation allow them.
- Generated workflows are drafts only and must be reviewed before save.
- High-risk generated steps follow existing Phase 2 risk warnings and save confirmation.
- Provider payloads should be minimized and assembled from selected timeline evidence.

Summary mode setup warning:

> 摘要模式仅屏蔽事件中的原始文本和坐标，截图不会被自动打码。如果你的操作中涉及密码、银行卡号等敏感信息，请在生成草稿前在时间线中手动删除相关截图。

Disk cleanup policy:

- Check total recording artifact directory size on app startup and before starting a new recording.
- If the total exceeds a soft threshold such as 500 MB, prompt the user to review or clean old recording sessions.
- `recordingTeach:discard` deletes video files, keyframe images, context artifacts, draft links, and provider manifests for that session best-effort, then records any cleanup warning in session metadata.

Annotation policy:

- User notes entered before recording are session-level notes.
- Future timeline annotations and explain notes must be persisted as first-class evidence rather than folded into unstructured text.
- Voice annotation remains deferred, but the evidence model should allow a later audio transcript reference without changing provider payload semantics.

## Failure Handling

Failures should degrade by layer:

- Recorder unavailable: show setup error and do not start.
- Concurrent start: reject by default and show the active session.
- Frame capture fails: continue event capture where possible and mark timeline warning.
- Event capture fails: continue recording and mark timeline warning.
- UIA snapshot fails: continue with screenshot/window context.
- Stop timeout: mark session `failed`, release native/session resources best-effort, and keep artifacts for review.
- Disk quota or artifact write failure: stop capture if required, mark the session degraded or failed, and preserve consistent metadata.
- Active window handle invalid: switch to degraded capture or fail before starting active-window recording.
- Remote desktop or unstable capture environment: show degraded warning and allow screenshots-only or manual smoke fallback where real recording is unreliable.
- Provider parse fails: keep timeline and allow retry or manual draft creation.
- Draft validation fails: show errors and keep generated draft as editable unsaved data where safe.
- App startup should clean up orphan active sessions from prior crashes.
- App quit should call `forceStopAllRecordings()` and finalize or fail active recording sessions.

No failure should leave an active recording session untracked.

## Testing Strategy

Core tests:

- Recording session lifecycle state transitions.
- `RecordingSessionService` returns a failed/degraded state when low-level `recorder.startRecording()` fails instead of throwing through IPC.
- Event redaction for summary and detailed modes.
- Timeline builder aligns events and keyframes.
- Provider payload manifest generation and redaction.
- Artifact exclude/delete consistency.
- Evidence link invalidation when artifacts are deleted, including dangling evidence links that reference removed keyframes or events.
- Extractor accepts deterministic provider output and validates `WorkflowDraft`.
- Extractor rejects malformed provider output.
- High-frequency event ingestion, such as 100+ events per second, does not corrupt session state.

Desktop tests:

- IPC rejects invalid recording payloads.
- IPC returns stable errors for missing sessions and provider failures.
- IPC rejects concurrent starts by default.
- Timeline review model handles deleted keyframes/events.
- App quit cleanup calls recorder force-stop path.
- `forceStopAllRecordings()` transitions all active teaching sessions to `failed` or `ready` consistently.
- Generate draft result opens Phase 2-compatible draft data.

Integration and smoke:

- Simulated recording timeline can generate and save a workflow draft.
- Real desktop smoke validates full-screen and active-window start/stop.
- Five-cycle start/stop test verifies no active session leak.
- Remote desktop or degraded-mode manual smoke records the fallback behavior.
- Manual or interactive smoke records one simple workflow, reviews timeline, generates draft, edits it, and saves it.

Quality benchmark:

- Use 5 representative recordings.
- Benchmark scenarios:
  - Notepad text entry and save.
  - Browser copy to editor, paste, and window switch.
  - Shortcut-heavy workflow using actions such as Ctrl+N, Ctrl+S, and Alt+Tab.
  - Explorer mouse navigation through folders and opening a file.
  - Mixed form workflow with text inputs, dropdown selection, and confirm click.
- At least 3 should produce structurally complete drafts that pass validation and are practical to edit.
- Structurally complete means: topic, summary, success criteria, at least 2 steps, each step has intent, target hint, risk level, and key steps have at least one evidence link.
- The benchmark does not claim fully automatic execution without review.

## Acceptance Criteria

- User can record full screen and active window.
- User can stop recording and see a local timeline with keyframes, event summaries, context, and notes.
- User can delete sensitive artifacts before parsing.
- User can click generate draft and receive a Phase 2-compatible `WorkflowDraft`.
- Generated drafts use `sourceType: 'recording'`.
- Generated drafts enter the Phase 2 editor before save.
- Workflow version history records initial recording-created saves as source `recording-teach`.
- Provider payload manifest is shown and confirmed before provider invocation.
- Deleted or excluded artifacts never enter provider payloads or evidence previews.
- Invalid parser output returns stable validation errors.
- Full-screen and active-window recording can each start and stop successfully in a valid desktop session.
- Five repeated start/stop cycles leave no active recording sessions behind.
- Startup orphan cleanup and app quit cleanup are covered.
- 5 benchmark recordings produce at least 3 structurally complete, editable drafts.
- Cloud sync and vector retrieval remain absent.

## Implementation Order

Phase 3 should be implemented as internal slices rather than one large change:

1. **Phase 3A: Types, schema, and simulated timeline**
   - Add recording session, timeline, artifact, evidence, and provider manifest types.
   - Add runtime validation and repository interfaces.
   - Add `RecordingWorkflowProvider`, `RecordingWorkflowProviderResult`, and `StepEvidenceLink` types.
   - Extend `WorkflowMemoryVersion.source` to include `recording-teach` in Core types, memory-store writes, and SQLite CHECK constraints.
   - Prepare at least three simulated timeline fixtures: happy path, minimal timeline with warnings, and invalid timeline with validation errors.
   - Use simulated timelines to validate extractor-to-Phase-2-editor handoff.
2. **Phase 3B: Local session and artifact lifecycle**
   - Implement session state machine, artifact directory management, exclude/delete consistency, and stable IPC results.
   - Add migration v5 for session, event, keyframe, and context tables.
   - Do not connect real provider parsing yet.
3. **Phase 3C: Keyframes and basic recording**
   - Connect full-screen and active-window start/stop, interval keyframe sampling, first/last frame capture, SHA-256 keyframe hashing, five-cycle leak checks, app quit cleanup, and remote desktop degraded warnings.
   - Do not depend on passive event capture for this phase.
4. **Phase 3D: Events and context**
   - Add native passive event capture, event summaries, event-driven keyframe sampling, window context, UIA snapshots, summary mode defaults, and explicit detailed mode opt-in.
5. **Phase 3E: Provider payload and draft generation**
   - Add migration v7 for draft links and provider payload manifests.
   - Add provider payload manifests, user confirmation, provider invocation, warnings, evidence mapping, persisted `draft_ready` wrapper recovery, and optional `sourceType` list filtering.
   - Generated drafts enter the Phase 2 editor and do not write workflow memory directly.
6. **Phase 3F: Benchmark and hardening**
   - Run 5 representative recordings.
   - Record pass rate, failure reasons, resource leak checks, and provider payload audit results.
