# Phase 2 架构师审查报告

## 审查范围

- 设计文档：`docs/superpowers/specs/2026-06-24-phase2-text-teaching-workflow-memory-design.md`
- 实施计划：`docs/superpowers/plans/2026-06-24-phase2-text-teaching-workflow-memory.md`
- 提交范围：`3d4e740..dc01365`
- 关键提交：
  - `a3f7cc9 feat(core): add workflow draft validation`
  - `898e5b0 feat(core): add text teaching service`
  - `e53ac09 feat(core): add workflow memory versioning`
  - `a742c15 test(core): cover text taught workflow reuse`
  - `2942bef feat(desktop): expose workflow memory ipc`
  - `2cd0739 feat(desktop): add workflow memory editor`
  - `dc01365 test(core): stabilize phase2 verification`

## 总体结论

Phase 2 当前实现与已确认范围基本一致：只做本地文字教学、可编辑 workflow memory、关键词检索复用、版本历史和回滚；没有引入云同步、向量检索、embedding 索引或录屏解析。

架构方向是合理的：Core 层承载草稿校验、教学服务、存储和版本语义；Desktop 主进程通过 IPC 暴露能力；Renderer 提供第一版编辑界面。这个边界符合既有 Phase 1 结构，也为后续接入真实 LLM provider、录屏教学和更强检索留下了扩展点。

不过，该版本仍是 Phase 2 的“可用雏形”，不建议直接视为生产级完成。主要风险集中在 IPC 错误包装、Renderer 类型安全、敏感信息识别编码问题、UI 手动 smoke 缺失，以及 workflow 编辑能力尚未覆盖 inputs、expected state、fallback 等完整字段。

## 设计审查

### 架构边界

设计文档把 Core、Desktop main、Renderer 分层拆开，方向正确。`TextTeachingService` 通过 `TextTeachingProvider` 注入生成能力，避免 Core 直接依赖 Electron 或 UI，这一点符合可测试性要求。

版本能力落在 `MemoryStore` 内，和 `workflow_memories` 主表保持一致，便于 AgentService 继续通过现有 memory search 路径复用 workflow。这比另起一个独立 workflow service 更贴合当前代码库阶段。

### 数据流

当前数据流为：

1. Renderer 收集 `goal`、`teachingText`、`appName`。
2. IPC 调用 `TextTeachingService.teach()`。
3. Core 返回 `WorkflowDraft` 和 warnings。
4. Renderer 编辑草稿。
5. IPC 调用 `draftToMemory()` 并通过 `MemoryStore.saveWithVersion()` 入库。
6. 后续 search 继续使用本地关键词匹配。

这个流转没有绕开用户确认，满足“生成草稿不自动执行”的安全边界。

### 安全与隐私

正向点：

- 设计明确保持本地优先。
- 不做云同步和向量检索。
- `sourceType` 固定为 `text-teach`，便于后续审计来源。
- 版本历史记录 edit / rollback / text-teach 来源。

风险点：

- `TextTeachingService` 的敏感词正则中文部分出现编码损坏，中文密码、验证码、银行卡等词可能无法被稳定识别。
- IPC 层没有统一捕获 `draftToMemory()`、`updateWithVersion()`、`rollback()` 抛出的异常，错误可能作为 rejected IPC 泄漏到 Renderer，而不是统一 `{ ok: false, error }`。
- Renderer 当前没有在保存前显式展示风险确认，`forbidden` / `high` 风险虽然可选，但没有阻止保存或提示。

### 可演进性

当前设计具备继续扩展的基础：

- 可替换 `TextTeachingProvider` 接入真实 LLM。
- `workflow_memory_versions` 采用 snapshot 模式，支持回滚、审计和未来 diff。
- `embeddingStatus` 保持 `not_indexed`，符合本阶段不做向量检索的约束。

后续建议把“草稿保存、编辑、回滚”从 IPC 文件中抽成 Core service，减少 `ipc.ts` 的业务膨胀。

## 实现审查

### Core：WorkflowDraft

相关文件：`packages/core/src/memory/workflow-draft.ts`

优点：

- `validateWorkflowDraft()` 和 `normalizeWorkflowDraft()` 分工清楚。
- 生成稳定 step id、order、searchText、时间戳。
- 对缺失 topic、appName、summary、initialState、steps、input 字段做了基本校验。
- 对缺失 expected state 和坐标依赖给 warnings，符合 Phase 2 的“先提醒，不阻塞”策略。

