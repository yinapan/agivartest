# IPC 与多窗口架构设计手册

> 参考 Agivar 反编译的 131 通道 + 5 窗口架构
> 适配我们项目的阶段路线图

---

## 一、IPC 通道完整分类与迁移计划

### 1.1 Agivar 通道分类 ← 我们的迁移状态

#### 基础与窗口（Agivar: 8 通道 | 我们：已部分实现）

| Agivar 通道 | 我们的对应 | 状态 |
|---|---|---|
| `ping` | `app:ping` | **已有** |
| `window:is_maximized` | — | **需新增** |
| `window:minimize` | — | **需新增** |
| `window:maximize_toggle` | — | **需新增** |
| `window:close` | — | **需新增** |
| `window:maximized_changed` | — | **需新增** |
| `shell:open_external` | — | **Phase 2 新增** |
| `media:open_local_image` | — | **Phase 3 新增** |

#### 聊天 / Agent（Agivar: 17 通道 | 我们：已部分实现）

| Agivar 通道 | 我们的对应 | 状态 |
|---|---|---|
| `chat:list` | `agent:session-list` | **已有** |
| `chat:create` | `agent:session-create` | **已有** |
| `chat:open` | `agent:session-open` | **已有** |
| `chat:delete` | `agent:session-delete` | **已有** |
| `chat:send` | `agent:run` | **已有** |
| `chat:stop` | `agent:stop` | **已有** |
| `chat:event` | `agent:event` | **已有** |
| `chat:resume` | `agent:takeover-resume` | **已有** |
| `chat:title` | — | **Phase 2 新增** |
| `chat:set_mode` | — | **Phase 2 新增** |
| `chat:set_model` | — | **Phase 4 新增** |
| `chat:mcp_task_created` | — | **后置** |
| `chat:user_message_added` | — | **Phase 2 新增** |

#### 录屏（Agivar: ~45 通道 | 我们：基础框架已搭建）

| Agivar 通道分组 | 我们的状态 |
|---|---|
| **核心录制** (start/stop/cancel/discard_prev/state/get_state) | Phase 3 实现中 |
| **录制条** (bar_action/set_interactive/drag_start/drag_end/drag_move/set_position/get_bounds/resize/resize_ack/count) | Phase 4A+ |
| **音频** (mic_capture/audio_pcm) | Phase 4B+ |
| **注释** (annotation_submit/edit/delete + voice variants) | Phase 4B+ |
| **说明** (explain_show/hide/submit/edit/delete/cancel) | Phase 4B+ |
| **面板** (panel_state/submit/edit/delete/history_expanded/close/resize) | Phase 4B+ |
| **帧数据** (frame_meta/frame) | Phase 3 实现中 |
| **处理控制** (cancel_processing/reprocess) | Phase 4B+ |
| **语音标注热键** (voice_toggle_hotkey/voice_draft) | Phase 4B+ |
| **录制历史** (recordings:list/rename/delete/frame_meta/frame) | Phase 4C+ |

#### 设置与权限（Agivar: ~18 通道 | 我们：基础框架）

| Agivar 通道 | 我们的状态 |
|---|---|
| `settings:get_language` / `set_language` / `language_changed` | Phase 4+ |
| `settings:get/set_developer_code` / `is_developer_mode` | **可移除（内部调试）** |
| `settings:get/set_streamer_mode` | Phase 4A+ |
| `settings:list_screen_scopes` / `screen_scopes_changed` / `get/set_selected_screen_scope` / `get_screen_scope_lock` | Phase 4A+ |
| `settings:get/set_preferred_model` | Phase 4+ |
| `settings:clear_cache` | Phase 2+ |
| `settings:get_data_root_parent` / `pick_data_root_directory` / `set_data_root_parent` | Phase 2+ |
| `permissions:check_required` / `open_settings` / `ensure_microphone` | Phase 3+ |

#### 商业化（Agivar: ~14 通道 | 我们：全部后置）

