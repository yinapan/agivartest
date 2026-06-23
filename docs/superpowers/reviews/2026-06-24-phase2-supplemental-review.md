# Phase 2 补充审查意见

> 对 `2026-06-24-phase2-architect-review.md` 和实施计划 `2026-06-24-phase2-text-teaching-workflow-memory.md` 的补充审查。

## 审查方法

逐文件阅读了架构审查报告、实施计划、以及全部已实现代码（`text-teaching-service.ts`、`workflow-draft.ts`、`memory-store.ts`、`schema.ts`、`ipc.ts`、`WorkflowsPage.tsx`），交叉验证审查报告的每一项 claim。

---

## 一、架构审查报告遗漏的关键问题

### 1. (P0) fallback provider 分句正则存在致命缺陷

**位置**: [ipc.ts:33](packages/desktop/src/main/ipc.ts#L33)

```ts
.split(/\r?\n|[。.;]/)
```

字符类 `[。.;]` 中的 `.` 是正则通配符，匹配**任意字符**。实际效果是：输入字符串会被按每个字符切分，而不是按句子切分。例如 `"打开记事本。输入文字。"` 会产生 10 个单字符 step，而不是 2 个句子 step。

**修复**：
```ts
.split(/[\r\n。.;]+/)  // 按换行、中文句号、英文句号、分号切分
```

审查报告 Important #5 提到了中文检索正则编码问题，但**未发现这个正则本身的逻辑错误**。

### 2. (P0) `memory:update` 不重新生成 `searchText`

**位置**: [memory-store.ts:119-138](packages/core/src/memory/memory-store.ts#L119-L138)

`updateWithVersion()` 接受完整 `WorkflowMemory` 直接写入，不重新计算 `searchText`。当用户通过 WorkflowsPage 修改 topic、summary 或 steps 后保存，`searchText` 保持初次创建时的值，导致后续 `search()` 永远匹配不到更新后的内容。

**修复**：在 `updateWithVersion` 中，如果 memory 未显式提供新的 searchText，则用 `updateRow` 之前重新生成：

```ts
const updated = {
  ...memory,
  version: current.version + 1,
  createdAt: current.createdAt,
  updatedAt: now,
  searchText: memory.searchText || buildSearchTextFromMemory(memory),
};
```

审查报告 Important #3 提到 `memory:update` 绕过 workflow 校验，但**未指出 searchText 过时这个更隐蔽的问题**。

### 3. (P1) 全部新增 IPC handler 缺少 try/catch

**位置**: [ipc.ts:196-223](packages/desktop/src/main/ipc.ts#L196-L223)

`memory:saveDraft`、`memory:update`、`memory:rollback` 三个 handler 直接调用可能 throw 的 store 方法（重复 ID 插入、找不到记录、版本不存在），没有任何 try/catch。发生异常时 IPC 以 rejected promise 形式泄漏给 Renderer，而 Renderer 的 `if (!result.ok)` 分支无法捕获 rejected invoke。

审查报告 Important #1 指出了这个问题，但严重性应为 **P0** 而非 Important，因为它会导致 UI 完全无响应（Promise rejection 未被 catch，页面卡死）。

### 4. (P2) `memory:teachText` 对 request 无任何输入校验

**位置**: [ipc.ts:188-190](packages/desktop/src/main/ipc.ts#L188-L190)

```ts
ipcMain.handle('memory:teachText', async (_event, request) => {
  return textTeachingService.teach(request);
});
```

如果 Renderer 传入 `{ goal: undefined, teachingText: undefined }` 或恶意大对象（如 100MB 字符串），会直接穿透到 provider 和下游逻辑。应至少校验 `goal` 和 `teachingText` 为 string 类型且长度合理。

审查报告 Minor #5 将此事标为 Minor，但未给出具体输入校验建议。

### 5. (P2) 实施计划文档与代码策略名不一致

实施计划 Task 1 测试代码（第 136 行）写的是：
```ts
target: { strategy: 'coordinates', x: 10, y: 20 }
```

但 `TargetDescriptorSchema` 中定义的是 `strategy: 'coordinate'`（单数），且 target 结构是 `{ strategy, point: {x, y, space}, hint }` 而非 `{ strategy, x, y }`。如果按计划文档写测试，坐标警告检测（`step.target?.strategy === 'coordinate'`）永远不会触发，产生假阴性。

### 6. (P2) `memory:saveDraft` 无重复保存保护

**位置**: [memory-store.ts:101-117](packages/core/src/memory/memory-store.ts#L101-L117)

`saveWithVersion` 调用 `insert()`，如果 Renderer 连续点击两次保存（同一 draft 生成相同 memory ID），第二次会因 SQLite UNIQUE 约束抛错。由于 IPC handler 没有 try/catch（见问题 #3），这会直接导致 rejected invoke。

建议：在 `saveWithVersion` 中先检查 ID 是否存在，或使用 `INSERT OR REPLACE`，或在 IPC 层做幂等处理。

---

## 二、对实施计划文档的修改建议

### 2.1 Task 1：修复测试代码中的 `strategy: 'coordinates'` 和 target 结构

第 134-141 行：

```diff
- target: { strategy: 'coordinates', x: 10, y: 20 },
+ target: { strategy: 'coordinate', point: { x: 10, y: 20, space: 'screen-logical' } },
```

### 2.2 Task 3：`updateWithVersion` 应包含 `searchText` 重生成

在计划 664 行 `const now = new Date().toISOString();` 之后，增加 searchText 处理逻辑：

```ts
const searchText = memory.searchText || buildSearchTextFromFields(memory);
const updated = { ...memory, searchText, version: current.version + 1, ... };
```

### 2.3 Task 4：测试中的 `makeMemory` 需补充 searchText 和 embeddingStatus

Task 4 的测试代码引用 `makeMemory()` 但未定义，且 `makeMemory` 需要至少包含 `searchText` 和 `embeddingStatus` 字段才能通过 `WorkflowMemory` 类型检查。建议在 Step 1 前补充说明该 helper 的定义。

### 2.4 Task 5：IPC handler 模板应包含 try/catch

所有新增 handler（`memory:saveDraft`、`memory:update`、`memory:rollback`）应包裹 try/catch。示例：

```ts
ipcMain.handle('memory:saveDraft', async (_event, draft, changeNote) => {
  try {
    if (!memoryStore) return { ok: false, error: { code: 'NO_MEMORY_STORE', message: '...' } };
    const memory = draftToMemory(draft);
    memoryStore.saveWithVersion(memory, { source: 'text-teach', changeNote });
    return { ok: true, data: memory };
  } catch (err: any) {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } };
  }
});
```

### 2.5 Task 5：fallback provider 正则修复

```diff
- .split(/\r?\n|[。.;]/)
+ .split(/[\r\n。.;]+/)
```

### 2.6 Task 6：WorkflowsPage 应增加以下字段编辑

当前只编辑 `intent`、`targetHint`、`riskLevel`。应在 Step 1 的步骤编辑区域增加：

- `expectedState` — 文本输入（type + value 的简单 key-value）
- `inputHint` — 文本输入（DraftStep 类型已有此字段，UI 未渲染）
- `fallback` — 文本输入

以及 metadata 区域增加：

- `inputs` 数组编辑（name / type / prompt）

### 2.7 Task 6：WorkflowsPage 缺少 loading/disabled 状态

建议在计划中增加：

```ts
const [saving, setSaving] = useState(false);
```

保存/更新/回滚按钮在操作期间应 `disabled={saving}`。

### 2.8 Task 6：rollback 按钮缺少确认弹窗

建议在 `rollback()` 函数头部增加：

```ts
if (!window.confirm(`Rollback to version ${version}? This cannot be undone.`)) return;
```

### 2.9 Task 7：应补充 native addon 构建失败的应对方案

当前 Task 7 Step 3 的 `pnpm build` 会因 `@agivar/native` Rust 编译失败而无法通过。建议补充：

```
如果 native addon 构建失败，可跳过 native 包：
  pnpm -F @agivar/core build && pnpm -F @agivar/desktop build
或使用预编译的 .node 文件：
  将 packages/native/native.win32-x64-msvc.node 复制到正确位置
```

---

## 三、审查报告自身的元改进

### 3.1 整改清单缺少优先级排序

12 条整改项没有标注执行顺序。建议按以下顺序排列：

| 顺序 | 整改项 | 理由 |
|------|--------|------|
| 1 | IPC try/catch 包装（原 #1） | 不改会导致 UI 卡死 |
| 2 | 敏感词编码修复（原 #2） | 安全功能失效 |
| 3 | update 路径加 workflow 校验（原 #3） | 数据完整性 |
| 4 | 中文检索正则（原 #4） | 核心功能可用性 |
| 5 | Renderer 类型边界（原 #5） | 维护性 |
| 6-12 | 其余按 Minor 顺序 | 改进项 |

### 3.2 缺少对 `packages/core/src/index.ts` 导出完整性的验证

审查报告未检查 Core 包是否导出了 Desktop 所需的全部类型：`TextTeachingService`、`TextTeachingProvider`、`WorkflowDraft`、`TextTeachingRequest`、`TextTeachingResult`、`WorkflowMemoryVersion`、`validateWorkflowDraft`、`draftToMemory`。Desktop `ipc.ts` 从 `@agivar/core` 导入这些，如果 Core 未重新导出，Desktop 编译会失败。

### 3.3 审查报告和计划文档的测试代码存在不一致

审查报告第 30 行写 `strategy === 'coordinate'`（正确），但计划文档第 136 行写 `strategy: 'coordinates'`（错误）。两份文档应交叉验证后再发布。

---

## 修正后的优先级汇总

| 优先级 | 问题 | 位置 |
|--------|------|------|
| **P0** | fallback provider 分句正则 `.` 匹配任意字符 | [ipc.ts:33](packages/desktop/src/main/ipc.ts#L33) |
| **P0** | `memory:update` 不重新生成 `searchText` | [memory-store.ts:126](packages/core/src/memory/memory-store.ts#L126) |
| **P0** | 新增 IPC handler 缺少 try/catch → rejected invoke 导致 UI 卡死 | [ipc.ts:196-223](packages/desktop/src/main/ipc.ts#L196-L223) |
| **P1** | `memory:teachText` 无输入校验 | [ipc.ts:188](packages/desktop/src/main/ipc.ts#L188) |
| **P1** | 敏感词中文编码损坏 | [text-teaching-service.ts:13](packages/core/src/memory/text-teaching-service.ts#L13) |
| **P1** | `memory:update` 绕过 workflow 校验 | [ipc.ts:203](packages/desktop/src/main/ipc.ts#L203) |
| **P1** | 中文检索正则编码 | [memory-store.ts:207](packages/core/src/memory/memory-store.ts#L207) |
| **P2** | 计划文档测试代码 strategy 名不一致 | 计划第 136 行 |
| **P2** | `memory:saveDraft` 无重复保存保护 | [memory-store.ts:113](packages/core/src/memory/memory-store.ts#L113) |
| **P2** | Core 导出完整性未验证 | `packages/core/src/index.ts` |
| **P2** | WorkflowsPage 缺少 `any` 类型替代 | [WorkflowsPage.tsx:44](packages/desktop/src/renderer/pages/WorkflowsPage.tsx#L44) |
| **P2** | WorkflowsPage 缺少 loading/disabled 状态 | [WorkflowsPage.tsx:211](packages/desktop/src/renderer/pages/WorkflowsPage.tsx#L211) |
| **P2** | rollback 缺少确认弹窗 | [WorkflowsPage.tsx:226](packages/desktop/src/renderer/pages/WorkflowsPage.tsx#L226) |
| **P2** | 编辑字段覆盖不足 | [WorkflowsPage.tsx:194-206](packages/desktop/src/renderer/pages/WorkflowsPage.tsx#L194-L206) |
