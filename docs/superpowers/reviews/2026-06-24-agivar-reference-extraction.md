# Agivar 反编译参考抽取与落地映射

## 目的

本文基于 `F:\agivarfanbianyi` 中的本地反编译产物，抽取对我们“类 Agivar 桌面 Agent”有价值的架构、产品分层和实施策略，并映射到：

- 总落地方案：[docs/agivar-like-agent-landing-plan.md](../../agivar-like-agent-landing-plan.md)
- Phase 1：可教学 Agent 基础
- Phase 2：文字教学与流程记忆
- Phase 3：录屏教学后端
- Phase 4A：录屏教学 UI
- Phase 4B：provider 质量
- Phase 4C：可靠性、清理和数据治理

边界：只借鉴可观察的产品结构、模块划分、IPC 形态和工程策略；不复制反编译源码、私有接口、密钥、埋点配置、后端地址、素材或具体 UI 实现。

## 已查看材料

- `F:\agivarfanbianyi\AGIVAR_反编译分析报告.md`
- `F:\agivarfanbianyi\DECOMPILE_REPORT.md`
- `F:\agivarfanbianyi\installed-ipc-summary.txt`
- `F:\agivarfanbianyi\installed-extracted\app\package.json`
- `F:\agivarfanbianyi\installed-decompiled\main\deobfuscated.js`
- `F:\agivarfanbianyi\installed-decompiled\preload\deobfuscated.js`
- `F:\agivarfanbianyi\installed-decompiled\renderer-main\deobfuscated.js`
- 我们当前 `docs/superpowers` 下的阶段设计、实施计划和审查文档

## 参考产品形态

参考产品是 Electron + React 桌面应用，主进程承担服务编排，preload 暴露 `window.api`，renderer 拆成多个页面，并配套 native hook、录屏、麦克风、托盘、本地 MCP、更新、账号、支付和分析等产品化能力。

可观察页面包括：

- 主应用页
- 捕获页
- 录制条页
- 任务覆盖层页
- 渐变覆盖层页

可观察原生能力包括：

- 全局键鼠 hook
- Native FFI
- 录屏与媒体运行时资源
- Windows 辅助可执行文件和 DLL
- 单实例、托盘、更新、权限检查

## 可借鉴能力矩阵

| 可观察能力 | 对我们的价值 | 当前状态 | 落地动作 |
| --- | --- | --- | --- |
| 主进程录制服务 | 录制是长生命周期任务，必须跨 renderer reload 存活 | Phase 3 已有 core/main IPC 和持久化 session | 继续让 main/core 持有录制状态，React 只展示和发起命令 |
| 独立录制条页面 | 用户录制时需要脱离主页面的 start / stop / cancel 控制 | Phase 4A 计划是嵌入式面板 | Phase 4A 先交付面板，Phase 4A+ / 4C 增加轻量录制条窗口 |
| capture / overlay / main 多页面 | 不同窗口有不同权限、尺寸、层级和交互模式 | 当前主要是单主窗口 | IPC 和 DTO 从现在开始预留多窗口复用，不在 MVP 里一次做完 |
| 状态事件推送 | 录制状态、覆盖层状态、进度不应靠多个页面轮询 | Phase 4A 主要是命令式调用 | 增加或预留 `recordingTeach.onStateChanged(listener)` |
| frame meta 与 frame payload 分离 | 大图和视频不能一股脑塞进 renderer | Phase 3 已有 keyframe artifact | UI 先展示元数据，再做懒加载缩略图 |
| 注释 / 解释 / 语音注释 | 用户补充意图能显著提升教学生成质量 | Phase 4A 只有 goal / notes | Phase 4B/C 增加 annotation / explain evidence，语音后置 |
| cancel processing / reprocess | provider 生成需要取消、重试、恢复 | Phase 3E 已有 draft link / resume | Phase 4B/C 增加取消、重试、重新处理 |
| recordings 历史管理 | 用户需要列表、重命名、删除、预览和继续处理 | Phase 4A 聚焦当前 session | Phase 4C 增加录屏历史和素材治理 |
| screen scope / streamer mode / permission checks | 录制范围和隐私模式是产品偏好，不是一次性表单 | Phase 4A 有 scope / privacy | Summary 默认，Detailed 必须确认；Phase 4C 增加权限预检和范围偏好 |
| 本地 MCP 服务 | 可作为外部自动化桥接 | 当前明确不做云同步、向量检索 | 暂不进入 Phase 2/3/4 主路径 |
| 账号、支付、积分、更新、埋点 | 商业化产品基础设施 | 当前目标是本地 MVP | 全部后置，不阻塞桌面录屏教学闭环 |

## 映射到总落地方案

已经同步到 [docs/agivar-like-agent-landing-plan.md](../../agivar-like-agent-landing-plan.md) 的调整：

