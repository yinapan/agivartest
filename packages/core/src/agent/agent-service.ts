import { nanoid } from 'nanoid';
import { TakeoverRequest } from '../types/agent.js';
import type { StepPlan, TaskContext, StepResult, AgentEvent } from '../types/agent.js';
import type { WorkflowMemory } from '../types/workflow.js';
import type { MemorySearchResult } from '../memory/memory-store.js';
import { MemoryStore } from '../memory/memory-store.js';
import { TaskPlanner } from './task-planner.js';
import { ToolRouter, type ToolAdapters } from './tool-router.js';
import { StepExecutor } from './step-executor.js';
import { StateVerifier } from './state-verifier.js';
import { FailureHandler } from './failure-handler.js';
import { RiskClassifier } from '../safety/risk-classifier.js';
import { ExecutionLog } from '../safety/execution-log.js';
import { AbortManager } from '../safety/abort-manager.js';
import type { LLMProvider } from '../llm/provider.js';
import type Database from 'better-sqlite3';

export interface AgentServiceDeps {
  db: Database.Database;
  llm: LLMProvider;
  tools: ToolAdapters;
  abortManager: AbortManager;
  memoryStore: MemoryStore;
}

const MEMORY_AUTO_SELECT_THRESHOLD = 0.8;
const MEMORY_SHOW_CANDIDATES_THRESHOLD = 0.5;
const MAX_FAILURES_BEFORE_LLM = 2;

export class AgentService {
  private toolRouter: ToolRouter;
  private stepExecutor: StepExecutor;
  private stateVerifier: StateVerifier;
  private failureHandler: FailureHandler;
  private riskClassifier: RiskClassifier;
  private executionLog: ExecutionLog;
  private taskPlanner: TaskPlanner;

  constructor(private deps: AgentServiceDeps) {
    this.toolRouter = new ToolRouter(deps.tools);
    this.stateVerifier = new StateVerifier(deps.tools);
    this.failureHandler = new FailureHandler();
    this.riskClassifier = new RiskClassifier();
    this.executionLog = new ExecutionLog(deps.db);
    this.taskPlanner = new TaskPlanner(deps.llm);

    this.stepExecutor = new StepExecutor({
      toolRouter: this.toolRouter,
      stateVerifier: this.stateVerifier,
      riskClassifier: this.riskClassifier,
      executionLog: this.executionLog,
      tools: deps.tools,
    });
  }

  async *run(goal: string, sessionId: string): AsyncGenerator<AgentEvent> {
    const taskRunId = nanoid();
    const signal = this.deps.abortManager.createTaskSignal(taskRunId);
    const context = this.createTaskContext(taskRunId, sessionId, goal, signal);
    const executedSteps: StepPlan[] = [];
    let consecutiveFailures = 0;

    yield this.evt(taskRunId, sessionId, { type: 'thinking', message: '正在搜索相关流程记忆...' });

    try {
      const searchResults = await this.deps.memoryStore.search(goal);
      let selectedMemory: WorkflowMemory | null = null;

      if (searchResults.length > 0) {
        const best = searchResults[0];
        if (best.score >= MEMORY_AUTO_SELECT_THRESHOLD) {
          selectedMemory = best.memory;
          yield this.evt(taskRunId, sessionId, { type: 'memory-match', workflow: selectedMemory });
        } else if (best.score >= MEMORY_SHOW_CANDIDATES_THRESHOLD) {
          yield this.evt(taskRunId, sessionId, { type: 'memory-candidates', candidates: searchResults });
          return;
        }
      }

      if (selectedMemory) {
        context.mode = 'workflow';
        yield* this.executeWorkflow(selectedMemory, context, executedSteps, consecutiveFailures);
      }

      if (!context.signal.aborted) {
        context.mode = context.mode === 'hybrid' ? 'hybrid' : 'llm';
        yield* this.executeLLMLoop(context, executedSteps, consecutiveFailures);
      }
    } catch (err) {
      if (err instanceof TakeoverRequest) {
        yield this.evt(taskRunId, sessionId, { type: 'takeover-required', reason: err.reason });
        return;
      }
      yield this.evt(taskRunId, sessionId, { type: 'task-failed', diagnosis: err instanceof Error ? err.message : String(err) });
    } finally {
      this.executionLog.flush();
      this.deps.abortManager.cleanup(taskRunId);
    }
  }

