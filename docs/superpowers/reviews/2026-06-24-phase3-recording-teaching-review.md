# Phase 3 Recording Teaching 设计审查

> 审查对象：`docs/superpowers/specs/2026-06-24-phase3-recording-teaching-design.md`
> 交叉验证：`packages/core/src/tools/recorder.ts`、`packages/core/src/types/workflow.ts`、`packages/desktop/src/preload.ts`、`packages/core/src/memory/schema.ts`

## 总体评价

设计文档质量高，安全边界清晰（provider 不直接接触文件系统、manifest 确认两步走、summary 默认模式），与 Phase 2 的衔接合理（生成 draft 进入已有编辑器、复用 `WorkflowDraft` 校验链）。以下聚焦于**与现有代码的冲突点**、**缺失的关键细节**、和**实施顺序问题**。

---

## 一、与现有代码的冲突和模糊点

### 1. (P0) 事件捕获需要 Windows 全局钩子 — 现有 `input` 模块不支持

**现有代码**：[recorder.ts](packages/core/src/tools/recorder.ts) 的 `input` 模块只有主动操作（`clickPoint`、`typeText`、`pressKeys`），**没有被动事件监听能力**。

捕获用户鼠标/键盘事件需要 `SetWindowsHookEx` (WH_MOUSE_LL / WH_KEYBOARD_LL) 或 Raw Input API，这些是 native addon 层面的事，不是 Core 纯 TypeScript 层能解决的。

**现有依赖链**：
- `input.clickPoint(x, y)` → 主动模拟点击，不监听用户真实点击
- `input.typeText(text)` → 主动模拟输入，不捕获用户真实键盘

**建议**：设计文档应增加一节说明事件捕获的 native 依赖：
1. 需要 native addon 暴露 `startEventCapture(sessionId, config)` / `stopEventCapture(sessionId)`
2. 事件回调通过 N-API thread-safe 机制（`napi_threadsafe_function`）推送到 Node.js 主线程
3. 在 Phase 3B 之前，应先完成 native addon 的事件捕获能力
4. 或者，Phase 3D 明确标注为"依赖 native addon 事件捕获 PR"

### 2. (P1) `RecordingSessionService` 与已有的 `recorder.ts` 关系不清

**现有代码**：[recorder.ts](packages/core/src/tools/recorder.ts) 已经管理了 `captureSessions` Map，有 `startRecording`、`stopRecording`、`getRecordingStatus`、`forceStopAllRecordings`。

设计文档的 `RecordingSessionService` 也管理 session lifecycle（start/stop/status）。两者是什么关系？

| 可能关系 | 影响 |
|----------|------|
| `RecordingSessionService` **替代** recorder.ts | 大重构，需重写所有现有 recorder IPC handler |
| `RecordingSessionService` **包装** recorder.ts | 委托 `startRecording`/`stopRecording`，自己负责元数据和状态机 |

**建议**：在设计的 Architecture 小节增加一句：

> `RecordingSessionService` 通过委托已有的 `recorder.startRecording` / `recorder.stopRecording` 实现视频录制，自身只负责 session 状态机（idle→recording→stopping→ready）、元数据持久化到 `recording_sessions` 表和 artifact 目录管理。

### 3. (P1) `recorder:*` vs `recordingTeach:*` 两个 IPC 命名空间容易混淆