`payment:*`, `phone:*`, `credit:*` — **不进入 Phase 1-4 主路径**

#### 更新（Agivar: 5 通道 | 我们：全部后置）

`update:*` — **阶段 4 以后**

#### 埋点（Agivar: 2 通道 | 我们：后置）

`analytics:button_click`, `analytics:task_control` — **后续评估**

---

## 二、IPC 实现规范

### 2.1 通道定义文件

所有 IPC 通道在单一文件中定义，不允许在各 service 中使用字符串字面量：

```typescript
// packages/desktop/src/shared/ipc-channels.ts

/**
 * IPC 通道常量 — 唯一权威来源
 * 
 * 命名规范：
 *   domain:action — 使用 kebab-case（Agivar 风格）
 *   事件通道加 -changed 后缀
 * 
 * 添加新通道时：
 *   1. 在此文件按域分组添加
 *   2. 确保 handler 和 renderer 端引用同一个常量
 *   3. 更新本文件顶部的通道计数
 */
export const IPC = {
  // ====== 基础（Phase 0+）======
  PING: 'app:ping',

  // ====== 窗口（Phase 1+）======
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE_TOGGLE: 'window:maximize-toggle',
  WINDOW_CLOSE: 'window:close',
  WINDOW_MAXIMIZED_CHANGED: 'window:maximized-changed',

  // ====== Agent / 聊天（Phase 1+）======
  AGENT_SESSION_LIST: 'agent:session-list',
  AGENT_SESSION_CREATE: 'agent:session-create',
  AGENT_SESSION_OPEN: 'agent:session-open',
  AGENT_SESSION_DELETE: 'agent:session-delete',
  AGENT_SESSION_TITLE: 'agent:session-title',
  AGENT_RUN: 'agent:run',
  AGENT_STOP: 'agent:stop',
  AGENT_EVENT: 'agent:event',
  AGENT_TAKEOVER_RESUME: 'agent:takeover-resume',

  // ====== 录屏核心（Phase 3+）======
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  RECORDING_CANCEL: 'recording:cancel',
  RECORDING_DISCARD_PREV: 'recording:discard-prev',
  RECORDING_STATE_CHANGED: 'recording:state-changed',
  RECORDING_GET_STATE: 'recording:get-state',
  RECORDING_FRAME_META: 'recording:frame-meta',
  RECORDING_FRAME: 'recording:frame',

  // ====== 录制条（Phase 4A+）======
  RECORDING_BAR_ACTION: 'recording:bar-action',
  RECORDING_BAR_SET_INTERACTIVE: 'recording:bar-set-interactive',
  RECORDING_BAR_DRAG_START: 'recording:bar-drag-start',
  RECORDING_BAR_DRAG_END: 'recording:bar-drag-end',
  RECORDING_BAR_SET_POSITION: 'recording:bar-set-position',
  RECORDING_BAR_GET_BOUNDS: 'recording:bar-get-bounds',
  RECORDING_BAR_RESIZE: 'recording:bar-resize',
  RECORDING_BAR_COUNT: 'recording:bar-count',

  // ====== 注释与说明（Phase 4B+）======
  RECORDING_ANNOTATION_SUBMIT: 'recording:annotation-submit',
  RECORDING_ANNOTATION_EDIT: 'recording:annotation-edit',
  RECORDING_ANNOTATION_DELETE: 'recording:annotation-delete',
  RECORDING_EXPLAIN_SHOW: 'recording:explain-show',
  RECORDING_EXPLAIN_HIDE: 'recording:explain-hide',
  RECORDING_EXPLAIN_SUBMIT: 'recording:explain-submit',

  // ====== 录制面板（Phase 4B+）======
  RECORDING_PANEL_STATE: 'recording:panel-state',
  RECORDING_PANEL_SUBMIT: 'recording:panel-submit',
  RECORDING_PANEL_EDIT: 'recording:panel-edit',
  RECORDING_PANEL_DELETE: 'recording:panel-delete',
  RECORDING_PANEL_CLOSE: 'recording:panel-close',

  // ====== 录制处理控制（Phase 4B+）======
  RECORDING_CANCEL_PROCESSING: 'recording:cancel-processing',
  RECORDING_REPROCESS: 'recording:reprocess',

  // ====== 录制历史（Phase 4C+）======
  RECORDINGS_LIST: 'recordings:list',
  RECORDINGS_RENAME: 'recordings:rename',
  RECORDINGS_DELETE: 'recordings:delete',
  RECORDINGS_FRAME_META: 'recordings:frame-meta',
  RECORDINGS_FRAME: 'recordings:frame',

  // ====== 设置（Phase 2+）======
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed',

  // ====== 通用（Phase 2+）======
  SHELL_OPEN_EXTERNAL: 'shell:open-external',

  // ====== 更新（Stage 4+）======
  UPDATE_CHECK: 'update:check',
  UPDATE_INSTALL: 'update:install',
  UPDATE_AVAILABLE: 'update:available',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
```

