import { recorder, type PocResult } from '@agivar/core';
import { createOutputDir } from './helpers/report.js';
import { sleep } from './helpers/timer.js';
import path from 'node:path';

export async function runPocRecorder(outputDir: string): Promise<PocResult> {
  const result: PocResult = {
    name: 'poc-recorder',
    kind: 'interactive',
    status: 'failed',
    durationMs: 0,
    metrics: {},
    artifacts: [],
    notes: [],
  };

  const start = performance.now();

  // === Phase 1: 帧捕获验证 ===
  for (const backend of ['wgc', 'dxgi'] as const) {
    const backendDir = path.join(outputDir, `recorder-${backend}`);

    try {
      // 启动录屏 5 秒
      const startResult = await recorder.startRecording({
        backend,
        fps: 5,
        outputDir: backendDir,
      });

      if (!startResult.ok) {
        result.metrics[`${backend}.available`] = false;
        result.notes.push(`${backend}: launch failed — ${startResult.error.message}`);
        continue;
      }

      const sessionId = startResult.data.sessionId;
      result.notes.push(`${backend}: started session ${sessionId}`);

      // 等待 5 秒
      await sleep(5000);

      // 停止
      const stopResult = await recorder.stopRecording(sessionId);
      if (stopResult.ok) {
        result.metrics[`${backend}.available`] = true;
        result.metrics[`${backend}.frameCount`] = stopResult.data.frameCount;
        result.metrics[`${backend}.durationMs`] = stopResult.data.durationMs;
        result.metrics[`${backend}.droppedFrames`] = stopResult.data.droppedFrames;
        result.notes.push(`${backend}: ${stopResult.data.frameCount} frames in ${stopResult.data.durationMs}ms`);
      } else {
        result.metrics[`${backend}.available`] = false;
        result.notes.push(`${backend}: stop failed — ${stopResult.error.message}`);
      }
    } catch (err: any) {
      result.metrics[`${backend}.available`] = false;
      result.notes.push(`${backend}: error — ${err.message}`);
    }
  }

  // === Phase 2: 资源释放硬验收 ===
  let leakTestPassed = true;
  const leakBackend = result.metrics['wgc.available'] ? 'wgc' : 'dxgi';

  if (result.metrics[`${leakBackend}.available`]) {
    result.notes.push(`Leak test using ${leakBackend}...`);

    for (let i = 0; i < 5; i++) {
      const dir = path.join(outputDir, `leak-test-${i}`);
      const startR = await recorder.startRecording({
        backend: leakBackend as any,
        fps: 5,
        outputDir: dir,
      });

      if (!startR.ok) {
        leakTestPassed = false;
        result.notes.push(`Leak test ${i}: start failed`);
        break;
      }

      await sleep(1000);
      const stopR = await recorder.stopRecording(startR.data.sessionId);

      if (!stopR.ok) {
        leakTestPassed = false;
        result.notes.push(`Leak test ${i}: stop failed`);
        break;
      }
    }

    // forceStopAll 清理测试
    await recorder.forceStopAllRecordings();
    result.metrics['leakTest.passed'] = leakTestPassed;
    result.metrics['leakTest.cycles'] = 5;
  }

  // 判断结果
  const wgcOk = result.metrics['wgc.available'] === true;
  const dxgiOk = result.metrics['dxgi.available'] === true;
  result.status = (wgcOk || dxgiOk) ? 'passed' : 'failed';

  result.durationMs = Math.round(performance.now() - start);
  return result;
}

// 独立运行
if (process.argv[1]?.endsWith('poc-recorder.ts')) {
  const dir = createOutputDir();
  runPocRecorder(dir).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === 'passed' ? 0 : 1);
  });
}
