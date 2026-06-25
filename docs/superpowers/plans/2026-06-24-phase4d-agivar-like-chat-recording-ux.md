# Phase 4D Agivar-like Chat Recording UX 实施计划

> **面向 AI 代理的工作说明：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行本计划。步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 把 Phase 4A/4B/4C 的录屏教学能力迁移到主聊天体验中，使录屏成为聊天输入素材，并以 Agivar-like 的「对话 + 录屏证据 + 步骤解析 + 工具状态胶囊」形态呈现。

**架构：** 不新增核心录屏服务，不新增主进程 IPC。Phase 4D 限定为 renderer 体验层和录屏链路编排层：新增聊天录屏状态、附件卡片、步骤解析展示和输入栏录屏控制，复用现有 `recordingTeach.*` IPC 和 Phase 4B/4C provider / history / discard 能力。本阶段不做 IPC 全量常量化、不重命名 `recordingTeach:*`、不做 service 注册重构、单实例锁或多窗口 recording bar。

**技术栈：** React、Zustand、TypeScript、Electron preload IPC、Tailwind-style utility classes、Vitest、现有 `@agivar/core` draft 类型。

---

## 文件结构

- 新建 `packages/desktop/src/renderer/features/chat-recording/chat-recording-model.ts`
  - 定义聊天录屏附件、assistant 解析、tool pill 类型。
  - 提供 timeline / draft link 到聊天 metadata 的纯函数。

- 新建 `packages/desktop/tests/chat-recording-model.test.ts`
  - 覆盖附件摘要、draft 解析映射、discard 状态、tool pill 归一化。

- 修改 `packages/desktop/src/renderer/stores/chat-store.ts`
  - 为 `ChatMessage.metadata` 增加窄类型 helper，不强制迁移所有旧消息。
  - 增加附件消息和 assistant 解析消息的写入方法。
  - 增加按 session 保存消息的内存隔离，或明确最近对话为本地内存 mock。
  - 增加附件级幂等更新 helper。

- 新建 `packages/desktop/src/renderer/stores/chat-recording-store.ts`
  - 封装主聊天录屏 start/stop/generate/retry/discard 状态。
  - 复用 `window.agivar.recordingTeach.*`。

- 新建 `packages/desktop/src/renderer/components/RecordingAttachmentCard.tsx`
  - 渲染录屏缩略图、标题、时长、状态、重试、删除。

- 新建 `packages/desktop/src/renderer/components/ToolStatusPill.tsx`
  - 渲染 `wait`、`click`、`type`、`observe` 等状态胶囊。

- 新建 `packages/desktop/src/renderer/components/RecordingStepList.tsx`
  - 渲染 assistant 解析步骤、证据数量和 tool pills。

- 修改 `packages/desktop/src/renderer/components/MessageBubble.tsx`
  - 支持用户消息录屏附件。
  - 支持 assistant 消息录屏解析。

- 修改 `packages/desktop/src/renderer/components/InputBar.tsx`
  - 增加任务模式、模型、录屏、图片、语音和发送布局。
  - 录屏按钮接入 `chat-recording-store`。

- 修改 `packages/desktop/src/renderer/components/Sidebar.tsx`
  - 增加账号、UID、积分、设置入口和最近对话区。

- 修改 `packages/desktop/src/renderer/components/ChatView.tsx`
  - 调整消息区宽度、居中和底部滚动行为。

- 修改 `packages/desktop/src/renderer/pages/ChatPage.tsx`
  - 调整整体页面框架，使主区更接近 Agivar 参考页。

- 修改或新增 `packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.ts`
  - 验证聊天页结构、输入栏控件、录屏附件、tool pills 的静态渲染。

---

## Phase 4D 明确不做

以下内容来自 Agivar 反编译和架构 review，方向有价值，但不进入 Phase 4D 实施任务：

