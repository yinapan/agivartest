# Phase 4D Agivar-like Chat Recording UX Design

> **相关设计文档**：
> - [phase4d-recording-attachment-data-model.md](../../phase4d-recording-attachment-data-model.md) — Agivar `attach_bar` / `selectable` 数据模型逆向与 Phase 4D 对齐
> - [recording-storage-lifecycle-design.md](../../recording-storage-lifecycle-design.md) — 录制存储、.rz 归档格式、孤儿清理
> - [agivar-reverse-engineering-insights.md](../../agivar-reverse-engineering-insights.md) — 反编译架构完整洞察
> - [ipc-and-multi-window-architecture.md](../../ipc-and-multi-window-architecture.md) — IPC 通道规范与多窗口模板

## 背景

Phase 4A 到 Phase 4C 已经把录屏教学链路打通：真实录制、keyframe 采样、事件和上下文、provider payload manifest、生成草稿、历史管理、discard、preflight、orphan cleanup、真实 Electron smoke 都已经具备。

但当前 UI 仍然偏工程调试台：`RecordingTeachPanel` 暴露了 start、stop、manifest、provider、history、discard 等底层动作，适合验证链路，不适合作为最终产品入口。

Agivar 参考页面呈现的是另一种产品形态：

- 左侧是账号、积分、最近对话和新对话。
- 主区是聊天式任务上下文。
- 录屏作为用户消息附件出现，有缩略图、名称和时长。
- Agent 回复会基于录屏解释操作步骤，并在步骤间展示 `wait`、`click`、`type` 等工具状态胶囊。
- 底部输入栏整合任务模式、模型、录屏、图片、语音和发送。
- 录屏不是独立页面，而是聊天输入的一种素材。

Phase 4D 的目标是把录屏教学从「工程功能面板」迁移到「对话 + 录屏证据 + 自动继续操作」的主产品体验。

## 范围

Phase 4D 覆盖：

1. 主聊天页布局对齐 Agivar-like 形态。
2. 底部输入栏增加录屏入口和模式选择。
3. 录屏完成后生成用户消息附件卡片。
4. Agent 回复以自然语言步骤展示录屏解析结果。
5. 工具调用状态用轻量胶囊展示。
6. 左侧最近对话信息增强。
7. 保留 Phase 4A/4B/4C 的工程面板能力作为开发入口或降级路径。

Phase 4D 的实施边界限定为 **renderer 体验层 + 录屏链路编排层**。本阶段不重构主进程 IPC 架构，不全量常量化通道，不重命名 `recordingTeach:*`，不引入 service 注册重构。Agivar 反编译中关于 IPC 常量化、多窗口、单实例锁、归档和云处理的建议保留为后续 Phase 4E / hardening 输入。

执行路径采用路径 A：先完成 Phase 4D 聊天录屏 UX，再单独进入 Phase 4E hardening。Phase 4D 不以 `docs/superpowers/specs/2026-06-25-agivar-key-findings-implementation-design.md` 中的 IPC 常量化、状态事件推送、service 注册重构、单实例锁或环境变量治理为前置条件。

## 非目标

- 不实现云同步。
- 不实现向量检索。
- 不新增账号后端、真实积分系统或远程用户体系。
- 不让录屏生成的 workflow 自动保存到 memory。
- 不绕过 Phase 4B 的 manifest 确认边界。
- 不静默上传本地 artifact。
- 不在 Phase 4D 内实现完整任务自动执行器重写。
- 不新增主进程 IPC handler，不重命名现有 `recordingTeach:*` 通道。
- 不做 IPC 全量常量化、单实例锁、`EnvConfig` 全覆盖、service 注册重构或多窗口 recording bar。
- 不实现持久化聊天历史；最近对话在 Phase 4D 先作为 renderer 本地内存体验。

## 产品原则

### 录屏是消息素材

用户不应先进入一个「录屏教学表单」再回到聊天。Phase 4D 中，用户从底部输入栏点击录屏，完成后消息区出现一条用户消息：

