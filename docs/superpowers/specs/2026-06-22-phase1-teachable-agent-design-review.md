# 阶段 1 可教学桌面流程 Agent 设计评审建议

> 日期：2026-06-22
> 评审对象：[2026-06-22-phase1-teachable-agent-design.md](./2026-06-22-phase1-teachable-agent-design.md)
> 对照资料：[落地方案.md](../../../落地方案.md)、[Phase 0 设计](../../specs/2026-06-21-phase0-desktop-poc-design.md)、[Phase 0 验收报告](../../phase0-acceptance-report.md)

---

## 1. 总体判断

阶段 1 设计方向正确：它抓住了第一版真正要验证的主线，也就是“手写流程记忆 → 观察 → 执行 → 验证 → 日志”的闭环。文档已经覆盖 AgentService、ToolRouter、MemoryStore、SafetyLayer、StateVerifier、ExecutionLog、聊天 UI、SQLite schema 和本地目录结构，骨架是完整的。

但目前不建议直接进入实施计划。主要原因不是缺少模块，而是有几处边界会让实施阶段出现返工：

1. Phase 0 验收报告里仍有未完成的交互输入和录屏帧捕获验证，但阶段 1 文档写成“6 项能力直接复用”。
2. 阶段 1 同时把“确定性流程闭环”和“LLM 自主规划”放进核心验收，范围偏大。
3. LLM 工具定义存在绕过 SafetyLayer、ExecutionLog 和 StateVerifier 的风险。
4. ToolRouter 示例与 Phase 0 已定义 API 不完全一致。
5. 数据模型、运行上下文、恢复状态机和隐私边界还需要收口。

建议先做一轮设计小修，再开始写实施计划。

---

## 2. 实施前必须修改

### 2.1 不要把 Phase 0 未验证项写成已验证能力

**当前问题**

阶段 1 目标写道：

> 阶段 0 已验证的 6 项桌面控制能力（截图、UIA、键鼠输入、Playwright、DPI、录屏）作为底层直接复用。

但 Phase 0 验收报告显示：

- 输入：交互 PoC 未运行，判定为“待验证”。
- 录屏：WGC / DXGI 骨架已实现，帧捕获待 Phase 1 补充。
- UIA：Win11 Notepad 的 ValuePattern 读取失败，需要 tree walk 和键盘输入回退。
- 当前验收环境是远程桌面，会影响截图和录屏行为。

**风险**

如果阶段 1 直接基于“6 项能力均已稳定”展开，实施计划会漏掉最关键的底层补验任务。尤其是紧急停止、键鼠输入、录屏资源清理，这些都属于安全闭环，不应该在 Agent 层开发完成后才发现不稳定。

**建议修改**

把阶段 1 的前置条件改成：

```markdown
### 阶段 1 前置门槛

阶段 1 可以复用 Phase 0 的代码骨架，但以下能力必须在阶段 1 Day 1-2 补验：

1. 非远程桌面环境下运行 `poc:interactive`，确认键鼠输入成功率 ≥ 90%。
2. 确认紧急停止热键真实可中断交互动作，响应时间 < 500ms。
3. 录屏至少完成 WGC 或 DXGI 的真实帧捕获验证。
4. UIA 对 Win11 Notepad 的 Document 控件使用 tree walk 回退，不依赖 ValuePattern 读取。
5. 记录 Phase 0 已知限制，并决定哪些限制允许带入阶段 1。
```

并把“阶段 0 已验证的 6 项能力”改为：

```markdown
阶段 0 已交付桌面控制代码骨架，其中截图、Playwright、基础 UIA 可直接复用；输入、紧急停止和录屏帧捕获需要在阶段 1 开始前完成补验。
```

### 2.2 将阶段 1 P0 收敛为“确定性流程闭环”

**当前问题**

文档把两个目标都放进核心验收：

- 手写流程记忆的确定性执行。
- LLM 自主规划完成简单任务，要求 3/5 成功。

这会让阶段 1 同时承担两个难题：产品闭环工程化和 LLM 桌面自主操作稳定性。后者不稳定时，会拖慢前者。

**风险**

