# Phase 4E 候选：Agivar 关键发现 Hardening 设计

> **关联文档**：
> - [agivar-reverse-engineering-insights.md](../../agivar-reverse-engineering-insights.md) — 反编译架构洞察
> - [phase4d-recording-attachment-data-model.md](../../phase4d-recording-attachment-data-model.md) — 录屏附件数据模型
> - [recording-storage-lifecycle-design.md](../../recording-storage-lifecycle-design.md) — 录制存储生命周期
> - [phase4d-agivar-like-chat-recording-ux-design.md](./2026-06-24-phase4d-agivar-like-chat-recording-ux-design.md) — Phase 4D UX 设计

## 背景

从 Agivar v1.2.0.721 反编译和三个设计文档的分析中，提取了 6 项工程 hardening 改进。它们不进入 Phase 4D 聊天录屏 UX 的主线实现，作为 Phase 4D 完成后的 Phase 4E / hardening 候选。

核心原则：**非破坏性迁移**。Phase 4C 已跑通的真实录屏链路不能因本次改动而中断。

与 Phase 4D 的关系：

- Phase 4D 以 `docs/superpowers/plans/2026-06-24-phase4d-agivar-like-chat-recording-ux.md` 为准，定位为 renderer 体验层和录屏链路编排层。
- Phase 4D 不做 IPC 全量常量化、`recordingTeach:*` 重命名、新增主进程事件、service 注册重构、单实例锁、`EnvConfig` 全覆盖。
- 本文只记录后续 hardening 候选项，不能作为 Phase 4D 实施计划的前置条件。

## 执行路径

采用路径 A：Phase 4D 先行，Phase 4E / hardening 后置。

- 当前优先完成 Agivar-like 聊天录屏 UX，让 Phase 4C 已验证的真实录屏链路作为聊天附件被消费。
- 本文记录的 6 项基础设施改进在 Phase 4D closure 后单独开阶段或分支处理。
- 若后续进入 Phase 4E，必须保持非破坏性迁移：保留现有 `recordingTeach:*` 通道值，先做常量化和兼容层，再考虑任何重命名。

## 范围

后续 hardening 阶段可考虑对 `@agivar/desktop` 共 7 个文件进行修改（3 新建 + 4 修改），覆盖：

1. IPC 通道常量化 —— 提取到 `IpcChannels`，保留现有通道名（P0）
2. 录制状态事件推送（P0，Phase 4D 后置）
3. 录制附件数据模型增强（P1）
4. 环境变量完整覆盖（P1）
5. 单实例锁（P2）
6. Service 注册模式重构（P2）

## 非目标

- 不重命名 `recordingTeach:*` 为 `recording:*`（破坏性变更，后续单独迁移）
- 不新增 MemoryStore 方法（`platform` 与 `appName` 关系待明确）
- 不新增任何 IPC handler 功能逻辑
- 不改变现有录制生命周期行为
- 不修改 `@agivar/core` 包
- 不修改 Rust native 模块
- 不作为 Phase 4D 的实施范围
- 不阻塞 Phase 4D 聊天录屏 UX

## 实施分层

### 第一层（零依赖、纯新增）

可以并行创建，不依赖任何现有代码的修改：

| # | 文件 | 操作 | 内容 |
|---|------|------|------|
| 1 | `packages/desktop/src/shared/ipc-channels.ts` | 新建 | 所有 IPC 通道常量，按域分组，`as const` |
| 2 | `packages/desktop/src/shared/env.ts` | 新建 | 环境变量配置读取，集中导出 |
| 3 | `packages/desktop/src/renderer/features/chat-recording/chat-recording-model.ts` | 新建或复用 | `ChatRecordingAttachment` 类型 + `mergeRecordingAttachments` + `RecordingStatePayload` |

### 第二层（依赖第一层的修改）

| # | 文件 | 操作 | 依赖 |
|---|------|------|------|
| 4 | `packages/desktop/src/main/ipc.ts` | 修改 | ipc-channels.ts |
| 5 | `packages/desktop/src/main/recording-teach-ipc.ts` | 修改 | ipc-channels.ts |
| 6 | `packages/desktop/src/preload.ts` | 修改 | ipc-channels.ts |
| 7 | `packages/desktop/src/main/index.ts` | 修改 | ipc-channels.ts, env.ts |

---

## 一、IPC 通道常量文件

### 文件：`packages/desktop/src/shared/ipc-channels.ts`（新建）

