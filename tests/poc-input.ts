import { input, type PocResult } from '@agivar/core';
import { launchNotepad, killTrackedProcesses } from './helpers/cleanup.js';
import { countdown, createAbortController, sleep } from './helpers/timer.js';
import { createOutputDir } from './helpers/report.js';

const SAFETY_FLAG = '--i-understand-this-controls-my-desktop';

export async function runPocInput(outputDir: string): Promise<PocResult> {
  const result: PocResult = {
    name: 'poc-input',
    kind: 'interactive',
    status: 'failed',
    durationMs: 0,
    metrics: {},
    artifacts: [],
    notes: [],
  };

  if (!process.argv.includes(SAFETY_FLAG)) {
    result.status = 'skipped';
    result.notes.push(`Skipped: requires ${SAFETY_FLAG}`);
    return result;
  }

  const start = performance.now();
  const { controller, checkAbort } = createAbortController();

  // 注册 Ctrl+C 作为 abort（Phase 0 简化版紧急停止）
  process.on('SIGINT', () => {
    console.log('\n[abort] Emergency stop triggered');
    controller.abort();
  });

  try {
    // 倒计时
    await countdown(3, 'poc-input will control your keyboard');

    // 启动记事本
    const pid = launchNotepad();
    await sleep(2000); // 等待记事本打开
    result.notes.push(`Notepad PID=${pid}`);

    // 连续 10 次输入测试
    let successCount = 0;
    const testText = 'Hello from Agivar Phase 0!';

    for (let i = 0; i < 10; i++) {
      checkAbort();
      const typeResult = await input.typeText(`${testText} [${i}]\n`);
      if (typeResult.ok) {
        successCount++;
      } else {
        result.notes.push(`Run ${i} failed: ${typeResult.error.message}`);
      }
      await sleep(200);
    }

    const successRate = successCount / 10;
    result.metrics['typeText.successRate'] = successRate;
    result.metrics['typeText.runs'] = 10;
    result.status = successRate >= 0.9 ? 'passed' : 'failed';
  } catch (err: any) {
    if (err.message.includes('INPUT_ABORTED')) {
      result.status = 'failed';
      result.metrics['aborted'] = true;
      result.notes.push('Aborted by user');
    } else {
      result.notes.push(`Error: ${err.message}`);
    }
  } finally {
    killTrackedProcesses();
    result.durationMs = Math.round(performance.now() - start);
  }

  return result;
}

// 独立运行
if (process.argv[1]?.endsWith('poc-input.ts')) {
  const dir = createOutputDir();
  runPocInput(dir).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === 'passed' ? 0 : 1);
  });
}
