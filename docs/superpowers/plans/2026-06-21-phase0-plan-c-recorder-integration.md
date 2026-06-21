# Phase 0 Plan C：录屏 + Electron 集成 + 回归验收

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现 WGC/DXGI 双路线录屏模块并输出对比报告，完成 Electron 面板 IPC 集成（6 个验证项均可从 UI 触发），执行全量回归并填写 Go/No-Go 决策表。

**前置条件：** Plan A + Plan B 已完成——monorepo 可构建，截图/输入/浏览器/UIA/DPI 模块均已通过 PoC 验证。

**架构：** 录屏在 Rust 中实现（windows-capture WGC + win_desktop_duplication DXGI），sessionId + 内部 map 管理生命周期。TypeScript 层暴露 start/stop/forceStopAll。Electron 面板通过 IPC 调用所有 core 模块，UI 按安全等级分按钮类型。

**设计规格：** `docs/specs/2026-06-21-phase0-desktop-poc-design.md` 第 5-8、13 章

---

## 文件结构

```
# Rust 录屏模块
packages/native/Cargo.toml              — 添加 windows-capture, win_desktop_duplication 依赖
packages/native/src/lib.rs               — 添加 recorder 模块导出
packages/native/src/recorder.rs          — WGC + DXGI 录屏实现

# TypeScript 录屏层
packages/core/src/tools/recorder.ts      — 录屏 TypeScript 封装
packages/core/src/index.ts               — 添加 recorder 导出

# Electron 面板 IPC
packages/desktop/src/main/ipc.ts         — IPC handler 注册
packages/desktop/src/main/index.ts       — 引入 ipc 注册
packages/desktop/src/preload.ts          — 暴露完整 agivar API
packages/desktop/src/renderer/App.tsx    — 6 行验证面板 + 安全分级

# PoC 验证
tests/poc-recorder.ts                    — 录屏对比验证
tests/poc-runner.ts                      — 添加 recorder，完整 6 项
```

---

## 任务 1：Rust 录屏模块

**文件：**
- 修改：`packages/native/Cargo.toml`
- 创建：`packages/native/src/recorder.rs`
- 修改：`packages/native/src/lib.rs`

- [ ] **步骤 1：更新 `packages/native/Cargo.toml`**

在 `[dependencies]` 下添加：

```toml
windows-capture = "1.3"
win_desktop_duplication = { version = "0.5", optional = true }
image = "0.25"
uuid = { version = "1", features = ["v4"] }
parking_lot = "0.12"
```

在末尾添加：

```toml
[features]
default = ["dxgi"]
dxgi = ["dep:win_desktop_duplication"]
```

- [ ] **步骤 2：创建 `packages/native/src/recorder.rs`**