将硬编码通道字符串提取为常量。**保留现有通道名不变**，只为现有 camelCase 通道提供 kebab-case 别名作为未来迁移目标：

```typescript
export const IpcChannels = {
  Screenshot: {
    CAPTURE_SCREEN: 'screenshot:captureScreen',
    GET_ACTIVE_WINDOW: 'screenshot:getActiveWindow',
    LIST_WINDOWS: 'screenshot:listWindows',
  },
  Uia: {
    GET_UI_TREE: 'uia:getUiTree',
    FIND_ELEMENT: 'uia:findElement',
  },
  Input: {
    CLICK: 'input:click',
    TYPE_TEXT: 'input:typeText',
    PRESS_KEYS: 'input:pressKeys',
  },
  Browser: {
    LAUNCH: 'browser:launch',
  },
  Recorder: {
    START: 'recorder:start',
    STOP: 'recorder:stop',
    FORCE_STOP_ALL: 'recorder:forceStopAll',
  },
  Agent: {
    RUN_TASK: 'agent:runTask',
    ABORT: 'agent:abort',
    RESUME_TAKEOVER: 'agent:resumeTakeover',
    SELECT_MEMORY: 'agent:selectMemory',
    EVENT: 'agent:event',
  },
  Memory: {
    IMPORT: 'memory:import',
    TEACH_TEXT: 'memory:teachText',
    VALIDATE_DRAFT: 'memory:validateDraft',
    SAVE_DRAFT: 'memory:saveDraft',
    UPDATE: 'memory:update',
    LIST_VERSIONS: 'memory:listVersions',
    GET_VERSION: 'memory:getVersion',
    ROLLBACK: 'memory:rollback',
    LIST: 'memory:list',
    GET: 'memory:get',
    DELETE: 'memory:delete',
  },
  Session: {
    LIST: 'session:list',
    CREATE: 'session:create',
    DELETE: 'session:delete',
    GET_MESSAGES: 'session:getMessages',
  },
  RecordingTeach: {
    START: 'recordingTeach:start',
    STOP: 'recordingTeach:stop',
    STATUS: 'recordingTeach:status',
    GET_TIMELINE: 'recordingTeach:getTimeline',
    LIST_SESSIONS: 'recordingTeach:listSessions',
    UPDATE_SESSION_METADATA: 'recordingTeach:updateSessionMetadata',
    LIST_PROVIDERS: 'recordingTeach:listProviders',
    BUILD_MANIFEST: 'recordingTeach:buildManifest',
    GENERATE_DRAFT: 'recordingTeach:generateDraft',
    GENERATION_STATUS: 'recordingTeach:generationStatus',
    CANCEL_DRAFT_GENERATION: 'recordingTeach:cancelDraftGeneration',
    RETRY_DRAFT_GENERATION: 'recordingTeach:retryDraftGeneration',
    REPROCESS_DRAFT: 'recordingTeach:reprocessDraft',
    DISCARD: 'recordingTeach:discard',
    PREFLIGHT: 'recordingTeach:preflight',
    CLEANUP_ORPHANS: 'recordingTeach:cleanupOrphans',
    RESUME_DRAFT: 'recordingTeach:resumeDraft',
    STATE_CHANGED: 'recordingTeach:stateChanged',
  },
  Settings: {
    GET: 'settings:get',
    UPDATE: 'settings:update',
    GET_API_KEY_MASK: 'settings:getApiKeyMask',
    SET_API_KEY: 'settings:setApiKey',
  },
  Dpi: {
    GET_SCALE_FACTOR: 'dpi:getScaleFactor',
  },
} as const;
```

所有常量值等于现有硬编码字符串，纯提取，无行为变更。

---

## 二、录制状态事件推送（Phase 4D 后置）

> Phase 4D 明确不新增主进程 IPC 事件。本节为 Phase 4E / hardening 候选，不应并入 Phase 4D 实施任务。

### 改动文件：`packages/desktop/src/main/recording-teach-ipc.ts`

在每个状态变更函数末尾调用 `emitStateChanged()`：

```typescript
import { IpcChannels } from '../shared/ipc-channels.js';

function emitStateChanged(state: {
  sessionId: string;
  status:
    | 'recording'
    | 'stopped'
    | 'manifesting'
    | 'manifest_ready'
    | 'generating'
    | 'draft_ready'
    | 'failed'
    | 'discarded';
  progress?: number;
  error?: string;
  updatedAt: string;
}) {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    win.webContents.send(IpcChannels.RecordingTeach.STATE_CHANGED, state);
  }
}
```

