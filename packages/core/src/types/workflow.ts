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
