import { nanoid } from 'nanoid';
import type { StepPlan, StepResult, TaskContext } from '../types/agent.js';
import type { DatabaseLike } from '../memory/schema.js';
import { getDatabase } from '../memory/db.js';

export interface StepLogEntry {
  step: StepPlan;
  result: StepResult;
  context: TaskContext;
}

export class ExecutionLog {
  private queue: StepLogEntry[] = [];
  private db: DatabaseLike;
  private batchSize: number;

  constructor(db?: DatabaseLike, batchSize: number = 5) {
    if (db) {
      this.db = db;
    } else {
      this.db = getDatabase(':memory:');
    }
    this.batchSize = batchSize;
  }

  write(step: StepPlan, result: StepResult, context: TaskContext): void {
    this.queue.push({ step, result, context });
    if (this.queue.length >= this.batchSize) {
      this.flush();
    }
  }

  flush(): void {
    if (this.queue.length === 0) return;

    const entries = this.queue.splice(0);
    const insert = this.db.prepare(`
      INSERT INTO task_step_logs (
        id, task_run_id, step_index, intent, action, locator_strategy,
        before_screenshot, after_screenshot, uia_snapshot, expected_state,
        verification_result, error_type, workflow_step_snapshot, target_snapshot,
        tool_result, failure_info, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const entry of entries) {
        const { step, result, context } = entry;
        const id = nanoid();

        const verificationResult = result.verification
          ? (result.verification.passed ? ('pass' as const) : ('fail' as const))
          : ('skipped' as const);

        const locatorStrategy =
          step.action.type === 'click' ? step.action.target.strategy : step.action.type;

        insert.run(
          id,
          context.taskRunId,
          context.stepIndex,
          step.intent,
          JSON.stringify(step.action),
          locatorStrategy,
          result.beforeScreenshot ?? null,
          result.afterScreenshot ?? null,
          null,
          step.expectedState ? JSON.stringify(step.expectedState) : null,
          verificationResult,
          result.failure?.errorType ?? null,
          null,
          null,
          result.toolResult ? JSON.stringify(result.toolResult) : null,
          result.failure ? JSON.stringify(result.failure) : null,
          result.durationMs,
        );
      }
    });

    tx();
  }

  getByTaskRun(taskRunId: string): unknown[] {
    return this.db
      .prepare('SELECT * FROM task_step_logs WHERE task_run_id = ? ORDER BY step_index')
      .all(taskRunId);
  }
}
