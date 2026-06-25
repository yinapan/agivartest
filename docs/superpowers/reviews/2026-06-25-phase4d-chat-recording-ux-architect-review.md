# Phase 4D Chat Recording UX 架构审查报告

## 总体结论

Phase 4D 方案 **需调整后可行**。

方向是正确的：复用 `recordingTeach.*`、保留 `RecordingTeachPanel`、把录屏作为聊天附件迁移到主聊天体验，这些都能保护 Phase 4C 已跑通的真实录屏链路。Agivar-like 页面映射也基本完整：左侧最近对话、主聊天、录屏附件、assistant 解析步骤、tool pill、底部输入栏都有覆盖。

主要风险在于当前 Phase 4D 计划把「产品 UX 落地」和「IPC 常量化、事件推送、启动架构重构」混在一起。建议 Phase 4D 限定为 **renderer 体验层 + 录屏链路编排层**，不要在同一阶段大改主进程 IPC 架构。

## 必须修正的问题

### 1. Phase 4D 范围过大，补充设计混入高风险架构改造

涉及文件：

- `docs/superpowers/specs/2026-06-25-agivar-key-findings-implementation-design.md`
- `packages/desktop/src/main/ipc.ts`
- `packages/desktop/src/preload.ts`

问题：

IPC 常量化、`recordingTeach:stateChanged`、`EnvConfig`、单实例锁、service 注册重构都不是 Agivar-like UX 的必要前置。当前 `ipc.ts` 和 `preload.ts` 仍使用硬编码通道，批量替换会直接触碰 Phase 4C 已跑通链路。

建议：

- Phase 4D 只允许新增 renderer store、model 和组件。
- 主进程最多补低风险 preload 订阅 API；如果要做 IPC 常量化，应拆到 Phase 4E 或架构 hardening。
- 不在 Phase 4D 中直接重命名 `recordingTeach:*`。

### 2. 最近对话 / 历史会话目标与当前聊天存储不匹配

涉及文件：

- `packages/desktop/src/renderer/stores/chat-store.ts`
- `packages/desktop/src/main/ipc.ts`

问题：

`chat-store` 当前只有全局 `messages`，`switchSession` 只改 active id，不按 session 加载消息。`session:list/create/getMessages` 在主进程也是空实现。Phase 4D 若把「最近对话」和「历史录屏继续解析」作为真实验收目标，会不成立。

建议：

- 文档明确：Phase 4D 的最近对话先是本地内存 mock，不承诺重启后恢复。
- 或先实现 `messagesBySessionId`，让当前会话切换至少在 renderer 内存中成立。
- 持久化聊天历史放到后续阶段，不放进 Phase 4D 必选范围。

### 3. 录屏附件状态更新缺少单一写入边界

涉及文件：

- `packages/desktop/src/renderer/stores/chat-store.ts`
- Phase 4D 计划中的 `chat-recording-store.ts`

问题：

计划流程是 stop 后先写用户消息，再 build manifest / generate draft。失败、重试、discard 都需要更新同一个附件，但当前 store 只有 `updateMessage(id)`，没有 `sessionId -> messageId` 映射，也没有附件级 update helper。

建议：

在 Phase 4D 计划中新增 helper：

```ts
addOrUpdateRecordingAttachment(sessionId, patch)
```

并要求 start / stop / generate / retry / discard 幂等更新同一条消息，避免重复插入附件卡片。

### 4. Manifest 确认边界描述前后冲突

涉及文件：

- `packages/desktop/src/renderer/pages/RecordingTeachPanel.tsx`
- `docs/superpowers/specs/2026-06-24-phase4d-agivar-like-chat-recording-ux-design.md`

问题：

设计非目标写了「不绕过 Phase 4B manifest 确认边界」，但用户流程里 `buildManifest()` 后自动 `generateDraft()`。现有工程面板是用户先 `Build manifest`，再点 `Confirm & generate`。聊天入口不能无声跳过这个边界。

建议：

- `summary` 模式可自动确认，但必须在文档中写清楚条件。
- `detailed` 模式或 manifest 含 raw text / precise coordinates 时，聊天入口必须展示确认 affordance。
- 生成失败或用户取消确认时，附件保持 `stopped` 或 `manifest_ready`，允许用户重试。

### 5. 数据模型状态枚举不统一

涉及文件：

- `packages/desktop/src/renderer/pages/recording-teach-model.ts`
- `docs/phase4d-recording-attachment-data-model.md`
- `docs/superpowers/specs/2026-06-24-phase4d-agivar-like-chat-recording-ux-design.md`