- 文本：用户输入的任务目标，或默认「我录制了一段操作」。
- 附件：录屏卡片，包含缩略图、名称、时长、scope、隐私模式。
- 状态：使用 Phase 4D 的 canonical renderer 状态，覆盖录制、manifest、生成、成功、失败和删除。

### Agent 回复是教学解释

录屏 draft 不再只进入 workflow editor。主聊天区会展示一条 assistant 消息：

- 先用自然语言确认看到了什么。
- 再列出可执行步骤。
- 每个步骤可展示证据引用和工具状态胶囊。
- manifest、provider、keyframe 数量等工程细节只作为展开信息，不占主体验。

### 工程能力保留，但不占主屏

`RecordingTeachPanel` 仍保留在 Workflows 或开发入口中，用于：

- provider 调试；
- manifest 检查；
- benchmark 和 smoke 验证；
- discard / reprocess / history 问题排查。

主聊天页只暴露用户自然需要的动作：录屏、停止、重试、删除附件、生成/重新生成解析。

## 现有架构映射

### 可直接复用

- `recordingTeach.start`
- `recordingTeach.stop`
- `recordingTeach.status`
- `recordingTeach.getTimeline`
- `recordingTeach.buildManifest`
- `recordingTeach.generateDraft`
- `recordingTeach.resumeDraft`
- `recordingTeach.listProviders`
- `recordingTeach.cancelDraftGeneration`
- `recordingTeach.retryDraftGeneration`
- `recordingTeach.reprocessDraft`
- `recordingTeach.listSessions`
- `recordingTeach.updateSessionMetadata`
- `recordingTeach.discard`
- `recordingTeach.preflight`

这些 IPC 已覆盖 Phase 4D 所需的录屏生命周期。Phase 4D 不新增核心服务，只新增聊天体验层的状态组织和展示。

### 需要扩展的 renderer 层

- `packages/desktop/src/renderer/stores/chat-store.ts`
  - 扩展 `ChatMessage.metadata` 的结构化附件类型。
  - 增加录屏附件、assistant 解析状态、tool capsule 数据。
  - 增加按 session 保存消息的内存隔离能力，或在文档和 UI 中明确最近对话为本地 mock。
  - 增加 `addOrUpdateRecordingAttachment(sessionId, patch)`，让 start / stop / generate / retry / discard 幂等更新同一条用户消息。
  - `addOrUpdateRecordingAttachment` 必须保证同一 recording session 在 start、stop、manifest、generate、retry、discard 全生命周期内只更新同一条用户消息里的同一张附件卡片。

- `packages/desktop/src/renderer/components/InputBar.tsx`
  - 增加任务模式、模型、录屏、图片、语音、发送按钮布局。
  - 录屏按钮调用新的聊天录屏控制逻辑，而不是直接嵌入 `RecordingTeachPanel`。

- `packages/desktop/src/renderer/components/MessageBubble.tsx`
  - 支持用户消息中的录屏附件卡片。
  - 支持 assistant 消息中的步骤列表和工具状态胶囊。

- `packages/desktop/src/renderer/components/Sidebar.tsx`
  - 增加账号信息、UID 占位、积分占位、最近对话标题。
  - 保持本地 mock，不接真实账号系统。

- `packages/desktop/src/renderer/pages/ChatPage.tsx`
  - 调整顶部栏和主区宽度，使主区更接近 Agivar 参考图的对话阅读体验。

### 建议新增的 renderer 文件

- `packages/desktop/src/renderer/components/RecordingAttachmentCard.tsx`
  - 展示录屏缩略图、名称、时长、scope、状态。

- `packages/desktop/src/renderer/components/ToolStatusPill.tsx`
  - 展示 `wait`、`click`、`type`、`observe` 等状态胶囊。

- `packages/desktop/src/renderer/components/RecordingStepList.tsx`
  - 展示由录屏 draft 映射出的步骤说明。

- `packages/desktop/src/renderer/stores/chat-recording-store.ts`
  - 封装主聊天录屏状态。
  - 负责 start/stop/preflight/buildManifest/generateDraft。
  - 把结果写入 `chat-store`。

