import type { FailureInfo, FailureAction, StepPlan, TaskContext, FailureErrorType } from '../types/agent.js';

export class FailureHandler {
  classify(failure: FailureInfo): FailureErrorType {
    const msg = failure.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('not visible') || msg.includes('not ready')) return 'retryable';
    if (msg.includes('element_not_found') || msg.includes('selector')) return 'degradable';
    if (msg.includes('password') || msg.includes('captcha') || msg.includes('login')) return 'takeover';
    return 'terminal';
  }

  async handle(
    failure: FailureInfo,
    step: StepPlan,
    context: TaskContext,
  ): Promise<FailureAction> {
    const errorType = failure.errorType ?? this.classify(failure);

    switch (errorType) {
      case 'retryable': {
        const retryCount = context.retryCountByStep.get(context.stepIndex) ?? 0;
        if (retryCount < context.maxRetries) {
          context.retryCountByStep.set(context.stepIndex, retryCount + 1);
          return { action: 'retry' };
        }
        return { action: 'degrade', newStrategy: this.getNextStrategy(step) ?? 'none' };
      }
      case 'degradable': {
        const next = this.getNextStrategy(step);
        if (next) return { action: 'degrade', newStrategy: next };
        return { action: 'takeover', reason: '所有定位策略均失败' };
      }
      case 'takeover':
        return { action: 'takeover', reason: failure.message };
      case 'terminal':
        return { action: 'abort', diagnosis: this.buildDiagnosis(failure, context) };
    }
  }

  private getNextStrategy(step: StepPlan): string | null {
    if (step.action.type !== 'click') return null;
    const chain = ['playwright', 'uia', 'coordinate'];
    const current = step.action.target.strategy;
    const idx = chain.indexOf(current);
    return idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null;
  }

  private buildDiagnosis(failure: FailureInfo, context: TaskContext): string {
    return [
      `Step ${failure.stepIndex}: ${failure.message}`,
      `Task: ${context.goal}`,
      `Mode: ${context.mode}`,
      failure.screenshot ? `Screenshot: ${failure.screenshot}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }
}
