import type { StepPlan, StepResult, TaskContext, FailureInfo } from '../types/agent.js';
import { TakeoverRequest } from '../types/agent.js';
import type { ToolResult } from '../types/errors.js';
import type { ToolRouter, ToolAdapters } from './tool-router.js';
import type { StateVerifier } from './state-verifier.js';
import type { RiskClassifier } from '../safety/risk-classifier.js';
import type { ExecutionLog } from '../safety/execution-log.js';
import fs from 'node:fs';
import path from 'node:path';

export interface StepExecutorDeps {
  toolRouter: ToolRouter;
  stateVerifier: StateVerifier;
  riskClassifier: RiskClassifier;
  executionLog: ExecutionLog;
  tools: ToolAdapters;
}

export class StepExecutor {
  private toolRouter: ToolRouter;
  private stateVerifier: StateVerifier;
  private riskClassifier: RiskClassifier;
  private executionLog: ExecutionLog;
  private tools: ToolAdapters;

  constructor(deps: StepExecutorDeps) {
    this.toolRouter = deps.toolRouter;
    this.stateVerifier = deps.stateVerifier;
    this.riskClassifier = deps.riskClassifier;
    this.executionLog = deps.executionLog;
    this.tools = deps.tools;
  }

  async execute(step: StepPlan, context: TaskContext): Promise<StepResult> {
    const startMs = performance.now();
    let beforeScreenshot: string | undefined;
    let afterScreenshot: string | undefined;
    let toolResult: ToolResult<unknown> | undefined;

    try {
      // 1. Before screenshot
      beforeScreenshot = await this.saveScreenshot('before', context);

      // 2. Dispatch tool action
      toolResult = await this.toolRouter.dispatch(step.action, context);

      // 3. After screenshot
      afterScreenshot = await this.saveScreenshot('after', context);

      // 4. Verify state
      const verification = await this.stateVerifier.verify(step.expectedState, context);

      const durationMs = performance.now() - startMs;

      const result: StepResult = {
        success: toolResult.ok && verification.passed,
        toolResult,
        verification,
        beforeScreenshot,
        afterScreenshot,
        durationMs,
      };

      // 5. Log
      this.executionLog.write(step, result, context);

      return result;
    } catch (err) {
      // TakeoverRequest should propagate
      if (err instanceof TakeoverRequest) throw err;

      const durationMs = performance.now() - startMs;

      const failure: FailureInfo = {
        stepIndex: context.stepIndex,
        message: err instanceof Error ? err.message : String(err),
        toolResult,
        screenshot: beforeScreenshot,
      };

      const result: StepResult = {
        success: false,
        toolResult,
        beforeScreenshot,
        afterScreenshot,
        failure,
        durationMs,
      };

      this.executionLog.write(step, result, context);

      return result;
    }
  }

  private async saveScreenshot(
    phase: 'before' | 'after',
    context: TaskContext,
  ): Promise<string | undefined> {
    const result = await this.tools.screenshot.captureScreen();
    if (!result.ok) return undefined;

    const filename = `step-${context.stepIndex}-${phase}.png`;
    const filePath = path.join(context.outputDir, filename);

    if (!fs.existsSync(context.outputDir)) {
      fs.mkdirSync(context.outputDir, { recursive: true });
    }

    fs.writeFileSync(filePath, result.data.buffer);
    return filePath;
  }
}
