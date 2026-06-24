import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('Phase 4A E2E - recording teaching UI smoke', () => {
  it('opens Workflows and exposes recording teaching safety controls', async () => {
    const result = await execFileAsync(process.execPath, ['packages/desktop/scripts/phase4a-recording-ui-smoke.mjs'], {
      cwd: process.cwd(),
      timeout: 30000,
    });

    expect(result.stdout).toContain('Phase 4A recording UI smoke passed');
  }, 35000);
});