主要不足：

- `WorkflowDraftStep` 仍允许任意 `target` 结构通过 TypeScript 编译后的运行时输入进入 IPC，需要运行时 schema 校验。
- `draftToMemory()` 直接 throw，适合 Core 内部调用，但 IPC 边界需要捕获。

### Core：TextTeachingService

相关文件：`packages/core/src/memory/text-teaching-service.ts`

优点：

- Provider 注入方式便于测试和后续替换。
- 强制设置 `sourceType: 'text-teach'`，避免来源混淆。
- 返回 validation errors 和 warnings，调用方可展示。

主要不足：

- provider 抛错没有被捕获，会向上冒泡。
- 敏感词中文正则出现编码损坏，需要修复为可靠 UTF-8 或改成数组 includes/正则组合。
- 当前 fallback provider 在 Desktop IPC 层，不在 Core 层，导致 Core service 本身仍没有默认文本切分策略。

### Core：MemoryStore Versioning

相关文件：

- `packages/core/src/memory/schema.ts`
- `packages/core/src/memory/memory-store.ts`

优点：

- 新增 `workflow_memory_versions` 表，snapshot 存储简单直接。
- `saveWithVersion()`、`updateWithVersion()`、`rollback()` 都通过 transaction 执行。
- rollback 创建新版本，不覆盖历史，符合 append-only 设计。
- delete 显式删除 versions，兼容外键 cascade 不可靠的场景。

主要不足：

- `saveWithVersion()` 直接调用 `insert()`，如果 memory id 已存在会抛数据库错误，调用方没有友好错误。
- `updateWithVersion()` 接受完整 `WorkflowMemory`，但不重新校验 workflow 字段，依赖调用方传入合法对象。
- `updateRow()` 没有检查 `changes`，如果 UPDATE 未命中理论上不会被发现；当前前置 `getById()` 降低了风险。

### Desktop IPC

相关文件：`packages/desktop/src/main/ipc.ts`

优点：

- IPC API 覆盖 teach、validate、save、update、listVersions、getVersion、rollback。
- 没有引入云端或向量服务。
- fallback provider 可在无模型情况下生成最小草稿，利于 MVP 验证。

主要不足：

- `memory:saveDraft`、`memory:update`、`memory:rollback` 对核心异常没有 try/catch。
- `memory:teachText` 对 request 结构没有运行时校验。
- fallback provider 的分句正则中存在编码异常，中文句号分割可能不稳定。
- `NO_MEMORY_STORE` 不是 Core `ToolErrorCode` 类型之一，当前只是 IPC 自定义对象，可接受但建议统一错误码。

### Renderer UI

相关文件：

- `packages/desktop/src/renderer/App.tsx`
- `packages/desktop/src/renderer/pages/WorkflowsPage.tsx`

优点：

- 新增 workflow 页面入口，保留 chat/settings 路径。
- 三栏布局覆盖列表、教学/编辑、版本。
- 支持生成草稿、编辑步骤、保存、再次编辑、版本列表、回滚。

主要不足：

- 使用大量 `any`，如 memories、selected、versions、IPC 返回值，后续维护风险较高。
- UI 目前只编辑 step 的 intent、targetHint、riskLevel，没有编辑 expectedState、fallback、inputHint、inputs。
- rollback 按钮没有确认弹窗，容易误点。
- 缺少 loading / disabled 状态，连续点击可能造成重复保存。
- Desktop 端尚无自动化 smoke 覆盖 WorkflowsPage。

## 风险分级

### Critical

无。当前实现没有发现会直接违背用户明确范围，或导致数据不可恢复的确定性问题。

### Important

1. IPC 错误处理不统一。
   - 位置：`packages/desktop/src/main/ipc.ts:196-222`
   - 影响：无效 draft、缺失 version、数据库约束错误可能变成 rejected invoke，Renderer 现有 `if (!result.ok)` 分支无法处理。

2. 敏感词识别存在编码损坏。
   - 位置：`packages/core/src/memory/text-teaching-service.ts:13`
   - 影响：中文敏感输入识别可能失效，削弱安全提示。