落地方案的阶段 1 核心是“执行闭环 MVP”，不是完整 Computer Use 能力。若 LLM 自主规划成为 Go/No-Go 条件，团队会过早投入 Prompt、模型兼容、多模态截图压缩、失败恢复等问题，反而影响手写流程闭环。

**建议修改**

将阶段 1 分成两层验收：

| 层级 | 内容 | 是否 Go/No-Go |
|---|---|---|
| P0 | 手写 YAML / JSON 流程导入、执行、验证、日志、失败诊断、人工接管、紧急停止 | 是 |
| P1 | LLM 基于当前截图生成下一步 StepPlan，在本地测试页上完成对照实验 | 否 |

验收条件建议改为：

```markdown
### P0 验收条件

| 条件 | 指标 |
|---|---|
| 手写流程导入到首次执行成功 | < 10 分钟 |
| 固定流程重复执行成功率 | > 80%（3 条流程各执行 5 次） |
| 失败可诊断率 | > 80% |
| 紧急停止响应 | < 500ms |
| 人工接管后可继续 | 100% |
| 每步执行日志完整率 | 100% |

### P1 对照验证

LLM 自主规划只作为对照实验，不作为阶段 1 Go/No-Go 条件。验证范围限定在本地测试页和记事本，不进入真实外网站点和高风险动作。
```

### 2.3 LLM 工具调用不能直接执行副作用

**当前问题**

文档在“Agent 工具定义”中使用 Vercel AI SDK 的 `tool()`，并在工具 `execute` 中描述直接调用 `input.typeText`、`browser.navigateTo`、`input.scroll` 等动作。

这和前面的架构原则冲突：执行动作应该统一经过 SafetyLayer、StepExecutor、ToolRouter、StateVerifier 和 ExecutionLog。

**风险**

如果 LLM 工具 `execute` 直接操作桌面，会出现几个严重问题：

- LLM 能绕过风险分级和高风险确认。
- 执行前后截图、日志、验证可能缺失。
- 紧急停止 signal 不一定传入工具。
- 同一套能力会有两条执行路径，后期难以审计和回归。

**建议修改**

阶段 1 不要把 Vercel AI SDK 的 tool `execute` 作为真实桌面动作入口。LLM 只产出“建议动作”，所有副作用统一由 AgentService 执行。

推荐改为：

```typescript
interface PlannerOutput {
  step: StepPlan;
  confidence: number;
  rationale: string;
}

class LLMPlanner {
  async planNext(context: TaskContext): Promise<PlannerOutput> {
    // LLM 只返回 StepPlan，不直接调用桌面工具
  }
}

class AgentService {
  async executePlannedStep(step: StepPlan, context: TaskContext): Promise<StepResult> {
    await this.safetyLayer.check(step, context);
    const result = await this.stepExecutor.execute(step, context);
    const verification = await this.stateVerifier.verify(step.expectedState, context);
    await this.executionLog.write(step, result, verification, context);
    return { result, verification };
  }
}
```

如果继续使用 AI SDK tools，也建议把工具命名为 `propose_click`、`propose_type_text`、`propose_navigate`，其返回值只是结构化 `StepPlan`，不执行真实桌面操作。

### 2.4 ToolRouter 必须对齐 Phase 0 API

**当前问题**

ToolRouter 示例中出现了这些调用：

```typescript
this.tools.browser.click(locator.selector!)
this.tools.uia.clickElement(locator.selector!)
this.tools.input.click(locator.point!)
```

但 Phase 0 设计中实际 API 更接近：

```typescript
browser.clickElement(page, selector)
uia.invokeElement(hwnd, query)
input.clickPoint(point)
```

同时，Phase 0 已明确 `click(x, y)` 只作为内部封装，Agent 层入口应使用 `clickPoint(point)`，强制携带坐标空间。

**风险**

如果实施计划照着当前示例写，会在 Task 级别引入不存在的函数和错误坐标调用。尤其是 UIA 的 `selector` 并不是字符串选择器，而应该是 `ElementQuery`。

**建议修改**

把 ToolRouter 改成适配器模式，显式依赖 `TaskContext` 中的 `browserSession`、`activeHwnd` 和 `abortSignal`：

