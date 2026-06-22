export type AbortSource = 'hotkey' | 'tray' | 'ui' | 'timeout';

export class AbortManager {
  private controllers = new Map<string, AbortController>();

  createTaskSignal(taskRunId: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(taskRunId, controller);
    return controller.signal;
  }

  abortTask(taskRunId: string, source: AbortSource): void {
    const controller = this.controllers.get(taskRunId);
    if (controller) {
      controller.abort(source);
      this.controllers.delete(taskRunId);
    }
  }

  isAborted(taskRunId: string): boolean {
    const controller = this.controllers.get(taskRunId);
    if (!controller) return true; // unknown task = aborted
    return controller.signal.aborted;
  }

  cleanup(taskRunId: string): void {
    this.controllers.delete(taskRunId);
  }

  get activeTaskIds(): string[] {
    return [...this.controllers.keys()];
  }
}
