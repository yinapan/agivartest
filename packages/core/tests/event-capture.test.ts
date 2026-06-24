import { describe, expect, it } from 'vitest';
import { eventCapture } from '../src/index.js';

describe('event capture tool wrapper', () => {
  it('starts, stops, and drains native passive event capture', async () => {
    const result = await eventCapture.startEventCapture('rec-1', {
      scope: 'fullscreen',
      privacyMode: 'summary',
    });

    expect(result.ok).toBe(true);

    const stopped = await eventCapture.stopEventCapture('rec-1');
    expect(stopped.ok).toBe(true);

    const drained = await eventCapture.drainEvents('rec-1');
    expect(drained.ok).toBe(true);
    if (drained.ok) expect(Array.isArray(drained.data)).toBe(true);
  });

  it('allows a session id to be reused after stop and drain cleanup', async () => {
    for (let i = 0; i < 2; i++) {
      const started = await eventCapture.startEventCapture('rec-reuse', {
        scope: 'fullscreen',
        privacyMode: 'summary',
      });
      expect(started.ok).toBe(true);

      const stopped = await eventCapture.stopEventCapture('rec-reuse');
      expect(stopped.ok).toBe(true);

      const drained = await eventCapture.drainEvents('rec-reuse');
      expect(drained.ok).toBe(true);
    }
  });
});
