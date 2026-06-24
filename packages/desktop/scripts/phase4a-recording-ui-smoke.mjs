import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

let browser;
let server;

try {
  server = await serveRenderer();
  const address = server.address();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await installAgivarMock(page);
  await page.goto(`http://127.0.0.1:${address.port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.keyboard.press('Control+Shift+W');

  await expectVisible(page, 'workflows-page');
  await expectVisible(page, 'recording-teach-panel');
  await expectVisible(page, 'workflow-import-path');
  await expectEnabled(page, 'recording-start');

  await page.getByTestId('recording-privacy-mode').selectOption('detailed', { timeout: 5000 });
  await expectVisible(page, 'recording-detailed-ack');
  await expectDisabled(page, 'recording-start');

  await page.getByTestId('recording-detailed-ack').check();
  await expectEnabled(page, 'recording-start');

  console.log('Phase 4A recording UI smoke passed');
} finally {
  await browser?.close();
  await closeServer(server);
}

async function serveRenderer() {
  const root = resolve('packages/desktop/dist/renderer');
  const nextServer = createServer((request, response) => {
    const rawPath = request.url?.split('?')[0] ?? '/index.html';
    const filePath = join(root, rawPath === '/' ? 'index.html' : rawPath);
    const resolved = resolve(filePath);
    if (!resolved.startsWith(root) || !existsSync(resolved)) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }
    if (resolved.endsWith('.js')) response.setHeader('Content-Type', 'text/javascript');
    if (resolved.endsWith('.css')) response.setHeader('Content-Type', 'text/css');
    if (resolved.endsWith('.html')) response.setHeader('Content-Type', 'text/html');
    createReadStream(resolved).pipe(response);
  });

  await new Promise((resolveListen, rejectListen) => {
    nextServer.once('error', rejectListen);
    nextServer.listen(0, '127.0.0.1', () => {
      nextServer.off('error', rejectListen);
      resolveListen();
    });
  });
  return nextServer;
}

async function closeServer(activeServer) {
  if (!activeServer) return;
  activeServer.closeAllConnections?.();
  await new Promise((resolveClose) => {
    const timeout = setTimeout(resolveClose, 1000);
    activeServer.close(() => {
      clearTimeout(timeout);
      resolveClose();
    });
  });
}

async function expectVisible(page, testId) {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: 'visible', timeout: 5000 });
  if (!(await locator.isVisible())) throw new Error(`${testId} is not visible`);
}

async function expectEnabled(page, testId) {
  const locator = page.getByTestId(testId);
  if (!(await locator.isEnabled())) throw new Error(`${testId} is not enabled`);
}

async function expectDisabled(page, testId) {
  const locator = page.getByTestId(testId);
  if (!(await locator.isDisabled())) throw new Error(`${testId} is not disabled`);
}

async function installAgivarMock(page) {
  await page.addInitScript(() => {
    window.agivar = {
      platform: 'win32',
      versions: { node: 'test', electron: 'test', chrome: 'test' },
      memory: {
        list: async () => [],
        import: async () => ({ ok: true, data: { id: 'imported', topic: 'Imported workflow', inputs: [], steps: [] } }),
        teachText: async () => ({ ok: false, error: { code: 'UNUSED', message: 'unused in smoke' } }),
        validateDraft: async () => ({ ok: true, data: { ok: true, errors: [], warnings: [] } }),
        saveDraft: async (draft) => ({ ok: true, data: draft }),
        update: async (draft) => ({ ok: true, data: draft }),
        listVersions: async () => ({ ok: true, data: [] }),
        getVersion: async () => ({ ok: true, data: null }),
        rollback: async () => ({ ok: false, error: { code: 'UNUSED', message: 'unused in smoke' } }),
        delete: async () => undefined,
      },
      recordingTeach: {
        start: async () => ({ ok: true, data: { id: 'rec-smoke', status: 'recording' } }),
        stop: async () => ({ ok: true, data: { id: 'rec-smoke', status: 'stopped' } }),
        status: async () => ({ ok: true, data: { id: 'rec-smoke', status: 'recording' } }),
        getTimeline: async () => ({ ok: true, data: {
          sessionId: 'rec-smoke',
          startedAt: '2026-06-24T00:00:00.000Z',
          stoppedAt: '2026-06-24T00:00:03.000Z',
          keyframes: [{ id: 'kf-1', status: 'active' }],
          events: [{ id: 'ev-1', type: 'click', summary: 'Clicked Save', status: 'active' }],
          context: [],
          warnings: [],
        } }),
        buildManifest: async () => ({ ok: true, data: {
          id: 'manifest-smoke',
          sessionId: 'rec-smoke',
          providerName: 'recording-teaching-provider',
          selectedArtifactIds: ['kf-1', 'ev-1'],
          redactionPolicy: { privacyMode: 'summary' },
          containsRawText: false,
          containsPreciseCoordinates: false,
          estimatedBytes: 2048,
          createdAt: '2026-06-24T00:00:04.000Z',
          status: 'pending',
        } }),
        generateDraft: async () => ({ ok: true, data: {
          id: 'draft-smoke',
          sessionId: 'rec-smoke',
          status: 'draft_ready',
          draftJson: {
            appName: 'Smoke',
            platform: 'desktop',
            topic: 'Smoke workflow',
            triggerExamples: ['smoke'],
            summary: 'Smoke summary',
            initialState: 'Ready',
            steps: [{ intent: 'Click', targetHint: 'Button', riskLevel: 'low' }],
            successCriteria: 'Done',
            riskLevel: 'low',
            sourceType: 'recording',
          },
          evidence: [],
          createdAt: '2026-06-24T00:00:05.000Z',
          updatedAt: '2026-06-24T00:00:05.000Z',
        } }),
        resumeDraft: async () => ({ ok: false, error: { code: 'UNUSED', message: 'unused in smoke' } }),
      },
    };
  });
}