- IPC 全量常量化。
- `recordingTeach:*` 到 `recording:*` 的通道重命名。
- `recordingTeach:stateChanged` 或其它新增主进程 IPC 事件。
- service 注册重构。
- 单实例锁。
- `EnvConfig` 全覆盖。
- 多窗口 recording bar。
- 录屏选择器。
- 云端 `queued` / `processing` 管线。
- `.rz` 归档或加密格式。
- 真实账号、积分系统。
- 持久化聊天历史完整实现。

Phase 4D 只证明一件事：Phase 4C 已跑通的真实录屏链路可以作为聊天附件被自然消费，并生成 assistant 解析消息。

---

## 执行路径决策

采用路径 A：先合 Phase 4D，再做 Phase 4E hardening。

- Phase 4D 只实施聊天录屏 UX、附件模型、renderer store、输入栏和 smoke 验证。
- IPC 常量化、`recordingTeach:*` 重命名、新增主进程事件、service 注册重构、单实例锁和 `EnvConfig` 全覆盖全部后置。
- `docs/superpowers/specs/2026-06-25-agivar-key-findings-implementation-design.md` 只能作为 Phase 4E / hardening 候选输入，不作为本计划的前置任务。

---

### 任务 1：聊天录屏模型和 TDD 基础

**文件：**

- 新建：`packages/desktop/src/renderer/features/chat-recording/chat-recording-model.ts`
- 新建：`packages/desktop/tests/chat-recording-model.test.ts`

- [ ] **步骤 1：编写失败测试**

创建 `packages/desktop/tests/chat-recording-model.test.ts`，覆盖：

```ts
import { describe, expect, it } from 'vitest';
import {
  createRecordingAttachmentFromTimeline,
  createRecordingExplanationFromDraftLink,
  normalizeToolPill,
  markRecordingAttachmentDiscarded,
} from '../src/renderer/features/chat-recording/chat-recording-model.js';

describe('chat recording model', () => {
  it('summarizes a stopped timeline as a recording attachment', () => {
    const attachment = createRecordingAttachmentFromTimeline({
      session: {
        id: 'rec-1',
        scope: 'active-window',
        privacyMode: 'summary',
        status: 'stopped',
        goal: '打开音乐',
      },
      timeline: {
        sessionId: 'rec-1',
        durationMs: 14300,
        keyframes: [{ id: 'kf-1', imagePath: 'frame.png' }],
        events: [],
        context: [],
        warnings: [],
      },
    } as any);

    expect(attachment).toMatchObject({
      type: 'recording',
      sessionId: 'rec-1',
      title: '打开音乐',
      durationSeconds: 14,
      scope: 'active-window',
      privacyMode: 'summary',
      status: 'stopped',
      keyframeCount: 1,
    });
  });

  it('maps a draft link into an assistant recording explanation', () => {
    const explanation = createRecordingExplanationFromDraftLink({
      sessionId: 'rec-1',
      draftJson: JSON.stringify({
        goal: '播放音乐',
        steps: [
          { id: 'step-1', intent: '打开 QQ 音乐', action: { kind: 'click' } },
        ],
      }),
      evidence: [{ stepId: 'step-1', keyframeIds: ['kf-1'] }],
      warnings: ['low confidence'],
    } as any);

    expect(explanation.steps[0].toolPills[0]).toMatchObject({
      kind: 'click',
      status: 'pending',
    });
    expect(explanation.warnings).toEqual(['low confidence']);
  });

  it('marks an attachment discarded without losing session identity', () => {
    const discarded = markRecordingAttachmentDiscarded({
      type: 'recording',
      sessionId: 'rec-1',
      title: '录屏',
      scope: 'fullscreen',
      privacyMode: 'summary',
      status: 'draft_ready',
    });
    expect(discarded.status).toBe('discarded');
    expect(discarded.sessionId).toBe('rec-1');
  });

  it('normalizes unknown tool pills', () => {
    expect(normalizeToolPill({ kind: 'hover', label: 'hover menu' } as any)).toMatchObject({
      kind: 'other',
      label: 'hover menu',
      status: 'pending',
    });
  });
});
```

同时补充以下模型测试：

