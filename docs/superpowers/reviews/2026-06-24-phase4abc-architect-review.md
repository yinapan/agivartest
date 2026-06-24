# Phase 4A/4B/4C Architect Review

## Scope

Reviewed Phase 4 recording teaching design, implementation plans, closure reports, and implementation files for:

- Phase 4A recording teaching UI.
- Phase 4B provider payload, OpenAI-compatible adapter, generation controls, and evidence hardening.
- Phase 4C recording history, discard cleanup, orphan cleanup, preflight, and benchmark reporting.

This review was produced by an architecture review agent. It is read-only feedback; no implementation files were changed by the review.

## Findings

### Critical

1. Unsafe local path deletion in discard cleanup.

Files:

- `packages/core/src/memory/recording-store.ts`

Issue:

`discardSession` deletes `keyframe.imagePath`, `session.videoPath`, and `session.artifactDir` with recursive `rm` and only skips `artifact://` pseudo paths. It does not prove the target path is inside the recording artifact root or data directory.

Risk:

A corrupted DB row or unexpected path could delete files outside the intended recording artifact area.

Recommendation:

- Pass an explicit artifact root into `discardSession`, or store it in `RecordingStore`.
- Before deletion, resolve the target with `realpath` where possible.
- Check `path.relative(root, target)` and reject paths outside the root.
- Treat missing paths as idempotent success.
- Add tests where a DB row points outside the artifact root and verify no file is deleted.

### Important

1. Cancelled provider generations can still persist results.

Files:

- `packages/desktop/src/main/recording-teach-ipc.ts`

Issue:

`cancelDraftGeneration` marks generation state as `cancelled`, but an in-flight provider call can still return later, save a draft link, and overwrite state to `draft_ready`.

Recommendation:

- Assign a request token or attempt id for every generation.
- Store the token in generation state.
- Before `repo.saveDraftLink`, confirm the current state is still `running` for the same token.
- If state is cancelled or superseded, discard the provider result and avoid persistence.
- Add a deferred-provider test: start generation, cancel, resolve provider, assert no draft link is saved.

2. Provider payload builder ignores `includedInProvider`.

Files:

- `packages/core/src/memory/recording-teaching-service.ts`

Issue:

`buildRecordingProviderPayload` filters keyframes by selected id and active status, but does not check `includedInProvider`.

Recommendation:

- Add `keyframe.includedInProvider` to the payload filter.
- Add a core test where a manifest includes a provider-disabled keyframe and the payload still excludes it.

3. Provider prompt leaks local image paths.

Files:

- `packages/core/src/memory/recording-teaching-service.ts`
- `packages/core/src/memory/recording-provider.ts`

Issue:

`RecordingProviderPayload.keyframes` includes `imagePath`, and the OpenAI-compatible adapter serializes that payload into the LLM prompt. In production this can expose local directory structure and usernames.

Recommendation:

- Do not send local filesystem paths to text providers.
- External provider payload should expose artifact id, timestamp, reason, hash, size, mime type, and redaction status.
- If future vision upload is added, read files through a controlled file boundary instead of putting local paths in prompt JSON.

4. Production preflight is not wired.

Files:

- `packages/desktop/src/main/recording-teach-ipc.ts`
- `packages/desktop/src/main/index.ts`

Issue:

`handleRecordingTeachPreflight` supports injected deps, but production `recordingTeachDeps` does not provide `preflight`, so production returns `{ canRecord: true, artifactBytes: 0 }`.

Recommendation:

- Wire a real production preflight in `main/index.ts`.
- Check artifact root can be created and written.
- Estimate recording artifact directory size.
- Probe active-window availability when relevant.
- Return warnings for non-blocking issues.

5. App quit cleanup is fire-and-forget.

Files:

- `packages/desktop/src/main/index.ts`

Issue:

`before-quit` starts cleanup and `forceStopAllRecordings` without awaiting them. Electron may exit before cleanup finishes.

Recommendation:

- Add a shutdown coordinator with bounded timeout.
- Prevent default quit once, await cleanup or timeout, then quit.
- Make the coordinator unit-testable without needing Electron event tests.

6. Metadata patch semantics can clear fields unintentionally.

Files:

- `packages/core/src/memory/recording-store.ts`
- `packages/desktop/src/main/recording-teach-ipc.ts`

Issue:

`updateSessionMetadata` writes `goal: patch.goal` and `notes: patch.notes`. If only one field is sent, the other becomes `undefined`.

Recommendation:

- Preserve omitted fields.
- Define empty string behavior explicitly: either clear field or normalize to undefined.
- Add tests for notes-only update preserving goal and goal-only update preserving notes.

### Minor

1. History selection does not load timeline.

Files:

- `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`

Issue:

Selecting a historical session sets `session`, goal, and notes, but does not call `getTimeline`. The user cannot immediately review timeline evidence or build a manifest from the selected history item.

Recommendation:

- On history selection, call `recordingTeach.getTimeline(session.id)`.
- If timeline is missing, show a stable renderer error.

2. Phase 4C closure report is missing.

Files:

- `docs/superpowers/plans/2026-06-24-phase4c-recording-history-cleanup-hardening.md`

Issue:

Phase 4C implementation now exists, but there is no closure report recording what was completed, what remains, and verification evidence.

Recommendation:

- Add `docs/superpowers/reports/2026-06-24-phase4c-closure.md`.
- Include completed features, intentional gaps, verification commands, and follow-up hardening items.

## Positive Notes

- Phase 4B manifest verification is a strong trust boundary. Main rebuilds the expected manifest from the persisted timeline and rejects tampered renderer input before provider invocation.
- Provider evidence normalization reduces persistent data pollution from provider hallucinations.
- IPC remains scoped under `recordingTeach.*`; renderer does not receive store or filesystem authority.
- Current tests cover important paths: manifest tampering, provider retry/reprocess/cancel state, discard idempotency, and benchmark reporting.

## Suggested Plan Updates

Merge into Phase 4C hardening:

- Safe path containment for discard deletion.
- Real production preflight wiring.
- Awaited app quit cleanup with timeout.
- Metadata patch semantics.
- History item timeline loading.
- Phase 4C closure report.

Merge into Phase 4D or a Phase 4C hardening patch:

- Generation request tokens so cancelled provider calls cannot persist later results.
- Remove local image paths from provider prompt payloads.
- Runtime schema validation for provider output beyond JSON parse and draft validation.

## Recommended Next Action

Fix the Critical deletion containment issue first. Then address generation cancellation persistence and provider payload path leakage before pushing Phase 4C as fully closed.
