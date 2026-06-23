// packages/desktop/src/main/global-hotkey.ts
import { globalShortcut } from 'electron';
import type { AbortManager } from '@agivar/core';

export class GlobalHotkeyAdapter {
  private registeredKey: string | null = null;

  constructor(private abortManager: AbortManager) {}

  register(hotkey: string, taskRunId: string): boolean {
    try {
      this.unregister();
      const ok = globalShortcut.register(hotkey, () => {
        this.abortManager.abortTask(taskRunId, 'hotkey');
      });
      if (ok) this.registeredKey = hotkey;
      return ok;
    } catch {
      return false;
    }
  }

  unregister(): void {
    if (this.registeredKey) {
      globalShortcut.unregister(this.registeredKey);
      this.registeredKey = null;
    }
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.registeredKey = null;
  }
}
