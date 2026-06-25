# Phase 4D Chat Recording UX Closure

## 范围

Phase 4D 已按路径 A 实施：先交付 Agivar-like 聊天录屏 UX，后续再单独进入 Phase 4E hardening。

本阶段只改 renderer 体验层和录屏链路编排层，复用现有 `recordingTeach:*` IPC。未新增主进程 IPC，未重命名通道，未引入云同步、向量检索或账号后端。

## 已完成

- 新增聊天录屏模型：`packages/desktop/src/renderer/features/chat-recording/chat-recording-model.ts`
  - `ChatRecordingAttachment`
  - `ChatRecordingExplanation`
  - `requiresManifestConfirmation`
  - `mergeRecordingAttachments`
  - draft link 到 assistant explanation 映射

- 新增 renderer store：`packages/desktop/src/renderer/stores/chat-recording-store.ts`
  - `startRecording`
  - `stopAndGenerate`
  - `confirmManifestAndGenerate`
  - `retryGeneration`
  - `discardAttachment`
  - `preflight` 失败不创建消息，只回写输入栏错误

- 扩展 `chat-store`
  - `messagesBySessionId`
  - session 内存隔离
  - `addRecordingUserMessage`
  - `addRecordingAssistantMessage`
  - `addOrUpdateRecordingAttachment`

- 新增聊天录屏 UI 组件
  - `RecordingAttachmentCard`
  - `RecordingStepList`
  - `ToolStatusPill`

- 改造主聊天体验
  - 用户消息可显示录屏附件卡片
  - assistant 消息可显示录屏解析步骤和 tool pills
  - `manifest_ready` 显示「待确认」和「确认并生成」
  - `manifesting` / `generating` / `manifest_ready` 禁用录屏按钮，避免并发 start
  - 侧边栏、主聊天区、输入栏调整为 Agivar-like 浅色对话形态

- 回归修复
  - Phase 4A UI smoke 的 `recordingTeach` mock 补齐 `listProviders`、`listSessions`、`preflight` 等现有初始化依赖。

## 明确未做

- IPC 全量常量化。
- `recordingTeach:*` 到 `recording:*` 的通道重命名。
- 新增主进程 `recordingTeach:stateChanged` 事件。
- service 注册重构。
- 单实例锁。
- `EnvConfig` 全覆盖。
- 多窗口 recording bar。
- 录屏选择器。
- 云端 `queued` / `processing` 管线。
- `.rz` 归档或加密格式。
- 真实账号、积分系统。
- 持久化聊天历史完整实现。

## 测试结果

已通过：

```powershell
pnpm vitest run packages/desktop/tests/chat-recording-model.test.ts packages/desktop/tests/phase4d-chat-recording-ui-smoke.test.tsx packages/desktop/tests/chat-store.test.ts packages/desktop/tests/chat-recording-store.test.ts
```

结果：4 个测试文件，15 个测试通过。

```powershell
pnpm vitest run packages/desktop/tests/phase4a-recording-ui-smoke.test.ts packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/recording-teach-ipc.test.ts
```

结果：3 个测试文件，34 个测试通过。

```powershell
pnpm --filter @agivar/desktop build
```

结果：构建通过。存在既有 Vite / Playwright eval 和 external dependency warning，不阻塞本阶段。

```powershell
pnpm desktop:smoke-recording-real
```

结果：Phase 4C real recording smoke passed。

真实 smoke 观察：

- active-window start / stop 成功。
- active-window `nativeTargetHwnd` 为 `393568`，不再是 `0`。
- active-window 捕获 4 个 keyframes。
- fullscreen start / stop 成功。
- fullscreen 捕获 4 个 keyframes。
- manifest / draft / history / resume / reprocess / discard 链路通过。

## 风险和后续

- Phase 4D 的最近对话仍是 renderer 内存态，不承诺跨启动恢复。
- `chat-recording-store` 当前依赖 active chat session；后续若做持久化历史，需要补恢复策略。
- Phase 4E 可继续处理 key-findings hardening：IPC 常量化、状态事件推送、环境变量治理、单实例锁和 service 注册重构。