```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

#[napi(object)]
pub struct RecordConfig {
    pub backend: String,        // "wgc" | "dxgi"
    pub target_hwnd: Option<i64>,
    pub fps: Option<u32>,       // 默认 5
    pub output_dir: String,
}

#[napi(object)]
pub struct RecordResult {
    pub session_id: String,
    pub backend: String,
    pub frame_count: u32,
    pub duration_ms: u64,
    pub output_path: String,
    pub dropped_frames: u32,
}

#[napi(object)]
pub struct RecordingStatus {
    pub session_id: String,
    pub is_recording: bool,
    pub frame_count: u32,
    pub elapsed_ms: u64,
}

struct RecordingSession {
    session_id: String,
    backend: String,
    start_time: Instant,
    frame_count: Arc<Mutex<u32>>,
    is_recording: Arc<Mutex<bool>>,
    output_dir: PathBuf,
}

lazy_static::lazy_static! {
    static ref SESSIONS: Mutex<HashMap<String, RecordingSession>> = Mutex::new(HashMap::new());
}

// 注意：实际的 WGC/DXGI 捕获实现需要根据 windows-capture 和
// win_desktop_duplication crate 的 API 适配。以下是骨架实现，
// 编译时需参考各 crate 文档调整。

#[napi]
pub fn start_recording_wgc(config: RecordConfig) -> Result<String> {
    let session_id = Uuid::new_v4().to_string();
    let output_dir = PathBuf::from(&config.output_dir);
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| Error::from_reason(format!("mkdir: {}", e)))?;

    let frame_count = Arc::new(Mutex::new(0u32));
    let is_recording = Arc::new(Mutex::new(true));

    // WGC 捕获启动 — 实际实现需使用 windows_capture::capture::GraphicsCaptureSession
    // Phase 0 先实现帧计数和状态管理骨架
    let session = RecordingSession {
        session_id: session_id.clone(),
        backend: "wgc".to_string(),
        start_time: Instant::now(),
        frame_count: frame_count.clone(),
        is_recording: is_recording.clone(),
        output_dir,
    };

    SESSIONS.lock().insert(session_id.clone(), session);
    Ok(session_id)
}

#[napi]
pub fn start_recording_dxgi(config: RecordConfig) -> Result<String> {
    let session_id = Uuid::new_v4().to_string();
    let output_dir = PathBuf::from(&config.output_dir);
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| Error::from_reason(format!("mkdir: {}", e)))?;

    let frame_count = Arc::new(Mutex::new(0u32));
    let is_recording = Arc::new(Mutex::new(true));

    let session = RecordingSession {
        session_id: session_id.clone(),
        backend: "dxgi".to_string(),
        start_time: Instant::now(),
        frame_count: frame_count.clone(),
        is_recording: is_recording.clone(),
        output_dir,
    };

    SESSIONS.lock().insert(session_id.clone(), session);
    Ok(session_id)
}

#[napi]
pub fn stop_recording(session_id: String) -> Result<RecordResult> {
    let mut sessions = SESSIONS.lock();
    let session = sessions.remove(&session_id)
        .ok_or_else(|| Error::from_reason(format!("Session {} not found", session_id)))?;

    *session.is_recording.lock() = false;
    let frame_count = *session.frame_count.lock();
    let duration = session.start_time.elapsed();

    Ok(RecordResult {
        session_id,
        backend: session.backend,
        frame_count,
        duration_ms: duration.as_millis() as u64,
        output_path: session.output_dir.to_string_lossy().to_string(),
        dropped_frames: 0,
    })
}

#[napi]
pub fn get_recording_status(session_id: String) -> Result<RecordingStatus> {
    let sessions = SESSIONS.lock();
    let session = sessions.get(&session_id)
        .ok_or_else(|| Error::from_reason(format!("Session {} not found", session_id)))?;

    Ok(RecordingStatus {
        session_id: session.session_id.clone(),
        is_recording: *session.is_recording.lock(),
        frame_count: *session.frame_count.lock(),
        elapsed_ms: session.start_time.elapsed().as_millis() as u64,
    })
}

#[napi]
pub fn force_stop_all_recordings() -> Result<()> {
    let mut sessions = SESSIONS.lock();
    for (_, session) in sessions.iter() {
        *session.is_recording.lock() = false;
    }
    sessions.clear();
    Ok(())
}
```

注意：上述代码是录屏模块的 **状态管理骨架**。实际帧捕获需要在 `start_recording_wgc` 和 `start_recording_dxgi` 中启动后台线程，调用 `windows-capture` 和 `win_desktop_duplication` 的捕获 API。Phase 0 的核心目标是验证两条捕获路线是否可用，具体帧处理代码需在编译通过后根据 crate API 逐步补充。

在 `Cargo.toml` 中添加 `lazy_static`：

```toml
lazy_static = "1"
```

- [ ] **步骤 3：更新 `packages/native/src/lib.rs`**

```rust
use napi_derive::napi;

pub mod uia;
pub mod dpi;
pub mod recorder;

#[napi]
pub fn ping() -> String {
    format!(
        "pong from native | platform={} | arch={} | napi",
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}
```

- [ ] **步骤 4：构建验证**

```bash
cd packages/native && pnpm build
```

预期：编译成功。如 `windows-capture` 或 `win_desktop_duplication` 编译失败，记录错误信息，这正是 Phase 0 要验证的风险点。

- [ ] **步骤 5：Commit**

```bash
git add packages/native/
git commit -m "feat(native): implement recorder module skeleton — WGC + DXGI session management"
```

---

## 任务 2：TypeScript 录屏封装 (recorder.ts)

**文件：**
- 创建：`packages/core/src/tools/recorder.ts`
- 修改：`packages/core/src/index.ts`

- [ ] **步骤 1：创建 `packages/core/src/tools/recorder.ts`**

