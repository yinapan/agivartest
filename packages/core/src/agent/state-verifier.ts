import type { ExpectedState, StateCondition, VerifyResult, TaskContext } from '../types/agent.js';
import type { ToolAdapters } from './tool-router.js';
import fs from 'node:fs';

export class StateVerifier {
  constructor(private tools: ToolAdapters) {}

  async verify(expected: ExpectedState | undefined, context: TaskContext): Promise<VerifyResult> {
    if (!expected) return { passed: true, conditions: [] };

    const results: { condition: StateCondition; passed: boolean; actual?: string }[] = [];

    if (expected.any && expected.any.length > 0) {
      for (const cond of expected.any) {
        const { passed, actual } = await this.checkCondition(cond, context);
        results.push({ condition: cond, passed, actual });
      }
      return { passed: results.some(r => r.passed), conditions: results };
    }

    if (expected.all && expected.all.length > 0) {
      for (const cond of expected.all) {
        const { passed, actual } = await this.checkCondition(cond, context);
        results.push({ condition: cond, passed, actual });
      }
      return { passed: results.every(r => r.passed), conditions: results };
    }

    return { passed: true, conditions: [] };
  }

  private async checkCondition(
    cond: StateCondition,
    ctx: TaskContext,
  ): Promise<{ passed: boolean; actual?: string }> {
    switch (cond.type) {
      case 'window_title_contains': {
        const result = await this.tools.screenshot.getActiveWindow();
        if (!result.ok) return { passed: false, actual: `error: ${result.error.message}` };
        const title = result.data.title;
        return { passed: title.includes(cond.value), actual: title };
      }
      case 'page_text_contains': {
        const page = ctx.browserSession?.page;
        if (!page) return { passed: false, actual: 'no browser session' };
        const result = await this.tools.browser.getPageText(page);
        if (!result.ok) return { passed: false, actual: `error: ${result.error.message}` };
        return { passed: result.data.includes(cond.value), actual: result.data.slice(0, 200) };
      }
      case 'uia_element_exists': {
        const hwnd = ctx.activeHwnd;
        if (!hwnd) return { passed: false, actual: 'no active hwnd' };
        const result = await this.tools.uia.findElement(hwnd, cond.query);
        if (!result.ok) return { passed: false, actual: `error: ${result.error.message}` };
        return { passed: result.data !== null, actual: result.data?.name ?? 'not found' };
      }
      case 'element_text_equals': {
        if (cond.target.strategy === 'playwright') {
          const page = ctx.browserSession?.page;
          if (!page) return { passed: false, actual: 'no browser session' };
          try {
            const text = await page.locator(cond.target.selector).textContent({ timeout: 3000 });
            return { passed: text?.trim() === cond.value, actual: text?.trim() ?? '' };
          } catch {
            return { passed: false, actual: 'locator error' };
          }
        }
        if (cond.target.strategy === 'uia') {
          const hwnd = cond.target.hwnd ?? ctx.activeHwnd;
          if (!hwnd) return { passed: false, actual: 'no hwnd' };
          const result = await this.tools.uia.getElementValue(hwnd, cond.target.query);
          if (!result.ok) return { passed: false, actual: `error: ${result.error.message}` };
          return { passed: result.data === cond.value, actual: result.data };
        }
        return { passed: false, actual: 'unsupported target strategy' };
      }
      case 'file_exists': {
        const exists = fs.existsSync(cond.path);
        return { passed: exists, actual: exists ? 'exists' : 'not found' };
      }
    }
  }
}
