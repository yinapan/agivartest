import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface ResolveDataDirOptions {
  envDataDir?: string;
  appPath: string;
  userDataDir: string;
  isPackaged: boolean;
}

export interface DataDirMigrationOptions {
  legacyDir: string;
  targetDir: string;
}

export type DataDirMigrationResult =
  | { migrated: true; from: string; to: string }
  | { migrated: false; reason: 'no-legacy-database' | 'target-has-database' | 'same-directory' };

export function resolveDataDir(options: ResolveDataDirOptions): string {
  if (options.envDataDir?.trim()) return options.envDataDir;
  if (options.isPackaged) return options.userDataDir;

  return path.join(findWorkspaceRoot(options.appPath), '.agivar-dev');
}

export function resolveLegacyAppPathDataDir(appPath: string): string {
  return path.join(appPath, '.agivar-dev');
}

export async function migrateLegacyDataDir(options: DataDirMigrationOptions): Promise<DataDirMigrationResult> {
  const legacyDir = path.resolve(options.legacyDir);
  const targetDir = path.resolve(options.targetDir);
  if (legacyDir === targetDir) return { migrated: false, reason: 'same-directory' };

  const legacyDb = path.join(legacyDir, 'agivar.db');
  const targetDb = path.join(targetDir, 'agivar.db');
  if (!existsSync(legacyDb)) return { migrated: false, reason: 'no-legacy-database' };
  if (existsSync(targetDb)) return { migrated: false, reason: 'target-has-database' };

  await mkdir(targetDir, { recursive: true });
  await cp(legacyDir, targetDir, { recursive: true, force: false, errorOnExist: false });
  return { migrated: true, from: legacyDir, to: targetDir };
}

function findWorkspaceRoot(startPath: string): string {
  let current = path.resolve(startPath);
  while (true) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}