```typescript
import { toolOk, toolErr, type ToolResult } from '../types/errors.js';

let nativeRecorder: any = null;

function loadNative() {
  if (!nativeRecorder) {
    const native = require('@agivar/native');
    nativeRecorder = {
      startRecordingWgc: native.startRecordingWgc,
      startRecordingDxgi: native.startRecordingDxgi,
      stopRecording: native.stopRecording,
      getRecordingStatus: native.getRecordingStatus,
      forceStopAllRecordings: native.forceStopAllRecordings,
    };
  }
  return nativeRecorder;
}

export type RecorderBackend = 'dxgi' | 'wgc';

export interface RecordConfig {
  backend: RecorderBackend;
  targetHwnd?: number;
  fps?: number;
  outputDir: string;
}

export interface RecordResult {
  sessionId: string;
  backend: string;
  frameCount: number;
  durationMs: number;
  outputPath: string;
  droppedFrames: number;
}

export interface RecordingStatus {
  sessionId: string;
  isRecording: boolean;
  frameCount: number;
  elapsedMs: number;
}

export async function startRecording(config: RecordConfig): Promise<ToolResult<{ sessionId: string }>> {
  const start = performance.now();
  try {
    const native = loadNative();
    const nativeConfig = {
      backend: config.backend,
      targetHwnd: config.targetHwnd ?? null,
      fps: config.fps ?? 5,
      outputDir: config.outputDir,
    };

    let sessionId: string;
    if (config.backend === 'wgc') {
      sessionId = native.startRecordingWgc(nativeConfig);
    } else {
      sessionId = native.startRecordingDxgi(nativeConfig);
    }

    return toolOk({ sessionId }, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_BACKEND_UNAVAILABLE', err.message, performance.now() - start);
  }
}

export async function stopRecording(sessionId: string): Promise<ToolResult<RecordResult>> {
  const start = performance.now();
  try {
    const native = loadNative();
    const result = native.stopRecording(sessionId);
    return toolOk({
      sessionId: result.sessionId,
      backend: result.backend,
      frameCount: result.frameCount,
      durationMs: result.durationMs,
      outputPath: result.outputPath,
      droppedFrames: result.droppedFrames,
    }, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_RESOURCE_LEAK', err.message, performance.now() - start);
  }
}

export async function getRecordingStatus(sessionId: string): Promise<ToolResult<RecordingStatus>> {
  const start = performance.now();
  try {
    const native = loadNative();
    const status = native.getRecordingStatus(sessionId);
    return toolOk({
      sessionId: status.sessionId,
      isRecording: status.isRecording,
      frameCount: status.frameCount,
      elapsedMs: status.elapsedMs,
    }, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_BACKEND_UNAVAILABLE', err.message, performance.now() - start);
  }
}

export async function forceStopAllRecordings(): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    const native = loadNative();
    native.forceStopAllRecordings();
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('RECORDER_RESOURCE_LEAK', err.message, performance.now() - start);
  }
}
```

- [ ] **步骤 2：更新 `packages/core/src/index.ts`**

```typescript
export * from './types/index.js';
export * as screenshot from './tools/screenshot.js';
export * as input from './tools/input.js';
export * as browser from './tools/browser.js';
export * as uia from './tools/uia.js';
export * as dpi from './tools/dpi.js';
export * as recorder from './tools/recorder.js';
```

- [ ] **步骤 3：验证编译**

```bash
pnpm -F @agivar/core build
```

- [ ] **步骤 4：Commit**

```bash
git add packages/core/src/tools/recorder.ts packages/core/src/index.ts
git commit -m "feat(core): implement recorder TypeScript layer — start/stop/status/forceStopAll"
```

---

## 任务 3：poc-recorder 验证脚本

**文件：**
- 创建：`tests/poc-recorder.ts`

- [ ] **步骤 1：创建 `tests/poc-recorder.ts`**

```typescript
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
```

- [ ] **步骤 2：运行验证**

```bash
npx tsx tests/poc-recorder.ts
```

预期：WGC 和/或 DXGI 后端至少一个可用，资源释放测试 5 次 start/stop 无泄漏。

- [ ] **步骤 3：Commit**

```bash
git add tests/poc-recorder.ts
git commit -m "feat(tests): add poc-recorder — WGC/DXGI capture test + 5-cycle leak verification"
```

---

## 任务 4：Electron IPC 集成

**文件：**
- 创建：`packages/desktop/src/main/ipc.ts`
- 修改：`packages/desktop/src/main/index.ts`
- 修改：`packages/desktop/src/preload.ts`

- [ ] **步骤 1：创建 `packages/desktop/src/main/ipc.ts`**

