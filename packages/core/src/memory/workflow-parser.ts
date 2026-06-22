import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { WorkflowMemory, WorkflowInput, WorkflowStep } from '../types/workflow.js';
import type { RiskLevel } from '../types/agent.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'forbidden']);

const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
  space: z.string(),
});

export const TargetDescriptorSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('playwright'),
    selector: z.string(),
    hint: z.string().optional(),
  }),
  z.object({
    strategy: z.literal('uia'),
    query: z.record(z.unknown()),
    hwnd: z.number().optional(),
    hint: z.string().optional(),
  }),
  z.object({
    strategy: z.literal('coordinate'),
    point: PointSchema,
    hint: z.string().optional(),
  }),
  z.object({
    strategy: z.literal('human'),
    hint: z.string(),
  }),
]);

export const StateConditionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('window_title_contains'),
    value: z.string(),
  }),
  z.object({
    type: z.literal('page_text_contains'),
    value: z.string(),
    pageRef: z.literal('managed').optional(),
  }),
  z.object({
    type: z.literal('uia_element_exists'),
    query: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('element_text_equals'),
    target: TargetDescriptorSchema,
    value: z.string(),
  }),
  z.object({
    type: z.literal('file_exists'),
    path: z.string(),
    scope: z.enum(['app-data', 'user-approved']),
  }),
]);

export const ExpectedStateSchema = z
  .object({
    any: z.array(StateConditionSchema).optional(),
    all: z.array(StateConditionSchema).optional(),
  })
  .refine(
    (val) => val.any !== undefined || val.all !== undefined,
    { message: 'ExpectedState must have at least one of "any" or "all"' },
  );

const FallbackSchema = z.enum(['retry', 'degrade', 'takeover', 'terminal']);

export const WorkflowInputSchema = z.object({
  type: z.enum(['string', 'number']),
  required: z.boolean(),
  prompt: z.string(),
  secret: z.boolean().optional(),
  humanOnly: z.boolean().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  defaultValue: z.string().optional(),
});

export const WorkflowStepSchema = z.object({
  intent: z.string(),
  targetHint: z.string(),
  target: TargetDescriptorSchema,
  inputHint: z.string().optional(),
  expectedState: ExpectedStateSchema.optional(),
  fallback: FallbackSchema.optional(),
  riskLevel: RiskLevelSchema,
});

export const WorkflowFileSchema = z.object({
  appName: z.string(),
  platform: z.enum(['desktop', 'browser', 'hybrid']),
  topic: z.string(),
  triggerExamples: z.array(z.string()),
  summary: z.string(),
  initialState: z.string(),
  inputs: z.record(WorkflowInputSchema).optional(),
  steps: z.array(WorkflowStepSchema),
  successCriteria: z.string(),
  riskLevel: RiskLevelSchema,
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type WorkflowFileData = z.infer<typeof WorkflowFileSchema>;

// ---------------------------------------------------------------------------
// ParseResult
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; data: WorkflowFileData }
  | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseWorkflowContent(
  content: string,
  format: 'yaml' | 'json',
): Promise<ParseResult> {
  let raw: unknown;

  try {
    if (format === 'yaml') {
      const jsYaml = await import('js-yaml');
      raw = jsYaml.load(content);
    } else {
      raw = JSON.parse(content);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`Failed to parse ${format}: ${message}`] };
  }

  const result = WorkflowFileSchema.safeParse(raw);

  if (result.success) {
    return { ok: true, data: result.data };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`,
  );
  return { ok: false, errors };
}

export function workflowFileToMemory(data: WorkflowFileData): WorkflowMemory {
  const now = new Date().toISOString();

  const inputs: WorkflowInput[] | undefined =
    data.inputs
      ? Object.entries(data.inputs).map(([name, inputDef]) => ({
          name,
          ...inputDef,
        }))
      : undefined;

  const steps: WorkflowStep[] = data.steps.map((step, index) => ({
    id: nanoid(),
    order: index,
    intent: step.intent,
    targetHint: step.targetHint,
    target: step.target,
    inputHint: step.inputHint,
    expectedState: step.expectedState,
    fallback: step.fallback,
    riskLevel: step.riskLevel,
  }));

  const searchText = [
    data.appName,
    data.topic,
    ...data.triggerExamples,
    data.summary,
  ].join(' ');

  return {
    id: nanoid(),
    appName: data.appName,
    platform: data.platform,
    topic: data.topic,
    triggerExamples: data.triggerExamples,
    summary: data.summary,
    initialState: data.initialState,
    inputs,
    steps,
    successCriteria: data.successCriteria,
    riskLevel: data.riskLevel,
    sourceType: 'manual',
    version: 1,
    searchText,
    embeddingStatus: 'not_indexed',
    createdAt: now,
    updatedAt: now,
  };
}