### 2.2 Preload 端类型安全

```typescript
// packages/desktop/src/preload/index.ts

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

type IpcInvokers = {
  [IPC.PING]: () => Promise<string>;
  [IPC.WINDOW_MINIMIZE]: () => Promise<void>;
  [IPC.WINDOW_MAXIMIZE_TOGGLE]: () => Promise<void>;
  [IPC.WINDOW_CLOSE]: () => Promise<void>;
  [IPC.AGENT_RUN]: (opts: { goal: string; sessionId: string }) => Promise<void>;
  [IPC.AGENT_STOP]: () => Promise<void>;
  [IPC.RECORDING_START]: (opts: RecordStartOpts) => Promise<{ sessionId: string }>;
  [IPC.RECORDING_STOP]: (sessionId: string) => Promise<RecordResult>;
  // ... 后续阶段按需添加
};

type IpcListeners = {
  [IPC.AGENT_EVENT]: (callback: (event: AgentEvent) => void) => () => void;
  [IPC.RECORDING_STATE_CHANGED]: (callback: (state: RecordingState) => void) => () => void;
  [IPC.SETTINGS_CHANGED]: (callback: (settings: Settings) => void) => () => void;
  [IPC.UPDATE_AVAILABLE]: (callback: (info: UpdateInfo) => void) => () => void;
};

const api = {
  invoke: {} as Record<string, (...args: any[]) => Promise<any>>,
  on: {} as Record<string, (callback: (...args: any[]) => void) => () => void>,
};

// 构建 invoke 方法
for (const [_, channel] of Object.entries(IPC)) {
  api.invoke[channel] = (...args: any[]) => ipcRenderer.invoke(channel, ...args);
}

// 构建事件监听
const eventChannels = new Set([
  IPC.AGENT_EVENT,
  IPC.RECORDING_STATE_CHANGED,
  IPC.SETTINGS_CHANGED,
  IPC.UPDATE_AVAILABLE,
]);

for (const ch of eventChannels) {
  api.on[ch] = (callback: (...args: any[]) => void) => {
    const listener = (_: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(ch, listener);
    return () => ipcRenderer.removeListener(ch, listener);
  };
}

contextBridge.exposeInMainWorld('api', api);
```

### 2.3 主进程 Handler 注册

