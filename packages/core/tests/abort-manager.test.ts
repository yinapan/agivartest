import { describe, it, expect } from 'vitest';
import { AbortManager } from '../src/safety/abort-manager.js';

describe('AbortManager', () => {
  it('createTaskSignal returns a non-aborted signal, isAborted returns false', () => {
    const manager = new AbortManager();
    const signal = manager.createTaskSignal('task-1');
    expect(signal.aborted).toBe(false);
    expect(manager.isAborted('task-1')).toBe(false);
  });

  it('abortTask sets signal.aborted=true, isAborted returns true', () => {
    const manager = new AbortManager();
    const signal = manager.createTaskSignal('task-1');
    manager.abortTask('task-1', 'ui');
    expect(signal.aborted).toBe(true);
    expect(manager.isAborted('task-1')).toBe(true);
  });

  it('isAborted returns true for unknown task ids', () => {
    const manager = new AbortManager();
    expect(manager.isAborted('nonexistent')).toBe(true);
  });

  it('abortTask is idempotent (calling twice does not throw)', () => {
    const manager = new AbortManager();
    manager.createTaskSignal('task-1');
    manager.abortTask('task-1', 'hotkey');
    expect(() => manager.abortTask('task-1', 'hotkey')).not.toThrow();
  });

  it('activeTaskIds tracks created tasks', () => {
    const manager = new AbortManager();
    manager.createTaskSignal('task-1');
    manager.createTaskSignal('task-2');
    expect(manager.activeTaskIds).toEqual(['task-1', 'task-2']);
  });

  it('cleanup removes without aborting (signal still not aborted)', () => {
    const manager = new AbortManager();
    const signal = manager.createTaskSignal('task-1');
    manager.cleanup('task-1');
    expect(signal.aborted).toBe(false);
    expect(manager.isAborted('task-1')).toBe(true); // unknown after cleanup
  });
});