- `requiresManifestConfirmation(manifest)`：`summary` 且不含 raw text / precise coordinates 时返回 `false`。
- `requiresManifestConfirmation(manifest)`：`detailed` 或含 raw text / precise coordinates 时返回 `true`。
- `parseDraftLinkExplanation`：draft JSON 解析失败时返回 warning，不抛异常。
- `mergeRecordingAttachments`：按 `sessionId` 合并，同一个录屏只保留一份，discard 不读取 thumbnail。
- `toChatRecordingStatus`：把 session / generation 状态映射到 canonical renderer 状态，不输出 `queued` / `processing`。

运行：

```powershell
pnpm vitest run packages/desktop/tests/chat-recording-model.test.ts
```

预期：失败，提示模块或函数不存在。

- [ ] **步骤 2：实现模型类型和纯函数**

在 `packages/desktop/src/renderer/features/chat-recording/chat-recording-model.ts` 中实现：

```ts
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
};

export type ChatToolPill = {
  kind: 'wait' | 'click' | 'type' | 'observe' | 'other';
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
};

export type ChatRecordingExplanation = {
  type: 'recording-explanation';
  sessionId: string;
  summary: string;
  steps: Array<{
    id: string;
    title: string;
    instruction: string;
    evidenceIds: string[];
    toolPills: ChatToolPill[];
  }>;
  warnings: string[];
};
```

并补齐测试中调用的函数。draft JSON 解析失败时返回 1 条 warning，不抛异常。`queued`、`processing`、`processingPct` 只作为后续云处理扩展记录在文档中，不进入 Phase 4D 必选类型。

额外实现：

```ts
export function requiresManifestConfirmation(input: {
  privacyMode: 'summary' | 'detailed';
  includesRawText?: boolean;
  includesPreciseCoordinates?: boolean;
}): boolean {
  return input.privacyMode === 'detailed' || Boolean(input.includesRawText) || Boolean(input.includesPreciseCoordinates);
}

export const MAX_CHAT_ATTACHMENTS = 5;

export function mergeRecordingAttachments(
  existing: Map<string, ChatRecordingAttachment>,
  incoming: ChatRecordingAttachment[],
): Map<string, ChatRecordingAttachment> {
  const next = new Map(existing);

  for (const attachment of incoming) {
    const previous = next.get(attachment.sessionId);
    next.set(attachment.sessionId, { ...previous, ...attachment });
  }

  const entries = Array.from(next.entries()).slice(-MAX_CHAT_ATTACHMENTS);
  return new Map(entries);
}
```

这个 helper 必须被 `chat-recording-store` 使用，避免聊天入口绕过 Phase 4B 的 manifest 确认边界。

`mergeRecordingAttachments` 必须按 `sessionId` 合并同一条录屏附件，并保留最多 `MAX_CHAT_ATTACHMENTS` 条，供 `chat-recording-store` 控制当前消息附件上限。它要避免 start / stop / manifest / generate / retry / discard 在同一个 recording session 上重复插入多张卡片。`discarded` 状态下不得强制读取或恢复 thumbnail。

- [ ] **步骤 3：验证模型测试通过**

运行：

```powershell
pnpm vitest run packages/desktop/tests/chat-recording-model.test.ts
```

预期：测试通过。

- [ ] **步骤 4：提交模型基础**

运行：

```powershell
git add packages/desktop/src/renderer/features/chat-recording/chat-recording-model.ts packages/desktop/tests/chat-recording-model.test.ts
git commit -m "feat(phase4d): 添加聊天录屏模型"
```

### 任务 2：录屏附件、步骤列表和工具胶囊组件

**文件：**

- 新建：`packages/desktop/src/renderer/components/RecordingAttachmentCard.tsx`
- 新建：`packages/desktop/src/renderer/components/ToolStatusPill.tsx`
- 新建：`packages/desktop/src/renderer/components/RecordingStepList.tsx`
- 修改：`packages/desktop/src/renderer/components/MessageBubble.tsx`
- 新建或修改：`packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.ts`

- [ ] **步骤 1：编写组件 smoke 测试**

