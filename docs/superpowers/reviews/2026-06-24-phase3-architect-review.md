# Phase 3 架构师审查报告

## 总体结论

**Go with changes。**

设计方向整体正确：Phase 3 明确建立在 Phase 2 的 `WorkflowDraft`、结构化编辑器、验证、版本历史之上；也明确排除了云同步、向量检索和自动执行，这与用户已选择的方案 C 一致。文档对本地优先、显式录制、provider 注入、失败降级和可测试性都有基本覆盖。

但当前设计还不适合直接进入完整实现。主要问题集中在：隐私边界不够硬、数据模型缺少 evidence 和 artifact 生命周期字段、Core/Desktop/native 边界仍偏概念化、实施拆分过大，以及与 Phase 2 versioning/source 语义存在未对齐点。建议先把这些约束补进设计文档，再进入 Phase 3 实施。

## 关键风险

### Critical

**[必须修复] Provider payload 和本地 raw artifact 边界不够可验证**

涉及章节：`MultimodalTimeline`、`Provider Payload Policy`、`Safety And Privacy`

问题：设计说 timeline 包含本地 artifact path，provider payload preparation 决定发送哪些内容，但没有定义可审计的 payload manifest、字段白名单、大小限制、raw text/raw coordinates/keyframes 的过滤规则。`summary mode` 仍会保存关键帧，而关键帧本质上可能包含密码、客户数据、聊天内容等敏感像素；当前文档容易让人误以为 summary mode 已经足够脱敏。

建议：把 provider 调用改成显式两阶段：先生成 `ProviderPayloadPreview/Manifest`，用户确认后再发送。manifest 至少包含 data classes、keyframe ids、event ids、context ids、是否包含 raw text、是否包含 precise coordinates、估算大小、provider name、redaction mode。summary mode 下 `raw_payload_json` 必须为空或仅保存 redacted payload，不能靠调用方自觉过滤。

**[必须修复] artifact 删除和 evidence 引用缺少一致性约束**

涉及章节：`User Experience`、`Data Model`、`Provider Payload Policy`

问题：用户可以删除敏感 frames/events，但设计没有说明删除后如何同步更新 timeline、context、draft evidence link、provider payload selection 和本地文件。若只删 UI 记录不删物理文件，或者 evidence 仍引用已删除 keyframe，会形成隐私和一致性问题。

建议：设计中增加 artifact lifecycle：`active`、`excluded`、`deleted`。删除必须同时更新 DB/JSON 元数据、物理文件、payload selection 和 evidence mapping；已删除 artifact 不得进入 provider payload，也不得在 editor evidence preview 中展示。

### Important

**[建议修改] Core / Desktop main / native 职责边界还不够落地**

涉及章节：`Architecture`、`Desktop Integration`

问题：文档说 Core owns session lifecycle，Desktop owns platform-specific capture，但 `EventCaptureService`、`ContextSampler` 实际依赖 native mouse/keyboard hook、active window、UIA、screenshot。当前没有明确哪些是纯 Core 编排，哪些是 Desktop adapter，哪些是 native low-level API。

建议：补充边界表：

- Core：类型、状态机、redaction、timeline builder、extractor、validation、storage repository interface。
- Desktop main：IPC、权限/确认、artifact 目录管理、provider payload assembly、adapter wiring、app quit cleanup。
- native：录屏、截图、UIA、窗口枚举、输入事件采集的低层能力，不持有业务状态。
- Renderer：只展示 DTO 和用户选择，不直接访问任意本地路径。
- Provider：只接收经过 manifest 过滤后的 payload，不接收 loose artifact bag。

**[建议修改] Phase 3 实施范围过大，不适合一轮完成**

涉及章节：`Implementation Order`

问题：当前 implementation order 从 session、event、extractor、storage、IPC、renderer、真实录屏、benchmark 一次性铺开，风险较高。尤其全局输入事件采集、UIA context、关键帧采样、多模态 provider、evidence preview 都是独立复杂点。

建议：拆成可验收的内部 slice，先用 simulated timeline 打通 Phase 2 editor，再逐步接入真实录屏和事件采集。

**[建议修改] 数据模型不足以支撑 evidence link 和审计**

涉及章节：`Data Model`、`RecordingWorkflowExtractor`

问题：`recording_draft_links` 只列了表名，没有字段。当前模型也缺少 context snapshot 字段、provider payload manifest、draft id / memory id / version 关联、step-to-evidence mapping、confidence、included/excluded 状态。

建议：至少补充：

- `recording_context_snapshots`: `id`、`session_id`、`timestamp_ms`、`kind`、`summary_json`、`source`、`warning`。
- `recording_draft_links`: `id`、`session_id`、`draft_id` 或 `memory_id/version`、`step_id`、`event_ids_json`、`keyframe_ids_json`、`context_ids_json`、`confidence`、`rationale`。
- `provider_payload_manifests`: `id`、`session_id`、`provider_name`、`selected_artifact_ids_json`、`redaction_policy_json`、`created_at`、`status`。

**[建议修改] 与 Phase 2 versioning/source 语义未完全对齐**

涉及章节：`Edit And Save`、`RecordingWorkflowExtractor`、Phase 2 `MemoryStore Versioning`

问题：Phase 3 要保存 `sourceType: 'recording'`，但 Phase 2 的 version source 设计是 `create | edit | rollback | import | text-teach`。如果实现时把 version source 写成 `recording` 会与已有约束冲突；如果写成 `create` 又会丢失录屏来源审计语义。

