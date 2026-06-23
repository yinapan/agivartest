# Phase 2 Text Teaching And Workflow Memory Design

## Scope

Phase 2 builds the teachable workflow loop after the Phase 1 desktop agent loop:

1. User teaches a workflow with text.
2. The system turns that teaching text into a structured workflow draft.
3. User reviews and edits the workflow without writing code.
4. The workflow is saved into local memory.
5. Future tasks can retrieve and reuse the workflow.
6. User can inspect versions and roll back mistakes.

This phase explicitly does not include cloud sync or vector retrieval. Retrieval stays local and keyword-based, using the existing `searchText`, trigger examples, topic, and app name fields. Recording-based teaching and video-to-workflow parsing remain Phase 3.

## Goals

- Generate a usable workflow draft from natural-language teaching text in under five minutes.
- Let users modify workflow steps, inputs, expected states, risk levels, and trigger examples in the desktop app.
- Save text-taught workflows with `sourceType: 'text-teach'`.
- Reuse saved workflows through the existing AgentService memory match path.
- Preserve edit history and support rollback through explicit workflow versions.

## Non-Goals

- No cloud account, sync server, remote storage, or shared workspace.
- No embeddings, vector database, semantic index, or remote retrieval service.
- No automatic video, frame, mouse, keyboard, or UIA event parsing.
- No drag-and-drop visual workflow builder in the first Phase 2 slice.
- No execution of newly generated drafts until the user saves them and existing safety checks pass.

## User Experience

The desktop app adds a workflow memory area with three primary views:

1. Teach
   - User selects or enters an app name.
   - User enters the task goal and teaching notes.
   - User clicks generate draft.
   - The app shows validation warnings and an editable draft.

2. Edit
   - User edits topic, trigger examples, summary, initial state, inputs, steps, success criteria, and risk level.
   - Step editing uses structured form rows first. Each row exposes intent, target hint, optional input hint, expected state, fallback, and risk level.
   - The editor validates required fields before save.

3. Versions
   - User can see version number, timestamp, change note, and source.
   - User can preview an older version.
   - Rollback creates a new version from the selected snapshot instead of mutating history.

The UI should be work-focused and compact, matching the current Electron desktop app style.

## Core Architecture

### TextTeachingService

Create a core service responsible for converting text into a workflow draft.

Inputs:

- `goal`
- `teachingText`
- optional `appName`
- optional `platform`

Outputs:

- `WorkflowDraft`
- validation warnings
- raw model response metadata when available

The service depends on an injected LLM provider interface so tests can use deterministic fake providers. It must not call UI, Electron, or file APIs directly.

### WorkflowDraft And Validation

Add a draft type near the existing workflow types. A draft is close to `WorkflowMemory` but has no final id, version, createdAt, or updatedAt until saved.

The validator normalizes:

- missing platform to `desktop`
- missing source type to `text-teach`
- empty trigger examples from goal and topic
- stable step ids when absent
- `searchText` from app name, topic, summary, trigger examples, and step intents

Validation must reject:

- empty topic
- no steps
- steps without intent
- steps without target hint
- high-risk or forbidden-looking steps without a risk level
- unsupported platform or malformed input definitions

Validation warnings should be returned for weak expected states, coordinate-only target hints, vague step wording, and missing success criteria.

### MemoryStore Versioning

Add local workflow version storage. Recommended table:

```sql
CREATE TABLE IF NOT EXISTS workflow_memory_versions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES workflow_memories(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  change_note TEXT,
  source TEXT NOT NULL CHECK (source IN ('create', 'edit', 'rollback', 'import', 'text-teach')),
  created_at TEXT NOT NULL
);
```

Rules:

- Creating a workflow writes `workflow_memories.version = 1` and a version snapshot.
- Editing a workflow increments `workflow_memories.version`.
- Rollback copies an old snapshot into the main row with a new incremented version.
- Version history is append-only.
- Deleting a workflow deletes its versions through cascade behavior where supported; if the database driver does not enforce cascade, `MemoryStore.delete` should remove versions explicitly.

### Retrieval

Keep the existing keyword retrieval path. Improve local search only enough to support Phase 2:

- include trigger examples, topic, summary, app name, and generated search text
- keep result limit small
- return matched fields for explainability

`embeddingStatus` remains `not_indexed`.

## Desktop Integration

### IPC

Add IPC handlers under the existing `memory:*` namespace:

- `memory:teachText`
- `memory:validateDraft`
- `memory:saveDraft`
- `memory:update`
- `memory:listVersions`
- `memory:getVersion`
- `memory:rollback`

Handlers should return serializable result objects with `{ ok, data, error }` shape where possible. IPC should perform input validation before passing data to core services.

### Renderer

Add a workflow memory page or panel connected from the current desktop navigation. It should support:

- list saved workflows
- generate text-taught draft
- edit draft/workflow fields
- save with a change note
- inspect version history
- rollback with confirmation

The editor should not expose raw JSON as the only editing path. A structured form is required for normal use. A read-only JSON preview is acceptable for debugging if it fits the existing style.

## Safety And Privacy

