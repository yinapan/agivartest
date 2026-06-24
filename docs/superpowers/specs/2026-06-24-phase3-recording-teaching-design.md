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
- `failed`
- `discarded`

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

- capture around interaction events
- capture first and last frame
- capture after window changes
- deduplicate visually or by timestamp thresholds in later iterations

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
- Saving still goes through the Phase 2 editor and existing save path.
- Workflow version source should add `recording-teach` so version history preserves the creation source clearly.

## Data Model

Add local tables or equivalent storage records:

- `recording_sessions`
- `recording_events`
- `recording_keyframes`
- `recording_context_snapshots`
- `recording_draft_links`
- `provider_payload_manifests`

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

Minimum context snapshot fields:

- `id`
- `session_id`
- `timestamp_ms`
- `kind`
- `summary_json`
- `source`
- `warning`
- `status`

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

Handlers should return stable `{ ok, data, error }` results and must validate payloads at runtime.

Preload and renderer APIs should use explicit DTO/result types. Runtime validation must cover enum values, string lengths, session ids, artifact ids, version ids, path-like ids, and provider payload manifest requests.

### Renderer

Add a recording teaching view connected from the workflow memory area.

Required panels:

- setup panel: scope, privacy mode, goal, notes
- recording panel: status, elapsed time, stop button
- timeline review panel: keyframes, events, warnings, notes editor
- draft generation panel: selected evidence, provider warnings, generated draft entry point

The generated draft should reuse the existing Phase 2 editor instead of creating a separate raw JSON editor.

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
- Event redaction for summary and detailed modes.
- Timeline builder aligns events and keyframes.
- Provider payload manifest generation and redaction.
- Artifact exclude/delete consistency.
- Evidence link invalidation when artifacts are deleted.
- Extractor accepts deterministic provider output and validates `WorkflowDraft`.
- Extractor rejects malformed provider output.

Desktop tests:

- IPC rejects invalid recording payloads.
- IPC returns stable errors for missing sessions and provider failures.
- IPC rejects concurrent starts by default.
- Timeline review model handles deleted keyframes/events.
- App quit cleanup calls recorder force-stop path.
- Generate draft result opens Phase 2-compatible draft data.

Integration and smoke:

- Simulated recording timeline can generate and save a workflow draft.
- Real desktop smoke validates full-screen and active-window start/stop.
- Five-cycle start/stop test verifies no active session leak.
- Remote desktop or degraded-mode manual smoke records the fallback behavior.
- Manual or interactive smoke records one simple workflow, reviews timeline, generates draft, edits it, and saves it.

Quality benchmark:

- Use 5 representative recordings.
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
   - Use simulated timelines to validate extractor-to-Phase-2-editor handoff.
2. **Phase 3B: Local session and artifact lifecycle**
   - Implement session state machine, artifact directory management, exclude/delete consistency, and stable IPC results.
   - Do not connect real provider parsing yet.
3. **Phase 3C: Keyframes and basic recording**
   - Connect full-screen and active-window start/stop, keyframe sampling, five-cycle leak checks, app quit cleanup, and remote desktop degraded warnings.
4. **Phase 3D: Events and context**
   - Add event summaries, window context, UIA snapshots, summary mode defaults, and explicit detailed mode opt-in.
5. **Phase 3E: Provider payload and draft generation**
   - Add provider payload manifests, user confirmation, provider invocation, warnings, evidence mapping, and unsaved draft wrapper.
   - Generated drafts enter the Phase 2 editor and do not write workflow memory directly.
6. **Phase 3F: Benchmark and hardening**
   - Run 5 representative recordings.
   - Record pass rate, failure reasons, resource leak checks, and provider payload audit results.