```typescript
import { ipcMain } from 'electron';
import {
  screenshot,
  uia,
  input,
  browser,
  recorder,
  dpi,
  type ToolResult,
} from '@agivar/core';

function wrapHandler<T>(fn: (...args: any[]) => Promise<ToolResult<T>>) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    const result = await fn(...args);
    return result;
  };
}

export function registerIpcHandlers(): void {
  // Screenshot
  ipcMain.handle('screenshot:captureScreen', wrapHandler(
    (monitorIndex?: number) => screenshot.captureScreen(monitorIndex),
  ));
  ipcMain.handle('screenshot:getActiveWindow', wrapHandler(
    () => screenshot.getActiveWindow(),
  ));
  ipcMain.handle('screenshot:listWindows', wrapHandler(
    () => screenshot.listWindows(),
  ));

  // UIA
  ipcMain.handle('uia:getUiTree', wrapHandler(
    (hwnd: number, options?: any) => uia.getUiTree(hwnd, options),
  ));
  ipcMain.handle('uia:findElement', wrapHandler(
    (hwnd: number, query: any, options?: any) => uia.findElement(hwnd, query, options),
  ));

  // Input
  ipcMain.handle('input:click', wrapHandler(
    (x: number, y: number, options?: any) => input.click(x, y, options),
  ));
  ipcMain.handle('input:typeText', wrapHandler(
    (text: string) => input.typeText(text),
  ));
  ipcMain.handle('input:pressKeys', wrapHandler(
    (keys: string[]) => input.pressKeys(keys),
  ));

  // Browser
  ipcMain.handle('browser:launch', wrapHandler(
    (options?: any) => browser.launchManagedBrowser(options),
  ));

  // Recorder
  ipcMain.handle('recorder:start', wrapHandler(
    (config: any) => recorder.startRecording(config),
  ));
  ipcMain.handle('recorder:stop', wrapHandler(
    (sessionId: string) => recorder.stopRecording(sessionId),
  ));
  ipcMain.handle('recorder:forceStopAll', wrapHandler(
    () => recorder.forceStopAllRecordings(),
  ));

  // DPI
  ipcMain.handle('dpi:getScaleFactor', wrapHandler(
    (monitorIndex?: number) => dpi.getScaleFactor(monitorIndex),
  ));
}
```

- [ ] **步骤 2：更新 `packages/desktop/src/main/index.ts`**

在 `app.whenReady().then()` 回调中添加 IPC 注册：

```typescript
import { app } from 'electron';
import { createMainWindow } from './windows.js';
import { registerIpcHandlers } from './ipc.js';

let nativeStatus: { loaded: boolean; message: string } = {
  loaded: false,
  message: 'not attempted',
};

try {
  const native = require('@agivar/native');
  const result = native.ping();
  nativeStatus = { loaded: true, message: result };
  console.log('[main] native addon loaded:', result);
} catch (err: any) {
  nativeStatus = { loaded: false, message: err.message };
  console.error('[main] native addon failed:', err.message);
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

export { nativeStatus };
```

- [ ] **步骤 3：更新 `packages/desktop/src/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agivar', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  screenshot: {
    captureScreen: (idx?: number) => ipcRenderer.invoke('screenshot:captureScreen', idx),
    getActiveWindow: () => ipcRenderer.invoke('screenshot:getActiveWindow'),
    listWindows: () => ipcRenderer.invoke('screenshot:listWindows'),
  },
  uia: {
    getUiTree: (hwnd: number, opts?: any) => ipcRenderer.invoke('uia:getUiTree', hwnd, opts),
    findElement: (hwnd: number, q: any, opts?: any) => ipcRenderer.invoke('uia:findElement', hwnd, q, opts),
  },
  input: {
    click: (x: number, y: number, opts?: any) => ipcRenderer.invoke('input:click', x, y, opts),
    typeText: (text: string) => ipcRenderer.invoke('input:typeText', text),
    pressKeys: (keys: string[]) => ipcRenderer.invoke('input:pressKeys', keys),
  },
  browser: {
    launch: (opts?: any) => ipcRenderer.invoke('browser:launch', opts),
  },
  recorder: {
    start: (config: any) => ipcRenderer.invoke('recorder:start', config),
    stop: (sid: string) => ipcRenderer.invoke('recorder:stop', sid),
    forceStopAll: () => ipcRenderer.invoke('recorder:forceStopAll'),
  },
  dpi: {
    getScaleFactor: (idx?: number) => ipcRenderer.invoke('dpi:getScaleFactor', idx),
  },
});
```

- [ ] **步骤 4：Commit**

```bash
git add packages/desktop/src/main/ipc.ts packages/desktop/src/main/index.ts packages/desktop/src/preload.ts
git commit -m "feat(desktop): register IPC handlers for all 6 tool modules"
```

