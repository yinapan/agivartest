import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright';

const repoRoot = resolve('../..');
const dataDir = await mkdtemp(join(tmpdir(), 'agivar-real-recording-smoke-'));
const appMain = resolve(repoRoot, 'packages/desktop/dist/main/index.js');
const env = { ...process.env, AGIVAR_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;

const result = {
  dataDir,
  checks: [],
  artifacts: [],
};

function check(name, ok, detail = '') {
  result.checks.push({ name, ok, detail });
  if (!ok) throw new Error(`${name}: ${detail}`);
}

async function sleep(ms) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function walk(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) await walk(entryPath);
    if (entry.isFile()) {
      const info = await stat(entryPath);
      result.artifacts.push({ path: entryPath, size: info.size });
    }
  }
}

function runScript(name) {
  const mode = name === 'rebuild:sqlite:electron' ? 'electron' : 'node';
  execFileSync(process.execPath, [resolve('scripts/rebuild-better-sqlite3.cjs'), mode], {
    cwd: resolve('.'),
    env,
    stdio: 'inherit',
  });
}

let app;
try {
  runScript('rebuild:sqlite:electron');

  app = await electron.launch({ args: [appMain], cwd: repoRoot, env });
  const page = await app.firstWindow({ timeout: 30000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  await page.keyboard.press('Control+Shift+W');
  await page.getByTestId('recording-teach-panel').waitFor({ state: 'visible', timeout: 15000 });
  check('real Electron app loaded', true);

  const preflight = await page.evaluate(() => window.agivar.recordingTeach.preflight());
  check('preflight ok', preflight.ok && preflight.data.canRecord, JSON.stringify(preflight));

  const activeWindowId = await runRecording(page, 'active-window', true);
  const fullscreenId = await runRecording(page, 'fullscreen', true);

  const history = await page.evaluate(() => window.agivar.recordingTeach.listSessions({ includeActive: true, limit: 10 }));
  check(
    'history includes active-window and fullscreen sessions',
    history.ok && history.data.some((session) => session.id === activeWindowId) && history.data.some((session) => session.id === fullscreenId),
    JSON.stringify(history),
  );

  const resume = await page.evaluate((id) => window.agivar.recordingTeach.resumeDraft(id), fullscreenId);
  check('resume fullscreen draft ok', resume.ok, JSON.stringify(resume));

  const reprocess = await page.evaluate((id) => window.agivar.recordingTeach.reprocessDraft({
    sessionId: id,
    providerName: 'recording-teaching-provider',
  }), fullscreenId);
  check('reprocess fullscreen draft ok', reprocess.ok, JSON.stringify(reprocess));

  const discard = await page.evaluate((id) => window.agivar.recordingTeach.discard(id), fullscreenId);
  check('discard fullscreen ok', discard.ok && discard.data.session.status === 'discarded', JSON.stringify(discard));

  await walk(join(dataDir, 'recordings'));
  check('discard removed fullscreen artifacts', !result.artifacts.some((artifact) => artifact.path.includes(fullscreenId)), JSON.stringify(result.artifacts));

  await app.close();
  app = undefined;
  console.log(JSON.stringify(result, null, 2));
  console.log('Phase 4C real recording smoke passed');
} finally {
  if (app) await app.close().catch(() => undefined);
  runScript('rebuild:sqlite:node');
}

async function runRecording(page, scope, expectKeyframes) {
  const started = await page.evaluate((nextScope) => window.agivar.recordingTeach.start({
    scope: nextScope,
    privacyMode: 'summary',
    goal: `${nextScope} smoke`,
    notes: `${nextScope} notes`,
  }), scope);
  check(`${scope} start ok`, started.ok && started.data.status === 'recording', JSON.stringify(started));
  await sleep(3200);

  const stopped = await page.evaluate((sessionId) => window.agivar.recordingTeach.stop(sessionId), started.data.id);
  check(`${scope} stop ok`, stopped.ok && stopped.data.status === 'ready', JSON.stringify(stopped));

  const timeline = await page.evaluate((sessionId) => window.agivar.recordingTeach.getTimeline(sessionId), started.data.id);
  check(`${scope} timeline ok`, timeline.ok, JSON.stringify(timeline));
  const frameCount = timeline.ok ? timeline.data.keyframes.length : 0;
  if (expectKeyframes) check(`${scope} keyframes captured`, frameCount > 0, `frames=${frameCount}`);

  const manifest = await page.evaluate((sessionId) =>
    window.agivar.recordingTeach.buildManifest(sessionId, 'recording-teaching-provider'), started.data.id);
  check(`${scope} manifest ok`, manifest.ok && manifest.data.selectedArtifactIds.length > 0, JSON.stringify(manifest));

  const draft = await page.evaluate(({ sessionId, manifestData }) => window.agivar.recordingTeach.generateDraft({
    sessionId,
    manifest: { ...manifestData, status: 'confirmed' },
  }), { sessionId: started.data.id, manifestData: manifest.data });
  check(`${scope} draft ok`, draft.ok && draft.data.status === 'draft_ready', JSON.stringify(draft));

  return started.data.id;
}