```typescript
interface ToolAdapters {
  browser: {
    clickElement(page: Page, selector: string, signal?: AbortSignal): Promise<void>;
    fillInput(page: Page, selector: string, value: string, signal?: AbortSignal): Promise<void>;
    navigateTo(page: Page, url: string, signal?: AbortSignal): Promise<void>;
  };
  uia: {
    invokeElement(hwnd: number, query: ElementQuery, signal?: AbortSignal): Promise<void>;
    setElementValue(hwnd: number, query: ElementQuery, value: string, signal?: AbortSignal): Promise<void>;
  };
  input: {
    clickPoint(point: Point, signal?: AbortSignal): Promise<void>;
    typeText(text: string, signal?: AbortSignal): Promise<void>;
    pressKeys(keys: string[], signal?: AbortSignal): Promise<void>;
  };
}
```

`TargetDescriptor` 也建议拆清楚：

```typescript
type TargetDescriptor =
  | { strategy: 'playwright'; selector: string; hint?: string }
  | { strategy: 'uia'; query: ElementQuery; hwnd?: number; hint?: string }
  | { strategy: 'coordinate'; point: Point; hint?: string }
  | { strategy: 'human'; hint: string };
```

### 2.5 补齐 TaskContext 和任务生命周期

**当前问题**

文档多处使用 `TaskContext`，但没有定义它。AgentService、LLMPlanner、ToolRouter、StateVerifier、FailureHandler 都依赖上下文，但不知道上下文里到底有哪些内容。

**风险**

缺少 TaskContext 会让实现时出现隐性全局状态，例如当前 page、当前 hwnd、当前 taskRunId、当前 abortSignal、当前输出目录，各模块各取各的，最后很难测试和清理。

**建议补充**

```typescript
interface TaskContext {
  taskRunId: string;
  sessionId: string;
  goal: string;
  mode: 'workflow' | 'llm' | 'hybrid';
  status: 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'aborted';

  workflowId?: string;
  workflowVersion?: number;
  stepIndex: number;
  retryCountByStep: Map<number, number>;

  browserSession?: BrowserSession;
  activeHwnd?: number;
  activeWindowTitle?: string;

  outputDir: string;
  abortController: AbortController;
  signal: AbortSignal;

  startedPids: number[];
  createdTempDirs: string[];
  lastObservation?: ObservationSnapshot;
  humanTakeoverEvents: HumanTakeoverEvent[];
}
```

同时补充生命周期规则：

- 同一时间默认只允许一个 active task。
- 每个 task 创建独立 `AbortController`，任务结束后释放。
- 任务结束时必须关闭本任务启动的浏览器、停止录屏、释放按键、清理临时目录。
- 用户原本打开的浏览器和记事本不能被粗暴关闭。
- 任务状态流转必须写入数据库。

### 2.6 紧急停止设计需要拆分 core 和 desktop

**当前问题**

文档说 Agent 不依赖 Electron，但 EmergencyStop 示例直接使用 `globalShortcut`。`globalShortcut` 是 Electron 主进程能力，不能放在 `packages/core` 纯 Node 模块里。

**建议修改**

拆成两层：

```typescript
// packages/core/src/safety/abort-manager.ts
class AbortManager {
  createTaskSignal(taskRunId: string): AbortSignal
  abortTask(taskRunId: string, source: AbortSource): void
  isAborted(taskRunId: string): boolean
}

// packages/desktop/src/main/global-hotkey.ts
class GlobalHotkeyAdapter {
  register(hotkey: string, onTrigger: () => void): void
  unregister(): void
}
```

阶段 1 还需要补充验收：

- 热键注册失败时降级为 UI 停止按钮，并在环境检查中显示警告。
- `AbortController` 触发后不能复用，恢复任务时必须新建 signal。
- 所有长耗时工具都必须接收 `AbortSignal` 或 timeout。
- `releaseAllKeys()` 若 Phase 0 尚未实现，需要加入阶段 1 前置任务。

### 2.7 状态验证不能依赖 OCR

**当前问题**

阶段 1 明确“不做 OCR 视觉定位”，但 StateVerifier 写到：

```typescript
page_text_contains → Playwright page.textContent() 或截图 OCR
```

**风险**

这会让实现者误以为阶段 1 需要 OCR 能力。OCR 一旦进入验证链，会引入模型/语言/截图质量问题，范围立刻变大。