```typescript
// packages/desktop/src/main/services/recording-service.ts

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { RecordingSession } from '@agivar/core';

// 全局状态（不是每个窗口一份）
const sessions = new Map<string, RecordingSession>();
let mainWindow: BrowserWindow | null = null;

export function registerRecordingService(getWindows: () => { main: BrowserWindow | null }) {
  ipcMain.handle(IPC.RECORDING_START, async (_, opts) => {
    const session = await startRecordingSession(opts);
    sessions.set(session.id, session);
    broadcastState(session);
    return { sessionId: session.id };
  });

  ipcMain.handle(IPC.RECORDING_STOP, async (_, sessionId) => {
    const result = await stopRecordingSession(sessionId);
    sessions.delete(sessionId);
    broadcastState(null);
    return result;
  });

  ipcMain.handle(IPC.RECORDING_CANCEL, async (_, sessionId) => {
    await cancelRecordingSession(sessionId);
    sessions.delete(sessionId);
    broadcastState(null);
  });

  ipcMain.handle(IPC.RECORDING_GET_STATE, async (_, sessionId) => {
    return sessions.get(sessionId) ?? null;
  });
}

function broadcastState(session: RecordingSession | null) {
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.RECORDING_STATE_CHANGED, session ? serializeSession(session) : null);
  }
}
```

---

## 三、多窗口架构设计

### 3.1 窗口注册表

```typescript
// packages/desktop/src/main/window-registry.ts

import { BrowserWindow } from 'electron';

interface WindowEntry {
  id: string;
  type: 'main' | 'recording-bar' | 'capture' | 'overlay-todo' | 'overlay-gradient';
  window: BrowserWindow;
  phase: number;
  htmlPage: string;
}

const windows = new Map<string, WindowEntry>();

export function registerWindow(entry: WindowEntry) {
  windows.set(entry.id, entry);
  entry.window.on('closed', () => windows.delete(entry.id));
}

export function getWindow(id: string): BrowserWindow | undefined {
  return windows.get(id)?.window;
}

export function getWindowsOfType(type: WindowEntry['type']): BrowserWindow[] {
  return [...windows.values()]
    .filter(e => e.type === type)
    .map(e => e.window);
}

export function broadcastToMain(event: string, ...args: unknown[]) {
  for (const entry of windows.values()) {
    if (entry.type === 'main' && !entry.window.isDestroyed()) {
      entry.window.webContents.send(event, ...args);
    }
  }
}

export function getAllWindows(): BrowserWindow[] {
  return [...windows.values()].map(e => e.window).filter(w => !w.isDestroyed());
}
```

### 3.2 各阶段窗口矩阵

| 阶段 | 窗口 | 类型 | 特性 |
|---|---|---|---|
| Phase 1 | Main | 标准窗口 | 聊天、任务输入、设置 |
| Phase 3 | Main | 标准窗口 | + 嵌入式录制面板 |
| Phase 4A | Main + RecordingBar | Main 可调大小 + 录制条浮窗 | RecordingBar: 无边框/透明/置顶 |
| Phase 4B | Main + RecordingBar + 面板 | + 注释输入浮窗 | 面板: 可拖动/可调大小 |
| Phase 4C | Main + RecordingBar + Capture + OverlayTodo | + 捕获预览 + 任务进度 | 全窗口矩阵 |

### 3.3 RecordingBar 窗口创建模板

```typescript
// packages/desktop/src/main/windows/recording-bar.ts

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { registerWindow } from '../window-registry';

const BAR_WIDTH = 320;
const BAR_HEIGHT = 48;

export function createRecordingBarWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  const win = new BrowserWindow({
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    x: Math.round((screenWidth - BAR_WIDTH) / 2),
    y: 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 保持置顶但不抢夺焦点
  win.setAlwaysOnTop(true, 'screen-saver');
  // Windows: 设置工具窗口样式，不在 Alt+Tab 中显示
  win.setVisibleOnAllWorkspaces(true);

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173/pages/recording-bar/');
  } else {
    win.loadFile(join(__dirname, '../renderer/pages/recording_bar/index.html'));
  }

  registerWindow({
    id: 'recording-bar',
    type: 'recording-bar',
    window: win,
    phase: 4,
    htmlPage: 'recording_bar',
  });

  return win;
}
```

---

## 四、Agivar 录屏状态机参考

### 4.1 状态转换（从 IPC 推断）

