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
        expectedState: { type: 'text_contains', value: '{{noteText}}' },
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
        target: { strategy: 'coordinates', x: 10, y: 20 },
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
pnpm test -- --run packages/core/tests/workflow-draft.test.ts
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
    if (COORDINATE_RE.test(step.targetHint) || step.target?.strategy === 'coordinates') {
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
pnpm test -- --run packages/core/tests/workflow-draft.test.ts
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
pnpm test -- --run packages/core/tests/text-teaching-service.test.ts
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
pnpm test -- --run packages/core/tests/text-teaching-service.test.ts
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
pnpm test -- --run packages/core/tests/memory-store.test.ts
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
pnpm test -- --run packages/core/tests/memory-store.test.ts
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
pnpm test -- --run packages/core/tests/memory-store.test.ts
```

Expected: PASS if Task 3 already covers behavior, or FAIL if search/update behavior needs correction. If PASS immediately, document that existing keyword search already satisfies this part and keep the tests.

- [ ] **Step 3: Fix only if test fails**

If search fails, adjust `MemoryStore.FIELD_WEIGHTS` or `getFieldText` so `triggerExamples` and `searchText` participate. Do not add embeddings or new services.

- [ ] **Step 4: Run full core memory tests**

```powershell
pnpm test -- --run packages/core/tests/memory-store.test.ts packages/core/tests/workflow-draft.test.ts packages/core/tests/text-teaching-service.test.ts
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
        .split(/\r?\n|[。.;]/)
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
pnpm test -- --run packages/core/tests/workflow-draft.test.ts packages/core/tests/text-teaching-service.test.ts packages/core/tests/memory-store.test.ts
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
