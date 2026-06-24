import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  migrateLegacyDataDir,
  resolveDataDir,
} from '../src/main/data-dir.js';

describe('desktop data dir', () => {
  it('uses AGIVAR_DATA_DIR when provided', () => {
    expect(resolveDataDir({
      envDataDir: 'F:\\agivar-data',
      appPath: 'F:\\agivar\\packages\\desktop',
      userDataDir: 'C:\\Users\\admin\\AppData\\Roaming\\Agivar',
      isPackaged: false,
    })).toBe('F:\\agivar-data');
  });

  it('uses the workspace root .agivar-dev in development', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agivar-workspace-'));
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const appPath = join(root, 'packages', 'desktop');
    await mkdir(appPath, { recursive: true });

    expect(resolveDataDir({
      appPath,
      userDataDir: join(root, 'user-data'),
      isPackaged: false,
    })).toBe(join(root, '.agivar-dev'));
  });

  it('uses Electron userData in packaged builds', () => {
    expect(resolveDataDir({
      appPath: 'C:\\Program Files\\Agivar\\resources\\app.asar',
      userDataDir: 'C:\\Users\\admin\\AppData\\Roaming\\Agivar',
      isPackaged: true,
    })).toBe('C:\\Users\\admin\\AppData\\Roaming\\Agivar');
  });

  it('copies an old appPath .agivar-dev into the stable data dir when the target has no database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agivar-data-migration-'));
    const legacyDir = join(root, 'packages', 'desktop', '.agivar-dev');
    const targetDir = join(root, '.agivar-dev');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'agivar.db'), 'old-db', { encoding: 'utf8' });
    await writeFile(join(legacyDir, 'settings.json'), '{"theme":"dark"}', { encoding: 'utf8' });

    const result = await migrateLegacyDataDir({ legacyDir, targetDir });

    expect(result.migrated).toBe(true);
    await expect(readFile(join(targetDir, 'agivar.db'), 'utf8')).resolves.toBe('old-db');
    await expect(readFile(join(targetDir, 'settings.json'), 'utf8')).resolves.toBe('{"theme":"dark"}');
    expect(existsSync(join(legacyDir, 'agivar.db'))).toBe(true);
  });

  it('does not overwrite an existing target database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agivar-data-existing-'));
    const legacyDir = join(root, 'legacy');
    const targetDir = join(root, 'target');
    await mkdir(legacyDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(legacyDir, 'agivar.db'), 'old-db', { encoding: 'utf8' });
    await writeFile(join(targetDir, 'agivar.db'), 'current-db', { encoding: 'utf8' });

    const result = await migrateLegacyDataDir({ legacyDir, targetDir });

    expect(result.migrated).toBe(false);
    expect(result.reason).toBe('target-has-database');
    await expect(readFile(join(targetDir, 'agivar.db'), 'utf8')).resolves.toBe('current-db');
  });
});
