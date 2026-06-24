# Phase 4B Closure Report

## Summary

Phase 4B is implemented across three pushed commits:

- `74aa257 feat(phase4b): 构建录屏 provider payload 边界`
- `b9376f2 feat(phase4b): 接入 OpenAI-compatible 录屏 provider`
- `51f8967 feat(phase4b): 完善录屏 provider 生成控制`

The work connects recording teaching to a real OpenAI-compatible provider adapter while keeping the deterministic provider for regression and fallback.

## Implemented

### Provider Payload Boundary

Implemented in:

- `packages/core/src/types/workflow.ts`
- `packages/core/src/memory/recording-teaching-service.ts`

The provider receives `RecordingProviderPayload`, not a loose timeline or artifact directory.

Payload includes:

- selected active keyframes;
- selected active events;
- selected active context;
- goal and notes;
- provider name;
- privacy mode;
- redaction policy;
- raw text flags.

Summary mode strips raw event payloads. Detailed mode only includes raw payloads after manifest confirmation.

### Manifest Trust Boundary

Implemented in:

- `packages/desktop/src/main/recording-teach-ipc.ts`

`handleRecordingTeachGenerateDraft` verifies the submitted manifest by rebuilding the expected manifest from the persisted timeline. Tampered selected artifacts, raw text flags, coordinate flags, or redaction policy are rejected before provider invocation.

### OpenAI-Compatible Provider

Implemented in:

- `packages/core/src/memory/recording-provider.ts`
- `packages/core/src/index.ts`
- `packages/desktop/src/main/index.ts`

The adapter uses the existing `LLMProvider` abstraction and therefore works with the existing `OpenAIClient`.

No API key:

- app uses deterministic fallback provider.

API key present:

- app selects `openai-compatible`.

### Provider UI Selection

Implemented in:

- `packages/desktop/src/main/recording-teach-ipc.ts`
- `packages/desktop/src/main/ipc.ts`
- `packages/desktop/src/preload.ts`
- `packages/desktop/src/renderer/pages/recording-teach-model.ts`
- `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`

Renderer displays provider choices and uses the selected provider name when building manifests.

### Generation Controls

Implemented in:

- `packages/desktop/src/main/recording-teach-ipc.ts`
- `packages/desktop/src/main/ipc.ts`
- `packages/desktop/src/preload.ts`
- `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`

Supported controls:

- generation status;
- cancel generation state;
- retry previous failed generation request;
- reprocess by rebuilding manifest and generating again.

Cancel is state-level cancellation. It does not yet physically abort an in-flight LLM request.

### Evidence Hardening

Implemented in:

- `packages/core/src/memory/recording-teaching-service.ts`

Provider evidence is normalized:

- invalid step ids map to the first generated step;
- unavailable event ids are removed;
- unavailable keyframe ids are removed;
- unavailable context ids are removed;
- confidence is clamped to `0..1`;
- warnings explain each correction.

## Verification Evidence

Fresh verification was run during implementation:

```powershell
pnpm vitest run packages/core/tests/recording-provider.test.ts packages/core/tests/recording-teaching-service.test.ts packages/core/tests/recording-benchmark.test.ts packages/desktop/tests/recording-teach-ipc.test.ts packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/phase4a-recording-ui-smoke.test.ts
```

Result:

- 6 test files passed.
- 43 tests passed.

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

## Remaining Work

These are intentionally Phase 4C or later:

- Recording history list.
- Persisted recording goal / notes rename.
- Discard and artifact cleanup.
- Startup orphan cleanup.
- App quit active-recording cleanup.
- Permission and artifact directory preflight.
- Artifact quota prompts.
- Structured five-recording hardening report.
- Physical abort propagation to provider calls via `AbortSignal`.

## Status

Phase 4B implementation is complete and pushed.

Current next phase:

- Phase 4C: recording history, cleanup, lifecycle hardening, preflight, and benchmark reporting.
