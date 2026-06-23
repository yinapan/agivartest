import type { Page } from 'playwright';
import type { ElementQuery, UiaNode } from '../tools/uia.js';
import type { ScreenshotResult, WindowInfo } from '../tools/screenshot.js';
import type { ToolResult } from '../types/errors.js';
import { toolOk, toolErr } from '../types/errors.js';
import type { StepAction, TargetDescriptor, TaskContext } from '../types/agent.js';
import { TakeoverRequest } from '../types/agent.js';
import type { Point } from '../types/coordinates.js';

export interface ToolAdapters {
  browser: {
    clickElement(page: Page, selector: string): Promise<ToolResult<void>>;
    fillInput(page: Page, selector: string, value: string): Promise<ToolResult<void>>;
    navigateTo(page: Page, url: string): Promise<ToolResult<void>>;
    getPageText(page: Page, selector?: string): Promise<ToolResult<string>>;
  };
  uia: {
    invokeElement(hwnd: number, query: ElementQuery): Promise<ToolResult<void>>;
    findElement(hwnd: number, query: ElementQuery): Promise<ToolResult<UiaNode | null>>;
    setElementValue(hwnd: number, query: ElementQuery, value: string): Promise<ToolResult<void>>;
    getElementValue(hwnd: number, query: ElementQuery): Promise<ToolResult<string>>;
    getUiTree(hwnd: number): Promise<ToolResult<UiaNode>>;
  };
  input: {
    clickPoint(point: Point): Promise<ToolResult<void>>;
    typeText(text: string): Promise<ToolResult<void>>;
    pressKeys(keys: string[]): Promise<ToolResult<void>>;
    scroll(direction: 'up' | 'down', amount: number): Promise<ToolResult<void>>;
    releaseAllKeys(): Promise<ToolResult<void>>;
  };
  screenshot: {
    captureScreen(monitorIndex?: number): Promise<ToolResult<ScreenshotResult>>;
    captureWindow(hwnd: number): Promise<ToolResult<ScreenshotResult>>;
    getActiveWindow(): Promise<ToolResult<WindowInfo>>;
  };
  programmatic: {
    readFile(path: string, scope: 'app-data' | 'user-approved'): Promise<ToolResult<string>>;
    copyFile(source: string, target: string): Promise<ToolResult<void>>;
    readTable(path: string, range?: string): Promise<ToolResult<Record<string, string>[]>>;
  };
}

const TOOL_TIMEOUT_MS = 15000;

export class ToolRouter {
  constructor(private tools: ToolAdapters) {}

  async dispatch(action: StepAction, context: TaskContext): Promise<ToolResult<unknown>> {
    if (context.signal.aborted) {
      return toolErr('TASK_ABORTED', 'Task was aborted', 0);
    }

    switch (action.type) {
      case 'click':
        return this.routeClick(action.target, context);
      case 'type':
        return this.withAbort(this.tools.input.typeText(action.text), context.signal);
      case 'press':
        return this.withAbort(this.tools.input.pressKeys(action.keys), context.signal);
      case 'scroll':
        return this.withAbort(this.tools.input.scroll(action.direction, action.amount), context.signal);
      case 'navigate':
        return this.routeNavigate(action.url, context);
      case 'wait':
        return toolOk({ waited: true }, 0);
      case 'observe':
        return this.captureState(context);
      case 'takeover':
        throw new TakeoverRequest(action.reason);
      case 'done':
        return toolOk({ done: true, summary: action.summary }, 0);
      case 'read_file':
        return this.tools.programmatic.readFile(action.path, action.scope);
      case 'copy_file':
        return this.tools.programmatic.copyFile(action.source, action.target);
      case 'read_table':
        return this.tools.programmatic.readTable(action.path, action.range);
      case 'get_page_text': {
        const p = context.browserSession?.page;
        if (!p) return toolErr('BROWSER_ACTION_FAILED', 'No active browser session', 0);
        return this.tools.browser.getPageText(p, action.selector);
      }
    }
  }

  private async routeClick(target: TargetDescriptor, ctx: TaskContext): Promise<ToolResult<void>> {
    switch (target.strategy) {
      case 'playwright': {
        const page = ctx.browserSession?.page;
        if (!page) return toolErr('BROWSER_ACTION_FAILED', 'No active browser session', 0);
        return this.withAbort(this.tools.browser.clickElement(page, target.selector), ctx.signal);
      }
      case 'uia': {
        const hwnd = target.hwnd ?? ctx.activeHwnd;
        if (!hwnd) return toolErr('UIA_ELEMENT_NOT_FOUND', 'No active window hwnd', 0);
        return this.withAbort(this.tools.uia.invokeElement(hwnd, target.query), ctx.signal);
      }
      case 'coordinate':
        return this.withAbort(this.tools.input.clickPoint(target.point), ctx.signal);
      case 'human':
        throw new TakeoverRequest(`需要人工定位: ${target.hint}`);
    }
  }

  private async routeNavigate(url: string, ctx: TaskContext): Promise<ToolResult<void>> {
    const page = ctx.browserSession?.page;
    if (!page) return toolErr('BROWSER_ACTION_FAILED', 'No active browser session', 0);
    return this.withAbort(this.tools.browser.navigateTo(page, url), ctx.signal);
  }

  private async captureState(ctx: TaskContext): Promise<ToolResult<unknown>> {
    const screenshot = await this.tools.screenshot.captureScreen();
    const window = await this.tools.screenshot.getActiveWindow();
    return toolOk({
      screenshot: screenshot.ok ? { width: screenshot.data.width, height: screenshot.data.height } : null,
      window: window.ok ? { title: window.data.title, hwnd: window.data.hwnd } : null,
    }, 0);
  }

  private async withAbort<T>(promise: Promise<ToolResult<T>>, signal: AbortSignal): Promise<ToolResult<T>> {
    if (signal.aborted) return toolErr('TASK_ABORTED', 'Task was aborted', 0);

    const ac = new AbortController();
    const onAbort = () => ac.abort(new Error('Task aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => ac.abort(new Error(`Tool timed out after ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS);

    try {
      const result = await Promise.race([
        promise,
        new Promise<ToolResult<T>>((_, reject) => {
          ac.signal.addEventListener('abort', () => {
            reject(toolErr('TASK_ABORTED', ac.signal.reason?.message ?? 'Tool aborted', TOOL_TIMEOUT_MS));
          }, { once: true });
        }),
      ]);
      return result;
    } catch (err: any) {
      if (err && typeof err === 'object' && 'ok' in err && err.ok === false) return err;
      return toolErr('TASK_ABORTED', err?.message ?? 'Aborted', 0);
    } finally {
      signal.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
    }
  }
}
