import fs from 'node:fs';
import path from 'node:path';
import type { PocResult, EnvCheckItem } from '@agivar/core';
import { runEnvChecks } from './poc-env.js';
import { runPocScreenshot } from './poc-screenshot.js';
import { runPocInput } from './poc-input.js';
import { runPocPlaywright } from './poc-playwright.js';
import { runPocUia } from './poc-uia.js';
import { runPocDpi } from './poc-dpi.js';
import { runPocRecorder } from './poc-recorder.js';
import { createOutputDir, writeReport } from './helpers/report.js';

type RunMode = 'readonly' | 'interactive' | 'all' | 'clean';

function parseMode(): RunMode {
  if (process.argv.includes('--clean')) return 'clean';
  if (process.argv.includes('--mode')) {
    const idx = process.argv.indexOf('--mode');
    return (process.argv[idx + 1] as RunMode) || 'readonly';
  }
  return 'readonly';
}

async function main() {
  const mode = parseMode();

  if (mode === 'clean') {
    const outputDir = path.join('tests', 'output');
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
      console.log('[clean] Removed tests/output/');
    }
    return;
  }

  console.log(`\n=== Agivar Phase 0 PoC Runner (mode: ${mode}) ===\n`);

  // 环境检查
  const envChecks: EnvCheckItem[] = await runEnvChecks();
  const fails = envChecks.filter((c) => c.level === 'fail');
  if (fails.length > 0) {
    console.log('\nBlocking environment issues:');
    for (const f of fails) console.log(`  [FAIL] ${f.name}: ${f.message}`);
    console.log('\nFix these before running PoCs.');
    process.exit(1);
  }

  const outputDir = createOutputDir();
  console.log(`Output: ${outputDir}\n`);

  const results: PocResult[] = [];

  // 只读 PoC
  console.log('--- Running readonly PoCs ---');

  console.log('[1/6] poc-screenshot...');
  results.push(await runPocScreenshot(outputDir));
  console.log(`  -> ${results[results.length - 1].status}`);

  console.log('[2/6] poc-playwright...');
  results.push(await runPocPlaywright(outputDir));
  console.log(`  -> ${results[results.length - 1].status}`);

  console.log('[3/6] poc-uia...');
  results.push(await runPocUia(outputDir));
  console.log(`  -> ${results[results.length - 1].status}`);

  console.log('[4/6] poc-dpi...');
  results.push(await runPocDpi(outputDir));
  console.log(`  -> ${results[results.length - 1].status}`);

  // 交互 PoC
  if (mode === 'interactive' || mode === 'all') {
    console.log('\n--- Running interactive PoCs ---');

    console.log('[5/6] poc-input...');
    results.push(await runPocInput(outputDir));
    console.log(`  -> ${results[results.length - 1].status}`);

    console.log('[6/6] poc-recorder...');
    results.push(await runPocRecorder(outputDir));
    console.log(`  -> ${results[results.length - 1].status}`);
  }

  // 生成报告
  const reportPath = writeReport(outputDir, envChecks, results);

  // 摘要
  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`  ${r.status.toUpperCase().padEnd(7)} ${r.name} (${r.durationMs}ms)`);
  }

  const passed = results.filter((r) => r.status === 'passed').length;
  const total = results.filter((r) => r.status !== 'skipped').length;
  console.log(`\n${passed}/${total} passed. Report: ${reportPath}\n`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('Runner failed:', err);
  process.exit(1);
});