  private async *executeWorkflow(
    memory: WorkflowMemory,
    context: TaskContext,
    executedSteps: StepPlan[],
    consecutiveFailures: number,
  ): AsyncGenerator<AgentEvent> {
    for (const step of memory.steps) {
      if (context.signal.aborted) break;

      const plan = this.taskPlanner.buildStepPlanFromWorkflow(step, {});
      yield this.evt(context.taskRunId, context.sessionId, { type: 'step-start', step: plan, index: context.stepIndex });

      const result = await this.executePlannedStep(plan, context);
      executedSteps.push(plan);

      if (result.success) {
        consecutiveFailures = 0;
        yield this.evt(context.taskRunId, context.sessionId, { type: 'step-result', success: true, verification: result.verification });
      } else {
        consecutiveFailures++;
        yield this.evt(context.taskRunId, context.sessionId, {
          type: 'step-failed',
          failure: result.failure ?? { stepIndex: context.stepIndex, message: 'unknown failure' },
          failCount: consecutiveFailures,
        });
        if (consecutiveFailures > MAX_FAILURES_BEFORE_LLM) {
          context.mode = 'hybrid';
          break;
        }
      }

      context.stepIndex++;
    }

    if (context.mode !== 'hybrid') {
      yield this.evt(context.taskRunId, context.sessionId, { type: 'task-complete', summary: '流程执行完毕' });
    }
  }

  private async *executeLLMLoop(
    context: TaskContext,
    executedSteps: StepPlan[],
    consecutiveFailures: number,
  ): AsyncGenerator<AgentEvent> {
    while (!context.signal.aborted) {
      yield this.evt(context.taskRunId, context.sessionId, { type: 'thinking', message: 'LLM 正在规划下一步...' });

      const output = await this.taskPlanner.planNextFromLLM(context, executedSteps);
      const plan = output.step;

      if (plan.action.type === 'done') {
        yield this.evt(context.taskRunId, context.sessionId, { type: 'task-complete', summary: plan.action.summary });
        return;
      }

      yield this.evt(context.taskRunId, context.sessionId, { type: 'step-start', step: plan, index: context.stepIndex });

      const result = await this.executePlannedStep(plan, context);
      executedSteps.push(plan);

      if (result.success) {
        consecutiveFailures = 0;
        yield this.evt(context.taskRunId, context.sessionId, { type: 'step-result', success: true, verification: result.verification });
      } else {
        consecutiveFailures++;
        yield this.evt(context.taskRunId, context.sessionId, {
          type: 'step-failed',
          failure: result.failure ?? { stepIndex: context.stepIndex, message: 'unknown failure' },
          failCount: consecutiveFailures,
        });
        if (consecutiveFailures > MAX_FAILURES_BEFORE_LLM) {
          yield this.evt(context.taskRunId, context.sessionId, { type: 'task-failed', diagnosis: '连续失败次数过多' });
          return;
        }
      }

      context.stepIndex++;
    }
  }

  async executePlannedStep(plan: StepPlan, context: TaskContext): Promise<StepResult> {
    if (plan.riskLevel === 'forbidden') {
      throw new TakeoverRequest(`禁止操作: ${plan.intent}`);
    }
    return this.stepExecutor.execute(plan, context);
  }

  async resumeWithMemory(memoryId: string, _context: TaskContext): Promise<WorkflowMemory | null> {
    return this.deps.memoryStore.getById(memoryId);
  }

  abort(taskRunId: string): void {
    this.deps.abortManager.abortTask(taskRunId, 'ui');
  }

  private createTaskContext(
    taskRunId: string, sessionId: string, goal: string, signal: AbortSignal,
  ): TaskContext {
    return {
      taskRunId, sessionId, goal, mode: 'workflow', status: 'running',
      stepIndex: 0, retryCountByStep: new Map(), maxRetries: 2,
      outputDir: '', abortController: new AbortController(), signal,
      startedPids: [], createdTempDirs: [], humanTakeoverEvents: [],
    };
  }

  private evt(
    taskRunId: string,
    sessionId: string,
    payload: Omit<AgentEvent, 'taskRunId' | 'sessionId' | 'timestamp'>,
  ): AgentEvent {
    return { taskRunId, sessionId, timestamp: new Date().toISOString(), ...payload } as AgentEvent;
  }
}
