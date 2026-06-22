import { browser, type PocResult } from '@agivar/core';
import { createOutputDir } from './helpers/report.js';

export async function runPocPlaywright(outputDir: string): Promise<PocResult> {
  const result: PocResult = {
    name: 'poc-playwright',
    kind: 'readonly',
    status: 'failed',
    durationMs: 0,
    metrics: {},
    artifacts: [],
    notes: [],
  };

  const start = performance.now();
  let session: browser.BrowserSession | null = null;

  try {
    // 启动托管浏览器
    const launchResult = await browser.launchManagedBrowser({ headless: false });
    if (!launchResult.ok) {
      result.notes.push(`Launch failed: ${launchResult.error.message}`);
      result.durationMs = Math.round(performance.now() - start);
      return result;
    }
    session = launchResult.data;
    result.notes.push(`Browser launched, server at ${session.serverUrl}`);

    // 连续 5 次表单填写测试
    let successCount = 0;
    const timings: number[] = [];

    for (let i = 0; i < 5; i++) {
      const runStart = performance.now();
      try {
        const page = session.page;

        // 导航到本地测试页
        const navResult = await browser.navigateTo(page, `${session.serverUrl}/test-form.html`);
        if (!navResult.ok) throw new Error(navResult.error.message);

        // 填写表单
        await browser.fillInput(page, '#name', `TestUser_${i}`);
        await browser.fillInput(page, '#email', `test${i}@example.com`);
        await page.selectOption('#category', 'feature');
        await page.check('#agree');
        await browser.fillInput(page, '#details', `Automated test run ${i} from poc-playwright`);

        // 提交
        await browser.clickElement(page, 'button[type="submit"]');

        // 等待成功消息
        await page.waitForSelector('.result.success', { timeout: 3000 });
        const resultText = await page.textContent('.result.success');

        if (resultText?.includes('Form submitted successfully')) {
          successCount++;
          timings.push(performance.now() - runStart);
        } else {
          result.notes.push(`Run ${i}: unexpected result text`);
        }
      } catch (err: any) {
        result.notes.push(`Run ${i} failed: ${err.message}`);
      }
    }

    const successRate = successCount / 5;
    const avgMs = timings.length > 0 ? timings.reduce((a, b) => a + b, 0) / timings.length : 0;
    result.metrics['formSubmit.successRate'] = successRate;
    result.metrics['formSubmit.avgMs'] = Math.round(avgMs);
    result.metrics['formSubmit.runs'] = 5;
    result.status = successRate >= 0.95 ? 'passed' : 'failed';
  } catch (err: any) {
    result.notes.push(`Error: ${err.message}`);
  } finally {
    if (session) {
      await browser.closeBrowserSession(session);
    }
    result.durationMs = Math.round(performance.now() - start);
  }

  return result;
}

// 独立运行
if (process.argv[1]?.endsWith('poc-playwright.ts')) {
  const dir = createOutputDir();
  runPocPlaywright(dir).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === 'passed' ? 0 : 1);
  });
}