```
                    ┌─→ cancel ─→ [DISCARDED]
                    │
[IDLE] ──start──→ [RECORDING] ──stop──→ [PROCESSING] ──complete──→ [READY]
                     │                      │
                     │                      ├─→ cancel_processing ─→ [DISCARDED]
                     │                      └─→ error ─→ [FAILED]
                     │
                     └─→ discard_prev ─→ [IDLE] (丢弃上次录制)
```

### 4.2 我们的状态机实现

```typescript
// packages/core/src/tools/recording-state-machine.ts

export type RecordingPhase =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'discarded';

export interface RecordingState {
  phase: RecordingPhase;
  sessionId: string | null;
  startedAt: number | null;
  durationMs: number;
  frameCount: number;
  annotations: Annotation[];
  error: string | null;
}

export class RecordingStateMachine {
  private state: RecordingState = {
    phase: 'idle',
    sessionId: null,
    startedAt: null,
    durationMs: 0,
    frameCount: 0,
    annotations: [],
    error: null,
  };

  private listeners: Set<(state: RecordingState) => void> = new Set();

  getState(): Readonly<RecordingState> {
    return this.state;
  }

  subscribe(fn: (state: RecordingState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  transition(next: Partial<RecordingState> & { phase: RecordingPhase }): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(fn => fn(this.state));
  }

  canStart(): boolean {
    return this.state.phase === 'idle' || this.state.phase === 'discarded';
  }

  canStop(): boolean {
    return this.state.phase === 'recording';
  }

  canCancel(): boolean {
    return this.state.phase === 'recording' || this.state.phase === 'processing';
  }
}
```

---

## 五、关键实现注意事项

### 5.1 录制 ID 分配

Agivar 使用 `/api/v1/recording/allocate_id` 从服务端预分配 ID。我们第一版本地运行，使用本地 nanoid：

```typescript
import { nanoid } from 'nanoid';
const recordingId = `rec_${nanoid(12)}`;
```

### 5.2 录制资源清理

必须实现全局清理函数（参考 Agivar 的 `forceStopAllRecordings()`）：

```typescript
// packages/core/src/tools/recorder.ts
export async function forceCleanupAllRecordings(): Promise<void> {
  const ids = [...captureSessions.keys()];
  for (const id of ids) {
    try {
      await stopRecording(id);
    } catch {
      // 确保即使单个失败也继续清理其他
    }
  }
  loadNative().forceStopAllRecordings();
}
```

在以下时机调用：
- `app.on('before-quit')`
- `app.on('window-all-closed')`
- 全局热键紧急停止

### 5.3 Frame 数据流模式

**推荐的分层设计**：

```
渲染层                           主进程
  │                               │
  │── recording:start ──────────→│ 创建录制会话
  │                               │ 启动帧捕获循环
  │←── recording:state-changed ──│ 状态更新事件
  │                               │
  │←── recording:frame-meta ────│ 帧元数据 (id, ts, type)
  │                               │
  │── recording:frame ──────────→│ 按需请求帧数据
  │←── recording:frame ──────────│ 返回 base64/路径
```

> 关键：不要每次推送完整帧数据到渲染层。先推元数据，UI 需要展示时才请求具体帧。

---

## 六、与落地方案的映射关系

| 落地方案章节 | 本手册参考 | 说明 |
|---|---|---|
| §3.1 MVP 架构图 | IPC 通道定义 + 窗口架构 | 补充了详细的 IPC 命名规范 |
| §3.2 客户端架构 | 多窗口注册表 + Service 注册 | 补充了窗口管理框架 |
| §6.1 录屏引擎 | 录制状态机 + Frame 数据流 | 补充了完整的状态转换定义 |
| §6.3 Computer Use 执行引擎 | 窗口矩阵 | 补充了浮窗与主窗口的交互模式 |
| §6.6 统一工具接口 | Preload API 设计 | 补充了类型安全的 API 暴露方式 |
| Phase 3 设计 | 录制管线参考 | 补充了归档、同步、迁移的完整链路 |
| Phase 4A+ 设计 | RecordingBar 模板 + 窗口注册表 | 补充了精确的实现模板 |