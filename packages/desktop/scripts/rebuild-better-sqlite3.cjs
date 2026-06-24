#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const mode = process.argv[2];
if (mode !== 'electron' && mode !== 'node') {
  console.error('Usage: node packages/desktop/scripts/rebuild-better-sqlite3.cjs <electron|node>');
  process.exit(2);
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const desktopDir = path.resolve(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (mode === 'electron') {
  const electronVersion = require(path.join(desktopDir, 'node_modules', 'electron', 'package.json')).version;
  execCommand('pnpm', ['dlx', '@electron/rebuild', '-f', '-v', electronVersion, '-m', desktopDir, '--only', 'better-sqlite3'], repoRoot);
  process.exit(0);
}

const nodeTarget = process.versions.node;
const betterSqliteDir = path.join(repoRoot, 'node_modules', '.pnpm', 'better-sqlite3@12.11.1', 'node_modules', 'better-sqlite3');
const prebuildInstall = path.join(
  betterSqliteDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prebuild-install.cmd' : 'prebuild-install',
);

execCommand(prebuildInstall, ['--runtime', 'node', '--target', nodeTarget, '--verbose'], betterSqliteDir);

function execCommand(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}
