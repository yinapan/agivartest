# Phase 2 测试审查报告

## 审查范围

本报告审查 Phase 2 文字教学与 workflow memory 的测试资产、验证结果和剩余测试缺口。

涉及测试文件：

- `packages/core/tests/workflow-draft.test.ts`
- `packages/core/tests/text-teaching-service.test.ts`
- `packages/core/tests/memory-store.test.ts`
- `packages/core/tests/schema.test.ts`
- `packages/core/tests/recorder.test.ts`
- `tests/e2e/phase1b-workflow.test.ts`

关联命令：

- `pnpm test -- packages/core/tests/workflow-draft.test.ts packages/core/tests/text-teaching-service.test.ts packages/core/tests/memory-store.test.ts`
- `pnpm test`
- `pnpm build`

## 已验证结果

最近一次本地验证结果：

- `pnpm test`：20 个测试文件通过，177 个测试通过。
- `pnpm build`：`@agivar/core`、`@agivar/desktop`、`@agivar/native` 构建通过。
- `recorder.test.ts` 在当前桌面会话无法截图时跳过帧断言，并输出原因：`句柄无效。 (0x80070006)`。

## 测试覆盖评价

### WorkflowDraft

文件：`packages/core/tests/workflow-draft.test.ts`

已覆盖：

- 有效 text teaching draft 规范化。
- 生成 memory id、version、sourceType、step id、order、searchText、embeddingStatus。
- draft 转 `WorkflowMemory`。
- 空 topic、无 steps 的拒绝逻辑。
- 缺失 expected state 和坐标依赖 warning。

评价：核心行为覆盖充分，适合作为 Phase 2 草稿校验的第一道防线。

建议补充：

- unsupported platform。
- malformed input。
- 缺失 appName / summary / initialState。
- triggerExamples 去重和空白过滤。
- `draftToMemory()` 抛错路径。

### TextTeachingService

文件：`packages/core/tests/text-teaching-service.test.ts`

已覆盖：

- fake provider 输出有效 draft。
- invalid provider output 返回 validation errors。
- 英文敏感词 password / 2FA 触发 warning。

评价：Provider 注入路径覆盖到位，能防止后续接真实 LLM 时破坏基本契约。

建议补充：

- provider 抛异常时的返回策略。
- 中文敏感词，例如“密码”“验证码”“银行卡”。
- request appName / platform 默认值。
- teachingText 为空时的处理。
- Desktop fallback provider 的分句行为，尤其是真实中文句号、分号、换行混合输入。

### MemoryStore Versioning

文件：`packages/core/tests/memory-store.test.ts`

已覆盖：

- `saveWithVersion()` 创建 workflow 和 version 1 snapshot。
- `updateWithVersion()` 递增版本并记录 snapshot。
- `rollback()` 从旧 snapshot 创建新版本。
- `delete()` 清理 versions。
- text-taught workflow 可通过 triggerExamples 被关键词检索命中。
- update 保留 createdAt 并更新 updatedAt。

评价：版本语义主路径覆盖较扎实，append-only rollback 行为有测试保护。

建议补充：

- rollback 到不存在的版本。
- update 不存在的 memory。
- save 重复 id。
- 新建 workflow 时传入非 1 version 是否会被强制归一。
- version snapshot 中 steps / inputs 深层字段完整保真。
- 多 workflow 并存时 listVersions 不串数据。
- versions 表 `(memory_id, version)` 唯一性。
- update 后 `searchText` 是否随 topic、summary、triggerExamples、steps 同步变化。

### Schema

文件：`packages/core/tests/schema.test.ts`

已覆盖：

- 预期表创建。
- migration 记录数量与 `MIGRATIONS.length` 一致。
- migration 幂等。
- foreign key 开启。
- file-based WAL。

评价：新增 `workflow_memory_versions` 后测试已适配，不再写死 migration 数量。

建议补充：

- `workflow_memory_versions` 的外键关系和索引存在性。
- source check constraint。
- delete cascade 或显式删除版本后的数据一致性。

### Recorder

文件：`packages/core/tests/recorder.test.ts`

已覆盖：

- 当前环境能截图时，recorder start / stop 后应产生 frameCount 和 PNG。
- 当前环境不能截图时，测试记录原因并跳过帧断言。

