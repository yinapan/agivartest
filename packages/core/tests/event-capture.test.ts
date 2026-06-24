import { describe, expect, it } from 'vitest';
import { eventCapture } from '../src/index.js';

describe('event capture tool wrapper', () => {
  it('returns a stable unavailable error when native passive capture is missing', async () => {
    const result = await eventCapture.startEventCapture('rec-1', {
      scope: 'fullscreen',
      privacyMode: 'summary',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EVENT_CAPTURE_UNAVAILABLE');
      expect(result.error.message).toContain('Native passive event capture');
    }
  });
});