建议：设计明确二选一：

- 方案一：version source 新增 `recording-teach`。
- 方案二：version source 仍为 `create`，来源以 snapshot 内的 `sourceType: 'recording'` 和 `recording_draft_links` 审计。

建议采用方案一，语义更清楚。

**[建议修改] 录屏稳定性验收缺少关键失败恢复场景**

涉及章节：`Failure Handling`、`Testing Strategy`、`Acceptance Criteria`

问题：已有 “five-cycle start/stop no leak”，但还缺 app quit、renderer crash、stop timeout、concurrent start、disk full、artifact write failure、active window handle invalid、RDP/远程桌面降级、多显示器 DPI、UIA timeout circuit breaker 等验收。

建议：增加稳定性验收项：启动时清理 orphan active sessions；app quit 必须 `forceStopAllRecordings`；同一时间默认只允许一个 recording session；stop 超时后进入 `failed` 并释放 native/session resources；远程桌面检测到不稳定时展示 degraded warning，并允许 screenshots-only 或跳过真实录屏 smoke。

### Minor

**[仅供参考] Quality benchmark 的 “structurally complete” 需要定义**

涉及章节：`Quality benchmark`、`Acceptance Criteria`

建议定义为：通过 `WorkflowDraft` validation；至少包含 topic、summary、successCriteria、2 个以上 steps；每个 step 有 intent、targetHint、riskLevel；关键步骤至少有 1 个 evidence link；没有 forbidden/high-risk 未标注风险的问题。

**[仅供参考] IPC namespace 合理，但需要 DTO 类型边界**

涉及章节：`Desktop Integration`

建议明确 preload/renderer 使用显式 DTO，不使用宽泛 `any`；所有 `recordingTeach:*` handler 必须有 runtime schema、字符串长度限制、路径 id 校验和稳定 `{ ok, data, error }`。

## 建议合并到设计的修改

1. 在 `Provider Payload Policy` 增加 `ProviderPayloadManifest`：provider 调用前必须生成可预览 manifest，列出将发送的数据类别、artifact ids、raw text/coordinates 是否包含、payload 大小和 redaction policy；用户确认后才能调用 provider。
2. 在 `Safety And Privacy` 明确：summary mode 只保证事件 payload 默认脱敏，不代表关键帧像素已脱敏；关键帧发送 provider 前必须由用户选择或确认。
3. 在 `Data Model` 补充 artifact lifecycle 字段：`status: active | excluded | deleted`、`deleted_at`、`hash`、`file_size`、`mime_type`、`included_in_provider`。
4. 补全 `recording_draft_links` 字段，用于保存 `step_id -> event/keyframe/context` 的 evidence mapping，并说明删除 artifact 后 evidence link 必须失效或隐藏。
5. 明确 Phase 2 保存路径：`recordingTeach:generateDraft` 只返回 unsaved draft wrapper，不写 workflow memory；用户进入 Phase 2 editor 后通过现有 save path 保存，保存后 `sourceType = 'recording'`。
6. 更新 versioning 语义：新增 version source `recording-teach`，或明确继续使用 `create` 并依赖 `sourceType` + `recording_draft_links` 审计。
7. 在 `Architecture` 增加职责边界表，明确 Core、Desktop main、Renderer、native、provider 各自不能做什么。
8. 在 `Failure Handling` 增加 app quit cleanup、startup orphan cleanup、concurrent session rejection、stop timeout、disk quota/write failure、remote desktop degraded mode。
9. 在 `Testing Strategy` 增加 provider payload redaction tests、artifact delete consistency tests、evidence link tests、app quit cleanup tests、RDP/degraded-mode manual smoke。

## 建议的实施拆分

1. **Phase 3A：类型、schema、simulated timeline**
   建立 recording session/timeline/evidence 类型、runtime validation、JSON/SQLite 存储接口，用模拟数据打通 extractor 到 Phase 2 editor。
2. **Phase 3B：本地 session 和 artifact lifecycle**
   实现 session 状态机、artifact 目录、删除/排除/清理逻辑、IPC 稳定结果，不接真实 provider。
3. **Phase 3C：关键帧和基础录屏**
   接入 full-screen / active-window start-stop、关键帧采样、五轮 start/stop、app quit cleanup、远程桌面降级提示。
4. **Phase 3D：事件和 context**
   加入 event summary、window context、UIA snapshot，先 summary mode 默认可用，detailed mode 单独 opt-in。
5. **Phase 3E：provider payload 和 draft generation**
   实现 payload manifest、用户选择、provider 调用、warnings、evidence mapping，确保生成 draft 只进入 Phase 2 editor。
6. **Phase 3F：benchmark 和 hardening**
   运行 5 个代表性录制样本，记录通过率、失败原因、资源泄漏、provider payload 审计结果。

## 不建议做的内容

- 不建议 Phase 3 一次性实现完整全局键盘 raw text 捕获；先做 summary event 和 explicit detailed opt-in，避免把输入采集做成不可控 keylogger。
- 不建议保存或上传完整 raw video 给 provider；默认只用用户选择的关键帧、事件摘要和 context summary。
- 不建议在 Phase 3 引入向量检索、云同步、团队共享或后台训练数据收集。
- 不建议让生成的 workflow 绕过 Phase 2 editor 直接保存或执行。
- 不建议把 evidence 字段直接塞进 `WorkflowMemory` 主模型，除非同步更新验证、版本快照和 UI；更稳妥的是用 draft wrapper 和 `recording_draft_links` 关联。
