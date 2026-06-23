import type { TargetDescriptor, ExpectedState, RiskLevel } from './agent.js';

export interface WorkflowMemory {
  id: string;
  appName: string;
  platform: 'desktop' | 'browser' | 'hybrid';
  topic: string;
  triggerExamples: string[];
  summary: string;
  initialState: string;
  inputs?: WorkflowInput[];
  steps: WorkflowStep[];
  successCriteria: string;
  riskLevel: RiskLevel;
  sourceType: 'manual' | 'text-teach' | 'recording';
  version: number;
  searchText: string;
  embeddingStatus: 'not_indexed';
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInput {
  name: string;
  type: 'string' | 'number';
  required: boolean;
  prompt: string;
  secret?: boolean;
  humanOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
}

export interface WorkflowStep {
  id: string;
  order: number;
  intent: string;
  targetHint: string;
  target: TargetDescriptor;
  inputHint?: string;
  expectedState?: ExpectedState;
  fallback?: 'retry' | 'degrade' | 'takeover' | 'terminal';
  riskLevel: RiskLevel;
}

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