**建议修改**

阶段 1 的验证策略应限定为：

| 条件 | 阶段 1 实现方式 |
|---|---|
| `page_text_contains` | Playwright `locator('body').textContent()` 或 role/text locator |
| `uia_element_exists` | UIA `findElement(hwnd, query)` |
| `window_title_contains` | `getActiveWindow().title` |
| `element_text_equals` | 必须携带 `strategy`，Playwright 或 UIA 分别实现 |
| `file_exists` | 限定在用户授权目录或应用数据目录 |
| `clipboard_contains` | 默认不启用，避免读取敏感剪贴板 |

建议把 `StateCondition` 改成：

```typescript
type StateCondition =
  | { type: 'window_title_contains'; value: string }
  | { type: 'page_text_contains'; value: string; pageRef?: 'managed' }
  | { type: 'uia_element_exists'; query: ElementQuery }
  | { type: 'element_text_equals'; target: TargetDescriptor; value: string }
  | { type: 'file_exists'; path: string; scope: 'app-data' | 'user-approved' };
```

### 2.8 评测流程要使用可控本地目标，不要依赖外网

**当前问题**

必交付评测流程中有“浏览器搜索：打开浏览器 → 导航到目标网站 → 搜索关键词”。示例 YAML 使用 B 站投币流程。

这和阶段 1 的稳定验收目标不匹配：

- 外部网站页面结构会变。
- 搜索结果不可控。
- 投币属于账号和权益相关动作，风险级别不适合作为阶段 1 样例。
- Playwright 托管浏览器默认无用户登录态。

**建议修改**

阶段 1 的 3 条必交付流程全部使用本地 fixture 或低风险本地应用：

1. `form-fill-local.yaml`：打开本地测试页 → 填写字段 → 提交 → 验证成功消息。
2. `search-local.yaml`：打开本地搜索 fixture → 输入关键词 → 验证搜索结果区域出现匹配项。
3. `notepad-text.yaml`：打开记事本 → 输入文本 → UIA / 截图验证文本。

如果要保留外网站点，只能作为 P1 人工演示，不作为 Go/No-Go 验收。

---

## 3. 实施计划里必须体现

### 3.1 工作流变量需要 schema 和安全策略

**当前问题**

文档只写了 `{{变量}}` 支持运行时替换，但没有定义变量来源、类型、必填校验和敏感信息处理。

**建议补充**

```yaml
inputs:
  searchQuery:
    type: string
    required: true
    prompt: 请输入搜索关键词
    minLength: 1
    maxLength: 100
  password:
    type: string
    required: true
    secret: true
    humanOnly: true
```

规则：

- `secret: true` 的变量不能写入日志、截图文件名、LLM prompt 或 SQLite 明文。
- `humanOnly: true` 的变量必须触发人工接管，Agent 不自动输入。
- 执行前生成 `resolvedInputs`，但日志中只保存脱敏值。
- 未提供必填变量时，任务进入 `paused`，等待用户补充。

### 3.2 LLM API Key 不应明文保存在 settings.json

**当前问题**

配置示例把 `apiKey` 放在 `~/.agivar/settings.json`。

**风险**

桌面 Agent 会保存截图、任务日志和模型配置。如果 API Key 明文落盘，泄漏面过大。

**建议修改**

- `settings.json` 只保存 provider、model、baseURL 等非敏感配置。
- API Key 存入系统凭据管理器，例如 Windows Credential Manager。
- 设置页只显示掩码，如 `sk-...abcd`。
- 日志、错误上报和调试输出必须过滤 API Key。
- 若暂时不接入系统凭据管理器，至少使用本机加密并明确这是 Phase 1 临时方案。

### 3.3 数据库需要迁移机制，而不只是 schema

**当前问题**

文档给了 SQLite 建表语句，但没有说明 schema 版本、迁移策略、WAL、同步写入阻塞和数据库初始化方式。

**建议补充**

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

并在设计中明确：

- 启动时运行 migrations。
- 开启 WAL：`PRAGMA journal_mode = WAL;`
- 设置 busy timeout。
- better-sqlite3 同步写入不要放在高频 UI 事件路径中，执行日志可通过队列批量写入。
- `task_step_logs` 中保存 workflow step 快照，避免流程更新后历史日志无法复盘。