测试应渲染一条用户消息和一条 assistant 消息：

```ts
const userMessage = {
  id: 'm1',
  sessionId: 's1',
  role: 'user',
  content: '我录制一下',
  createdAt: '2026-06-24T00:00:00.000Z',
  metadata: {
    attachments: [{
      type: 'recording',
      sessionId: 'rec-1',
      title: '录屏 2026/06/24 08:55',
      durationSeconds: 14,
      scope: 'fullscreen',
      privacyMode: 'summary',
      status: 'stopped',
      keyframeCount: 4,
    }],
  },
};
```

断言：

- 页面存在录屏标题；
- 页面存在 `14s`；
- 页面存在 `wait` 胶囊；
- 页面存在步骤标题。
- 旧消息没有 `metadata.attachments` 时仍能正常渲染。
- 未知 attachment type 被忽略或降级展示。
- assistant explanation 的 warning 能渲染为低干扰提示。
- `discarded` 附件不渲染 thumbnail。

运行：

```powershell
pnpm vitest run packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.ts
```

预期：失败，组件未实现。

- [ ] **步骤 2：实现 `ToolStatusPill`**

实现要求：

- 使用小圆角胶囊；
- `wait`、`click`、`type`、`observe` 有不同轻量颜色；
- 文本不超过容器，使用 `truncate`；
- 不使用大面积渐变。

- [ ] **步骤 3：实现 `RecordingAttachmentCard`**

实现要求：

- 左侧缩略图，缺失时显示本地占位块；
- 右侧标题、时长、状态；
- 支持 `onRetry`、`onDiscard` 可选回调；
- `discarded` 状态不显示缩略图内容。
- `manifest_ready` 状态显示「待确认」状态文案或 badge，并提供 `onConfirmManifest` 可选回调入口。

- [ ] **步骤 4：实现 `RecordingStepList`**

实现要求：

- 每个步骤显示标题、说明、证据数量；
- 步骤下方渲染 `ToolStatusPill`；
- warning 以低干扰提示显示。

- [ ] **步骤 5：扩展 `MessageBubble`**

实现要求：

- 用户消息读取 `metadata.attachments`，渲染录屏附件；
- assistant 消息读取 `metadata.recordingExplanation`，渲染步骤列表；
- 保留旧的 `metadata.toolCalls` 渲染逻辑；
- 消息最大宽度放宽到适合阅读步骤，但用户短消息仍靠右。
- 对未知 metadata 做防御式处理，不让坏数据导致整条消息崩溃。

- [ ] **步骤 6：验证组件 smoke 测试**

运行：

```powershell
pnpm vitest run packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.ts packages/desktop/tests/chat-recording-model.test.ts
```

预期：测试通过。

- [ ] **步骤 7：提交组件**

运行：

```powershell
git add packages/desktop/src/renderer/components/RecordingAttachmentCard.tsx packages/desktop/src/renderer/components/ToolStatusPill.tsx packages/desktop/src/renderer/components/RecordingStepList.tsx packages/desktop/src/renderer/components/MessageBubble.tsx packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.ts
git commit -m "feat(phase4d): 渲染聊天录屏附件和步骤解析"
```

### 任务 3：主聊天录屏状态和输入栏接入

**文件：**

- 新建：`packages/desktop/src/renderer/stores/chat-recording-store.ts`
- 修改：`packages/desktop/src/renderer/stores/chat-store.ts`
- 修改：`packages/desktop/src/renderer/components/InputBar.tsx`
- 修改：`packages/desktop/tests/chat-recording-model.test.ts`

- [ ] **步骤 1：扩展 `chat-store` 写入方法**

先把聊天消息从全局数组调整为 session 内存隔离。Phase 4D 不承诺跨启动恢复，但同一次运行内切换最近对话时必须保留各 session 的消息。

建议状态结构：

```ts
messagesBySessionId: Record<string, ChatMessage[]>;
```

`messages` selector 可以继续保留为当前 `activeSessionId` 的派生结果，避免一次性改动所有组件。

