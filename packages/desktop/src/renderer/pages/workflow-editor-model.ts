export type RiskLevel = 'low' | 'medium' | 'high' | 'forbidden';
export type Platform = 'desktop' | 'browser' | 'hybrid';

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error?: { code: string; message: string } | string; errors?: string[] };

export type WorkflowInput = {
  name: string;
  type: 'string' | 'number';
  required: boolean;
  prompt: string;
  secret?: boolean;
  humanOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
};

export type ExpectedStateType = 'window_title_contains' | 'page_text_contains';

export type DraftStep = {
  id?: string;
  order?: number;
  intent: string;
  targetHint: string;
  inputHint?: string;
  expectedState?: { all?: Array<{ type: ExpectedStateType; value: string }> };
  fallback?: 'retry' | 'degrade' | 'takeover' | 'terminal';
  riskLevel: RiskLevel;
  target?: unknown;
};

export type WorkflowDraft = {
  id?: string;
  appName: string;
  platform?: Platform;
  topic: string;
  triggerExamples?: string[];
  summary: string;
  initialState: string;
  inputs?: WorkflowInput[];
  steps: DraftStep[];
  successCriteria?: string;
  riskLevel: RiskLevel;
  sourceType?: 'manual' | 'text-teach' | 'recording';
  version?: number;
};

export type WorkflowMemoryVersion = {
  id: string;
  memoryId: string;
  version: number;
  snapshot: WorkflowDraft;
  changeNote?: string;
  source: 'create' | 'edit' | 'rollback' | 'import' | 'text-teach' | 'recording-teach';
  createdAt: string;
};

export function createEmptyDraft(): WorkflowDraft {
  return {
    appName: 'Desktop',
    platform: 'desktop',
    topic: '',
    triggerExamples: [],
    summary: '',
    initialState: '',
    inputs: [],
    steps: [],
    successCriteria: '',
    riskLevel: 'low',
    sourceType: 'text-teach',
  };
}

export function draftHasHighRisk(draft: WorkflowDraft): boolean {
  return draft.riskLevel === 'high'
    || draft.riskLevel === 'forbidden'
    || draft.steps.some((step) => step.riskLevel === 'high' || step.riskLevel === 'forbidden');
}

export function setStepExpectedState(
  step: DraftStep,
  type: ExpectedStateType,
  value: string,
): DraftStep {
  const trimmed = value.trim();
  if (!trimmed) {
    const { expectedState: _expectedState, ...rest } = step;
    return rest;
  }
  return {
    ...step,
    expectedState: { all: [{ type, value: trimmed }] },
  };
}

export function getExpectedStateType(step: DraftStep): ExpectedStateType {
  const condition = step.expectedState?.all?.[0];
  return condition?.type ?? 'window_title_contains';
}

export function getExpectedStateValue(step: DraftStep): string {
  return step.expectedState?.all?.[0]?.value ?? '';
}

export function versionPreview(version: WorkflowMemoryVersion): {
  topic: string;
  summary: string;
  stepIntents: string[];
} {
  return {
    topic: version.snapshot.topic,
    summary: version.snapshot.summary,
    stepIntents: version.snapshot.steps.slice(0, 5).map((step) => step.intent),
  };
}

export function getIpcErrorMessage(result: IpcResult<unknown>): string {
  if (result.ok) return '';
  if (Array.isArray(result.errors) && result.errors.length > 0) return result.errors.join('; ');
  if (typeof result.error === 'string') return result.error;
  return result.error?.message ?? 'Request failed';
}
