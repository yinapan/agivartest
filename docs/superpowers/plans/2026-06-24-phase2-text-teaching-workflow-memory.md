# Phase 2 Text Teaching Workflow Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build local text teaching, editable workflow memory, keyword reuse, and version rollback while excluding cloud sync and vector retrieval.

**Architecture:** Core owns draft parsing, validation, persistence, versioning, and local search. Desktop main exposes those capabilities through IPC, and the renderer adds a compact workflow memory page for teaching, editing, saving, and rollback. Generated workflows never execute automatically; they enter the existing AgentService path only after user save and normal memory matching.

**Tech Stack:** TypeScript, Vitest, zod, better-sqlite3, Electron IPC, React, Tailwind CSS, existing `@agivar/core` and `@agivar/desktop` packages.

---

## File Structure

- Modify: `packages/core/src/types/workflow.ts`
  - Add `WorkflowDraft`, `WorkflowDraftInput`, `WorkflowDraftStep`, validation result, version snapshot, and text teaching request/result types.
- Create: `packages/core/src/memory/workflow-draft.ts`
  - Normalize and validate workflow drafts. Convert accepted drafts into `WorkflowMemory`.
- Create: `packages/core/tests/workflow-draft.test.ts`
  - TDD coverage for normalization, validation, search text, risk warnings, and memory conversion.
- Create: `packages/core/src/memory/text-teaching-service.ts`
  - Convert teaching text into draft data through an injectable provider and validate it.
- Create: `packages/core/tests/text-teaching-service.test.ts`
  - TDD coverage for successful draft generation, invalid provider output, and sensitive wording warnings.
- Modify: `packages/core/src/memory/schema.ts`
  - Add migration 3 for `workflow_memory_versions`.
- Modify: `packages/core/src/memory/memory-store.ts`
  - Add update, save draft, list versions, get version, rollback, and explicit version cleanup.
- Modify: `packages/core/tests/memory-store.test.ts`
  - TDD coverage for version 1 creation, edit version increment, rollback, delete cleanup, and search reuse.
- Modify: `packages/core/src/index.ts`
  - Export workflow draft and text teaching services/types.
- Modify: `packages/desktop/src/main/ipc.ts`
  - Add `memory:teachText`, `memory:validateDraft`, `memory:saveDraft`, `memory:update`, `memory:listVersions`, `memory:getVersion`, and `memory:rollback`.
- Modify: `packages/desktop/src/preload.ts`
  - Expose the new memory APIs.
- Modify: `packages/desktop/src/renderer/App.tsx`
  - Add workflow memory page navigation.
- Create: `packages/desktop/src/renderer/pages/WorkflowsPage.tsx`
  - Teach/edit/list/version UI.
- Modify: `packages/desktop/src/renderer/main.css`
  - Only if small layout utilities are needed beyond Tailwind classes.

---

## Task 1: Workflow Draft Types And Validator

**Files:**
- Modify: `packages/core/src/types/workflow.ts`
- Create: `packages/core/src/memory/workflow-draft.ts`
- Create: `packages/core/tests/workflow-draft.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for valid text-teach draft normalization**

Create `packages/core/tests/workflow-draft.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { draftToMemory, normalizeWorkflowDraft, validateWorkflowDraft } from '../src/memory/workflow-draft.js';
import type { WorkflowDraft } from '../src/types/workflow.js';

function makeDraft(overrides: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    appName: 'Notepad',
    platform: 'desktop',
    topic: 'Write a short note',
    triggerExamples: ['write a note', 'create a notepad memo'],
    summary: 'Open Notepad and write a short note.',
    initialState: 'Windows desktop is visible.',
    inputs: [{ name: 'noteText', type: 'string', required: true, prompt: 'Text to write' }],
    steps: [
      {
        intent: 'Open Notepad',
        targetHint: 'Start menu search result for Notepad',
        target: { strategy: 'human', hint: 'Notepad app' },
        riskLevel: 'low',
      },
      {
        intent: 'Type the note text',
        targetHint: 'Notepad editor',
        inputHint: '{{noteText}}',
        target: { strategy: 'human', hint: 'Notepad editor' },
        expectedState: { all: [{ type: 'window_title_contains', value: 'Notepad' }] },
        riskLevel: 'low',
      },
    ],
    successCriteria: 'The note text is visible in Notepad.',
    riskLevel: 'low',
    sourceType: 'text-teach',
    ...overrides,
  };
}

