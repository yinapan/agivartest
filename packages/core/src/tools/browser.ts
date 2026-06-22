import { toolOk, toolErr, type ToolResult } from '../types/errors.js';
import type { Browser, BrowserContext, Page } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  userDataDir: string;
  isManaged: true;
  cleanupOnClose: boolean;
  serverUrl: string;
}

let localServer: http.Server | null = null;
let localServerPort: number = 0;

async function startLocalServer(fixturesDir: string): Promise<string> {
  if (localServer) return `http://127.0.0.1:${localServerPort}`;

  return new Promise((resolve, reject) => {
    localServer = http.createServer((req, res) => {
      const requestedPath = req.url === '/' ? 'test-form.html' : req.url!.slice(1);
      const filePath = path.resolve(fixturesDir, requestedPath);
      if (!filePath.startsWith(path.resolve(fixturesDir))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath);
      const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : 'text/plain';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fs.readFileSync(filePath));
    });

    localServer.listen(0, '127.0.0.1', () => {
      const addr = localServer!.address() as any;
      localServerPort = addr.port;
      const url = `http://127.0.0.1:${localServerPort}`;
      resolve(url);
    });

    localServer.on('error', reject);
  });
}

export function stopLocalServer(): void {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
}

export async function launchManagedBrowser(options?: {
  headless?: boolean;
  channel?: 'chrome' | 'msedge' | 'chromium';
  userDataDir?: string;
  cleanupOnClose?: boolean;
  fixturesDir?: string;
}): Promise<ToolResult<BrowserSession>> {
  const start = performance.now();
  try {
    const { chromium } = await import('playwright');

    const userDataDir = options?.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'agivar-pw-'));
    const cleanupOnClose = options?.cleanupOnClose ?? true;
    const fixturesDir = options?.fixturesDir ?? path.join(process.cwd(), 'tests', 'fixtures');

    const serverUrl = await startLocalServer(fixturesDir);

    const launchOptions: any = {
      headless: options?.headless ?? false,
    };
    if (options?.channel) {
      launchOptions.channel = options.channel;
    }

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext();
    const page = await context.newPage();

    const session: BrowserSession = {
      browser,
      context,
      page,
      userDataDir,
      isManaged: true,
      cleanupOnClose,
      serverUrl,
    };

    return toolOk(session, performance.now() - start);
  } catch (err: any) {
    return toolErr('BROWSER_LAUNCH_FAILED', err.message, performance.now() - start);
  }
}

export async function navigateTo(page: Page, url: string): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('BROWSER_ACTION_FAILED', err.message, performance.now() - start);
  }
}

export async function clickElement(page: Page, selector: string): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    await page.click(selector, { timeout: 5000 });
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('BROWSER_ACTION_FAILED', err.message, performance.now() - start);
  }
}

export async function fillInput(page: Page, selector: string, value: string): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    await page.fill(selector, value, { timeout: 5000 });
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('BROWSER_ACTION_FAILED', err.message, performance.now() - start);
  }
}

export async function getPageText(page: Page): Promise<ToolResult<string>> {
  const start = performance.now();
  try {
    const text = await page.textContent('body', { timeout: 5000 });
    return toolOk(text ?? '', performance.now() - start);
  } catch (err: any) {
    return toolErr('BROWSER_ACTION_FAILED', err.message, performance.now() - start);
  }
}

export async function closeBrowserSession(session: BrowserSession): Promise<void> {
  try {
    await session.context.close();
    await session.browser.close();
  } catch {
    // best effort
  }
  if (session.cleanupOnClose) {
    try {
      fs.rmSync(session.userDataDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  stopLocalServer();
}