触发点：`start`、`stop`、`buildManifest` 开始/完成、`generateDraft` 开始/完成/失败、`cancel`、`discard`。所有成功和失败路径都必须 emit。

### 改动文件：`packages/desktop/src/preload.ts`

暴露 `onRecordingStateChanged` 返回 unsubscribe 函数：

```typescript
import { IpcChannels } from './shared/ipc-channels.js';

onRecordingStateChanged: (cb: (s: RecordingStatePayload) => void) => {
  const handler = (_e: IpcRendererEvent, s: RecordingStatePayload) => cb(s);
  ipcRenderer.on(IpcChannels.RecordingTeach.STATE_CHANGED, handler);
  return () => ipcRenderer.removeListener(IpcChannels.RecordingTeach.STATE_CHANGED, handler);
}
```

### RecordingStatePayload 类型

定义在 `chat-recording-model.ts`，main 和 preload 共享：

```typescript
export type RecordingStatePayload = {
  sessionId: string;
  status:
    | 'recording'
    | 'stopped'
    | 'manifesting'
    | 'manifest_ready'
    | 'generating'
    | 'draft_ready'
    | 'failed'
    | 'discarded';
  progress?: number;
  error?: string;
  updatedAt: string;
};
```

---

## 三、录制附件数据模型增强

### 文件：`packages/desktop/src/renderer/features/chat-recording/chat-recording-model.ts`（新建或复用）

对齐 Phase 4D 实施计划规划的文件路径。统一放置类型和纯函数：

```typescript
// --- Types ---

export type ChatRecordingAttachment = {
  type: 'recording';
  sessionId: string;
  title: string;
  durationSeconds?: number;
  thumbnailPath?: string;
  scope: 'fullscreen' | 'active-window';
  privacyMode: 'summary' | 'detailed';
  status:
    | 'recording'
    | 'stopped'
    | 'manifesting'
    | 'manifest_ready'
    | 'generating'
    | 'draft_ready'
    | 'failed'
    | 'discarded';
  keyframeCount?: number;
  warningCount?: number;
  startedAt?: number;
};

export type RecordingStatePayload = {
  sessionId: string;
  status:
    | 'recording'
    | 'stopped'
    | 'manifesting'
    | 'manifest_ready'
    | 'generating'
    | 'draft_ready'
    | 'failed'
    | 'discarded';
  progress?: number;
  error?: string;
  updatedAt: string;
};

// --- Helpers ---

const MAX_CHAT_ATTACHMENTS = 5;

export function mergeRecordingAttachments(
  existing: Map<string, ChatRecordingAttachment>,
  incoming: ChatRecordingAttachment[],
): Map<string, ChatRecordingAttachment> {
  const merged = new Map(existing);
  for (const att of incoming) {
    merged.set(att.sessionId, { ...merged.get(att.sessionId), ...att });
  }
  if (merged.size > MAX_CHAT_ATTACHMENTS) {
    const keys = [...merged.keys()];
    for (const k of keys.slice(0, merged.size - MAX_CHAT_ATTACHMENTS)) {
      merged.delete(k);
    }
  }
  return merged;
}
```

对应的测试文件 `packages/desktop/tests/chat-recording-model.test.ts` 覆盖合并、状态更新和 discard。

---

## 四、环境变量支持

### 文件：`packages/desktop/src/shared/env.ts`（新建）

```typescript
export const EnvConfig = {
  DATA_DIR: process.env.AGIVAR_DATA_DIR,
  LOG_LEVEL: (process.env.AGIVAR_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
  DEV_TOOLS: process.env.AGIVAR_DEV_TOOLS === '1',
  MODEL_ENDPOINT: process.env.AGIVAR_MODEL_ENDPOINT,
  MODEL_API_KEY: process.env.AGIVAR_MODEL_API_KEY,
  MODEL_NAME: process.env.AGIVAR_MODEL_NAME,
  PORT: process.env.AGIVAR_PORT ? parseInt(process.env.AGIVAR_PORT, 10) : undefined,
  NO_SANDBOX: process.env.AGIVAR_NO_SANDBOX === '1',
} as const;
```

### 消费点