再增加方法：

```ts
addRecordingUserMessage(input: {
  sessionId: string;
  content: string;
  attachment: ChatRecordingAttachment;
}): string;

addRecordingAssistantMessage(input: {
  sessionId: string;
  content: string;
  explanation: ChatRecordingExplanation;
}): string;

addOrUpdateRecordingAttachment(
  sessionId: string,
  patch: Partial<ChatRecordingAttachment>,
): string;
```

`addOrUpdateRecordingAttachment` 必须用 `recording sessionId` 找到已有用户消息并更新附件；找不到时才创建新用户消息。start / stop / generate / retry / discard 都通过这个 helper 幂等更新同一条消息。

保留现有 `addMessage`，避免影响旧路径。

还需要新增或调整测试覆盖：

- 创建两个 chat session 后，各自消息互不覆盖。
- `switchSession` 后当前 `messages` 指向 active session。
- 对同一个 recording session 连续调用 `addOrUpdateRecordingAttachment` 不会新增第二条用户消息。
- discard 后附件状态为 `discarded`，thumbnail path 被清空或不再被 UI 使用。

- [ ] **步骤 2：实现 `chat-recording-store`**

状态：

```ts
type ChatRecordingPhase =
  | 'idle'
  | 'preflight'
  | 'recording'
  | 'stopping'
  | 'manifesting'
  | 'manifest_ready'
  | 'generating'
  | 'failed';
```

动作：

- `startRecording({ scope, privacyMode, goal })`
- `stopAndGenerate({ activeSessionId, content })`
- `confirmManifestAndGenerate(sessionId)`
- `retryGeneration(sessionId)`
- `discardAttachment(sessionId)`

流程：

1. `preflight`
2. `start`
3. `stop`
4. `getTimeline`
5. 调用 `addOrUpdateRecordingAttachment` 写入或更新用户消息附件
6. `buildManifest`
7. 如果是 `summary` 且 manifest 不含 raw text / precise coordinates，可以自动确认；否则把状态置为 `manifest_ready`，等待用户确认
8. `generateDraft`
9. 写入 assistant 解析

本任务不新增 `recordingTeach:stateChanged` 或其它主进程 IPC。状态来自现有 invoke 链路和本地 store。

当状态进入 `manifest_ready` 时：

- `InputBar` 的主操作显示「确认并生成」。
- 当前录屏附件状态显示为「待确认」。
- 用户可以在附件卡片或输入栏的轻量确认入口查看 manifest 摘要、warning 数量和隐私提示；Phase 4D 不在主聊天区直接展开 raw text、precise coordinates 或 artifact path。
- 用户确认后调用 `confirmManifestAndGenerate(sessionId)`，并把 phase 更新为 `generating`。

`retryGeneration` 和 `discardAttachment` 必须复用同一条 recording attachment：

- retry：附件状态从 `failed` 或 `manifest_ready` 更新为 `generating`，成功后更新为 `draft_ready`。
- discard：调用 `recordingTeach.discard(sessionId)`，附件状态更新为 `discarded`，已有 assistant explanation 保留并显示本地证据已删除提示。

- [ ] **步骤 3：改造 `InputBar` 布局**

输入栏目标结构：

- 上层 textarea；
- 下层左侧：任务模式、模型、录屏、图片；
- 下层右侧：语音、发送；
- 录屏中：录屏按钮变成停止按钮；
- `manifesting` / `generating`：发送禁用，录屏按钮禁用，避免同一条录屏 draft 生成过程中再次 start。
- `manifest_ready`：发送禁用，录屏按钮禁用，主操作显示「确认并生成」。

先使用文字按钮，若项目已有 icon 依赖再替换为 icon。不要新增无必要依赖。

`InputBar` 不直接实现录屏业务流程，只消费 `useChatRecordingStore` 暴露的 `phase`、`primaryAction`、`error`、`elapsedSeconds`，并触发对应 action。

- [ ] **步骤 4：录屏错误回写聊天**

