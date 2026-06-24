# Phase 4 Architect Review

Review target:

- `docs/superpowers/specs/2026-06-24-phase4-recording-ui-provider-hardening-design.md`
- `docs/superpowers/plans/2026-06-24-phase4a-recording-teaching-ui.md`

Reviewer: Architect agent

## Findings

### P0

No blocking issues found.

### P1: Recording Draft Saves Would Be Audited As `text-teach`

File: `docs/superpowers/plans/2026-06-24-phase4a-recording-teaching-ui.md`

Section: `Task 3: Wire RecordingTeachPanel Into WorkflowsPage`

The plan only extends the renderer-side `WorkflowMemoryVersion.source` type to include `recording-teach`. Existing `packages/desktop/src/main/workflow-ipc.ts` still saves drafts through `handleMemorySaveDraft` with `{ source: 'text-teach' }` unconditionally.

Impact: a recording-generated draft can have `sourceType: 'recording'`, but the saved workflow version audit trail will still say `text-teach`.

Recommendation:

- Update the Phase 4A plan to modify `handleMemorySaveDraft`.
- Use `source: draft.sourceType === 'recording' ? 'recording-teach' : 'text-teach'`.
- Add a `workflow-ipc.test.ts` case proving recording drafts save with version source `recording-teach`.

### P1: Manifest Confirmation Trusts Renderer-Supplied Data

Files:

- `docs/superpowers/specs/2026-06-24-phase4-recording-ui-provider-hardening-design.md`
- `docs/superpowers/plans/2026-06-24-phase4a-recording-teaching-ui.md`

Sections:

- `IPC Contract`
- `Privacy And Safety`
- `Task 2: Add RecordingTeachPanel Component`

The current flow has the renderer call `buildConfirmedManifest(manifest)` and send the full manifest back to `recordingTeach.generateDraft`. Current IPC validation only checks that `manifest` is an object, and core validation mainly checks `status === 'confirmed'` and matching `sessionId`.

Impact: a tampered renderer could modify `containsRawText`, `containsPreciseCoordinates`, or `selectedArtifactIds`. This is limited while Phase 4A uses a deterministic provider, but it becomes a privacy boundary problem in Phase 4B when a real provider is connected.

Recommendation:

- Update the design and plan so `generateDraft` re-loads the timeline in main/core and verifies the submitted manifest matches a server-derived manifest before provider invocation.
- A stronger alternative is to persist provider manifests and accept only `{ manifestId, explicitConfirm: true }`.
- Add an IPC test proving a tampered manifest is rejected.

### P1: Renderer DTO Plan Does Not Truly Match The IPC Surface

Files:

- `docs/superpowers/specs/2026-06-24-phase4-recording-ui-provider-hardening-design.md`
- `docs/superpowers/plans/2026-06-24-phase4a-recording-teaching-ui.md`

Sections:

- `IPC Contract`
- `Task 1: Add Recording Teach Renderer Model`

The spec says renderer DTOs should match the current preload surface, but the planned `RecordingTimelineDto`, event, keyframe, and context shapes omit fields from core IPC results, including `sessionId`, `timestampMs`, `redactionLevel`, `fileSize`, `mimeType`, `includedInProvider`, and `source`.

Impact: the tests could pass against a UI-only subset while giving false confidence that the renderer contract matches IPC. Missing fields also matter for Phase 4B payload display and Phase 4C artifact governance.

Recommendation:

- Clarify that renderer DTOs are view DTOs, not complete IPC DTOs, and add conversion/normalization helpers.
- Or mirror the core DTO fields that Phase 4B/4C will need.

### P1: Concurrent Recording Protection Depends On Local React State

File: `docs/superpowers/plans/2026-06-24-phase4a-recording-teaching-ui.md`

Section: `Task 2: Add RecordingTeachPanel Component`

The plan passes `activeSessionId: state.session?.id` to `recordingTeach.start`. Current IPC only checks active session state when an `activeSessionId` is supplied. If the page refreshes, the component remounts, or start fails after native state changes, local state can be empty and a second recording may start.

Impact: multiple `recording` or `stopping` sessions can be created, which risks inconsistent native recorder and recording-store state.

Recommendation:

- Add a Phase 4A task to make `recordingTeach.start` reject any existing `recording` or `stopping` session from the repository, independent of renderer state.
- Keep broader startup orphan cleanup in Phase 4C.

### P2: Detailed Mode Needs Explicit Acknowledgement

Files:

- `docs/superpowers/specs/2026-06-24-phase4-recording-ui-provider-hardening-design.md`
- `docs/superpowers/plans/2026-06-24-phase4a-recording-teaching-ui.md`

Sections:

- `Privacy And Safety`
- `Task 2: Add RecordingTeachPanel Component`

The spec and plan only show a warning for detailed mode. Detailed mode may retain raw text or precise coordinates locally.

Recommendation:

- Add an explicit acknowledgement before starting detailed recording.
- A checkbox is preferable to a transient message: `I understand detailed mode may retain raw text and precise coordinates locally`.

### P2: Manual Smoke Is Optional Despite Being The Only End-To-End UI Verification

File: `docs/superpowers/plans/2026-06-24-phase4a-recording-teaching-ui.md`

Section: `Task 4: Run Phase 4A Verification`

Phase 4A's core value is the renderer interaction loop, but there is no component test harness and manual smoke is optional.

Recommendation:

- Make manual smoke a required Phase 4A verification item, or require a recorded local smoke result.
- Include failure-path checks: start failure, stop failure, unconfirmed manifest cannot generate, and generate failure can retry.

### P2: Plan Defaults To Pushing Directly To Remote `master`

File: `docs/superpowers/plans/2026-06-24-phase4a-recording-teaching-ui.md`

Section: `Task 4: Run Phase 4A Verification / Step 5: Push branch`

The plan requires `git push`, which implies pushing `master` in this repository. That couples implementation with integration policy.

Recommendation:

- Change the plan to commit locally and wait for integration instruction, or push only the current feature branch when explicitly requested.

## Overall Conclusion

Phase 4 is split sensibly: Phase 4A renderer workflow, Phase 4B provider quality, Phase 4C reliability and governance. The main architecture direction is sound.

Before implementation, update the design and plan for the P1 findings:

- version source for recording-created saves,
- server-side manifest verification,
- clearer renderer DTO boundary,
- repository-level concurrent recording protection.
