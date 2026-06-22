import fs from 'node:fs';
import path from 'node:path';
import type { PocResult, PocReport, EnvCheckItem } from '@agivar/core';

function getTimestampDir(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
  return path.join('tests', 'output', ts);
}

export function createOutputDir(): string {
  const dir = getTimestampDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeReport(
  outputDir: string,
  envChecks: EnvCheckItem[],
  results: PocResult[],
): string {
  const report: PocReport = {
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    environment: {
      os: `${process.platform} ${require('node:os').release()}`,
      nodeVersion: process.version,
      dpiScale: 1.0,
      monitors: 1,
    },
    envChecks,
    results,
  };

  const reportPath = path.join(outputDir, 'poc-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Write latest.json pointer
  const latestPath = path.join('tests', 'output', 'latest.json');
  fs.writeFileSync(
    latestPath,
    JSON.stringify({ dir: outputDir, reportPath, updatedAt: report.endedAt }, null, 2),
  );

  console.log(`[report] saved to ${reportPath}`);
  return reportPath;
}