当 preflight/start/stop/generate 失败时：

- 输入栏显示短错误；
- 可选写入 system 消息；
- attachment 若已创建，则状态更新为 `failed`。
- 不重复插入新的录屏附件消息。
- 如果失败发生在用户消息创建前，只显示输入栏错误和可重试状态。
- `preflight` 失败不创建用户消息和录屏附件，只在 `InputBar` 显示短错误，例如权限不足、屏幕录制不可用或磁盘空间不足。

- [ ] **步骤 5：验证输入栏和模型测试**

运行：

```powershell
pnpm vitest run packages/desktop/tests/chat-recording-model.test.ts packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.ts
pnpm --filter @agivar/desktop build
```

预期：测试和构建通过。

- [ ] **步骤 6：提交输入栏接入**

运行：

```powershell
git add packages/desktop/src/renderer/stores/chat-recording-store.ts packages/desktop/src/renderer/stores/chat-store.ts packages/desktop/src/renderer/components/InputBar.tsx packages/desktop/tests/chat-recording-model.test.ts
git commit -m "feat(phase4d): 在聊天输入栏接入录屏"
```

### 任务 4：Agivar-like 左侧栏和聊天页布局

**文件：**

- 修改：`packages/desktop/src/renderer/components/Sidebar.tsx`
- 修改：`packages/desktop/src/renderer/components/ChatView.tsx`
- 修改：`packages/desktop/src/renderer/pages/ChatPage.tsx`
- 修改：`packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.ts`

- [ ] **步骤 1：改造 `Sidebar`**

要求：

- 顶部品牌简洁展示；
- 账号区包含头像占位、昵称、UID、积分和设置按钮；
- `+ 新对话` 使用轻量边框按钮；
- 最近对话标题和列表分区；
- 当前会话使用浅色高亮。

- [ ] **步骤 2：调整 `ChatPage` 顶部和主区**

要求：

- 去掉明显工程标题；
- 顶部只保留轻量当前任务或空白 toolbar；
- 主区背景浅色、安静；
- 不用大卡片包裹整页。

- [ ] **步骤 3：调整 `ChatView` 阅读宽度**

要求：

- 消息容器居中；
- 最大宽度约 880 px；
- 右下保留滚动到最新的行为；
- loading 文案修正为正常中文。

- [ ] **步骤 4：验证 UI smoke**

运行：

```powershell
pnpm vitest run packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.ts
pnpm --filter @agivar/desktop build
```

预期：测试和构建通过。

- [ ] **步骤 5：提交布局**

运行：

```powershell
git add packages/desktop/src/renderer/components/Sidebar.tsx packages/desktop/src/renderer/components/ChatView.tsx packages/desktop/src/renderer/pages/ChatPage.tsx packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.ts
git commit -m "feat(phase4d): 调整主聊天页为 Agivar-like 布局"
```

### 任务 5：真实 Electron smoke 和回归

**文件：**

- 修改：`packages/desktop/scripts/phase4c-real-recording-smoke.mjs`（仅在需要复用新入口时修改）
- 新建或修改：`packages/desktop/scripts/phase4d-chat-recording-smoke.mjs`
- 修改：`packages/desktop/package.json`
- 修改：根 `package.json`

- [ ] **步骤 1：保留 Phase 4C smoke**

先运行：

```powershell
pnpm desktop:smoke-recording-real
```

预期：active-window 和 fullscreen 仍能生成 keyframes，且 ABI 自动恢复。

这个 smoke 是 Phase 4D 的回归门禁。若本命令失败，不继续提交聊天录屏 smoke。

- [ ] **步骤 2：新增 Phase 4D 聊天录屏 smoke**

脚本应：

1. 启动真实 Electron；
2. 进入聊天页；
3. 创建或使用当前会话；
4. 点击录屏按钮；
5. 停止录屏；
6. 等待用户录屏附件出现；
7. 等待 assistant 解析消息出现；
8. 断言页面存在录屏卡片和至少 1 个步骤。