### 3.4 TaskRun schema 需要对齐落地方案

**当前问题**

落地方案中的 `TaskRun` 包含 `selected_memory_ids[]`、`plan`、`screenshots[]`、`ui_tree_snapshots[]`、`human_takeover_events[]`。阶段 1 schema 只有 `matched_memory_id`，不足以支撑调试和复盘。

**建议补充字段**

```sql
ALTER TABLE task_runs ADD COLUMN selected_memory_ids TEXT; -- JSON array
ALTER TABLE task_runs ADD COLUMN plan_json TEXT;           -- StepPlan[]
ALTER TABLE task_runs ADD COLUMN run_config TEXT;          -- provider/model/safety settings snapshot

ALTER TABLE task_step_logs ADD COLUMN workflow_step_snapshot TEXT;
ALTER TABLE task_step_logs ADD COLUMN target_snapshot TEXT;
ALTER TABLE task_step_logs ADD COLUMN tool_result TEXT;
ALTER TABLE task_step_logs ADD COLUMN failure_info TEXT;
```

这样历史任务可以在流程修改后仍然复盘。

### 3.5 MemoryStore 搜索要有阈值和人工选择策略

**当前问题**

MemoryStore 返回 top-3，但 AgentService 直接使用 `memories[0]`。

**风险**

关键词匹配在中文场景下容易误命中。错误流程一旦自动执行，风险比“没找到流程”更高。

**建议修改**

```typescript
interface MemorySearchResult {
  memory: WorkflowMemory;
  score: number;
  matchedFields: string[];
}
```

执行策略：

- `score >= 0.8`：自动选择最高分流程。
- `0.5 <= score < 0.8`：展示候选流程，让用户确认。
- `< 0.5`：不自动执行，进入 LLM 对照或提示导入流程。

阶段 1 可以先用简单评分，但必须把阈值写进设计。

### 3.6 人工接管需要状态机

**当前问题**

文档有 `TakeoverRequest`，但没有定义暂停、恢复、超时和窗口变化的处理。

**建议补充状态机**

```text
running
  ├─ needs_takeover → paused
  ├─ user_resume → observing
  ├─ observation_pass → running
  ├─ observation_mismatch → paused
  ├─ user_abort → aborted
  └─ timeout → failed
```

恢复条件：

- 用户点击“继续”后必须重新截图和获取活动窗口。
- 如果活动窗口不是预期窗口，继续前要求用户确认。
- 恢复事件写入 `human_takeover_events`。
- 接管期间不执行任何自动输入动作。

### 3.7 IPC 事件订阅需要可取消和按任务隔离

**当前问题**

`onEvent` 只注册监听，没有返回取消函数，也没有按 `taskRunId` / `sessionId` 过滤事件。

**建议修改**

```typescript
onEvent: (taskRunId: string, callback: (event: AgentEvent) => void) => {
  const handler = (_: unknown, event: AgentEvent) => {
    if (event.taskRunId === taskRunId) callback(event);
  };
  ipcRenderer.on('agent:event', handler);
  return () => ipcRenderer.removeListener('agent:event', handler);
}
```

`AgentEvent` 也应统一包含：

```typescript
type AgentEventBase = {
  taskRunId: string;
  sessionId: string;
  timestamp: string;
};
```

### 3.8 本地数据目录建议使用 Electron userData

**当前问题**

文档使用 `~/.agivar/`。这和落地方案一致，但在 Windows 桌面应用里，正式打包后更推荐使用 Electron 的 `app.getPath('userData')`。

**建议**

阶段 1 可以保留可配置 `dataDir`，但默认值建议：

```text
开发环境：<repo>/.agivar-dev/
生产环境：app.getPath('userData')
```

这样符合 Windows 用户数据目录习惯，也更利于卸载、备份和权限处理。

---

## 4. 可选但有价值的优化

### 4.1 明确 provider 支持范围

文档写“OpenAI 格式兼容”并列出 GPT-4o / Claude / Qwen-VL / DeepSeek。这里需要更精确：

- OpenAI、DeepSeek、Qwen 可能走 OpenAI-compatible adapter。
- Claude 通常需要 Anthropic provider adapter，不应写成 OpenAI-compatible。

