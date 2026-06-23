import type { Page } from 'playwright';
import type { ElementQuery, UiaNode } from '../tools/uia.js';
import type { Point } from './coordinates.js';
import type { BrowserSession } from '../tools/browser.js';
import type { ToolResult } from './errors.js';

export interface StepPlan {
  intent: string;
  action: StepAction;
  expectedState?: ExpectedState;
  riskLevel: RiskLevel;
  source: 'workflow' | 'llm';
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'forbidden';

export type StepAction =
  | { type: 'click'; target: TargetDescriptor }
  | { type: 'type'; text: string }
  | { type: 'press'; keys: string[] }
  | { type: 'scroll'; direction: 'up' | 'down'; amount: number }
  | { type: 'navigate'; url: string }
  | { type: 'wait'; condition: ExpectedState; timeoutMs: number }
  | { type: 'observe' }
  | { type: 'takeover'; reason: string }
  | { type: 'done'; summary: string }
  | { type: 'read_file'; path: string; scope: 'app-data' | 'user-approved' }
  | { type: 'copy_file'; source: string; target: string }
  | { type: 'read_table'; path: string; range?: string }
  | { type: 'get_page_text'; selector?: string };

export type TargetDescriptor =
  | { strategy: 'playwright'; selector: string; hint?: string }
  | { strategy: 'uia'; query: ElementQuery; hwnd?: number; hint?: string }
  | { strategy: 'coordinate'; point: Point; hint?: string }
  | { strategy: 'human'; hint: string };

export interface ExpectedState {
  any?: StateCondition[];
  all?: StateCondition[];
}

export type StateCondition =
  | { type: 'window_title_contains'; value: string }
  | { type: 'page_text_contains'; value: string; pageRef?: 'managed' }
  | { type: 'uia_element_exists'; query: ElementQuery }
  | { type: 'element_text_equals'; target: TargetDescriptor; value: string }
  | { type: 'file_exists'; path: string; scope: 'app-data' | 'user-approved' };

export type TaskMode = 'workflow' | 'llm' | 'hybrid';
export type TaskStatus = 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'aborted';

export interface TaskContext {
  taskRunId: string;
  sessionId: string;
  goal: string;
  mode: TaskMode;
  status: TaskStatus;
  workflowId?: string;
  workflowVersion?: number;
  stepIndex: number;
  retryCountByStep: Map<number, number>;
  browserSession?: BrowserSession;
  activeHwnd?: number;
  activeWindowTitle?: string;
  maxRetries: number;
  outputDir: string;
  abortController: AbortController;
  signal: AbortSignal;
  startedPids: number[];
  createdTempDirs: string[];
  lastObservation?: ObservationSnapshot;
  humanTakeoverEvents: HumanTakeoverEvent[];
}

export interface ObservationSnapshot {
  screenshot: Buffer;
  screenshotPath?: string;
  windowTitle: string;
  hwnd?: number;
  uiaTree?: UiaNode;
  timestamp: string;
}

export interface HumanTakeoverEvent {
  stepIndex: number;
  reason: string;
  pausedAt: string;
  resumedAt?: string;
  userAction?: string;
}

export interface VerifyResult {
  passed: boolean;
  conditions: { condition: StateCondition; passed: boolean; actual?: string }[];
  screenshot?: string;
}

export type FailureErrorType = 'retryable' | 'degradable' | 'takeover' | 'terminal';

export interface FailureInfo {
  stepIndex: number;
  errorType?: FailureErrorType;
  message: string;
  toolResult?: ToolResult<unknown>;
  screenshot?: string;
}

export type FailureAction =
  | { action: 'retry' }
  | { action: 'degrade'; newStrategy: string }
  | { action: 'takeover'; reason: string }
  | { action: 'abort'; diagnosis: string };

export type AgentEventBase = {
  taskRunId: string;
  sessionId: string;
  timestamp: string;
};

export type AgentEvent = AgentEventBase & (
  | { type: 'thinking'; message: string }
  | { type: 'memory-match'; workflow: import('../types/workflow.js').WorkflowMemory }
  | { type: 'memory-candidates'; candidates: import('../memory/memory-store.js').MemorySearchResult[] }
  | { type: 'step-start'; step: StepPlan; index: number }
  | { type: 'step-screenshot'; before?: string; after?: string }
  | { type: 'step-result'; success: boolean; verification?: VerifyResult }
  | { type: 'step-failed'; failure: FailureInfo; failCount: number }
  | { type: 'takeover-required'; reason: string }
  | { type: 'takeover-resumed' }
  | { type: 'task-complete'; summary: string }
  | { type: 'task-failed'; diagnosis: string }
);

export interface StepResult {
  success: boolean;
  toolResult?: ToolResult<unknown>;
  verification?: VerifyResult;
  failure?: FailureInfo;
  beforeScreenshot?: string;
  afterScreenshot?: string;
  durationMs: number;
  artifacts?: string[];
  evidenceSummary?: string;
}

export class TakeoverRequest extends Error {
  constructor(public reason: string) {
    super(`Takeover required: ${reason}`);
    this.name = 'TakeoverRequest';
  }
}