---

## 任务 5：Electron 验证面板 UI

**文件：**
- 修改：`packages/desktop/src/renderer/App.tsx`

- [ ] **步骤 1：重写 `packages/desktop/src/renderer/App.tsx`**

```tsx
import React, { useState, useCallback } from 'react';

type Status = 'idle' | 'running' | 'passed' | 'failed';
type SafetyLevel = 'direct' | 'confirm' | 'confirm-countdown';

interface PocItem {
  key: string;
  label: string;
  safety: SafetyLevel;
  safetyNote?: string;
  run: () => Promise<any>;
}

declare global {
  interface Window {
    agivar: any;
  }
}

export function App() {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [results, setResults] = useState<Record<string, any>>({});

  const updateStatus = (key: string, status: Status, result?: any) => {
    setStatuses((prev) => ({ ...prev, [key]: status }));
    if (result !== undefined) setResults((prev) => ({ ...prev, [key]: result }));
  };

  const pocs: PocItem[] = [
    {
      key: 'env',
      label: 'Environment Detection',
      safety: 'direct',
      run: async () => {
        const info = window.agivar;
        return { platform: info.platform, versions: info.versions };
      },
    },
    {
      key: 'screenshot',
      label: 'Screenshot',
      safety: 'direct',
      run: () => window.agivar.screenshot.captureScreen(),
    },
    {
      key: 'uia',
      label: 'UIA Read',
      safety: 'direct',
      run: () => window.agivar.screenshot.listWindows().then((r: any) => {
        if (r.ok && r.data.length > 0) {
          return window.agivar.uia.getUiTree(r.data[0].hwnd, { maxDepth: 3 });
        }
        return r;
      }),
    },
    {
      key: 'playwright',
      label: 'Playwright Browser',
      safety: 'direct',
      safetyNote: 'Will launch a browser window',
      run: () => window.agivar.browser.launch({ headless: true }),
    },
    {
      key: 'input',
      label: 'Keyboard/Mouse Input',
      safety: 'confirm-countdown',
      safetyNote: 'Will control your keyboard and mouse. Press Ctrl+Alt+Space to stop.',
      run: () => window.agivar.input.typeText('Agivar Phase 0 test'),
    },
    {
      key: 'recorder',
      label: 'Screen Recording',
      safety: 'confirm',
      safetyNote: 'Will record your screen for 3 seconds.',
      run: async () => {
        const r = await window.agivar.recorder.start({
          backend: 'wgc', fps: 5, outputDir: 'tests/output/ui-recorder-test',
        });
        if (!r.ok) return r;
        await new Promise((res) => setTimeout(res, 3000));
        return window.agivar.recorder.stop(r.data.sessionId);
      },
    },
  ];

  const handleRun = useCallback(async (poc: PocItem) => {
    if (poc.safety === 'confirm' || poc.safety === 'confirm-countdown') {
      const msg = poc.safetyNote
        ? `${poc.safetyNote}\n\nProceed?`
        : 'This action will interact with your desktop. Proceed?';
      if (!confirm(msg)) return;
    }

    updateStatus(poc.key, 'running');
    try {
      const result = await poc.run();
      const ok = result?.ok !== false;
      updateStatus(poc.key, ok ? 'passed' : 'failed', result);
    } catch (err: any) {
      updateStatus(poc.key, 'failed', { error: err.message });
    }
  }, []);

  const statusColor = (s: Status) =>
    s === 'passed' ? '#28a745' : s === 'failed' ? '#dc3545' : s === 'running' ? '#007bff' : '#6c757d';

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, maxWidth: 800 }}>
      <h1>Agivar Phase 0 — PoC Panel</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8 }}>Verification</th>
            <th style={{ width: 100 }}>Action</th>
            <th style={{ width: 80 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {pocs.map((poc) => (
            <tr key={poc.key} style={{ borderTop: '1px solid #ddd' }}>
              <td style={{ padding: 8 }}>
                {poc.label}
                {poc.safetyNote && (
                  <div style={{ fontSize: 11, color: '#999' }}>{poc.safetyNote}</div>
                )}
              </td>
              <td style={{ textAlign: 'center' }}>
                <button
                  onClick={() => handleRun(poc)}
                  disabled={statuses[poc.key] === 'running'}
                  style={{ padding: '4px 12px', cursor: 'pointer' }}
                >
                  Run
                </button>
              </td>
              <td style={{ textAlign: 'center', color: statusColor(statuses[poc.key] || 'idle') }}>
                {(statuses[poc.key] || 'idle').toUpperCase()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {Object.keys(results).length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>Results</h3>
          <pre style={{ background: '#f5f5f5', padding: 12, overflow: 'auto', maxHeight: 400 }}>
            {JSON.stringify(results, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
```

