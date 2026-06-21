import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { EnvCheckItem, EnvCheckLevel } from '@agivar/core';

function check(
  name: string,
  fn: () => { level: EnvCheckLevel; value: string; message: string },
): EnvCheckItem {
  try {
    const result = fn();
    return { name, ...result };
  } catch (err: any) {
    return { name, level: 'fail', value: 'error', message: err.message };
  }
}

export async function runEnvChecks(): Promise<EnvCheckItem[]> {
  const checks: EnvCheckItem[] = [];

  // OS version
  checks.push(
    check('os', () => {
      const release = os.release();
      const isWin = process.platform === 'win32';
      return {
        level: isWin ? 'pass' : 'fail',
        value: `${process.platform} ${release}`,
        message: isWin ? 'Windows detected' : 'Phase 0 requires Windows',
      };
    }),
  );

  // Node version
  checks.push(
    check('node', () => {
      const major = parseInt(process.versions.node.split('.')[0], 10);
      return {
        level: major >= 20 ? 'pass' : 'fail',
        value: process.versions.node,
        message: major >= 20 ? 'Node >= 20' : 'Node >= 20 required',
      };
    }),
  );

  // Rust version
  checks.push(
    check('rust', () => {
      let out: string;
      try {
        out = execSync('rustc --version', { encoding: 'utf-8' }).trim();
      } catch {
        // On Windows, ~/.cargo/bin may not be on PATH; try the standard location
        const cargoRustc = path.join(os.homedir(), '.cargo', 'bin', 'rustc');
        out = execSync(`"${cargoRustc}" --version`, { encoding: 'utf-8', shell: 'cmd.exe' }).trim();
      }
      return { level: 'pass', value: out, message: 'Rust available' };
    }),
  );

  // pnpm version
  checks.push(
    check('pnpm', () => {
      const out = execSync('pnpm --version', { encoding: 'utf-8' }).trim();
      const major = parseInt(out.split('.')[0], 10);
      return {
        level: major >= 9 ? 'pass' : 'fail',
        value: out,
        message: major >= 9 ? 'pnpm >= 9' : 'pnpm >= 9 required',
      };
    }),
  );

  // FFmpeg
  checks.push(
    check('ffmpeg', () => {
      try {
        const out = execSync('ffmpeg -version', { encoding: 'utf-8' }).split('\n')[0];
        return { level: 'pass', value: out, message: 'FFmpeg available' };
      } catch {
        return { level: 'warn', value: 'not found', message: 'FFmpeg not found — recording encoding PoC will skip' };
      }
    }),
  );

  // Native addon
  checks.push(
    check('native-addon', () => {
      try {
        const native = require('@agivar/native');
        const result = native.ping();
        return { level: 'pass', value: result, message: 'Native addon loaded' };
      } catch (err: any) {
        return { level: 'fail', value: 'load failed', message: err.message };
      }
    }),
  );

  // Admin check
  checks.push(
    check('admin', () => {
      try {
        execSync('net session', { stdio: 'ignore' });
        return { level: 'pass', value: 'true', message: 'Running as administrator' };
      } catch {
        return {
          level: 'warn',
          value: 'false',
          message: 'Not administrator — cannot control admin-privilege windows',
        };
      }
    }),
  );

  // DPI scale
  checks.push(
    check('dpi', () => {
      try {
        const out = execSync(
          'powershell -c "(Get-CimInstance Win32_VideoController | Select-Object -First 1).CurrentHorizontalResolution"',
          { encoding: 'utf-8' },
        ).trim();
        return { level: 'pass', value: `physicalWidth=${out}`, message: 'DPI info retrieved' };
      } catch {
        return { level: 'warn', value: 'unknown', message: 'Could not detect DPI' };
      }
    }),
  );

  // Monitor count
  checks.push(
    check('monitors', () => {
      try {
        const out = execSync(
          'powershell -c "(Get-CimInstance Win32_DesktopMonitor | Measure-Object).Count"',
          { encoding: 'utf-8' },
        ).trim();
        const count = parseInt(out, 10) || 1;
        return {
          level: count > 1 ? 'pass' : 'warn',
          value: `${count}`,
          message: count > 1 ? `${count} monitors` : 'Single monitor — multi-monitor PoC will skip',
        };
      } catch {
        return { level: 'warn', value: '1', message: 'Could not detect monitors' };
      }
    }),
  );

  // Remote desktop
  checks.push(
    check('remote-desktop', () => {
      const isRemote = process.env.SESSIONNAME?.startsWith('RDP-') ?? false;
      return {
        level: isRemote ? 'warn' : 'pass',
        value: String(isRemote),
        message: isRemote ? 'Remote desktop — screenshots/recording may behave differently' : 'Local session',
      };
    }),
  );

  return checks;
}

// Run standalone
if (process.argv[1]?.endsWith('poc-env.ts')) {
  runEnvChecks().then((checks) => {
    console.log('\n=== Environment Check Results ===\n');
    for (const c of checks) {
      const icon = c.level === 'pass' ? 'OK' : c.level === 'warn' ? 'WARN' : 'FAIL';
      console.log(`[${icon}] ${c.name}: ${c.value} — ${c.message}`);
    }
    const fails = checks.filter((c) => c.level === 'fail');
    if (fails.length > 0) {
      console.log(`\n${fails.length} blocking issue(s). Fix before running PoCs.`);
      process.exit(1);
    }
    console.log('\nAll blocking checks passed.');
  });
}