- 在第 3 章新增“反编译参考到落地方案映射”，把录制服务、录制条、多页面、状态事件、关键帧、注释、历史、权限、MCP、商业化能力逐项映射到我们的模块和阶段。
- 将“记忆库需要向量检索”调整为“结构化检索优先，向量检索后置”，与当前不做云同步和向量检索的决策一致。
- 在技术架构中把 MVP 存储层改为 SQLite + 本地文件 + 结构化索引，Embedding 模型标为后续可选增强。
- 在录屏教学流程中新增工程落地拆分，明确嵌入式面板、录制条、状态事件、事件采集、关键帧、注释、manifest、草稿生成、历史治理的先后顺序。
- 在阶段 3 的交付和验收中补入 manifest 确认、session / timeline / keyframe / draft link 持久化、`recording-teach` 版本来源和详细隐私模式确认。
- 在阶段 4 的交付和验收中补入录屏历史、录制条、权限预检、数据目录治理、取消 / 重试 / 重新处理、重启清理和素材删除降级。

## 映射到各阶段设计

### Phase 1：可教学 Agent 基础

可借鉴：

- chat / task 应该是事件流，而不是单次请求响应。
- 模型、模式、任务状态需要成为 session 属性。
- 用户可见事件和底层服务事件要分层。

建议：

- 执行 UI 成熟后，增加 typed task-event subscriptions。
- 不把账号、支付、遥测带进核心 Agent 执行路径。

### Phase 2：文字教学与流程记忆

可借鉴：

- 记忆应有历史、版本、可恢复草稿和用户可读命名。
- 大型本地素材出现后，需要数据目录和缓存清理能力。

建议：

- 保持本地优先和结构化检索。
- 云同步、向量检索、团队协作继续后置。
- 数据目录、缓存和素材治理放到 Phase 4C。

### Phase 3：录屏教学后端

可借鉴：

- 生命周期应覆盖 start、stop、cancel、discard、state、frame meta、frame payload、cancel processing、reprocess。
- keyframe 元数据和图片 payload 分离。
- native passive event capture 是录屏教学的基础能力。
- 五轮 start / stop 泄漏检查是合理硬化门槛。

建议：

- 保持 `recorder:*` 低层录制与 `recordingTeach:*` 教学编排分层。
- 活跃 session 锁必须在 repository / main 层，而不是 React 本地状态。
- 后续补 discard、cancel processing、reprocess 的持久化测试。

### Phase 4A：录屏教学 UI

可借鉴：

- 先做嵌入式面板可以，但最终需要独立录制条。
- 状态应由 main 推送给 renderer。
- timeline UI 先展示数量、警告、notes 和 evidence 摘要，再做缩略图。
- Detailed 隐私模式必须有明确确认。

已同步到 Phase 4A 计划：

- main/core 是录制生命周期 source of truth。
- `RecordingTeachPanel` 不能假设自己是唯一 consumer。
- 增加或预留 `recordingTeach.onStateChanged(listener)`。
- 详细模式开始前必须确认。
- recording draft 保存版本来源必须是 `recording-teach`，不能沿用 `text-teach`。
- 手工 smoke 从 optional 改成 required。
- `git push` 改为仅在用户要求时执行。

### Phase 4B：provider 质量

可借鉴：

- provider payload 必须从确认后的 manifest 和 evidence links 构建。
- notes、annotations、events、context、keyframes、privacy policy 都应该是显式 payload section。
- provider 生成需要取消、重试和重新处理。

建议：

- main/core 重新生成或校验 manifest，不能信任 renderer 传回的敏感字段。
- 增加 annotation / explain evidence 模型。
- 保留 deterministic provider 回归测试。
- 增加 provider 输出校验和稳定错误信息。

### Phase 4C：可靠性、清理和数据治理

可借鉴：

- 历史列表、重命名、删除、预览和重新处理是录屏教学产品闭环的一部分。
- app quit、启动恢复、孤儿清理必须覆盖活跃录制。
- 素材目录要有大小检查、缺失文件降级、删除提示和证据失效处理。
- 权限、屏幕范围、数据目录属于 settings，而不是临时 UI 状态。

建议：

- 增加 `recordingTeach.discard`、`recordingTeach.cancelProcessing`、`recordingTeach.reprocess`。
- 增加持久化 note / annotation 编辑 IPC。
- 增加录屏历史、懒加载缩略图和 artifact governance。
- 增加 fullscreen / active-window 的人工 smoke 和恢复测试。

## 不建议复刻的内容

- 反编译源码、混淆后的实现细节、私有接口、密钥、后端地址、素材。
- 账号、支付、电话验证、积分、订单等商业化能力。
- 默认遥测和埋点依赖。
- 本地 MCP，除非后续出现明确外部自动化场景。
- 云同步、向量检索、团队共享，这些与当前阶段目标不一致。

## 近期执行清单

- [x] 总落地方案增加反编译参考映射。
- [x] 总落地方案将向量检索从 MVP 主路径后置。
- [x] Phase 4 总设计增加状态事件、manifest 可信边界、注释、取消 / 重试 / reprocess、录制条、历史和权限治理。
- [x] Phase 4A 计划增加 detailed ack、`recording-teach` 来源校验、状态事件预留、手工 smoke 必做、按需 push。
- [ ] Phase 4A 实施时优先修正 `handleMemorySaveDraft` 的 source 映射。
- [ ] Phase 4A 实施时确认 repository/main 层活跃 session 锁。
- [ ] Phase 4B 开始前实现 main/core manifest 校验。
- [ ] Phase 4C 开始前拆出录屏历史、录制条、权限预检、数据治理四个子计划。
