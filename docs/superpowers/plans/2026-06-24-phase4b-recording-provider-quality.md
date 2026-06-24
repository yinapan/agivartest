# Phase 4B Recording Provider Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect recording teaching to a real OpenAI-compatible provider path while preserving deterministic regression and hardening provider payload, retry, reprocess, cancel, and evidence behavior.

**Architecture:** Core owns the provider payload boundary and output validation. Desktop main owns provider selection and generation-state IPC. Renderer consumes provider choices and generation controls without bypassing manifest confirmation.

**Tech Stack:** TypeScript, Vitest, Electron main/preload IPC, React renderer, existing `LLMProvider`, `OpenAIClient`, and `RecordingTeachingService`.

---

## File Structure

- Modify `packages/core/src/types/workflow.ts`
  - Add `RecordingProviderPayload`.
  - Keep `RecordingWorkflowProviderResult` and evidence types as the provider contract.

- Modify `packages/core/src/memory/recording-teaching-service.ts`
  - Add `buildRecordingProviderPayload`.
  - Change `RecordingWorkflowProvider.generateWorkflowDraft` to accept `RecordingProviderPayload`.
  - Normalize provider evidence before returning results.

- Create `packages/core/src/memory/recording-provider.ts`
  - Implement `OpenAICompatibleRecordingProvider`.

- Modify `packages/core/src/index.ts`
  - Export payload builder and provider adapter.

- Modify `packages/core/tests/recording-teaching-service.test.ts`
  - Cover manifest confirmation, payload redaction, detailed-mode raw payload inclusion, malformed provider output, and evidence normalization.

- Create `packages/core/tests/recording-provider.test.ts`
  - Cover OpenAI-compatible adapter behavior.

- Modify `packages/desktop/src/main/recording-teach-ipc.ts`
  - Add provider registry.
  - Add provider list handler.
  - Add generation status, cancel, retry, and reprocess handlers.
  - Verify submitted manifests before provider invocation.

- Modify `packages/desktop/src/main/ipc.ts`
  - Register new recording provider and generation handlers.

- Modify `packages/desktop/src/main/index.ts`
  - Configure OpenAI-compatible provider when API key exists.

- Modify `packages/desktop/src/preload.ts`
  - Expose provider list and generation-control APIs.

- Modify `packages/desktop/src/renderer/pages/recording-teach-model.ts`
  - Add provider list and generation state DTOs.

- Modify `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`
  - Add provider select, retry, reprocess, cancel, and generation status UI.

- Modify `packages/desktop/tests/recording-teach-ipc.test.ts`
  - Cover provider selection and generation-control behavior.

- Modify `packages/desktop/tests/recording-teach-model.test.ts`
  - Cover provider state helper behavior.

---

### Task 1: Provider Payload Boundary

**Files:**
- Modify: `packages/core/src/types/workflow.ts`
- Modify: `packages/core/src/memory/recording-teaching-service.ts`
- Test: `packages/core/tests/recording-teaching-service.test.ts`

- [x] **Step 1: Add failing tests**

Tests added:

- payload excludes deleted or unselected artifacts;
- summary mode does not leak raw event payloads;
- detailed confirmed mode can include raw event payloads;
- provider generation requires confirmed manifest.

Run:

```powershell
pnpm vitest run packages/core/tests/recording-teaching-service.test.ts
```

Expected before implementation: payload builder or provider signature tests fail.

- [x] **Step 2: Add `RecordingProviderPayload` type**

Add the payload shape in `packages/core/src/types/workflow.ts`.

- [x] **Step 3: Implement `buildRecordingProviderPayload`**

Build payload from timeline and manifest only, filtering:

- keyframes by selected id, active status, and included-in-provider;
- events by selected id and active status;
- context snapshots by selected id and active status.

Only include event `rawPayload` when:

- manifest is confirmed;
- manifest contains raw text;
- timeline privacy mode is `detailed`.

- [x] **Step 4: Verify tests**

Run:

```powershell
pnpm vitest run packages/core/tests/recording-teaching-service.test.ts
```

Expected: service tests pass.

### Task 2: OpenAI-Compatible Recording Provider Adapter

**Files:**
- Create: `packages/core/src/memory/recording-provider.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/recording-provider.test.ts`

- [x] **Step 1: Add failing adapter tests**

Tests added:

- sends redacted payload to LLM;
- summary mode does not leak raw text;
- invalid JSON produces stable error.

Run:

```powershell
pnpm vitest run packages/core/tests/recording-provider.test.ts
```

Expected before implementation: provider import or behavior fails.

- [x] **Step 2: Implement adapter**

Implement `OpenAICompatibleRecordingProvider` with:

- system prompt;
- JSON user payload;
- summary-mode raw payload sanitizer;
- JSON-fence stripping;
- stable invalid JSON error.

- [x] **Step 3: Export adapter**

Add to `packages/core/src/index.ts`:

```ts
export { OpenAICompatibleRecordingProvider } from './memory/recording-provider.js';
```

- [x] **Step 4: Verify adapter tests**

Run:

```powershell
pnpm vitest run packages/core/tests/recording-provider.test.ts
```

Expected: adapter tests pass.

### Task 3: Desktop Provider Selection

