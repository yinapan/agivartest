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

export function rebuildMemoryForUpdate(
  memory: WorkflowMemory,
  now = new Date().toISOString(),
): WorkflowMemory {
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