3. `memory:update` 可以绕过 workflow 校验。
   - 位置：`packages/desktop/src/main/ipc.ts:203`、`packages/core/src/memory/memory-store.ts:119`
   - 影响：保存草稿会走 `draftToMemory()`，但编辑已保存 workflow 时直接 `updateWithVersion(memory)`；如果 Renderer 或 DevTools 传入空 steps、空 topic、缺失 riskLevel，可能被持久化并生成新版本。建议新增 `validateWorkflowMemory()` 或让 update 路径复用 draft validator，同时重新生成 `searchText`。

4. 中文检索正则存在编码损坏风险。
   - 位置：`packages/core/src/memory/memory-store.ts:12`、`packages/core/src/memory/memory-store.ts:207`
   - 影响：现有测试数据也存在乱码，无法证明真实中文“填写表单”“搜索客户”等查询可靠。建议改为明确 Unicode Han 范围，例如 `\p{Script=Han}` 配合 `u` 标志，并补真实中文样本测试。

5. Renderer 类型边界过弱。
   - 位置：`packages/desktop/src/renderer/pages/WorkflowsPage.tsx:12,44-50,106`
   - 影响：IPC 返回结构变化、版本对象缺字段、非法 workflow 都可能在 UI 层静默进入保存路径。

6. Workflow 编辑器字段覆盖不足。
   - 位置：`packages/desktop/src/renderer/pages/WorkflowsPage.tsx:181-207`
   - 影响：设计要求用户可编辑 inputs、expected state、fallback 等字段，当前第一版只覆盖了核心字段和步骤三项。

### Minor

1. `memory-store.ts` 中 CJK 正则和部分中文测试内容仍显示编码异常，建议单独治理文件编码。
2. `App.tsx` 把原有中文返回文案改成英文，风格和当前中文界面不完全统一。
3. `WorkflowsPage` 组件较大，后续应拆分为 list、editor、versions 三个组件。
4. Recorder 单测在无法截图时跳过帧断言是合理的环境隔离，但需要在测试文档中明确真实录屏仍依赖 `poc:interactive`。
5. `saveWithVersion()` 使用 `memory.version || 1`，如果调用方传入非 1 版本的新 memory，会创建非 1 初始版本。计划要求新建 workflow 初始版本为 1，建议保存路径强制归一。
6. `workflow_memory_versions` 缺少 `(memory_id, version)` 唯一约束，当前业务路径不会重复写同版本，但数据库层还没有硬约束。
7. Desktop fallback provider 位于 `ipc.ts`，建议命名或注释明确它只是本地临时降级实现，不代表完整自然语言解析能力。

## 可执行整改清单

1. 为 `memory:*` 新 IPC 增加 `try/catch` 包装，统一返回 `{ ok: false, error: { code, message } }`。
2. 修复 `TextTeachingService` 敏感词中文匹配，使用 UTF-8 源文件和数组化关键词测试。
3. 给 `WorkflowsPage` 增加 IPC DTO 类型，减少 `any`。
4. 保存前调用 `memory:validateDraft`，并在 UI 中展示 errors / warnings。
5. 为 rollback 增加确认弹窗。
6. 为保存、生成、回滚增加 loading / disabled 状态。
7. 扩展编辑器字段：inputs、inputHint、expectedState、fallback。
8. 增加 Desktop smoke 或 Playwright/Electron 脚本覆盖 WorkflowsPage。
9. 增加 IPC 层测试，覆盖 invalid draft、missing memory、missing version、rollback failure。
10. 单独清理项目内中文乱码和编码问题，避免安全规则和 UI 文案被破坏。
11. 新建 workflow 时强制 version 为 1，并为 versions 表增加 `(memory_id, version)` 唯一约束。
12. 把计划文档中的测试命令统一成当前脚本实际可执行形式：`pnpm test -- packages/core/tests/...`。

## 审查结论

Phase 2 当前版本可以作为“文字教学与 workflow memory”的基础实现继续迭代；Core 的主要架构方向正确，版本模型可用，测试覆盖了核心路径。

合入后继续开发前，建议优先处理 Important 级别的 IPC 错误包装、敏感词编码、Renderer 类型边界和编辑字段覆盖。处理完这些问题后，再做 Electron workflow 页面 smoke，才能把 Phase 2 视为更完整的可验收版本。