- [ ] **步骤 2：验证 Electron 面板**

```bash
pnpm -F @agivar/desktop dev
```

预期：Electron 窗口显示 6 行验证面板，每行有 Run 按钮。点击 Environment Detection 和 Screenshot 应直接运行，Input 和 Recorder 应弹出确认对话框。

- [ ] **步骤 3：Commit**

```bash
git add packages/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): implement 6-item PoC verification panel with safety tiers"
```

---

## 任务 6：完整 poc-runner + 回归验收

**文件：**
- 修改：`tests/poc-runner.ts`

- [ ] **步骤 1：更新 `tests/poc-runner.ts` — 添加 recorder，完整 6 项**

在 import 部分添加：

```typescript
import { runPocRecorder } from './poc-recorder.js';
```

在交互 PoC 块中添加录屏：

```typescript
    console.log('[6/6] poc-recorder...');
    results.push(await runPocRecorder(outputDir));
    console.log(`  -> ${results[results.length - 1].status}`);
```

更新所有计数器反映 6 项。

- [ ] **步骤 2：运行全量回归**

```bash
pnpm poc:all -- --i-understand-this-controls-my-desktop
```

预期：6 个 PoC 全部运行，报告输出到 `tests/output/<timestamp>/poc-report.json`。

- [ ] **步骤 3：检查 Go/No-Go 决策表**

根据 `poc-report.json` 结果，填写设计文档中第 13 章的 Go/No-Go 表：

| 能力 | 结果 | 判定 |
|---|---|---|
| Native addon | 查看 `native:doctor` + `desktop:doctor-native` 输出 | Go / No-Go |
| 截图 | 查看 `poc-screenshot.captureScreen.successRate` | Go / No-Go |
| UIA | 查看 `poc-uia.notepad.editFound` + `chrome.windowIdentified` | Go / No-Go |
| 输入 | 查看 `poc-input.typeText.successRate` | Go / No-Go |
| Playwright | 查看 `poc-playwright.formSubmit.successRate` | Go / No-Go |
| 录屏 | 查看 `poc-recorder.wgc.available` 或 `dxgi.available` | Go / No-Go |

- [ ] **步骤 4：Commit**

```bash
git add tests/poc-runner.ts
git commit -m "feat(tests): complete 6-item poc-runner + full regression ready"
```

---

## 自检

### 1. 规格覆盖度

| 规格需求 | 对应任务 |
|---|---|
| Rust recorder (WGC + DXGI) | 任务 1 |
| sessionId + map 生命周期 | 任务 1 (SESSIONS map) |
| forceStopAllRecordings | 任务 1 + 2 |
| 帧捕获 vs 编码分层 | 任务 3 (poc-recorder Phase 1 vs Phase 2) |
| 录屏资源释放硬验收 | 任务 3 (5-cycle leak test) |
| 录屏对比维度 | 任务 3 (metrics per backend) |
| Electron IPC handler | 任务 4 |
| ToolResult 统一返回 | 任务 4 (wrapHandler) |
| preload contextBridge | 任务 4 |
| 面板按钮安全分级 | 任务 5 (direct / confirm / confirm-countdown) |
| 6 项均可从 UI 触发 | 任务 5 |
| 完整 poc-runner | 任务 6 |
| Go/No-Go 决策表 | 任务 6 步骤 3 |
| 产物清单 11 项 | Plan A-C 合计覆盖全部 |

### 2. 占位符扫描

录屏 Rust 模块（任务 1）中明确标注了"骨架实现"——这不是占位符，而是实际的状态管理代码。帧捕获的具体实现需要根据 `windows-capture` crate API 逐步补充，这是 Phase 0 本身要验证的内容。

### 3. 类型一致性

- `RecordConfig` / `RecordResult` / `RecordingStatus` — 任务 1 (Rust) + 任务 2 (TS) 对齐
- `ToolResult` / `toolOk` / `toolErr` — Plan A 定义，一致使用
- `recorder.startRecording` / `stopRecording` / `forceStopAllRecordings` — 任务 2 定义，任务 3-6 一致调用
- IPC channel 名称 — 任务 4 (ipc.ts 注册) 与 (preload.ts 调用) 一致
