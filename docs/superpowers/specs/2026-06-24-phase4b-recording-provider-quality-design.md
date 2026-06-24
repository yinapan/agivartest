# Phase 4B Recording Provider Quality Design

## Scope

Phase 4B connects the Phase 4A recording teaching UI to a real provider path while preserving deterministic regression behavior.

It covers:

1. A trusted provider payload boundary.
2. An OpenAI-compatible recording provider adapter.
3. Provider selection exposed to renderer UI.
4. Retry, reprocess, cancel, and generation status semantics.
5. Provider output validation and evidence-link hardening.
6. Regression tests that keep deterministic provider behavior available.

Phase 4B intentionally stops before full data governance. Recording history, discard cleanup, startup orphan cleanup, permission preflight, and artifact quota prompts are Phase 4C.

## Goals

- Build provider payloads only from a confirmed manifest and persisted timeline.
- Prevent renderer-supplied manifests from silently changing selected artifacts, raw text flags, or coordinate flags.
- Add a real OpenAI-compatible provider adapter using the existing `LLMProvider` abstraction.
- Keep the deterministic provider available for tests and fallback.
- Let renderer users see and choose the configured recording provider.
- Let a failed generation be retried without rebuilding state manually.
- Let a recording be reprocessed by rebuilding a manifest and invoking the selected provider again.
- Let the renderer cancel the current generation state without corrupting persisted session or draft data.
- Normalize provider evidence so generated evidence only points to valid steps and selected artifacts.

## Non-Goals

- Phase 4B does not upload artifacts without explicit manifest confirmation.
- Phase 4B does not implement cloud sync, vector retrieval, account sharing, or team collaboration.
- Phase 4B does not add recording history management.
- Phase 4B does not implement full local artifact deletion or disk quota cleanup.
- Phase 4B does not guarantee provider calls are physically aborted mid-request. The Phase 4B cancel operation is a stable local generation-state cancellation. Passing `AbortSignal` to providers is a later hardening step.

## Architecture

### Core Provider Payload Boundary

`RecordingTeachingService.generateDraft` accepts:

- persisted `RecordingTimeline`;
- confirmed `ProviderPayloadManifest`;
- injected `RecordingWorkflowProvider`.

The service validates the request before invoking the provider:

- manifest must be confirmed;
- manifest session id must match timeline session id;
- timeline must contain notes, events, keyframes, or context;
- summary mode must not leak raw event payloads.

`buildRecordingProviderPayload(timeline, manifest)` builds a narrow `RecordingProviderPayload`:

- selected keyframes;
- selected active events;
- selected active context snapshots;
- notes and goal;
- privacy mode and redaction policy;
- raw payload only when detailed mode and confirmed manifest allow raw text.

The provider never receives a loose artifact directory.

### OpenAI-Compatible Recording Provider

`OpenAICompatibleRecordingProvider` implements `RecordingWorkflowProvider` and depends on the existing `LLMProvider`.

The adapter:

- sends a system prompt and sanitized JSON payload;
- strips markdown JSON fences from provider output;
- parses strict JSON into `RecordingWorkflowProviderResult`;
- wraps invalid JSON with `Recording provider returned invalid JSON`;
- removes `rawPayload` from summary-mode prompts even if an upstream object contains it.

The adapter is OpenAI-compatible through the app's existing `OpenAIClient`, but tests use a mock `LLMProvider`.

### Desktop Provider Selection

Desktop main owns the provider registry:

- default: `recording-teaching-provider`;
- configured when API key exists: `openai-compatible`.

IPC exposes `recordingTeach.listProviders()`.

Renderer uses this list to show available provider options. Selecting a provider affects manifest building and generation.

### Generation State

Desktop main tracks per-session generation state in memory:

- `idle`
- `running`
- `failed`
- `draft_ready`
- `cancelled`

The state records:

- session id;
- provider name;
- attempt count;
- whether retry is allowed;
- last error.

`retryDraftGeneration(sessionId)` reuses the last confirmed generation request.

`reprocessDraft({ sessionId, providerName })` rebuilds a manifest from persisted timeline and invokes generation again.

`cancelDraftGeneration(sessionId)` marks state cancelled and keeps retry possible when a previous request exists.

### Evidence Hardening

Provider output can contain invalid links. Core normalizes evidence after draft validation:

- invalid `stepId` is mapped to the first generated step id;
- missing event ids are removed and warned;
- missing keyframe ids are removed and warned;
- missing context ids are removed and warned;
- confidence is clamped to `0..1`;
- session id is forced to the timeline session id.

This keeps provider output useful while preventing stale or invented evidence references from leaking into draft links.

## Data Flow

1. Renderer requests provider list.
2. User selects provider.
3. Renderer calls `buildManifest(sessionId, providerName)`.
4. Main rebuilds manifest from persisted timeline.
5. User confirms manifest in renderer.
6. Renderer calls `generateDraft({ sessionId, manifest: confirmedManifest })`.
7. Main verifies submitted manifest against the current timeline.
8. Core builds provider payload.
9. Provider returns draft, evidence, warnings.
10. Core validates draft and normalizes evidence.
11. Main persists `recording_draft_links`.
12. Renderer injects generated draft into the existing workflow editor.

## Security And Privacy

- Renderer confirmation is advisory. Main verifies the manifest before provider invocation.
- Summary mode excludes raw typed text from provider payloads.
- Detailed mode requires Phase 4A acknowledgement and confirmed manifest before raw text is allowed.
- Provider output is treated as untrusted until draft validation and evidence normalization complete.
- Deterministic provider remains the fallback when no API key is configured.

## Testing Strategy

Core tests:

- `packages/core/tests/recording-teaching-service.test.ts`
  - manifest confirmation required;
  - provider payload excludes unselected and deleted artifacts;
  - summary mode strips raw payloads;
  - detailed confirmed mode may include raw payloads;
  - malformed provider draft output returns validation errors;
  - provider evidence is normalized.

- `packages/core/tests/recording-provider.test.ts`
  - OpenAI-compatible adapter sends redacted payload;
  - summary mode does not leak raw text;
  - invalid JSON is wrapped in stable error.

Desktop tests:

- `packages/desktop/tests/recording-teach-ipc.test.ts`
  - configured provider name is used for manifest and generation;
  - provider list is exposed for renderer selection;
  - retry, reprocess, status, and cancellation semantics work;
  - tampered manifests are rejected before provider invocation.

Renderer tests:

- `packages/desktop/tests/recording-teach-model.test.ts`
  - provider list selection updates renderer state.

Smoke:

- `packages/desktop/tests/phase4a-recording-ui-smoke.test.ts`
  - recording UI remains visible after provider controls are added.

## Acceptance Criteria

- Provider payloads are built from confirmed manifests and persisted timelines.
- Tampered renderer manifests are rejected before provider invocation.
- OpenAI-compatible recording provider adapter is exported from core.
- Desktop main switches to OpenAI-compatible provider when an API key exists.
- Deterministic provider remains the no-key fallback and regression provider.
- Renderer exposes provider choice.
- Retry, reprocess, cancel, and status APIs exist and are covered by tests.
- Provider evidence is normalized to valid steps and artifacts.
- Core and desktop builds pass.
- Related Phase 4B tests pass.