问题：

UX 设计使用 `generating`，反编译补充文档建议 `queued / processing`，现有 `RecordingSessionDto.status` 使用 `ready / draft_ready / failed / discarded`。状态不统一会让 UI 和 store 分叉。

建议：

Phase 4D 定义 canonical renderer 状态：

```ts
type ChatRecordingStatus =
  | 'recording'
  | 'stopped'
  | 'manifesting'
  | 'manifest_ready'
  | 'generating'
  | 'draft_ready'
  | 'failed'
  | 'discarded';
```

`queued`、`processing`、`processingPct` 作为未来云处理扩展，不进入 Phase 4D 必选项。

### 6. 事件推送方案与「不新增 IPC」目标冲突

涉及文件：

- `packages/desktop/src/preload.ts`
- `docs/superpowers/specs/2026-06-25-agivar-key-findings-implementation-design.md`

问题：

Phase 4D 设计说「不新增 IPC」，补充设计又要求新增 `recordingTeach:stateChanged`。这会扩大回归面。

建议：

二选一：

- Phase 4D 继续基于现有 invoke 编排，不做事件推送。
- 或把事件推送作为独立 P0 架构任务，配套 `recording-teach-ipc.test.ts` 和真实录屏 smoke 回归。

推荐 Phase 4D 先不做事件推送。

## 建议增强项

### 1. 调整模型文件位置

`chat-recording-model.ts` 是纯模型，不属于页面层。建议放到：

- `packages/desktop/src/renderer/features/chat-recording/chat-recording-model.ts`

或：

- `packages/desktop/src/renderer/models/chat-recording-model.ts`

### 2. 组件测试覆盖 metadata 兼容性

Phase 4D 组件 smoke 不应只断言文字存在，还应覆盖：

- 旧消息没有 `attachments`；
- 未知 attachment type；
- draft JSON 解析失败；
- discard 后不读取 thumbnail；
- warnings 能低干扰展示。

### 3. `InputBar` 不应成为流程控制器

当前 `InputBar.tsx` 已经负责发送任务。录屏流程应由 `useChatRecordingStore` 暴露：

- `phase`
- `primaryAction`
- `error`
- `elapsedSeconds`

`InputBar` 只负责展示按钮和触发 action。

### 4. 主聊天入口复用 model，不复用工程面板 UI

`RecordingTeachPanel` 状态很完整，但 UI 是工程面板。Phase 4D 应保留它作为开发入口，主聊天入口只复用 model/helper 和 IPC 编排，不直接嵌入该组件。

### 5. Smoke 分层

建议分两类验证：

- 静态 renderer smoke：不依赖真实录屏，验证聊天页、附件卡片、tool pill、步骤列表。
- 真实 Electron smoke：验证 Phase 4C 链路未破坏，再额外验证聊天入口能生成一次最小录屏附件。

## 建议调整后的 Phase 4D 实施顺序

1. 先做 `chat-recording-model.ts` 和测试，统一附件、解释、tool pill、状态映射。
2. 做 `RecordingAttachmentCard`、`RecordingStepList`、`ToolStatusPill`，扩展 `MessageBubble` 静态渲染。
3. 改 `chat-store`，加入附件消息 helper、session 内存隔离、附件状态更新能力。
4. 新增 `chat-recording-store`，只用现有 `recordingTeach.*` invoke 编排 start / stop / timeline / manifest / generate。
5. 改 `InputBar` 接入录屏按钮和状态，确保失败、重试、discard 更新同一条消息。
6. 最后调整 `Sidebar`、`ChatPage`、`ChatView` 视觉布局。
7. 跑 `chat-recording-model.test`、Phase 4D renderer smoke、`pnpm --filter @agivar/desktop build`、`pnpm desktop:smoke-recording-real`。

## 不建议纳入 Phase 4D 的内容

以下内容方向合理，但不建议纳入 Phase 4D：

- IPC 全量常量化；
- service 注册重构；
- 单实例锁；
- `EnvConfig` 全覆盖；
- 多窗口 recording bar；
- 录屏选择器；
- 云端 `processing / queued` 管线；
- `.rz` 归档 / 加密；
- 真实账号 / 积分系统；
- 持久化聊天历史完整实现。

这些会扩大 Phase 4D 回归面。Phase 4D 最好只证明一件事：真实 Phase 4C 录屏链路可以作为聊天附件被自然消费，并生成 assistant 解析消息。