评价：这是对桌面环境差异的合理隔离。普通 CI / headless / 无效桌面句柄不应导致 Phase 2 文本教学测试失败。

注意：

- 该测试通过不等价于“录屏能力已在真实桌面验证通过”。
- 真实录屏仍需要 `poc:interactive -- --i-understand-this-controls-my-desktop` 或手动 smoke。

## 当前测试缺口

### IPC 层缺口

当前没有自动化测试覆盖：

- `memory:teachText`
- `memory:validateDraft`
- `memory:saveDraft`
- `memory:update`
- `memory:listVersions`
- `memory:getVersion`
- `memory:rollback`

风险：

- Core 方法抛错时 IPC 返回形态不稳定。
- Renderer 假设 `result.ok` 存在，但 rejected invoke 不会进入该分支。
- `memory:update` 没有验证 workflow，有机会持久化空 steps 或空 topic。

建议：

- 增加 main IPC handler 单元测试或轻量集成测试。
- 覆盖 invalid draft、missing memoryStore、missing version、provider error。
- 覆盖 `{}`、`null`、错误类型 payload，确保 IPC 不直接抛到 Electron invoke。

### Renderer 层缺口

当前没有自动化测试覆盖 WorkflowsPage。

风险：

- 键盘入口 `Ctrl+Shift+W` 未被自动验证。
- 生成草稿、编辑、保存、查看版本、rollback 未被 UI smoke 验证。
- 重复点击、空输入、错误返回等状态未覆盖。

建议：

- 增加 Electron smoke 脚本。
- 至少覆盖：打开 workflow 页面、输入教学文本、生成草稿、保存、编辑、rollback。

### 安全与隐私测试缺口

当前只覆盖英文敏感词。

建议补充：

- 中文敏感词测试。
- secret / humanOnly input 标记测试。
- high / forbidden risk 保存前提示或阻止策略测试。
- 修复编码后，使用真实 UTF-8 中文 fixture，而不是沿用当前乱码样本。

### 检索质量测试缺口

当前测试验证 triggerExamples 命中，但没有覆盖：

- appName / topic / summary / searchText 权重差异。
- 多个候选 workflow 排序。
- 中文分词在编码正常场景下的行为。

建议：

- 添加中文正常编码 fixture。
- 添加多候选排序测试。
- 将 CJK tokenizer 改为 `\p{Script=Han}` 后补对应回归测试。

## 推荐测试矩阵

| 层级 | 自动化状态 | 必补项 | 优先级 |
| --- | --- | --- | --- |
| Core draft validation | 已覆盖主路径 | 边界输入、中文敏感词 | Important |
| TextTeachingService | 已覆盖主路径 | provider error、中文敏感词 | Important |
| MemoryStore versioning | 已覆盖主路径 | missing version、重复 id、深层 snapshot | Important |
| Schema | 已覆盖主路径 | constraint / index 检查 | Minor |
| IPC | 未覆盖 | save/update/rollback 错误路径 | Important |
| Renderer | 未覆盖 | Electron workflow smoke | Important |
| Recorder | 环境隔离 | 真实交互桌面 PoC | 建议 |

## 建议执行命令

常规验证：

```powershell
pnpm test
pnpm build
```

Phase 2 focused 验证：

```powershell
pnpm test -- packages/core/tests/workflow-draft.test.ts packages/core/tests/text-teaching-service.test.ts packages/core/tests/memory-store.test.ts packages/core/tests/schema.test.ts
```

注意：项目根脚本已经是 `vitest run`，不要使用 `pnpm test -- --run ...`。当前可执行形式是 `pnpm test -- <test files...>`。

真实桌面录屏验证：

```powershell
pnpm poc:interactive -- --i-understand-this-controls-my-desktop
```

## 测试审查结论

Phase 2 的 Core 主路径测试已经达到可继续迭代的水平；测试能够保护草稿校验、教学服务、版本存储、回滚和关键词复用。

但 Desktop IPC 和 Renderer 仍缺少自动化验证，这是当前最大测试风险。建议下一步优先补 IPC 错误路径测试和 Electron workflow smoke，再扩展编辑器字段和安全提示测试。
