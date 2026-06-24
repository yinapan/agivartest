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

The timeline should include references to local artifact paths, but provider payload preparation should decide which artifacts are sent out of process.

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

## Data Model

Add local tables or equivalent storage records:

- `recording_sessions`
- `recording_events`
- `recording_keyframes`
- `recording_context_snapshots`
- `recording_draft_links`

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

Minimum keyframe fields:

- `id`
- `session_id`
- `timestamp_ms`
- `image_path`
- `reason`
- `event_id`
- `redacted`

The implementation may start with JSON files under an artifact directory if schema churn is high, but the design should keep a clear migration path to SQLite tables.

## Provider Payload Policy

Recording artifacts are local-first. The app must not send anything to a provider until the user explicitly clicks generate draft.

Before provider invocation:

- show which data classes may be sent: notes, event summaries, selected keyframes, UIA/window summaries
- never send full raw video by default
- allow user to deselect sensitive keyframes or events
- respect summary mode redactions

Detailed mode does not mean automatic upload of raw text or coordinates. It means the local timeline may retain them. Provider payload assembly still applies filtering.

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
- Generated workflows are drafts only and must be reviewed before save.
- High-risk generated steps follow existing Phase 2 risk warnings and save confirmation.
- Provider payloads should be minimized and assembled from selected timeline evidence.

## Failure Handling

Failures should degrade by layer:

- Recorder unavailable: show setup error and do not start.
- Frame capture fails: continue event capture where possible and mark timeline warning.
- Event capture fails: continue recording and mark timeline warning.
- UIA snapshot fails: continue with screenshot/window context.
- Provider parse fails: keep timeline and allow retry or manual draft creation.
- Draft validation fails: show errors and keep generated draft as editable unsaved data where safe.

No failure should leave an active recording session untracked.

## Testing Strategy

Core tests:

- Recording session lifecycle state transitions.
- Event redaction for summary and detailed modes.
- Timeline builder aligns events and keyframes.
- Extractor accepts deterministic provider output and validates `WorkflowDraft`.
- Extractor rejects malformed provider output.

Desktop tests:

- IPC rejects invalid recording payloads.
- IPC returns stable errors for missing sessions and provider failures.
- Timeline review model handles deleted keyframes/events.
- Generate draft result opens Phase 2-compatible draft data.

Integration and smoke:

- Simulated recording timeline can generate and save a workflow draft.
- Real desktop smoke validates full-screen and active-window start/stop.
- Five-cycle start/stop test verifies no active session leak.
- Manual or interactive smoke records one simple workflow, reviews timeline, generates draft, edits it, and saves it.

Quality benchmark:

- Use 5 representative recordings.
- At least 3 should produce structurally complete drafts that pass validation and are practical to edit.
- The benchmark does not claim fully automatic execution without review.

## Acceptance Criteria

- User can record full screen and active window.
- User can stop recording and see a local timeline with keyframes, event summaries, context, and notes.
- User can delete sensitive artifacts before parsing.
- User can click generate draft and receive a Phase 2-compatible `WorkflowDraft`.
- Generated drafts use `sourceType: 'recording'`.
- Generated drafts enter the Phase 2 editor before save.
- Invalid parser output returns stable validation errors.
- Full-screen and active-window recording can each start and stop successfully in a valid desktop session.
- Five repeated start/stop cycles leave no active recording sessions behind.
- 5 benchmark recordings produce at least 3 structurally complete, editable drafts.
- Cloud sync and vector retrieval remain absent.

## Implementation Order

1. Add recording teaching core types and session metadata model.
2. Add event redaction and timeline builder with deterministic tests.
3. Add extractor provider interface and validation path.
4. Add local storage for sessions, events, keyframes, and context snapshots.
5. Add desktop IPC handlers with stable result contracts.
6. Add recording teaching renderer view.
7. Integrate generated drafts with the existing workflow editor.
8. Add simulated timeline smoke tests.
9. Add real desktop recording smoke and five-cycle leak verification.
10. Run quality benchmark and record results.
