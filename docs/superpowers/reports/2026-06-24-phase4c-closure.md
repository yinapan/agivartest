# Phase 4C Closure Report

## Summary

Phase 4C is implemented and pushed across two implementation commits plus one architecture-review documentation commit:

- `0264a69 feat(phase4c): 完善录屏历史和清理治理`
- `72218a3 docs(phase4): 记录 4A4B4C 架构审查建议`
- `e588bc3 fix(phase4c): 加固录屏清理和生成取消边界`

The work closes the local recording-teaching lifecycle after Phase 4A UI and Phase 4B provider generation. It adds history management, persisted metadata edits, discard cleanup, startup and quit cleanup, preflight checks, benchmark reporting, and hardening from the Phase 4A/4B/4C architecture review.

## Implemented

### Recording History

Implemented in:

- `packages/core/src/types/workflow.ts`
- `packages/core/src/memory/recording-store.ts`
- `packages/desktop/src/main/recording-teach-ipc.ts`
- `packages/desktop/src/main/ipc.ts`
- `packages/desktop/src/preload.ts`
- `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`

Supported capabilities:

- list historical recording sessions outside the current active session;
- exclude active `recording` and `stopping` sessions by default;
- resume historical draft links;
- reprocess historical recordings through the existing Phase 4B manifest and provider path.

### Persisted Goal And Notes Edits

Implemented in:

- `packages/core/src/memory/recording-store.ts`
- `packages/desktop/src/main/recording-teach-ipc.ts`
- `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`

Goal and notes can be edited independently. Omitted patch fields are preserved, so a notes-only edit does not clear the goal and a goal-only edit does not clear notes.

### Discard And Artifact Cleanup

Implemented in:

- `packages/core/src/memory/recording-store.ts`
- `packages/desktop/src/main/recording-teach-ipc.ts`
- `packages/desktop/src/main/ipc.ts`
- `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`

Discard behavior:

- marks the session as `discarded`;
- marks draft links as `discarded`;
- marks timeline keyframes, events, and context records as deleted;
- removes local keyframe, video, and artifact-directory files best-effort;
- treats repeated discard and missing files as idempotent success;
- returns cleanup warnings instead of failing the user workflow.

Hardening added after architecture review:

- local deletion requires an explicit `artifactRoot`;
- paths are resolved and must remain inside `artifactRoot`;
- `artifact://` pseudo paths are skipped;
- database rows pointing outside the artifact root are not deleted and emit warnings.

### Startup Orphan Cleanup

Implemented in:

- `packages/desktop/src/main/recording-teach-ipc.ts`
- `packages/desktop/src/main/index.ts`

Startup cleanup:

- finds sessions still marked `recording` or `stopping`;
- attempts native recorder stop when a native session id exists;
- marks orphan sessions `failed`;
- appends a stable cleanup note;
- remains idempotent across repeated startup cleanup calls.

### App Quit Cleanup

Implemented in:

- `packages/desktop/src/main/index.ts`

Quit cleanup now uses a bounded shutdown coordinator:

- prevents default quit once;
- runs orphan cleanup and `recorder.forceStopAllRecordings`;
- waits for cleanup or a timeout;
- then resumes app quit.

This replaces the previous fire-and-forget cleanup path.

### Recording Preflight And Artifact Governance

Implemented in:

- `packages/desktop/src/main/recording-teach-ipc.ts`
- `packages/desktop/src/main/index.ts`
- `packages/desktop/src/renderer/pages/recording-teach-model.ts`
- `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`

Preflight now checks:

- artifact root creation and writability;
- artifact directory byte size;
- active-window probe availability.

The renderer displays a compact preflight summary and cleanup warnings. Non-blocking issues are surfaced as warnings.

### Provider And Generation Hardening

Implemented in:

- `packages/core/src/memory/recording-provider.ts`
- `packages/core/src/memory/recording-teaching-service.ts`
- `packages/desktop/src/main/recording-teach-ipc.ts`

Hardening added after architecture review:

- provider payload excludes keyframes with `includedInProvider: false` even if a submitted manifest selects them;
- OpenAI-compatible prompt payload strips local `imagePath` values before serialization;
- cancelled provider generations use request tokens so late provider results cannot persist draft links or overwrite state.

### Five-Recording Benchmark Report

Implemented in:

- `packages/core/tests/recording-benchmark.test.ts`

The benchmark test produces a structured report over five representative recordings:

- total recording count;
- complete draft count;
- pass rate;
- provider payload audit;
- failure reasons.

Summary-mode payload audit verifies raw payloads are not leaked.

## Verification Evidence

Focused Phase 4C hardening verification:

```powershell
pnpm vitest run packages/core/tests/recording-store.test.ts packages/core/tests/recording-teaching-service.test.ts packages/core/tests/recording-provider.test.ts packages/desktop/tests/recording-teach-ipc.test.ts
```

Result:

- 4 test files passed.
- 50 tests passed.

Phase 4 recording and workflow regression verification:

```powershell
pnpm vitest run packages/core/tests/recording-store.test.ts packages/core/tests/recording-teaching-service.test.ts packages/core/tests/recording-provider.test.ts packages/core/tests/recording-benchmark.test.ts packages/desktop/tests/recording-teach-ipc.test.ts packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/phase4a-recording-ui-smoke.test.ts packages/desktop/tests/workflow-ipc.test.ts
```

Result:

- 8 test files passed.
- 72 tests passed.

Build verification:

```powershell
pnpm --filter @agivar/core build
pnpm --filter @agivar/desktop build
```

Result:

- core build passed.
- desktop build passed.
- desktop build still reports existing Vite external/eval warnings for `chromium-bidi`, `file-type`, and `playwright-core`.

Whitespace verification:

```powershell
git diff --check
```

Result:

- no whitespace errors.
- Windows LF/CRLF warnings may appear.

Push verification:

```powershell
git push
```

Result:

- remote `master` advanced from `51f8967` to `e588bc3`.

## Intentional Gaps

The following are not claimed as complete in Phase 4C:

- full manual Electron desktop smoke with real recording permissions;
- compact floating recording bar window;
- `recordingTeach.onStateChanged(listener)` main-process state event subscription;
- timeline preview loading when selecting a historical session in the renderer;
- image thumbnail/gallery preview for keyframes;
- physical provider-request abort via `AbortSignal`;
- runtime schema validation for provider output beyond JSON parse and workflow draft validation;
- cloud sync, vector retrieval, account sharing, or silent artifact upload.

## Follow-Up Recommendations

Recommended next work:

1. Run and record a real Electron smoke for fullscreen and active-window start/stop, preflight, history resume/reprocess, and discard.
2. Add history-selection timeline loading so selecting a historical session immediately refreshes evidence and manifest context.
3. Add a main-process recording state event API before introducing a floating recording bar.
4. Add provider `AbortSignal` propagation and runtime schema validation for provider responses.
5. Start Phase 4D or Phase 5 planning around recording-bar UX, keyframe preview, annotations, and provider quality iteration.

## Status

Phase 4C implementation and review hardening are complete and pushed through `e588bc3`.

The next practical step is a real Electron manual smoke, then Phase 4D / Phase 5 planning.