若真实录屏在 CI 或无桌面环境不可用，脚本应输出清晰 skip 原因，不伪造成功。

脚本不得新增或依赖 `recordingTeach:stateChanged`。它只能通过现有 UI、preload invoke 结果和 DOM 状态观察完成验证。

- [ ] **步骤 3：注册脚本**

`packages/desktop/package.json` 添加：

```json
"smoke:recording:chat": "node scripts/phase4d-chat-recording-smoke.mjs"
```

根 `package.json` 添加：

```json
"desktop:smoke-recording-chat": "pnpm --filter @agivar/desktop smoke:recording:chat"
```

- [ ] **步骤 4：运行最终验证**

运行：

```powershell
pnpm vitest run packages/desktop/tests/chat-recording-model.test.ts packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.ts packages/desktop/tests/phase4a-recording-ui-smoke.test.ts
pnpm --filter @agivar/desktop build
pnpm desktop:smoke-recording-real
pnpm desktop:smoke-recording-chat
git diff --check
```

预期：

- 所有 Vitest 测试通过；
- desktop build 退出码为 0；
- 两个真实 smoke 通过，或聊天 smoke 在明确无桌面能力时显式 skip；
- `git diff --check` 无 whitespace error。

- [ ] **步骤 5：提交 smoke**

运行：

```powershell
git add packages/desktop/scripts/phase4d-chat-recording-smoke.mjs packages/desktop/package.json package.json
git commit -m "test(phase4d): 添加聊天录屏真实 smoke"
```

### 任务 6：收口文档和最终提交

**文件：**

- 新建：`docs/superpowers/reports/2026-06-24-phase4d-closure.md`

- [ ] **步骤 1：编写 closure report**

报告包含：

- 实现范围；
- 复用的 Phase 4A/4B/4C 能力；
- UI 与 Agivar 参考图的映射；
- 未做事项；
- 测试命令和结果；
- 真实 smoke 结果。
- 明确列出未纳入 Phase 4D 的 Agivar 借鉴项：IPC 常量化、多窗口、单实例锁、云处理、归档、账号积分、持久化聊天历史。

- [ ] **步骤 2：运行最终状态检查**

运行：

```powershell
git status --short --branch
git log --oneline -5
```

确认没有遗漏未提交文件。

- [ ] **步骤 3：提交报告**

运行：

```powershell
git add docs/superpowers/reports/2026-06-24-phase4d-closure.md
git commit -m "docs(phase4d): 补充聊天录屏体验收口报告"
```

- [ ] **步骤 4：按用户要求推送**

仅在用户要求时运行：

```powershell
git push origin master
```

---

## 最终验收清单

- [ ] 主聊天页呈现 Agivar-like 左侧栏、聊天区和底部输入栏。
- [ ] 录屏入口位于输入栏，而不是只存在于 `RecordingTeachPanel`。
- [ ] 录屏完成后，用户消息出现录屏附件卡片。
- [ ] provider 生成成功后，assistant 消息出现自然语言步骤解析。
- [ ] 每个步骤可以展示 `wait`、`click`、`type`、`observe` 等 tool pill。
- [ ] `RecordingTeachPanel` 仍可用于工程调试。
- [ ] Phase 4C 的真实录屏 smoke 仍通过。
- [ ] Phase 4D 的聊天录屏 smoke 通过或显式 skip。
- [ ] 不引入云同步、向量检索、静默上传或真实账号后端。
- [ ] 不新增主进程 IPC handler，不重命名 `recordingTeach:*`。
- [ ] `chat-store` 支持同一次运行内的 session 消息隔离。
- [ ] `addOrUpdateRecordingAttachment` 保证同一 recording session 的附件幂等更新。
- [ ] `summary` 且 manifest 无敏感标记才允许自动确认；`detailed` 或含 raw text / precise coordinates 必须等待确认。
- [ ] `queued`、`processing`、`processingPct` 不作为 Phase 4D 必选实现。
- [ ] `InputBar` 不承载录屏业务流程，只消费 `useChatRecordingStore` 状态和 action。