**Files:**
- Modify: `packages/desktop/src/main/recording-teach-ipc.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Test: `packages/desktop/tests/recording-teach-ipc.test.ts`

- [x] **Step 1: Add failing provider-selection tests**

Tests added:

- manifest default provider name follows configured provider;
- generation payload sees configured provider name;
- provider list returns deterministic and OpenAI-compatible providers.

Run:

```powershell
pnpm vitest run packages/desktop/tests/recording-teach-ipc.test.ts
```

Expected before implementation: provider selection/list functions fail.

- [x] **Step 2: Add provider registry**

Add:

- `setRecordingTeachProvider(name, provider)`
- `resetRecordingTeachProvider()`
- default deterministic provider.

- [x] **Step 3: Add provider list handler**

Add:

```ts
handleRecordingTeachListProviders()
```

Return selected provider and availability flags.

- [x] **Step 4: Wire OpenAI-compatible provider in main**

In `packages/desktop/src/main/index.ts`, when API key exists:

```ts
setRecordingTeachProvider('openai-compatible', new OpenAICompatibleRecordingProvider(llm));
```

- [x] **Step 5: Verify IPC tests**

Run:

```powershell
pnpm vitest run packages/desktop/tests/recording-teach-ipc.test.ts
```

Expected: provider selection tests pass.

### Task 4: Generation Retry, Reprocess, Cancel, And Status

**Files:**
- Modify: `packages/desktop/src/main/recording-teach-ipc.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/preload.ts`
- Test: `packages/desktop/tests/recording-teach-ipc.test.ts`

- [x] **Step 1: Add failing generation-control tests**

Tests added:

- provider failure sets failed status and `canRetry`;
- retry reuses previous request;
- reprocess rebuilds manifest;
- cancel marks session generation state cancelled.

Run:

```powershell
pnpm vitest run packages/desktop/tests/recording-teach-ipc.test.ts
```

Expected before implementation: missing handlers or incorrect state.

- [x] **Step 2: Implement in-memory generation state**

Track:

- session id;
- status;
- provider name;
- canRetry;
- attempts;
- error.

- [x] **Step 3: Implement handlers**

Add:

- `handleRecordingTeachGenerationStatus`
- `handleRecordingTeachCancelDraftGeneration`
- `handleRecordingTeachRetryDraftGeneration`
- `handleRecordingTeachReprocessDraft`

- [x] **Step 4: Register IPC and preload APIs**

Register:

- `recordingTeach:generationStatus`
- `recordingTeach:cancelDraftGeneration`
- `recordingTeach:retryDraftGeneration`
- `recordingTeach:reprocessDraft`

- [x] **Step 5: Verify IPC tests**

Run:

```powershell
pnpm vitest run packages/desktop/tests/recording-teach-ipc.test.ts
```

Expected: generation-control tests pass.

### Task 5: Provider Evidence Hardening

**Files:**
- Modify: `packages/core/src/memory/recording-teaching-service.ts`
- Test: `packages/core/tests/recording-teaching-service.test.ts`

- [x] **Step 1: Add failing evidence-normalization test**

Test added:

- invalid provider `stepId` maps to first step;
- unavailable event/keyframe/context ids are removed;
- confidence is clamped to `0..1`;
- warnings record each correction.

Run:

```powershell
pnpm vitest run packages/core/tests/recording-teaching-service.test.ts
```

Expected before implementation: raw provider evidence is returned unchanged.

- [x] **Step 2: Implement `normalizeProviderEvidence`**

Normalize after draft validation and before returning `RecordingTeachingResult`.

- [x] **Step 3: Verify service tests**

Run:

```powershell
pnpm vitest run packages/core/tests/recording-teaching-service.test.ts
```

Expected: evidence-normalization test passes.

### Task 6: Renderer Provider Controls

**Files:**
- Modify: `packages/desktop/src/renderer/pages/recording-teach-model.ts`
- Modify: `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`
- Test: `packages/desktop/tests/recording-teach-model.test.ts`
- Test: `packages/desktop/tests/phase4a-recording-ui-smoke.test.ts`

- [x] **Step 1: Add renderer model test**

Test added:

- provider list from main process updates selected provider and options.

Run:

```powershell
pnpm vitest run packages/desktop/tests/recording-teach-model.test.ts
```

Expected before implementation: helper is missing.

- [x] **Step 2: Add DTOs and helper**

Add:

- `RecordingProviderOptionDto`
- `RecordingProviderListDto`
- `RecordingGenerationStateDto`
- `applyProviderList`

- [x] **Step 3: Add panel controls**

Add:

- provider select;
- cancel;
- retry;
- reprocess;
- generation status line.

- [x] **Step 4: Verify renderer tests and smoke**

Run:

```powershell
pnpm vitest run packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/phase4a-recording-ui-smoke.test.ts
```

Expected: both files pass.

### Task 7: Final Verification

**Files:**
- All Phase 4B files.

- [x] **Step 1: Run related tests**

Run:

```powershell
pnpm vitest run packages/core/tests/recording-provider.test.ts packages/core/tests/recording-teaching-service.test.ts packages/core/tests/recording-benchmark.test.ts packages/desktop/tests/recording-teach-ipc.test.ts packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/phase4a-recording-ui-smoke.test.ts
```

Expected: 6 test files pass.

- [x] **Step 2: Run builds**

Run:

```powershell
pnpm --filter @agivar/core build
pnpm --filter @agivar/desktop build
```

Expected: both builds exit 0. Existing Vite external/eval warnings may remain.

- [x] **Step 3: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors. Windows LF/CRLF warnings may appear.

- [x] **Step 4: Commit and push**

Committed and pushed:

- `74aa257 feat(phase4b): 构建录屏 provider payload 边界`
- `b9376f2 feat(phase4b): 接入 OpenAI-compatible 录屏 provider`
- `51f8967 feat(phase4b): 完善录屏 provider 生成控制`