- Text teaching is local-first. Only the teaching text and required context are sent to the configured LLM provider.
- Secret inputs must be marked with `secret: true` or `humanOnly: true`; the parser should warn when it sees password, token, 2FA, verification code, payment, bank card, or identity-document wording.
- Generated workflows do not execute automatically.
- Risk levels are preserved and visible in the editor.
- Save and rollback actions are logged through local workflow version records.

## Review Addendum

The architecture and test reviews in `docs/superpowers/reviews/2026-06-24-phase2-architect-review.md` and `docs/superpowers/reviews/2026-06-24-phase2-test-review.md` are accepted as Phase 2 hardening input. The following items are now part of the Phase 2 completion scope:

### IPC Contract Hardening

- Every new `memory:*` IPC handler must validate its input at runtime.
- Every new `memory:*` IPC handler must return a stable `{ ok, data, error }` result shape and must not leak core exceptions as rejected Electron invokes.
- `memory:teachText`, `memory:saveDraft`, `memory:update`, `memory:listVersions`, `memory:getVersion`, and `memory:rollback` need invalid-payload tests.

### Workflow Validation Hardening

- `memory:update` must revalidate workflow content before persistence.
- Update paths must reject empty topic, empty steps, missing step intent, missing target hint, missing risk level, invalid platform, and malformed inputs.
- Update paths must regenerate `searchText` when topic, summary, trigger examples, app name, or step intents change.
- New workflow creation must force version `1`; import/version preservation requires a separate explicit design.

### Version Storage Hardening

- `workflow_memory_versions` should enforce uniqueness for `(memory_id, version)`.
- Version tests must cover missing version rollback, missing memory update, duplicate id behavior, deep snapshot preservation, and multi-workflow isolation.

### Chinese Text And Sensitive Data

- CJK tokenization must use a reliable Unicode-aware Han matcher rather than corrupted source text.
- Sensitive-term detection must include real UTF-8 Chinese samples such as `密码`, `验证码`, `银行卡`, `支付`, and `身份证`.
- Existing mojibake in tests or regex literals must not be used as evidence that Chinese handling works.

### Renderer Completeness

- The workflow editor must expose structured editing for `inputs`, `inputHint`, `expectedState`, `fallback`, workflow-level `riskLevel`, and `platform`.
- Save actions must display validation errors and warnings before persistence.
- High-risk and forbidden-risk workflows must show explicit warnings before save.
- Rollback must require confirmation and provide a readable version snapshot preview.
- Generate/save/update/rollback actions must have loading or disabled states to avoid duplicate writes.
- Renderer and preload should use explicit DTO/result types instead of broad `any` for workflow memory operations.

### Testing And Smoke

- Add IPC tests for invalid payloads, missing memory store, missing workflow, missing version, provider errors, and validation failures.
- Add an Electron workflow-page smoke test that opens the workflow page, generates a draft, edits a workflow, saves, lists versions, and rolls back.
- Continue treating recorder frame assertions as real-desktop-dependent; recorder success for this phase still requires an interactive PoC or manual smoke in a valid desktop session.

Deferred items:

- Full LLM-based workflow understanding beyond the provider interface.
- Recording/video-to-workflow parsing.
- Cloud sync and vector retrieval.

## Testing Strategy

Core tests:

- Text teaching builds a valid draft from a deterministic fake LLM response.
- Invalid model output returns validation errors.
- Draft normalization generates ids, trigger examples, search text, and timestamps correctly.
- Saving a text-taught draft creates memory version 1.
- Editing increments the version and records a snapshot.
- Rollback creates a new version and restores old workflow content.
- Search can hit a text-taught workflow through trigger examples and search text.

Desktop tests:

- IPC rejects invalid draft payloads.
- IPC can teach, save, update, list versions, and rollback using a fake text teaching service where practical.
- Renderer can open the workflow memory area, generate a draft, edit a step, save, and view versions in a smoke test.

Manual smoke:

- Teach a simple Notepad workflow from text.
- Edit one step and save.
- Confirm version 2 exists.
- Roll back to version 1.
- Run a task whose goal matches the trigger example and verify the agent selects the workflow memory.

## Acceptance Criteria

- A user can create a workflow from text teaching without writing YAML or JSON.
- A user can modify workflow steps in the desktop app without code changes.
- A saved workflow is retrievable before task execution through local keyword search.
- The same workflow can be reused through the existing workflow execution path.
- Workflow edits create version history.
- Rollback restores prior workflow content by creating a new version.
- Invalid IPC payloads and invalid workflow updates return stable user-visible errors instead of rejected invokes.
- Chinese sensitive terms and Chinese retrieval examples are covered by real UTF-8 tests.
- Workflow rollback requires user confirmation and exposes the target snapshot before rollback.
- Cloud sync and vector retrieval are absent from the Phase 2 implementation.

## Implementation Order

1. Add core draft types, validator, and deterministic tests.
2. Add TextTeachingService with injectable LLM provider and tests.
3. Add MemoryStore versioning methods and schema migration tests.
4. Add save/update/rollback service methods.
5. Add desktop IPC.
6. Add renderer workflow memory UI.
7. Add integration and smoke verification.
8. Apply review hardening: IPC contracts, update validation, CJK/sensitive terms, version constraints, editor completeness, and workflow-page smoke tests.
