import fs from 'node:fs';
import path from 'node:path';
import { screenshot, type PocResult } from '@agivar/core';
import { createOutputDir } from './helpers/report.js';

export async function runPocScreenshot(outputDir: string): Promise<PocResult> {
  const result: PocResult = {
    name: 'poc-screenshot',
    kind: 'readonly',
    status: 'failed',
    durationMs: 0,
    metrics: {},
    artifacts: [],
    notes: [],
  };

  const start = performance.now();

  // Test 1: captureScreen 连续 30 次
  let successCount = 0;
  const timings: number[] = [];
  for (let i = 0; i < 30; i++) {
    const r = await screenshot.captureScreen();
    if (r.ok) {
      successCount++;
      timings.push(r.durationMs);
      if (i === 0) {
        // 保存第一张截图
        const p = path.join(outputDir, 'screen-0.png');
        fs.writeFileSync(p, r.data.buffer);
        result.artifacts.push(p);
        result.metrics['imageWidth'] = r.data.width;
        result.metrics['imageHeight'] = r.data.height;
      }
    }
  }
  const successRate = successCount / 30;
  const avgMs = timings.length > 0 ? timings.reduce((a, b) => a + b, 0) / timings.length : 0;
  result.metrics['captureScreen.successRate'] = successRate;
  result.metrics['captureScreen.avgMs'] = Math.round(avgMs);
  result.metrics['captureScreen.runs'] = 30;

  // Test 2: listWindows
  const listResult = await screenshot.listWindows();
  if (listResult.ok) {
    result.metrics['windowCount'] = listResult.data.length;
    result.notes.push(`Found ${listResult.data.length} windows`);
    // 尝试截取第一个有标题的窗口
    const titled = listResult.data.find((w) => w.title.length > 0);
    if (titled) {
      const capResult = await screenshot.captureWindow(titled.hwnd);
      if (capResult.ok) {
        const p = path.join(outputDir, 'window-0.png');
        fs.writeFileSync(p, capResult.data.buffer);
        result.artifacts.push(p);
        result.metrics['captureWindow.success'] = true;
        result.notes.push(`Window capture: "${titled.title}"`);
      } else {
        result.metrics['captureWindow.success'] = false;
        result.notes.push(`Window capture failed: ${capResult.error.message}`);
      }
    }
  }

  // Test 3: getActiveWindow
  const activeResult = await screenshot.getActiveWindow();
  if (activeResult.ok) {
    result.metrics['activeWindow.title'] = activeResult.data.title;
  }

  result.durationMs = Math.round(performance.now() - start);
  result.status = successRate >= 0.95 ? 'passed' : 'failed';

  return result;
}

// 独立运行
if (process.argv[1]?.endsWith('poc-screenshot.ts')) {
  const dir = createOutputDir();
  runPocScreenshot(dir).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === 'passed' ? 0 : 1);
  });
}