- `packages/desktop/src/renderer/features/chat-recording/chat-recording-model.ts`
  - 提供纯函数：附件摘要、draft 到 assistant 消息的映射、工具胶囊归一化、错误文案。
  - 作为 Phase 4D 录屏附件和解释消息的唯一模型来源。

## 数据模型

### Chat recording attachment

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
```

`queued`、`processing` 和 `processingPct` 是 Agivar 云处理管线里的有效模型，但 Phase 4D 仍是本地 `buildManifest` + `generateDraft`，暂不把这些状态列入必选实现。后续接云处理或远程录屏分析时再扩展。

### Assistant recording explanation

```ts
export type ChatRecordingExplanation = {
  type: 'recording-explanation';
  sessionId: string;
  summary: string;
  steps: Array<{
    id: string;
    title: string;
    instruction: string;
    evidenceIds: string[];
    toolPills: Array<{
      kind: 'wait' | 'click' | 'type' | 'observe' | 'other';
      label: string;
      status: 'pending' | 'running' | 'done' | 'failed';
    }>;
  }>;
  warnings: string[];
};
```

`ChatMessage.metadata` 可以继续保留 `Record<string, unknown>`，但 Phase 4D 的 helper 和组件应使用上述窄类型，避免 UI 到处读写任意对象。

## 用户流程

### 新录屏解析

1. 用户在输入栏输入目标，例如「帮我播放每日推荐音乐」。
2. 用户点击「录屏」并选择 `active-window` 或 `fullscreen`。
3. UI 调用 `recordingTeach.preflight()`。
4. UI 调用 `recordingTeach.start()`，输入栏进入录制状态。
5. 用户点击停止。
6. UI 调用 `recordingTeach.stop()` 和 `getTimeline()`。
7. `chat-store` 新增或更新一条用户消息，包含录屏附件。
8. UI 调用 `buildManifest()`。
9. `summary` 模式且 manifest 不含 raw text / precise coordinates 时，可以由聊天入口自动确认；`detailed` 模式或 manifest 含敏感标记时，必须展示轻量确认。
10. 用户确认或自动确认后，UI 调用 `generateDraft()`。
11. 生成成功后，`chat-store` 新增一条 assistant 消息，包含自然语言步骤和 tool pills。
12. 生成失败时，同一条用户消息附件更新为 `failed`，并提供重试。

`preflight` 失败时不创建用户消息和录屏附件，只在输入栏显示短错误。典型原因包括权限不足、屏幕录制不可用、磁盘空间不足或 artifact 目录不可写。

当 manifest 需要用户确认时，录屏附件进入 `manifest_ready` 状态，卡片显示「待确认」状态文案或 badge。输入栏主操作变为「确认并生成」，用户可以查看 manifest 摘要、warning 数量和隐私提示后继续。Phase 4D 不在主聊天区直接展示 raw text、precise coordinates 或 artifact path。

### 历史录屏继续解析

1. 用户从左侧最近对话进入历史 session。
2. 聊天消息中仍能看到录屏附件。
3. 用户点击附件上的「重新解析」。
4. UI 调用 `reprocessDraft()`。
5. assistant 消息更新为新的解析结果。

Phase 4D 的最近对话先只保证 renderer 内存态体验，不承诺应用重启后的聊天恢复。持久化聊天历史和跨启动恢复是后续阶段范围。

### 删除录屏附件

1. 用户点击附件菜单中的删除。
2. UI 调用 `recordingTeach.discard(sessionId)`。
3. 附件状态变为 `discarded`，不再显示缩略图。
4. 已有 assistant 解释保留，但显示「本地录屏证据已删除」提示。

## UI 结构

### 左侧栏

宽度保持约 240 px 到 280 px。结构：

- 顶部：轻量品牌区。
- 账号区：头像占位、昵称、UID 截断、积分占位、设置按钮。
- 新对话按钮：虚线边框或浅色按钮。
- 最近：会话列表，当前会话浅色高亮。

账号和积分先使用本地 mock：

- 昵称：本地用户。
- UID：`local-****`。
- 积分：`--` 或本地占位。

### 主聊天区

主区保持大留白，不使用卡片包裹整页。消息最大宽度约 880 px，居中显示：

- 用户普通文本靠右。
- 用户录屏附件跟随用户消息靠右。
- assistant 解析靠左，但内容宽度更大，适合阅读步骤。
- 工具状态胶囊嵌在步骤下方。

### 输入栏

输入栏为底部固定区域，视觉上接近参考图：

- 大输入框。
- 左下控制组：任务模式、模型、录屏、图片。
- 右下控制组：语音、发送。
- 录屏中状态：录屏按钮变为停止，显示计时。
- 生成中状态：发送禁用，附件显示 `generating`。
- `manifesting` 和 `generating` 阶段禁用录屏按钮，避免同一 draft 生成过程中再次 start。
- `manifest_ready` 阶段发送禁用、录屏按钮禁用，主操作显示「确认并生成」，附件状态显示「待确认」。
- `InputBar` 只展示状态并触发 action，不承载录屏流程细节。录屏流程由 `useChatRecordingStore` 暴露 `phase`、`primaryAction`、`error`、`elapsedSeconds` 等状态。

## 隐私与安全

- 默认使用 `summary` 隐私模式。
- `detailed` 模式仍需显式确认；Phase 4D 可以把确认做成录屏按钮弹出的轻量确认。
- 生成 draft 前仍必须基于 `buildManifest()` 结果确认；`summary` 模式只有在 manifest 不含 raw text 和 precise coordinates 时才允许自动确认。
- 主聊天默认不展示 raw text、precise coordinates、artifact path。
- 缩略图只展示本地安全可访问的 keyframe；如果路径不可用，显示占位缩略图。
- discard 后不再尝试读取已删除 artifact。

## 测试策略

### Renderer model tests

新增 `packages/desktop/tests/chat-recording-model.test.ts`：

- timeline 映射为录屏附件摘要；
- draft link 映射为 assistant explanation；
- provider warnings 映射为用户可读提示；
- discard 后附件状态变为 `discarded`；
- tool pill label 归一化。
- `queued` / `processing` 不进入 Phase 4D 必选状态；
- manifest 敏感标记决定是否需要用户确认。

### Component smoke tests

扩展或新增 renderer smoke：

- 聊天页显示左侧账号区和最近对话。
- 输入栏显示任务模式、模型、录屏、图片、发送。
- 用户消息可以渲染录屏附件卡片。
- assistant 消息可以渲染步骤列表和 tool pills。
- 旧消息没有 `attachments` 时正常渲染。
- 未知 attachment type 被忽略或降级展示。
- draft JSON 解析失败时展示 warning，不让页面崩溃。
- discard 后不读取 thumbnail。

### IPC 复用测试

Phase 4D 不新增 IPC。真实录屏 smoke 继续使用：

```powershell
pnpm desktop:smoke-recording-real
```

### 构建验证

```powershell
pnpm vitest run packages/desktop/tests/chat-recording-model.test.ts packages/desktop/tests/phase4a-recording-ui-smoke.test.ts
pnpm --filter @agivar/desktop build
git diff --check
```

## 验收标准

- 主聊天页不再像工程表单，首屏呈现左侧最近对话、中间聊天、底部输入栏。
- 输入栏提供录屏入口，录屏是聊天素材，而不是单独功能页。
- 录屏完成后，用户消息中出现录屏附件卡片。
- draft 生成成功后，assistant 消息展示自然语言解析和步骤。
- 步骤下方能展示 `wait`、`click`、`type` 等工具状态胶囊。
- provider、manifest、history、discard 等 Phase 4B/4C 能力仍可通过底层 IPC 复用。
- `RecordingTeachPanel` 保留为开发和调试入口。
- 不引入云同步、向量检索或静默上传。
- 不新增主进程 IPC，不重命名现有 `recordingTeach:*`。
- 录屏附件状态更新具备幂等性，失败、重试和 discard 不重复插入用户消息。
- 最近对话明确为 Phase 4D renderer 内存态体验，不承诺跨启动恢复。
- 相关 renderer tests、desktop build 和真实录屏 smoke 均可通过。