**现有代码**：[preload.ts:41-44](packages/desktop/src/preload.ts#L41-L44)

```ts
recorder: {
  start: (config) => ipcRenderer.invoke('recorder:start', config),
  stop: (sid) => ipcRenderer.invoke('recorder:stop', sid),
  forceStopAll: () => ipcRenderer.invoke('recorder:forceStopAll'),
},
```

设计文档新增 `recordingTeach:start`、`recordingTeach:stop` 等。未来开发者看到 `recorder:start` 和 `recordingTeach:start` 会困惑两者的区别。

**建议**：在设计文档中加一句说明：
- `recorder:*` = 低层视频/帧捕获（Phase 0 已有，native addon 驱动）
- `recordingTeach:*` = 教学录制的编排层（Phase 3 新增，内部委托 `recorder:*` + 事件捕获 + 上下文采样 + session 持久化）

### 4. (P1) `WorkflowMemoryVersion.source` 类型需要扩展

**现有代码**：[workflow.ts:81](packages/core/src/types/workflow.ts#L81)

```ts
source: 'create' | 'edit' | 'rollback' | 'import' | 'text-teach';
```

设计文档多处要求 source 新增 `'recording-teach'`。这是一个小的类型变更，但需要同步修改：

1. `workflow.ts` 中 `WorkflowMemoryVersion.source` 的联合类型
2. `schema.ts` migration 4 中 `workflow_memory_versions.source` 的 CHECK 约束
3. `memory-store.ts` 中 `insertVersion` 的类型签名

**建议**：在 Phase 3A 的 types 任务中显式列出此变更，避免遗漏 schema CHECK 约束。

---

## 二、设计缺失的关键细节

### 5. (P0) 未定义 `RecordingWorkflowProvider` 接口

Phase 2 设计明确定义了 `TextTeachingProvider`：

```ts
export interface TextTeachingProvider {
  generateWorkflowDraft(request: TextTeachingRequest): Promise<WorkflowDraft>;
}
```

Phase 3 反复提到 "provider" 但未定义接口。建议在设计文档 "RecordingWorkflowExtractor" 小节补充：

```ts
export interface RecordingWorkflowProvider {
  generateWorkflowDraft(
    timeline: RecordingTimeline,
    manifest: ProviderPayloadManifest,
  ): Promise<{
    draft: WorkflowDraft;
    evidence: StepEvidenceLink[];
    warnings: string[];
    rawResponse?: unknown;
  }>;
}
```

同时定义 `StepEvidenceLink` 类型（目前只在数据模型表格中以字段列表形式出现）：

```ts
export interface StepEvidenceLink {
  id: string;
  sessionId: string;
  stepId: string;
  eventIds: string[];
  keyframeIds: string[];
  contextIds: string[];
  confidence: number;   // 0-1
  rationale: string;
}
```

### 6. (P0) `generateDraft` 生成的 draft 存在哪里？

设计文档说 "`recordingTeach:generateDraft` returns an unsaved draft wrapper ... It must not write `workflow_memories`"（line 199-200）。但如果用户在生成 draft 后关闭了应用，draft 应该能恢复。

当前设计没有指定 draft 的临时存储策略。

**建议**：明确临时存储策略。推荐方案：

1. 生成后自动写入 `recording_draft_links` 表（含完整 draft JSON 序列化）
2. Session 状态变为 `draft_ready`
3. 用户保存时，draft 通过 Phase 2 编辑器的 `memory:saveDraft` 进入 `workflow_memories`
4. 应用重启时，检查是否有 `draft_ready` 状态的 session 并恢复 UI 到 draft review 状态
5. `recordingTeach:discard` 清理 draft_links 和 session

### 7. (P2) `active-window` scope 的 HWND 解析途径未显式说明

设计文档提到 full-screen 和 active-window 两种 scope。现有 `recorder.ts` 接受 `targetHwnd?: number`。active-window scope 需要获取当前前台窗口的 HWND。

**现有链路是通的**：`screenshot.getActiveWindow()` → 返回 `{ hwnd, title, ... }` → HWND 传给 `recorder.startRecording({ targetHwnd })`。

**建议**：在设计文档 Desktop Integration 小节显式写出这个调用链，避免实施时遗漏。

### 8. (P2) 6 个新表的 schema migration 版本号未分配

当前 schema 有 3 个 migration（v1 initial, v2 programmatic log fields, v3 workflow_memory_versions）。Phase 3 新增 6 个表。

**建议**：按 Phase 3 子阶段分配 migration 版本：

| Migration | 子阶段 | 表 |
|-----------|--------|-----|
| v4 | 3B | `recording_sessions`、`recording_events`、`recording_keyframes`、`recording_context_snapshots` |
| v5 | 3E | `recording_draft_links`、`provider_payload_manifests` |

3B 的表先建（session/artifact 生命周期需要），3E 的表后建（draft link 和 manifest 在生成阶段才需要）。

### 9. (P2) 基准测试的 5 个代表性录屏未指定

设计文档要求 "5 个代表性录屏，至少 3 个产生结构完整的 draft"。但未定义"代表性"是什么。验收时可能产生争议。

**建议**：给出具体场景列表：

1. **简单文本输入**：打开 Notepad，输入一段文字，保存
2. **多窗口操作**：浏览器复制文本 → 粘贴到编辑器 → 切换窗口
3. **快捷键密集操作**：Ctrl+N 新建、Ctrl+S 保存、Alt+Tab 切换
4. **纯鼠标导航**：资源管理器中点击展开文件夹、打开文件
5. **混合表单填写**：多个输入框 + 下拉选择 + 点击确认按钮

### 10. (P2) `recording_keyframes.hash` 算法未指定

数据模型中 keyframe 有 `hash` 字段用于去重，但未指定 hash 算法（SHA-256? MD5? perceptual hash?）。

**建议**：指定使用 SHA-256 对文件内容做 hash，用于精确去重。如果后续需要视觉相似度去重（临近帧可能内容相同但 hash 不同），可以再加 `perceptual_hash` 字段。

---

## 三、实施顺序问题

### 11. (P1) Phase 3C (Keyframes) 与 Phase 3D (Events) 的顺序不合理

设计文档的 `ContextSampler` 要求 "capture around interaction events"（line 143）。没有事件捕获，无法做到"围绕交互事件采样"。但 Phase 3C 做 keyframes，Phase 3D 才做 events。

**建议**：
- **方案 A（推荐）**：合并 3C 和 3D 为一个阶段 `3CD: Keyframes + Events + Context`，因为三者互相依赖
- **方案 B**：3C 只做**等间隔 keyframe**（基于计时器的 `startFrameCapture`，现有能力已支持），3D 再做事件驱动的**智能采样**。等间隔 keyframe 独立可用，只是会产生更多冗余帧

如果选方案 B，ContextSampler 的 "capture around interaction events" 策略应移到 Phase 3D 实现，3C 只保证等间隔帧落盘。

### 12. (P2) Phase 3A "simulated timeline" 的 fixture 格式应提前约定

3A 的核心产出是 extractor 能接受 simulated timeline 并生成有效 draft。但 simulated timeline 需要包含什么数据？

**建议**：在 Phase 3A 中指定至少准备 3 个 fixture：

1. **完整 timeline**（happy path）：keyframes + events + context + notes，summary mode，期望 extractor 生成有效 draft
2. **最小 timeline**（边界）：仅 events + notes，无 keyframes 和 context，期望 extractor 仍能生成基本 draft（含 warnings）
3. **错误 timeline**（error path）：空 events、缺失 session metadata，期望 extractor 返回 validation errors

---

## 四、隐私与安全补充

### 13. (P2) keyframe 的像素级隐私风险需要更明确的 UX 警告

设计文档在 line 335 诚实地说：

> "Summary mode only redacts event payloads by default. It does not guarantee that keyframe pixels are safe."

这意味着即使 summary mode，截图中的密码、银行卡号等**仍然可见**。当前设计依赖用户手动删除敏感 keyframe，但 "summary mode" 这个名称可能让用户误以为截图也被处理了。

**建议**：在录制开始前的 setup panel 中，对 summary mode 增加明确警告文案：

> "摘要模式仅屏蔽事件中的原始文本和坐标，截图不会被自动打码。如果你的操作中涉及密码、银行卡号等敏感信息，请在生成草稿前在时间线中手动删除相关截图。"

### 14. (P2) 缺少对旧 recording session 的自动清理策略

设计文档的 failure handling 提到 "Disk quota or artifact write failure"，但没有主动的磁盘配额管理。视频录制会快速消耗磁盘空间。

**建议**：增加一个软性策略：
- 启动时检查 artifact 目录总大小
- 超过阈值（如 500MB）时提示用户清理
- `discard` 操作应删除物理文件（当前设计中提到了 best-effort 删除，但没有具体说明删除哪些路径）

---

## 五、测试策略补充

### 15. (P2) 缺少 recorder 与 recording teaching 协作的单元测试

现有 `recorder.ts` 有良好的 `ToolResult` 返回类型。应增加测试：

- `RecordingSessionService.start()` 在 `recorder.startRecording()` 失败时正确返回 `failed` 状态，而非 crash
- 事件捕获线程安全：模拟高频事件（100+ events/sec）不会导致 session 状态损坏
- artifact 删除后，evidence link 引用的 keyframe/event ID 应被标记为 `dangling` 而非静默返回 null 或导致 UI 崩溃
- `forceStopAllRecordings()` 被调用后，所有 session 状态正确过渡到 `failed` 或 `ready`

---

## 六、与 Phase 2 的衔接验证

以下衔接点是正确的，不需要修改：

- `WorkflowDraft.sourceType` 已预留 `'recording'` ✓
- `WorkflowMemory.sourceType` 已预留 `'recording'` ✓
- Phase 2 的 `memory:saveDraft` IPC 可以直接接受 `sourceType: 'recording'` 的 draft ✓
- Phase 2 的 `validateWorkflowDraft()` 对 sourceType 不做限制，recording draft 可以直接通过校验 ✓

以下衔接点需要确认：

- `WorkflowMemoryVersion.source` 需要新增 `'recording-teach'`（当前类型定义不包含）△
- Phase 2 `WorkflowsPage` 的列表筛选是否能按 `sourceType` 过滤？当前 `memory:list` 只支持 `appName` 和 `topic` 过滤，recording workflow 可能需要按 sourceType 分类查看

---

## 总结

| 优先级 | 问题 | 类型 |
|--------|------|------|
| **P0** | 事件捕获需 native addon 支持（SetWindowsHookEx），设计未规划 | 缺失依赖 |
| **P0** | `RecordingWorkflowProvider` 接口未定义 | 缺失设计 |
| **P0** | `generateDraft` 的临时存储策略未明确（关应用后 draft 丢失？） | 缺失设计 |
| **P1** | `RecordingSessionService` 与已有 `recorder.ts` 关系不清晰 | 架构冲突 |
| **P1** | `recorder:*` vs `recordingTeach:*` 命名空间易混淆 | 架构冲突 |
| **P1** | 3C/3D 实施顺序（keyframes 需要 events 才能做智能采样） | 顺序问题 |
| **P1** | `WorkflowMemoryVersion.source` 需要加 `'recording-teach'` | 类型遗漏 |
| **P2** | 6 个新表的 migration 版本号未分配 | 实施细节 |
| **P2** | 基准测试的 5 个录屏场景未定义 | 验收模糊 |
| **P2** | summary mode 名称可能误导用户（截图不打码） | UX 风险 |
| **P2** | active-window HWND 解析途径未显式说明 | 实施细节 |
| **P2** | `recording_keyframes.hash` 算法未指定 | 实施细节 |
| **P2** | 缺少旧 session 的磁盘自动清理策略 | 运维风险 |
| **P2** | `memory:list` 不支持按 sourceType 过滤 | 衔接缺口 |