| 变量 | 消费位置 | 当前阶段是否启用 |
|---|---|---|
| `AGIVAR_DATA_DIR` | `resolveDataDir()` | 是 |
| `AGIVAR_LOG_LEVEL` | 日志初始化 | 若当前无日志系统则后置 |
| `AGIVAR_DEV_TOOLS` | 窗口创建后打开 devtools | 是 |
| `AGIVAR_MODEL_ENDPOINT` | LLM provider 配置 | 是 |
| `AGIVAR_MODEL_API_KEY` | LLM provider 配置 | 是 |
| `AGIVAR_MODEL_NAME` | LLM provider 配置 | 是 |
| `AGIVAR_PORT` | 本地服务或 dev server | 若未使用则后置 |
| `AGIVAR_NO_SANDBOX` | Electron 启动参数 | 若未使用则后置 |

`index.ts` 中 `resolveDataDir()` 的 `AGIVAR_DATA_DIR` 改为引用 `EnvConfig.DATA_DIR`。

---

## 五、单实例锁

### 改动文件：`packages/desktop/src/main/index.ts`

在文件顶部、`app.whenReady()` 之前：

```typescript
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
```

行为：第二个实例静默退出，已有窗口恢复并聚焦。

---

## 六、Service 注册模式重构

### 改动文件：`packages/desktop/src/main/index.ts`

将 `app.whenReady()` 中的线性初始化提取为两个函数：

```typescript
async function registerServices(): Promise<ServiceContext> {
  const dataDir = resolveDataDir();
  await runMigrations(dataDir);
  const db = await initDatabase(dataDir);
  const stores = createStores(db);
  setupLlmConfiguration(stores.settings);
  const tools = createDesktopTools();
  const agentService = new AgentService(stores, tools);
  return { dataDir, db, stores, tools, agentService };
}

function registerIpcServices(ctx: ServiceContext): void {
  setAgentService(ctx.agentService);
  setMemoryStore(ctx.stores.memory);
  setRecordingStore(ctx.stores.recording);
  setSettingsStore(ctx.stores.settings);
  registerIpcHandlers();
}

app.whenReady().then(async () => {
  const ctx = await registerServices();
  registerIpcServices(ctx);
  wireRecordingEvents(ctx);
  createMainWindow(ctx);
});
```

本质是提取函数，不改变逻辑行为。`ServiceContext` 是内部接口，不导出。

---

## 测试策略

### 构建验证

```powershell
pnpm --filter @agivar/desktop build
```

### IPC contract test（新增）

```powershell
pnpm vitest run packages/desktop/tests/ipc-channels.test.ts
```

`ipc-channels.test.ts` 覆盖：
- `IpcChannels` 中没有重复字符串值
- preload 暴露的方法名与 main handler 注册使用同一常量
- `recordingTeach:*` 所有通道在常量中有对应项

### 附件模型测试

```powershell
pnpm vitest run packages/desktop/tests/chat-recording-model.test.ts
```

覆盖：合并、状态更新、discard、上限裁剪。

### 真实录屏 smoke

```powershell
pnpm desktop:smoke-recording-real
```

验证 hardening 改动后的录屏全链路。若仅执行 Phase 4D，不需要验证事件推送。

### TypeScript check + Git diff

```powershell
pnpm tsc --noEmit
git diff --check
```

---

## 验收标准

- 所有 IPC handler 注册使用 `IpcChannels.*` 常量，无硬编码字符串
- 所有 preload `ipcRenderer.invoke` / `ipcRenderer.on` 使用常量
- `recordingTeach:*` 通道名保持不变，常量值与原有字符串一致
- `recordingTeach:stateChanged` 事件在 start/stop/buildManifest/generateDraft/cancel/discard 触发（仅 Phase 4E / hardening）
- `RecordingStatePayload.status` 为窄类型枚举，不是 `string`
- `chat-recording-model.ts` 路径与 Phase 4D plan 一致：`packages/desktop/src/renderer/features/chat-recording/chat-recording-model.ts`
- `ChatRecordingAttachment.status` 不包含 `'queued'` 和 `'processing'`，这两个状态保留给后续云处理阶段
- `ChatRecordingAttachment.processingPct` 不进入 Phase 4D / 4E 本地处理模型
- `mergeRecordingAttachments` 上限 5 个
- 第二个实例启动时静默退出，已有窗口聚焦
- `EnvConfig` 导出 8 个环境变量，附带消费点文档
- `index.ts` 启动逻辑提取为 `registerServices()` + `registerIpcServices()`
- `pnpm --filter @agivar/desktop build` 通过
- `pnpm desktop:smoke-recording-real` 通过
- IPC contract test 通过
- `chat-recording-model.test.ts` 通过