describe('workflow draft validation', () => {
  it('normalizes a valid text teaching draft with stable ids and search text', () => {
    const result = normalizeWorkflowDraft(makeDraft(), {
      id: 'mem-1',
      now: '2026-06-24T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(result.data!.id).toBe('mem-1');
    expect(result.data!.version).toBe(1);
    expect(result.data!.sourceType).toBe('text-teach');
    expect(result.data!.steps.map((s) => s.id)).toEqual(['step-1', 'step-2']);
    expect(result.data!.steps.map((s) => s.order)).toEqual([1, 2]);
    expect(result.data!.searchText).toContain('Notepad');
    expect(result.data!.searchText).toContain('write a note');
    expect(result.data!.embeddingStatus).toBe('not_indexed');
  });

  it('converts a valid draft to WorkflowMemory', () => {
    const memory = draftToMemory(makeDraft(), {
      id: 'mem-2',
      now: '2026-06-24T01:00:00.000Z',
    });

    expect(memory.id).toBe('mem-2');
    expect(memory.createdAt).toBe('2026-06-24T01:00:00.000Z');
    expect(memory.updatedAt).toBe('2026-06-24T01:00:00.000Z');
    expect(memory.triggerExamples).toEqual(['write a note', 'create a notepad memo']);
  });

  it('rejects empty topic and missing steps', () => {
    const result = validateWorkflowDraft(makeDraft({ topic: ' ', steps: [] }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('topic is required');
    expect(result.errors).toContain('at least one step is required');
  });

  it('warns about weak expected states and coordinate-only target hints', () => {
    const result = validateWorkflowDraft(makeDraft({
      steps: [{
        intent: 'Click save',
        targetHint: 'x=10 y=20',
        target: { strategy: 'coordinate', point: { x: 10, y: 20, space: 'screen-logical' } },
        riskLevel: 'medium',
      }],
    }));

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('step 1 has no expected state');
    expect(result.warnings).toContain('step 1 appears to rely on coordinates');
  });
});
```

- [ ] **Step 2: Run draft tests and verify RED**

Run:

```powershell
pnpm test -- packages/core/tests/workflow-draft.test.ts
```

Expected: FAIL because `workflow-draft.ts` and new types are missing.

- [ ] **Step 3: Add draft types**

Modify `packages/core/src/types/workflow.ts` by appending:

```ts
export type WorkflowDraftInput = WorkflowInput;

export type WorkflowDraftStep = Omit<WorkflowStep, 'id' | 'order'> & {
  id?: string;
  order?: number;
};

export interface WorkflowDraft {
  appName: string;
  platform?: 'desktop' | 'browser' | 'hybrid';
  topic: string;
  triggerExamples?: string[];
  summary: string;
  initialState: string;
  inputs?: WorkflowDraftInput[];
  steps: WorkflowDraftStep[];
  successCriteria?: string;
  riskLevel: RiskLevel;
  sourceType?: 'manual' | 'text-teach' | 'recording';
}

export interface WorkflowValidationResult<T = WorkflowDraft> {
  ok: boolean;
  data?: T;
  errors: string[];
  warnings: string[];
}

export interface WorkflowMemoryVersion {
  id: string;
  memoryId: string;
  version: number;
  snapshot: WorkflowMemory;
  changeNote?: string;
  source: 'create' | 'edit' | 'rollback' | 'import' | 'text-teach';
  createdAt: string;
}

export interface TextTeachingRequest {
  goal: string;
  teachingText: string;
  appName?: string;
  platform?: 'desktop' | 'browser' | 'hybrid';
}

export interface TextTeachingResult {
  draft: WorkflowDraft;
  warnings: string[];
  rawResponse?: unknown;
}
```

- [ ] **Step 4: Implement validator and conversion**

Create `packages/core/src/memory/workflow-draft.ts`:

```ts
import { nanoid } from 'nanoid';
import type { WorkflowDraft, WorkflowMemory, WorkflowValidationResult } from '../types/workflow.js';

export interface NormalizeOptions {
  id?: string;
  now?: string;
}

const VALID_PLATFORMS = new Set(['desktop', 'browser', 'hybrid']);
const COORDINATE_RE = /\b(x|left)\s*=\s*\d+|\b(y|top)\s*=\s*\d+|\b\d+\s*,\s*\d+\b/i;

export function validateWorkflowDraft(draft: WorkflowDraft): WorkflowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!draft.topic?.trim()) errors.push('topic is required');
  if (!draft.appName?.trim()) errors.push('appName is required');
  if (!draft.summary?.trim()) errors.push('summary is required');
  if (!draft.initialState?.trim()) errors.push('initialState is required');
  if (!draft.riskLevel) errors.push('riskLevel is required');
  if (draft.platform && !VALID_PLATFORMS.has(draft.platform)) errors.push('platform is invalid');
  if (!Array.isArray(draft.steps) || draft.steps.length === 0) errors.push('at least one step is required');

  draft.steps?.forEach((step, index) => {
    const n = index + 1;
    if (!step.intent?.trim()) errors.push(`step ${n} intent is required`);
    if (!step.targetHint?.trim()) errors.push(`step ${n} targetHint is required`);
    if (!step.riskLevel) errors.push(`step ${n} riskLevel is required`);
    if (!step.expectedState) warnings.push(`step ${n} has no expected state`);
    if (COORDINATE_RE.test(step.targetHint) || step.target?.strategy === 'coordinate') {
      warnings.push(`step ${n} appears to rely on coordinates`);
    }
  });

  draft.inputs?.forEach((input, index) => {
    const n = index + 1;
    if (!input.name?.trim()) errors.push(`input ${n} name is required`);
    if (input.type !== 'string' && input.type !== 'number') errors.push(`input ${n} type is invalid`);
    if (!input.prompt?.trim()) errors.push(`input ${n} prompt is required`);
  });

  if (!draft.successCriteria?.trim()) warnings.push('successCriteria is missing');

  return { ok: errors.length === 0, data: draft, errors, warnings };
}

export function normalizeWorkflowDraft(
  draft: WorkflowDraft,
  options: NormalizeOptions = {},
): WorkflowValidationResult<WorkflowMemory> {
  const validation = validateWorkflowDraft(draft);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }

  const now = options.now ?? new Date().toISOString();
  const triggerExamples = normalizeStringList(
    draft.triggerExamples?.length ? draft.triggerExamples : [draft.topic],
  );
  const steps = draft.steps.map((step, index) => ({
    ...step,
    id: step.id || `step-${index + 1}`,
    order: step.order ?? index + 1,
    target: step.target ?? { strategy: 'human' as const, hint: step.targetHint },
  }));

  const memory: WorkflowMemory = {
    id: options.id ?? nanoid(),
    appName: draft.appName.trim(),
    platform: draft.platform ?? 'desktop',
    topic: draft.topic.trim(),
    triggerExamples,
    summary: draft.summary.trim(),
    initialState: draft.initialState.trim(),
    inputs: draft.inputs,
    steps,
    successCriteria: draft.successCriteria?.trim() ?? '',
    riskLevel: draft.riskLevel,
    sourceType: draft.sourceType ?? 'text-teach',
    version: 1,
    searchText: buildSearchText(draft, triggerExamples),
    embeddingStatus: 'not_indexed',
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, data: memory, errors: [], warnings: validation.warnings };
}

export function draftToMemory(draft: WorkflowDraft, options: NormalizeOptions = {}): WorkflowMemory {
  const result = normalizeWorkflowDraft(draft, options);
  if (!result.ok || !result.data) {
    throw new Error(result.errors.join('; '));
  }
  return result.data;
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function buildSearchText(draft: WorkflowDraft, triggerExamples: string[]): string {
  return normalizeStringList([
    draft.appName,
    draft.topic,
    draft.summary,
    ...triggerExamples,
    ...(draft.steps ?? []).map((step) => step.intent),
  ]).join(' ');
}
```

- [ ] **Step 5: Export workflow draft helpers**

Modify `packages/core/src/index.ts`:

```ts
export {
  validateWorkflowDraft,
  normalizeWorkflowDraft,
  draftToMemory,
} from './memory/workflow-draft.js';
```

- [ ] **Step 6: Run draft tests and verify GREEN**

Run:

```powershell
pnpm test -- packages/core/tests/workflow-draft.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```powershell
git add packages/core/src/types/workflow.ts packages/core/src/memory/workflow-draft.ts packages/core/tests/workflow-draft.test.ts packages/core/src/index.ts
git commit -m "feat(core): add workflow draft validation"
```

---

## Task 2: TextTeachingService

**Files:**
- Create: `packages/core/src/memory/text-teaching-service.ts`
- Create: `packages/core/tests/text-teaching-service.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for text teaching service**

Create `packages/core/tests/text-teaching-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TextTeachingService, type TextTeachingProvider } from '../src/memory/text-teaching-service.js';
import type { WorkflowDraft } from '../src/types/workflow.js';

const validDraft: WorkflowDraft = {
  appName: 'Notepad',
  topic: 'Write note',
  summary: 'Open Notepad and write text.',
  initialState: 'Desktop is visible.',
  triggerExamples: ['write note'],
  steps: [{
    intent: 'Open Notepad',
    targetHint: 'Notepad app',
    target: { strategy: 'human', hint: 'Notepad app' },
    expectedState: { type: 'window_title_contains', value: 'Notepad' },
    riskLevel: 'low',
  }],
  successCriteria: 'Notepad is open.',
  riskLevel: 'low',
};

describe('TextTeachingService', () => {
  it('builds a validated text-teach draft from provider output', async () => {
    const provider: TextTeachingProvider = {
      generateWorkflowDraft: async (request) => ({
        ...validDraft,
        appName: request.appName ?? validDraft.appName,
      }),
    };

    const result = await new TextTeachingService(provider).teach({
      goal: 'write a note',
      teachingText: 'Open Notepad, then type the note.',
      appName: 'Notepad',
    });

    expect(result.ok).toBe(true);
    expect(result.data!.draft.sourceType).toBe('text-teach');
    expect(result.data!.draft.appName).toBe('Notepad');
    expect(result.data!.warnings).toEqual([]);
  });

  it('returns validation errors for invalid provider output', async () => {
    const provider: TextTeachingProvider = {
      generateWorkflowDraft: async () => ({ ...validDraft, topic: '', steps: [] }),
    };

    const result = await new TextTeachingService(provider).teach({
      goal: 'write a note',
      teachingText: 'Open Notepad.',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('topic is required');
    expect(result.errors).toContain('at least one step is required');
  });

  it('warns when teaching text mentions secrets', async () => {
    const provider: TextTeachingProvider = {
      generateWorkflowDraft: async () => validDraft,
    };

    const result = await new TextTeachingService(provider).teach({
      goal: 'login',
      teachingText: 'Type the password and 2FA code.',
    });

    expect(result.ok).toBe(true);
    expect(result.data!.warnings).toContain('teaching text may contain sensitive instructions');
  });
});
```

- [ ] **Step 2: Run service tests and verify RED**

```powershell
pnpm test -- packages/core/tests/text-teaching-service.test.ts
```

Expected: FAIL because `text-teaching-service.ts` is missing.

- [ ] **Step 3: Implement TextTeachingService**

Create `packages/core/src/memory/text-teaching-service.ts`:

```ts
import type {
  TextTeachingRequest,
  TextTeachingResult,
  WorkflowDraft,
  WorkflowValidationResult,
} from '../types/workflow.js';
import { validateWorkflowDraft } from './workflow-draft.js';

export interface TextTeachingProvider {
  generateWorkflowDraft(request: TextTeachingRequest): Promise<WorkflowDraft>;
}

const SENSITIVE_RE = /\b(password|passcode|token|2fa|otp|verification code|payment|bank card|identity card|身份证|验证码|银行卡|支付|密码)\b/i;

export class TextTeachingService {
  constructor(private provider: TextTeachingProvider) {}

  async teach(request: TextTeachingRequest): Promise<WorkflowValidationResult<TextTeachingResult>> {
    const draft = await this.provider.generateWorkflowDraft(request);
    const normalizedDraft: WorkflowDraft = {
      ...draft,
      appName: draft.appName || request.appName || '',
      platform: draft.platform || request.platform || 'desktop',
      sourceType: 'text-teach',
    };

    const validation = validateWorkflowDraft(normalizedDraft);
    const warnings = [...validation.warnings];
    if (SENSITIVE_RE.test(request.teachingText)) {
      warnings.push('teaching text may contain sensitive instructions');
    }

    if (!validation.ok) {
      return { ok: false, errors: validation.errors, warnings };
    }

    return {
      ok: true,
      data: { draft: normalizedDraft, warnings },
      errors: [],
      warnings,
    };
  }
}
```

- [ ] **Step 4: Export service**

Modify `packages/core/src/index.ts`:

```ts
export { TextTeachingService } from './memory/text-teaching-service.js';
export type { TextTeachingProvider } from './memory/text-teaching-service.js';
```

- [ ] **Step 5: Run service tests and verify GREEN**

```powershell
pnpm test -- packages/core/tests/text-teaching-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add packages/core/src/memory/text-teaching-service.ts packages/core/tests/text-teaching-service.test.ts packages/core/src/index.ts
git commit -m "feat(core): add text teaching service"
```

---

## Task 3: Workflow Version Storage

**Files:**
- Modify: `packages/core/src/memory/schema.ts`
- Modify: `packages/core/src/memory/memory-store.ts`
- Modify: `packages/core/tests/memory-store.test.ts`

- [ ] **Step 1: Add failing versioning tests**

Append to `packages/core/tests/memory-store.test.ts`:

```ts
describe('workflow versions', () => {
  it('saveWithVersion creates memory and version 1 snapshot', () => {
    const mem = makeMemory({ id: 'versioned-1', sourceType: 'text-teach' });

    store.saveWithVersion(mem, { source: 'text-teach', changeNote: 'initial teach' });

    const versions = store.listVersions(mem.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].source).toBe('text-teach');
    expect(versions[0].changeNote).toBe('initial teach');
    expect(versions[0].snapshot.topic).toBe(mem.topic);
  });

  it('updateWithVersion increments memory version and records a snapshot', () => {
    const mem = makeMemory({ id: 'versioned-2' });
    store.saveWithVersion(mem, { source: 'create' });

    const updated = { ...mem, topic: 'updated topic', summary: 'updated summary' };
    store.updateWithVersion(updated, { source: 'edit', changeNote: 'rename' });

    const fetched = store.getById(mem.id)!;
    expect(fetched.version).toBe(2);
    expect(fetched.topic).toBe('updated topic');

    const versions = store.listVersions(mem.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0].snapshot.topic).toBe('updated topic');
  });

  it('rollback creates a new version from an old snapshot', () => {
    const mem = makeMemory({ id: 'versioned-3', topic: 'original' });
    store.saveWithVersion(mem, { source: 'create' });
    store.updateWithVersion({ ...mem, topic: 'changed' }, { source: 'edit' });

    const rolledBack = store.rollback(mem.id, 1, 'restore original');

    expect(rolledBack.version).toBe(3);
    expect(rolledBack.topic).toBe('original');
    expect(store.getById(mem.id)!.topic).toBe('original');
    expect(store.listVersions(mem.id)[0].source).toBe('rollback');
  });

  it('delete removes workflow versions', () => {
    const mem = makeMemory({ id: 'versioned-4' });
    store.saveWithVersion(mem, { source: 'create' });

    expect(store.delete(mem.id)).toBe(true);

    expect(store.listVersions(mem.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run version tests and verify RED**

```powershell
pnpm test -- packages/core/tests/memory-store.test.ts
```

Expected: FAIL because version methods and table are missing.

- [ ] **Step 3: Add schema migration**

Modify `packages/core/src/memory/schema.ts` by appending migration 3 to `MIGRATIONS`:

```ts
{
  version: 3,
  name: 'add_workflow_memory_versions',
  up: `
    CREATE TABLE IF NOT EXISTS workflow_memory_versions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL REFERENCES workflow_memories(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      change_note TEXT,
      source TEXT NOT NULL CHECK (source IN ('create', 'edit', 'rollback', 'import', 'text-teach')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_memory_versions_memory_version
      ON workflow_memory_versions(memory_id, version DESC);
  `,
}
```

- [ ] **Step 4: Implement store methods**

Modify `packages/core/src/memory/memory-store.ts`:

```ts
import { nanoid } from 'nanoid';
import type { WorkflowMemory, WorkflowMemoryVersion } from '../types/workflow.js';
```

Add methods inside `MemoryStore`:

```ts
saveWithVersion(
  memory: WorkflowMemory,
  meta: { source: WorkflowMemoryVersion['source']; changeNote?: string },
): void {
  const now = memory.createdAt || new Date().toISOString();
  const normalized = { ...memory, version: memory.version || 1, createdAt: now, updatedAt: memory.updatedAt || now };
  const tx = this.db.transaction(() => {
    this.insert(normalized);
    this.insertVersion(normalized, meta.source, meta.changeNote, normalized.updatedAt);
  });
  tx();
}

updateWithVersion(
  memory: WorkflowMemory,
  meta: { source: WorkflowMemoryVersion['source']; changeNote?: string },
): WorkflowMemory {
  const current = this.getById(memory.id);
  if (!current) throw new Error(`Workflow memory not found: ${memory.id}`);
  const now = new Date().toISOString();
  const updated = { ...memory, version: current.version + 1, createdAt: current.createdAt, updatedAt: now };
  const tx = this.db.transaction(() => {
    this.updateRow(updated);
    this.insertVersion(updated, meta.source, meta.changeNote, now);
  });
  tx();
  return updated;
}

listVersions(memoryId: string): WorkflowMemoryVersion[] {
  const rows = this.db
    .prepare('SELECT * FROM workflow_memory_versions WHERE memory_id = ? ORDER BY version DESC')
    .all(memoryId) as Record<string, unknown>[];
  return rows.map((row) => this.rowToVersion(row));
}

getVersion(memoryId: string, version: number): WorkflowMemoryVersion | null {
  const row = this.db
    .prepare('SELECT * FROM workflow_memory_versions WHERE memory_id = ? AND version = ?')
    .get(memoryId, version) as Record<string, unknown> | undefined;
  return row ? this.rowToVersion(row) : null;
}

rollback(memoryId: string, version: number, changeNote?: string): WorkflowMemory {
  const target = this.getVersion(memoryId, version);
  const current = this.getById(memoryId);
  if (!target || !current) throw new Error(`Workflow memory version not found: ${memoryId}@${version}`);
  const now = new Date().toISOString();
  const restored = {
    ...target.snapshot,
    id: memoryId,
    version: current.version + 1,
    createdAt: current.createdAt,
    updatedAt: now,
  };
  const tx = this.db.transaction(() => {
    this.updateRow(restored);
    this.insertVersion(restored, 'rollback', changeNote, now);
  });
  tx();
  return restored;
}
```

Add private helpers:

```ts
private updateRow(memory: WorkflowMemory): void {
  this.db.prepare(`
    UPDATE workflow_memories SET
      app_name = ?,
      platform = ?,
      topic = ?,
      trigger_examples = ?,
      summary = ?,
      initial_state = ?,
      inputs = ?,
      steps = ?,
      success_criteria = ?,
      risk_level = ?,
      source_type = ?,
      version = ?,
      search_text = ?,
      embedding_status = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    memory.appName,
    memory.platform,
    memory.topic,
    JSON.stringify(memory.triggerExamples),
    memory.summary,
    memory.initialState,
    memory.inputs ? JSON.stringify(memory.inputs) : null,
    JSON.stringify(memory.steps),
    memory.successCriteria,
    memory.riskLevel,
    memory.sourceType,
    memory.version,
    memory.searchText,
    memory.embeddingStatus,
    memory.updatedAt,
    memory.id,
  );
}

private insertVersion(
  memory: WorkflowMemory,
  source: WorkflowMemoryVersion['source'],
  changeNote: string | undefined,
  createdAt: string,
): void {
  this.db.prepare(`
    INSERT INTO workflow_memory_versions (
      id, memory_id, version, snapshot_json, change_note, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    nanoid(),
    memory.id,
    memory.version,
    JSON.stringify(memory),
    changeNote ?? null,
    source,
    createdAt,
  );
}

private rowToVersion(row: Record<string, unknown>): WorkflowMemoryVersion {
  return {
    id: row.id as string,
    memoryId: row.memory_id as string,
    version: row.version as number,
    snapshot: JSON.parse(row.snapshot_json as string) as WorkflowMemory,
    changeNote: (row.change_note as string | null) ?? undefined,
    source: row.source as WorkflowMemoryVersion['source'],
    createdAt: row.created_at as string,
  };
}
```

Modify `delete` to remove versions before deleting the memory:

```ts
delete(id: string): boolean {
  const tx = this.db.transaction(() => {
    this.db.prepare('DELETE FROM workflow_memory_versions WHERE memory_id = ?').run(id);
    return this.db.prepare('DELETE FROM workflow_memories WHERE id = ?').run(id);
  });
  const result = tx();
  return result.changes > 0;
}
```

- [ ] **Step 5: Run version tests and verify GREEN**

```powershell
pnpm test -- packages/core/tests/memory-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add packages/core/src/memory/schema.ts packages/core/src/memory/memory-store.ts packages/core/tests/memory-store.test.ts
git commit -m "feat(core): add workflow memory versioning"
```

---

## Task 4: Memory Draft Save And Local Retrieval

**Files:**
- Modify: `packages/core/tests/memory-store.test.ts`
- Modify: `packages/core/src/memory/memory-store.ts`

- [ ] **Step 1: Add failing tests for saving drafts and retrieval**

Append to `packages/core/tests/memory-store.test.ts`:

```ts
describe('text-taught workflow reuse', () => {
  it('saved text-taught workflows are searchable by trigger examples', () => {
    const mem = makeMemory({
      id: 'text-teach-search',
      sourceType: 'text-teach',
      triggerExamples: ['write a quick notepad memo'],
      topic: 'Notepad memo',
      searchText: 'Notepad memo write quick note',
    });

    store.saveWithVersion(mem, { source: 'text-teach' });

    const results = store.search('please write a quick notepad memo');
    expect(results[0].memory.id).toBe(mem.id);
    expect(results[0].matchedFields).toContain('triggerExamples');
  });

  it('updateWithVersion preserves createdAt and regenerates updatedAt only', () => {
    const mem = makeMemory({ id: 'text-teach-update', createdAt: '2026-01-01T00:00:00.000Z' });
    store.saveWithVersion(mem, { source: 'create' });

    const updated = store.updateWithVersion({ ...mem, summary: 'new summary' }, { source: 'edit' });

    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.updatedAt).not.toBe(mem.updatedAt);
  });
});
```

- [ ] **Step 2: Run retrieval tests and verify RED or current behavior**

```powershell
pnpm test -- packages/core/tests/memory-store.test.ts
```

Expected: PASS if Task 3 already covers behavior, or FAIL if search/update behavior needs correction. If PASS immediately, document that existing keyword search already satisfies this part and keep the tests.

- [ ] **Step 3: Fix only if test fails**

If search fails, adjust `MemoryStore.FIELD_WEIGHTS` or `getFieldText` so `triggerExamples` and `searchText` participate. Do not add embeddings or new services.

- [ ] **Step 4: Run full core memory tests**

```powershell
pnpm test -- packages/core/tests/memory-store.test.ts packages/core/tests/workflow-draft.test.ts packages/core/tests/text-teaching-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add packages/core/tests/memory-store.test.ts packages/core/src/memory/memory-store.ts
git commit -m "test(core): cover text taught workflow reuse"
```

---

## Task 5: Desktop IPC And Preload APIs

**Files:**
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/preload.ts`

- [ ] **Step 1: Add IPC handlers with minimal provider**

Modify imports in `packages/desktop/src/main/ipc.ts`:

```ts
import {
  screenshot,
  uia,
  input,
  browser,
  recorder,
  dpi,
  parseWorkflowContent,
  workflowFileToMemory,
  validateWorkflowDraft,
  draftToMemory,
  TextTeachingService,
  type WorkflowDraft,
  type TextTeachingProvider,
  type ToolResult,
  type AgentService,
  type MemoryStore,
} from '@agivar/core';
```

Add local provider and helper near module state:

```ts
const fallbackTeachingProvider: TextTeachingProvider = {
  async generateWorkflowDraft(request) {
    const topic = request.goal.trim() || 'Untitled workflow';
    const appName = request.appName?.trim() || 'Desktop';
    return {
      appName,
      platform: request.platform ?? 'desktop',
      topic,
      triggerExamples: [topic],
      summary: request.teachingText.trim().slice(0, 240) || topic,
      initialState: `${appName} is ready.`,
      steps: request.teachingText
        .split(/[\r\n。.;]+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 12)
        .map((line) => ({
          intent: line,
          targetHint: line,
          target: { strategy: 'human' as const, hint: line },
          riskLevel: 'low' as const,
        })),
      successCriteria: `${topic} is complete.`,
      riskLevel: 'low',
      sourceType: 'text-teach',
    };
  },
};

const textTeachingService = new TextTeachingService(fallbackTeachingProvider);
```

Add IPC handlers after existing memory import handler:

```ts
ipcMain.handle('memory:teachText', async (_event, request) => {
  return textTeachingService.teach(request);
});

ipcMain.handle('memory:validateDraft', async (_event, draft: WorkflowDraft) => {
  return validateWorkflowDraft(draft);
});

ipcMain.handle('memory:saveDraft', async (_event, draft: WorkflowDraft, changeNote?: string) => {
  if (!memoryStore) return { ok: false, error: { code: 'NO_MEMORY_STORE', message: 'MemoryStore not initialized' } };
  const memory = draftToMemory(draft);
  memoryStore.saveWithVersion(memory, { source: 'text-teach', changeNote });
  return { ok: true, data: memory };
});

ipcMain.handle('memory:update', async (_event, memory, changeNote?: string) => {
  if (!memoryStore) return { ok: false, error: { code: 'NO_MEMORY_STORE', message: 'MemoryStore not initialized' } };
  const updated = memoryStore.updateWithVersion(memory, { source: 'edit', changeNote });
  return { ok: true, data: updated };
});

ipcMain.handle('memory:listVersions', async (_event, memoryId: string) => {
  if (!memoryStore) return [];
  return memoryStore.listVersions(memoryId);
});

ipcMain.handle('memory:getVersion', async (_event, memoryId: string, version: number) => {
  if (!memoryStore) return null;
  return memoryStore.getVersion(memoryId, version);
});

ipcMain.handle('memory:rollback', async (_event, memoryId: string, version: number, changeNote?: string) => {
  if (!memoryStore) return { ok: false, error: { code: 'NO_MEMORY_STORE', message: 'MemoryStore not initialized' } };
  const restored = memoryStore.rollback(memoryId, version, changeNote);
  return { ok: true, data: restored };
});
```

- [ ] **Step 2: Expose preload APIs**

Modify `packages/desktop/src/preload.ts` memory section:

```ts
memory: {
  import: (filePath: string) => ipcRenderer.invoke('memory:import', filePath),
  list: (filter?: { appName?: string; topic?: string }) =>
    ipcRenderer.invoke('memory:list', filter),
  get: (id: string) => ipcRenderer.invoke('memory:get', id),
  delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
  teachText: (request: any) => ipcRenderer.invoke('memory:teachText', request),
  validateDraft: (draft: any) => ipcRenderer.invoke('memory:validateDraft', draft),
  saveDraft: (draft: any, changeNote?: string) =>
    ipcRenderer.invoke('memory:saveDraft', draft, changeNote),
  update: (memory: any, changeNote?: string) =>
    ipcRenderer.invoke('memory:update', memory, changeNote),
  listVersions: (memoryId: string) => ipcRenderer.invoke('memory:listVersions', memoryId),
  getVersion: (memoryId: string, version: number) =>
    ipcRenderer.invoke('memory:getVersion', memoryId, version),
  rollback: (memoryId: string, version: number, changeNote?: string) =>
    ipcRenderer.invoke('memory:rollback', memoryId, version, changeNote),
},
```

- [ ] **Step 3: Build desktop and core**

```powershell
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit Task 5**

```powershell
git add packages/desktop/src/main/ipc.ts packages/desktop/src/preload.ts
git commit -m "feat(desktop): expose workflow memory ipc"
```

---

## Task 6: Workflow Memory Renderer Page

**Files:**
- Modify: `packages/desktop/src/renderer/App.tsx`
- Create: `packages/desktop/src/renderer/pages/WorkflowsPage.tsx`

- [ ] **Step 1: Add WorkflowsPage**

Create `packages/desktop/src/renderer/pages/WorkflowsPage.tsx`:

```tsx
import React, { useEffect, useState } from 'react';

type DraftStep = {
  id?: string;
  order?: number;
  intent: string;
  targetHint: string;
  inputHint?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'forbidden';
  target?: any;
};

type WorkflowDraft = {
  appName: string;
  platform?: 'desktop' | 'browser' | 'hybrid';
  topic: string;
  triggerExamples?: string[];
  summary: string;
  initialState: string;
  steps: DraftStep[];
  successCriteria?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'forbidden';
  sourceType?: 'text-teach';
};

const emptyDraft: WorkflowDraft = {
  appName: 'Desktop',
  platform: 'desktop',
  topic: '',
  triggerExamples: [],
  summary: '',
  initialState: '',
  steps: [],
  successCriteria: '',
  riskLevel: 'low',
  sourceType: 'text-teach',
};

export function WorkflowsPage() {
  const [memories, setMemories] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>(emptyDraft);
  const [goal, setGoal] = useState('');
  const [teachingText, setTeachingText] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [versions, setVersions] = useState<any[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void reload();
  }, []);

  async function reload() {
    const list = await window.agivar.memory.list();
    setMemories(Array.isArray(list) ? list : []);
  }

  async function teach() {
    setMessage('');
    const result = await window.agivar.memory.teachText({
      goal,
      teachingText,
      appName: draft.appName,
      platform: draft.platform,
    });
    if (!result.ok) {
      setMessage(result.errors?.join('; ') || result.error?.message || 'Failed to generate draft');
      return;
    }
    setDraft(result.data.draft);
    setMessage(result.data.warnings?.join('; ') || 'Draft generated');
  }

  async function saveDraft() {
    const result = await window.agivar.memory.saveDraft(draft, changeNote || 'text teaching');
    if (!result.ok) {
      setMessage(result.error?.message || result.errors?.join('; ') || 'Failed to save workflow');
      return;
    }
    setSelected(result.data);
    setDraft(result.data);
    setMessage('Workflow saved');
    await reload();
    await loadVersions(result.data.id);
  }

  async function updateSelected() {
    if (!selected) return;
    const result = await window.agivar.memory.update({ ...selected, ...draft }, changeNote || 'edit workflow');
    if (!result.ok) {
      setMessage(result.error?.message || 'Failed to update workflow');
      return;
    }
    setSelected(result.data);
    setDraft(result.data);
    setMessage('Workflow updated');
    await reload();
    await loadVersions(result.data.id);
  }

  async function selectMemory(memory: any) {
    setSelected(memory);
    setDraft(memory);
    await loadVersions(memory.id);
  }

  async function loadVersions(memoryId: string) {
    const list = await window.agivar.memory.listVersions(memoryId);
    setVersions(Array.isArray(list) ? list : []);
  }

  async function rollback(version: number) {
    if (!selected) return;
    const result = await window.agivar.memory.rollback(selected.id, version, `rollback to ${version}`);
    if (!result.ok) {
      setMessage(result.error?.message || 'Failed to rollback workflow');
      return;
    }
    setSelected(result.data);
    setDraft(result.data);
    setMessage(`Rolled back to version ${version}`);
    await reload();
    await loadVersions(result.data.id);
  }

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    }));
  }

  function addStep() {
    setDraft((current) => ({
      ...current,
      steps: [...current.steps, { intent: '', targetHint: '', target: { strategy: 'human', hint: '' }, riskLevel: 'low' }],
    }));
  }

  return (
    <div className="h-[calc(100vh-2rem)] grid grid-cols-[260px_1fr_280px] bg-bg-primary text-text-primary">
      <aside className="border-r border-border p-3 overflow-y-auto">
        <button onClick={() => { setSelected(null); setDraft(emptyDraft); }} className="w-full bg-accent hover:bg-accent-hover text-white text-sm py-2 px-3 rounded">
          New workflow
        </button>
        <div className="mt-3 space-y-2">
          {memories.map((memory) => (
            <button key={memory.id} onClick={() => selectMemory(memory)} className="w-full text-left border border-border rounded p-2 hover:bg-bg-secondary">
              <div className="text-sm font-medium">{memory.topic}</div>
              <div className="text-xs text-text-secondary">{memory.appName} · v{memory.version}</div>
            </button>
          ))}
        </div>
      </aside>

      <main className="p-4 overflow-y-auto space-y-4">
        <section className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={draft.appName} onChange={(e) => setDraft({ ...draft, appName: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="App name" />
            <input value={goal} onChange={(e) => setGoal(e.target.value)} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Teaching goal" />
          </div>
          <textarea value={teachingText} onChange={(e) => setTeachingText(e.target.value)} className="w-full h-24 bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Describe the workflow steps" />
          <button onClick={teach} className="bg-accent hover:bg-accent-hover text-white text-sm py-2 px-3 rounded">Generate draft</button>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <input value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Topic" />
          <input value={draft.triggerExamples?.join(', ') ?? ''} onChange={(e) => setDraft({ ...draft, triggerExamples: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Trigger examples" />
          <textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Summary" />
          <textarea value={draft.initialState} onChange={(e) => setDraft({ ...draft, initialState: e.target.value })} className="bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Initial state" />
          <textarea value={draft.successCriteria ?? ''} onChange={(e) => setDraft({ ...draft, successCriteria: e.target.value })} className="col-span-2 bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Success criteria" />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Steps</h2>
            <button onClick={addStep} className="text-xs border border-border rounded px-2 py-1">Add step</button>
          </div>
          {draft.steps.map((step, index) => (
            <div key={index} className="border border-border rounded p-2 grid grid-cols-[40px_1fr_1fr_120px] gap-2">
              <div className="text-xs text-text-secondary pt-2">#{index + 1}</div>
              <input value={step.intent} onChange={(e) => updateStep(index, { intent: e.target.value })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm" placeholder="Intent" />
              <input value={step.targetHint} onChange={(e) => updateStep(index, { targetHint: e.target.value, target: { strategy: 'human', hint: e.target.value } })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm" placeholder="Target hint" />
              <select value={step.riskLevel} onChange={(e) => updateStep(index, { riskLevel: e.target.value as DraftStep['riskLevel'] })} className="bg-bg-secondary border border-border rounded px-2 py-1 text-sm">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="forbidden">forbidden</option>
              </select>
            </div>
          ))}
        </section>

        <section className="flex items-center gap-2">
          <input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} className="flex-1 bg-bg-secondary border border-border rounded px-3 py-2 text-sm" placeholder="Change note" />
          <button onClick={selected ? updateSelected : saveDraft} className="bg-accent hover:bg-accent-hover text-white text-sm py-2 px-3 rounded">
            {selected ? 'Save edit' : 'Save draft'}
          </button>
        </section>
        {message && <div className="text-sm text-text-secondary">{message}</div>}
      </main>

      <aside className="border-l border-border p-3 overflow-y-auto">
        <h2 className="text-sm font-semibold mb-2">Versions</h2>
        <div className="space-y-2">
          {versions.map((version) => (
            <div key={version.id} className="border border-border rounded p-2">
              <div className="text-sm">v{version.version}</div>
              <div className="text-xs text-text-secondary">{version.source}</div>
              <div className="text-xs text-text-secondary">{version.changeNote}</div>
              <button onClick={() => rollback(version.version)} className="mt-2 text-xs border border-border rounded px-2 py-1">Rollback</button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Add navigation**

Modify `packages/desktop/src/renderer/App.tsx`:

```tsx
import { WorkflowsPage } from './pages/WorkflowsPage.js';

type Page = 'chat' | 'settings' | 'workflows';
```

Add keyboard shortcut:

```tsx
if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'w') {
  e.preventDefault();
  setPage((p) => (p === 'workflows' ? 'chat' : 'workflows'));
}
```

Add render branch:

```tsx
if (page === 'workflows') {
  return (
    <div>
      <div className="h-8 bg-bg-secondary border-b border-border flex items-center gap-3 px-3">
        <button onClick={() => setPage('chat')} className="text-text-secondary hover:text-text-primary text-xs">
          Back to chat
        </button>
        <button onClick={() => setPage('settings')} className="text-text-secondary hover:text-text-primary text-xs">
          Settings
        </button>
      </div>
      <WorkflowsPage />
    </div>
  );
}
```

Add a `Workflows` button to the settings top bar next to `Back to chat`, and keep `Ctrl+Shift+W` as the keyboard shortcut for smoke verification.

- [ ] **Step 3: Build desktop**

```powershell
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit Task 6**

```powershell
git add packages/desktop/src/renderer/App.tsx packages/desktop/src/renderer/pages/WorkflowsPage.tsx
git commit -m "feat(desktop): add workflow memory editor"
```

---

## Task 7: Verification And Smoke

**Files:**
- No required code files unless verification finds defects.

- [ ] **Step 1: Run focused core tests**

```powershell
pnpm test -- packages/core/tests/workflow-draft.test.ts packages/core/tests/text-teaching-service.test.ts packages/core/tests/memory-store.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

```powershell
pnpm test
```

Expected: PASS. If `better-sqlite3` ABI fails after Electron app-deps, restore Node ABI with:

```powershell
Set-Location "f:\agivar\node_modules\.pnpm\better-sqlite3@12.11.1\node_modules\better-sqlite3"
cmd.exe /d /s /c "node_modules\.bin\prebuild-install.cmd --runtime node --target 22.22.1 --verbose"
Set-Location "f:\agivar"
```

- [ ] **Step 3: Run build**

```powershell
pnpm build
```

Expected: PASS.

If a native addon build fails, run package-scoped builds such as `pnpm -F @agivar/core build` and `pnpm -F @agivar/desktop build` to isolate whether Phase 2 TypeScript exports and desktop wiring are healthy. Treat that as diagnostic only; do not mark Phase 2 verification complete until `pnpm build` passes.

- [ ] **Step 4: Electron smoke for workflow page**

If Electron native deps were rebuilt for Node, first run:

```powershell
pnpm -F @agivar/desktop exec electron-builder install-app-deps
```

Then launch Electron with `ELECTRON_RUN_AS_NODE` removed from the child environment and verify:

- Chat page opens.
- `Ctrl+Shift+W` opens workflow page.
- Enter app name, goal, and teaching text.
- Generate draft.
- Edit one step.
- Save draft.
- Version 1 appears.
- Edit and save again.
- Version 2 appears.
- Rollback to version 1 creates version 3.

- [ ] **Step 5: Restore Node ABI if Electron app-deps ran**

```powershell
Set-Location "f:\agivar\node_modules\.pnpm\better-sqlite3@12.11.1\node_modules\better-sqlite3"
cmd.exe /d /s /c "node_modules\.bin\prebuild-install.cmd --runtime node --target 22.22.1 --verbose"
Set-Location "f:\agivar"
```

- [ ] **Step 6: Final status check**

```powershell
git status --short --branch
git log --oneline -5
```

Expected: working tree clean except intentional generated output ignored by git, branch ahead includes Phase 2 commits.

---

## Review Integration Notes

The architecture and test reviews produced after the first Phase 2 slice identified several items that should be pulled back into this plan before Phase 2 is considered complete:

- IPC handlers need runtime input validation and stable error results.
- `memory:update` must validate workflow content and regenerate `searchText`.
- Chinese CJK tokenization and sensitive-term detection must use real UTF-8 samples.
- Version storage should enforce `(memory_id, version)` uniqueness and force new workflows to start at version 1.
- The workflow editor must cover inputs, input hints, expected state, fallback, workflow risk level, and platform.
- Rollback needs confirmation and snapshot preview.
- IPC and workflow-page smoke tests are missing.

The supplemental review in `docs/superpowers/reviews/2026-06-24-phase2-supplemental-review.md` adds the following triage decisions:

- Accepted: regenerate `searchText` on update from accepted fields, reject duplicate workflow ids with a stable error, add request length limits, wrap IPC exceptions, correct `TargetDescriptor` examples, and verify package export completeness.
- Adjusted before accepting: normalize fallback provider delimiter handling and add coverage, but treat the dot in `[。.;]` as a literal character-class member rather than a wildcard defect.
- Not accepted as completion criteria: skipping native addon build failures. Package-scoped builds may be used for diagnosis only; full Phase 2 acceptance still requires `pnpm build`.

The next tasks are hardening tasks generated from those reviews.

---

## Task 8: Core Validation, Chinese Handling, And Version Constraints

**Files:**
- Modify: `packages/core/src/memory/workflow-draft.ts`
- Modify: `packages/core/src/memory/text-teaching-service.ts`
- Modify: `packages/core/src/memory/memory-store.ts`
- Modify: `packages/core/src/memory/schema.ts`
- Modify: `packages/core/tests/workflow-draft.test.ts`
- Modify: `packages/core/tests/text-teaching-service.test.ts`
- Modify: `packages/core/tests/memory-store.test.ts`
- Modify: `packages/core/tests/schema.test.ts`

- [ ] **Step 1: Add failing tests for Chinese sensitive terms**

Append to `packages/core/tests/text-teaching-service.test.ts`:

```ts
it('warns for Chinese sensitive terms', async () => {
  const provider: TextTeachingProvider = {
    generateWorkflowDraft: async () => validDraft,
  };

  const result = await new TextTeachingService(provider).teach({
    goal: '登录系统',
    teachingText: '输入密码、验证码和银行卡信息。',
  });

  expect(result.ok).toBe(true);
  expect(result.data!.warnings).toContain('teaching text may contain sensitive instructions');
});
```

- [ ] **Step 2: Run text teaching test and verify RED**

```powershell
pnpm test -- packages/core/tests/text-teaching-service.test.ts
```

Expected: FAIL until the sensitive-term matcher handles real UTF-8 Chinese terms.

- [ ] **Step 3: Replace sensitive regex with UTF-8 keyword matching**

Modify `packages/core/src/memory/text-teaching-service.ts`:

```ts
const SENSITIVE_TERMS = [
  'password',
  'passcode',
  'token',
  '2fa',
  'otp',
  'verification code',
  'payment',
  'bank card',
  'identity card',
  '密码',
  '验证码',
  '银行卡',
  '支付',
  '身份证',
];

function containsSensitiveTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return SENSITIVE_TERMS.some((term) => lower.includes(term.toLowerCase()));
}
```

Replace:

```ts
if (SENSITIVE_RE.test(request.teachingText)) {
```

with:

```ts
if (containsSensitiveTerm(request.teachingText)) {
```

- [ ] **Step 4: Add failing tests for real Chinese retrieval**

Append to `packages/core/tests/memory-store.test.ts`:

```ts
it('matches real UTF-8 Chinese trigger examples', () => {
  store.insert(
    makeMemory({
      id: 'utf8-chinese-search',
      triggerExamples: ['填写客户表单'],
      topic: '客户资料录入',
      summary: '在 CRM 中填写客户资料',
      searchText: '填写 客户 表单 CRM',
    }),
  );

  const results = store.search('帮我填写客户表单');

  expect(results[0].memory.id).toBe('utf8-chinese-search');
  expect(results[0].matchedFields).toContain('triggerExamples');
});
```

- [ ] **Step 5: Run memory-store test and verify RED if current CJK regex is broken**

```powershell
pnpm test -- packages/core/tests/memory-store.test.ts
```

Expected: FAIL if the current mojibake CJK regex cannot tokenize real Chinese correctly.

- [ ] **Step 6: Replace CJK tokenizer regex**

Modify `packages/core/src/memory/memory-store.ts`:

```ts
/** Matches Han characters for Chinese/Japanese/Korean ideographs. */
const HAN_RE = /\p{Script=Han}/u;
```

Replace cleanup:

```ts
const cleaned = text.replace(/[^\w\p{Script=Han}\s]/gu, ' ');
```

Replace `CJK_RE.test(ch)` with `HAN_RE.test(ch)`.

- [ ] **Step 7: Add failing tests for update validation and regenerated searchText**

Append to `packages/core/tests/memory-store.test.ts`:

```ts
it('updateWithVersion rejects invalid workflow memory', () => {
  const mem = makeMemory({ id: 'invalid-update' });
  store.saveWithVersion(mem, { source: 'create' });

  expect(() => {
    store.updateWithVersion({ ...mem, topic: '', steps: [] }, { source: 'edit' });
  }).toThrow(/topic is required|at least one step is required/);
});

it('updateWithVersion regenerates searchText from edited content', () => {
  const mem = makeMemory({ id: 'searchtext-update', searchText: 'old words' });
  store.saveWithVersion(mem, { source: 'create' });

  const updated = store.updateWithVersion({
    ...mem,
    topic: 'Updated customer search',
    summary: 'Find a customer record',
    triggerExamples: ['find customer'],
    steps: [{ ...mem.steps[0], intent: 'Search customer by name' }],
  }, { source: 'edit' });

  expect(updated.searchText).toContain('Updated customer search');
  expect(updated.searchText).toContain('Search customer by name');
  expect(updated.searchText).not.toBe('old words');
});

it('saveWithVersion rejects duplicate workflow ids', () => {
  const mem = makeMemory({ id: 'duplicate-workflow-id' });
  store.saveWithVersion(mem, { source: 'create' });

  expect(() => store.saveWithVersion(mem, { source: 'create' })).toThrow(/already exists|duplicate/i);
});
```

- [ ] **Step 8: Implement workflow-memory validation for update**

In `packages/core/src/memory/workflow-draft.ts`, export a helper:

```ts
export function memoryToDraft(memory: WorkflowMemory): WorkflowDraft {
  return {
    appName: memory.appName,
    platform: memory.platform,
    topic: memory.topic,
    triggerExamples: memory.triggerExamples,
    summary: memory.summary,
    initialState: memory.initialState,
    inputs: memory.inputs,
    steps: memory.steps.map(({ id, order, ...step }) => step),
    successCriteria: memory.successCriteria,
    riskLevel: memory.riskLevel,
    sourceType: memory.sourceType,
  };
}

export function rebuildMemoryForUpdate(memory: WorkflowMemory, now = new Date().toISOString()): WorkflowMemory {
  const normalized = normalizeWorkflowDraft(memoryToDraft(memory), {
    id: memory.id,
    now: memory.createdAt,
  });
  if (!normalized.ok || !normalized.data) {
    throw new Error(normalized.errors.join('; '));
  }
  return {
    ...normalized.data,
    version: memory.version,
    createdAt: memory.createdAt,
    updatedAt: now,
  };
}
```

Export these helpers from `packages/core/src/index.ts`.

In `packages/core/src/memory/memory-store.ts`, call `rebuildMemoryForUpdate()` before writing an update.

Do not preserve renderer-provided `searchText` during update. `rebuildMemoryForUpdate()` must derive it from app name, topic, summary, trigger examples, and step intents every time.

- [ ] **Step 9: Add failing schema tests for version uniqueness**

Append to `packages/core/tests/schema.test.ts`:

```ts
it('creates a unique index for workflow memory versions', () => {
  db = getDatabaseForTest();
  const rows = db
    .prepare("PRAGMA index_list('workflow_memory_versions')")
    .all() as { name: string; unique: number }[];

  expect(rows.some((row) => row.name === 'idx_workflow_memory_versions_unique' && row.unique === 1)).toBe(true);
});
```

- [ ] **Step 10: Add unique index migration**

Modify migration 3 in `packages/core/src/memory/schema.ts`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_memory_versions_unique
  ON workflow_memory_versions(memory_id, version);
```

- [ ] **Step 11: Force new workflow versions to 1**

Modify `saveWithVersion()` in `packages/core/src/memory/memory-store.ts` so duplicate ids are rejected and new saves always write version `1`:

```ts
if (this.getById(memory.id)) {
  throw new Error(`workflow memory ${memory.id} already exists`);
}

const normalized = {
  ...memory,
  version: 1,
  createdAt: now,
  updatedAt: memory.updatedAt || now,
};
```

Add a regression test:

```ts
it('saveWithVersion forces initial version to 1', () => {
  const mem = makeMemory({ id: 'forced-version', version: 7 });

  store.saveWithVersion(mem, { source: 'create' });

  expect(store.getById(mem.id)!.version).toBe(1);
  expect(store.listVersions(mem.id)[0].version).toBe(1);
});
```

- [ ] **Step 12: Run core hardening tests**

```powershell
pnpm test -- packages/core/tests/text-teaching-service.test.ts packages/core/tests/memory-store.test.ts packages/core/tests/schema.test.ts packages/core/tests/workflow-draft.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit Task 8**

```powershell
git add packages/core/src/memory/workflow-draft.ts packages/core/src/memory/text-teaching-service.ts packages/core/src/memory/memory-store.ts packages/core/src/memory/schema.ts packages/core/src/index.ts packages/core/tests/workflow-draft.test.ts packages/core/tests/text-teaching-service.test.ts packages/core/tests/memory-store.test.ts packages/core/tests/schema.test.ts
git commit -m "fix(core): harden phase2 workflow validation"
```

---

## Task 9: IPC Contract Hardening

**Files:**
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/preload.ts`
- Create: `packages/desktop/src/main/workflow-ipc-types.ts` if IPC DTOs become too large for `ipc.ts`.

- [ ] **Step 1: Define stable IPC result helpers**

In `packages/desktop/src/main/ipc.ts`, add helpers near `wrapHandler`:

```ts
type IpcOk<T> = { ok: true; data: T };
type IpcErr = { ok: false; error: { code: string; message: string } };
type IpcResult<T> = IpcOk<T> | IpcErr;

function ipcOk<T>(data: T): IpcOk<T> {
  return { ok: true, data };
}

function ipcErr(code: string, message: string): IpcErr {
  return { ok: false, error: { code, message } };
}

async function safeIpc<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return ipcOk(await fn());
  } catch (err: any) {
    return ipcErr('IPC_HANDLER_FAILED', err?.message || String(err));
  }
}
```

- [ ] **Step 2: Add request guards**

Add guards in `packages/desktop/src/main/ipc.ts`:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertTextTeachingRequest(value: unknown): asserts value is { goal: string; teachingText: string; appName?: string; platform?: 'desktop' | 'browser' | 'hybrid' } {
  if (!isRecord(value)) throw new Error('request must be an object');
  assertStringField(value.goal, 'goal', { min: 1, max: 500 });
  assertStringField(value.teachingText, 'teachingText', { min: 1, max: 20000 });
  if ('appName' in value) assertStringField(value.appName, 'appName', { min: 1, max: 200 });
  if ('platform' in value && value.platform !== 'desktop' && value.platform !== 'browser' && value.platform !== 'hybrid') {
    throw new Error('platform is invalid');
  }
}

function assertStringField(value: unknown, field: string, limits: { min: number; max: number }): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const length = value.trim().length;
  if (length < limits.min) throw new Error(`${field} is required`);
  if (length > limits.max) throw new Error(`${field} is too long`);
}
```

Add similar guards for `memoryId` and `version`:

```ts
function assertMemoryId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('memoryId must be a non-empty string');
}

function assertVersion(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error('version must be a positive integer');
}
```

- [ ] **Step 3: Wrap new memory IPC handlers**

Change `memory:teachText`:

```ts
ipcMain.handle('memory:teachText', async (_event, request) => safeIpc(async () => {
  assertTextTeachingRequest(request);
  const result = await textTeachingService.teach(request);
  if (!result.ok || !result.data) throw new Error(result.errors.join('; '));
  return result.data;
}));
```

Change `memory:saveDraft`, `memory:update`, and `memory:rollback` similarly so core exceptions become `{ ok: false, error }`. Map duplicate workflow ids to a stable code such as `WORKFLOW_ALREADY_EXISTS` so double-clicked save attempts do not surface as rejected invokes.

For `memory:listVersions` and `memory:getVersion`, validate `memoryId` and `version`.

Normalize the fallback provider splitter to group repeated delimiters:

```ts
const teachingLines = request.teachingText
  .split(/[\r\n。.;]+/)
  .map((line) => line.trim())
  .filter(Boolean);
```

Add focused coverage for newline, Chinese period, English period, and semicolon input so the fallback provider keeps producing one step per intended instruction.

- [ ] **Step 4: Preserve renderer compatibility**

Because the renderer already expects `result.ok`, ensure every new memory IPC handler returns:

```ts
{ ok: true, data: ... }
```

or:

```ts
{ ok: false, error: { code: string, message: string } }
```

Do not return bare arrays or null for the new version handlers; wrap them in `ok`.

- [ ] **Step 5: Update preload DTO comments or types**

Keep `packages/desktop/src/preload.ts` API names unchanged, but if TypeScript types are introduced, expose:

```ts
teachText: (request: TextTeachingRequestDto) => Promise<IpcResult<TextTeachingResultDto>>
```

Do not change renderer call sites until Task 10.

- [ ] **Step 6: Build desktop**

```powershell
pnpm build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 9**

```powershell
git add packages/desktop/src/main/ipc.ts packages/desktop/src/preload.ts packages/desktop/src/main/workflow-ipc-types.ts
git commit -m "fix(desktop): harden workflow memory ipc"
```

---

## Task 10: Workflow Editor Completeness And Safety UX

**Files:**
- Modify: `packages/desktop/src/renderer/pages/WorkflowsPage.tsx`
- Optionally create: `packages/desktop/src/renderer/components/workflows/WorkflowStepsEditor.tsx`
- Optionally create: `packages/desktop/src/renderer/components/workflows/WorkflowInputsEditor.tsx`
- Optionally create: `packages/desktop/src/renderer/components/workflows/WorkflowVersionsPanel.tsx`

- [ ] **Step 1: Replace broad `any` with local DTO types**

Add explicit result and version types in `WorkflowsPage.tsx` or a nearby helper file:

```ts
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

type WorkflowMemoryVersion = {
  id: string;
  memoryId: string;
  version: number;
  snapshot: WorkflowDraft;
  changeNote?: string;
  source: 'create' | 'edit' | 'rollback' | 'import' | 'text-teach';
  createdAt: string;
};
```

Change state:

```ts
const [memories, setMemories] = useState<WorkflowDraft[]>([]);
const [selected, setSelected] = useState<WorkflowDraft | null>(null);
const [versions, setVersions] = useState<WorkflowMemoryVersion[]>([]);
```

- [ ] **Step 2: Add workflow-level platform and risk controls**

Add controls near topic/trigger fields:

```tsx
<select value={draft.platform ?? 'desktop'} onChange={(e) => setDraft({ ...draft, platform: e.target.value as WorkflowDraft['platform'] })}>
  <option value="desktop">desktop</option>
  <option value="browser">browser</option>
  <option value="hybrid">hybrid</option>
</select>

<select value={draft.riskLevel} onChange={(e) => setDraft({ ...draft, riskLevel: e.target.value as RiskLevel })}>
  <option value="low">low</option>
  <option value="medium">medium</option>
  <option value="high">high</option>
  <option value="forbidden">forbidden</option>
</select>
```

- [ ] **Step 3: Add inputs editor**

Support adding/removing/editing:

- `name`
- `type`
- `required`
- `prompt`
- `secret`
- `humanOnly`
- `defaultValue`

Represent unchecked booleans as `false` or omit them consistently.

- [ ] **Step 4: Expand step editor**

For each step, expose:

- `intent`
- `targetHint`
- `inputHint`
- `riskLevel`
- `fallback`
- expected state type and value

Use a minimal expected-state shape first:

```ts
expectedState: { all: [{ type: 'window_title_contains', value }] }
```

or:

```ts
expectedState: { all: [{ type: 'page_text_contains', value }] }
```

- [ ] **Step 5: Validate before save/update**

Before `saveDraft()` and `updateSelected()`, call:

```ts
const validation = await window.agivar.memory.validateDraft(draft);
```

If validation returns errors, show them and stop.

If validation returns warnings, show them above the save button and still allow save.

- [ ] **Step 6: Add high-risk save confirmation**

Before saving when `draft.riskLevel` is `high` or `forbidden`, require:

```ts
window.confirm('This workflow is marked high risk. Save anyway?')
```

Use the same confirmation when any step has `riskLevel` `high` or `forbidden`.

- [ ] **Step 7: Add rollback preview and confirmation**

When a version is selected, show:

- version number
- source
- change note
- snapshot topic
- snapshot summary
- first 5 step intents

Before rollback:

```ts
window.confirm(`Rollback to version ${version}? This creates a new version.`)
```

- [ ] **Step 8: Add loading states**

Use a state value:

```ts
const [busyAction, setBusyAction] = useState<'teach' | 'save' | 'update' | 'rollback' | null>(null);
```

Disable relevant buttons while busy.

- [ ] **Step 9: Build desktop**

```powershell
pnpm build
```

Expected: PASS.

- [ ] **Step 10: Commit Task 10**

```powershell
git add packages/desktop/src/renderer/pages/WorkflowsPage.tsx packages/desktop/src/renderer/components/workflows
git commit -m "feat(desktop): complete workflow editor fields"
```

---

## Task 11: IPC And Workflow Page Verification

**Files:**
- Create or modify: `packages/desktop/tests/workflow-ipc.test.ts` if desktop tests are already supported.
- Otherwise create: `tests/e2e/phase2-workflow-memory-smoke.test.ts` or a documented smoke script under `tests/`.
- Modify: `docs/superpowers/reviews/2026-06-24-phase2-test-review.md` only if test commands change.

- [ ] **Step 1: Add IPC contract tests where practical**

Cover at least:

- `memory:teachText` with `{}` returns `{ ok: false }`
- `memory:saveDraft` with invalid draft returns `{ ok: false }`
- `memory:update` with empty steps returns `{ ok: false }`
- `memory:rollback` with missing version returns `{ ok: false }`

If Electron IPC tests are not practical in the current harness, add a small main-process handler helper that can be unit-tested without Electron and route IPC through it.

- [ ] **Step 2: Add workflow page smoke**

The smoke should verify:

1. App opens chat page.
2. `Ctrl+Shift+W` opens workflow page.
3. Teaching text generates a draft.
4. User edits topic and first step.
5. Save creates version 1.
6. Edit creates version 2.
7. Version preview is visible.
8. Rollback confirmation appears.
9. Confirmed rollback creates version 3.

- [ ] **Step 3: Run focused Phase 2 tests**

```powershell
pnpm test -- packages/core/tests/workflow-draft.test.ts packages/core/tests/text-teaching-service.test.ts packages/core/tests/memory-store.test.ts packages/core/tests/schema.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full tests**

```powershell
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Run build**

```powershell
pnpm -F @agivar/core build
pnpm -F @agivar/desktop build
pnpm build
```

Expected: PASS. Package-scoped builds verify export completeness and desktop wiring quickly; the repository build remains the acceptance gate.

- [ ] **Step 6: Run Electron workflow smoke**

If the smoke is automated, run its command and capture output.

If the smoke is manual for now, record the exact manual result in the final report:

- workflow page opened
- draft generated
- save version 1
- edit version 2
- rollback version 3

- [ ] **Step 7: Commit Task 11**

```powershell
git add tests packages/desktop/tests docs/superpowers/reviews/2026-06-24-phase2-test-review.md
git commit -m "test(desktop): add workflow memory smoke coverage"
```