建议阶段 1 只承诺：

```markdown
阶段 1 P0 支持一个 OpenAI-compatible provider。多 provider 切换作为 P1。Claude 通过独立 adapter 接入，不纳入 P0。
```

这能减少第一版配置和调试成本。

### 4.2 和“不做任务进度悬浮窗”保持一致

文档架构图中写了 `TaskProgressOverlay (悬浮窗/内嵌进度面板)`，但第 13 节明确“不做任务进度悬浮窗（内嵌在聊天流中）”。

建议统一改为：

```text
TaskProgressPanel（内嵌在聊天流中）
```

阶段 1 不创建额外 BrowserWindow，避免窗口置顶、录屏排除和焦点争抢问题。

### 4.3 补充隐私和日志保留策略

阶段 1 会保存大量截图和 UIA 快照，建议加一节：

- 默认只保存任务必要截图。
- 日志保留天数可配置。
- 用户可以删除某个 TaskRun 的所有截图、UIA 快照和数据库记录。
- 发送给 LLM 的截图要在日志中记录“发送时间、provider、用途”，但不记录 API Key。
- 密码框、验证码、支付页面触发人工接管，不进入 LLM prompt。

### 4.4 为阶段 2 预留向量检索迁移口

阶段 1 改为关键词检索是合理的，但和落地方案中“sqlite-vec P0”不一致。建议在关键决策里写清楚这是一次阶段收敛，并预留字段：

```sql
ALTER TABLE workflow_memories ADD COLUMN search_text TEXT;
ALTER TABLE workflow_memories ADD COLUMN embedding_status TEXT DEFAULT 'not_indexed';
```

阶段 1 不生成 embedding，但数据结构为阶段 2 迁移做准备。

### 4.5 增加阶段 1 实施顺序

建议在设计文档末尾加一个 3-4 周实现顺序：

```text
Week 1: Phase 0 补验 + Storage / Memory / Workflow Parser
Week 2: StepExecutor / ToolRouter / StateVerifier / ExecutionLog
Week 3: SafetyLayer / Emergency Stop / Takeover / 3 条流程跑通
Week 4: Chat UI / Settings / 回归评测 / 验收报告
```

LLM 自主规划放在 Week 4 的 P1 对照实验，避免压住主链路。

---

## 5. 建议后的阶段 1 范围

推荐把阶段 1 范围重写为：

### P0 必做

- 手写 YAML / JSON 流程导入。
- MemoryStore 关键词检索 + 阈值选择。
- StepPlan 统一模型。
- ToolRouter 对接 Phase 0 工具 API。
- StepExecutor 执行前后截图。
- StateVerifier 非 OCR 验证。
- SafetyLayer 风险分级和高风险拦截。
- Emergency Stop 真实中断交互动作。
- Human Takeover 暂停与恢复。
- SQLite 任务、消息、流程、步骤日志持久化。
- 聊天主界面和内嵌任务进度。
- 3 条本地可控评测流程。

### P1 对照

- LLM 生成 StepPlan，但不直接执行工具。
- 本地测试页上的 LLM 自主规划 3/5 成功率统计。
- 多 provider 配置页面的最小版本。

### 明确不做

- 外网站点自动化验收。
- 账号登录态复用。
- OCR 视觉定位。
- 录屏教学。
- 流程编辑器。
- Python 脚本执行。
- 自动更新。
- 独立任务进度悬浮窗。

---

## 6. 结论

这份阶段 1 文档已经具备实施设计的雏形，但需要先修正“范围”和“执行安全链”两个核心问题。

最重要的修改顺序：

1. 先把 Phase 0 遗留补验写成阶段 1 前置门槛。
2. 把确定性手写流程闭环设为 P0，LLM 自主规划降为 P1 对照。
3. 禁止 LLM tool `execute` 直接操作桌面，统一改为产出 StepPlan。
4. ToolRouter 对齐 Phase 0 API，尤其是 `clickPoint`、`invokeElement`、`BrowserSession.page`。
5. 补齐 TaskContext、任务状态机、日志 schema 和隐私策略。

完成这些修正后，再写阶段 1 实施计划会更稳，也更符合落地方案“先证明能执行，再降低教学成本”的主线。
