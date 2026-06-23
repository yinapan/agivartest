import { describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recorder, screenshot } from '../src/index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('recorder tool wrapper', () => {
  it('starts a desktop recording when targetHwnd is omitted', async () => {
    const screenProbe = await screenshot.captureScreen();
    if (!screenProbe.ok) {
      console.warn(`Skipping frame assertions: screen capture unavailable (${screenProbe.error.message})`);
      return;
    }

    const outputDir = join(tmpdir(), `agivar-recorder-test-${Date.now()}`);

    const started = await recorder.startRecording({
      backend: 'wgc',
      fps: 1,
      outputDir,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await sleep(1200);

    const stopped = await recorder.stopRecording(started.data.sessionId);
    expect(stopped.ok).toBe(true);
    if (!stopped.ok) return;

    expect(stopped.data.frameCount).toBeGreaterThan(0);
    const files = await readdir(outputDir);
    expect(files.some((file) => file.endsWith('.png'))).toBe(true);
  });
});
