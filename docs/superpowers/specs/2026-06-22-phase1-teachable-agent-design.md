# 阶段 1：可教学桌面流程 Agent — 技术设计文档

> 日期：2026-06-22
> 状态：设计完成，待实现
> 关联：[落地方案.md](../../../落地方案.md) 阶段 1 | [Phase 0 设计](../../specs/2026-06-21-phase0-desktop-poc-design.md) | [Phase 0 验收报告](../../phase0-acceptance-report.md)
> 评审记录：[Codex 评审意见](./2026-06-22-phase1-teachable-agent-design-review.md)

---

## 1. 目标

跑通「手写流程记忆 → 观察 → 执行 → 验证 → 日志」完整闭环。

阶段 0 已交付桌面控制代码骨架，其中截图、Playwright、基础 UIA 可直接复用；输入、紧急停止和录屏帧捕获需要在阶段 1 开始前完成补验。

### 阶段 1 前置门槛

阶段 1 可以复用 Phase 0 的代码骨架，但以下能力必须在阶段 1 Day 1-2 补验：

1. 非远程桌面环境下运行 `poc:interactive`，确认键鼠输入成功率 >= 90%。
2. 确认紧急停止热键真实可中断交互动作，响应时间 < 500ms。
3. 录屏至少完成 WGC 或 DXGI 的真实帧捕获验证。
4. UIA 对 Win11 Notepad 的 Document 控件使用 tree walk 回退，不依赖 ValuePattern 读取。
5. 记录 Phase 0 已知限制清单，并决定哪些限制允许带入阶段 1。

### P0 验收条件（Go/No-Go）

| 条件 | 指标 |
|------|------|
| 手写流程导入到首次执行成功 | < 10 分钟 |
| 固定流程重复执行成功率 | > 80%（3 条流程各执行 5 次） |
| 失败可诊断率 | > 80%（失败时能定位到步骤和原因） |
| 紧急停止响应 | < 500ms |
| 人工接管后可继续 | 100% |
| 每步执行日志完整率 | 100% |

### P1 对照验证（不作为 Go/No-Go）

LLM 自主规划只作为对照实验。验证范围限定在本地测试页和记事本，不进入真实外网站点和高风险动作。

| 条件 | 指标 |
|------|------|
| LLM 自主规划完成本地简单任务 | 3/5 成功（本地测试页填表单 + 记事本输入） |
| LLM 产出的 StepPlan 通过统一执行链 | 100%（不存在绕过 SafetyLayer 的路径） |

### 必交付评测流程（3 条，全部使用本地可控目标）

1. **form-fill-local.yaml**：打开本地测试页 → 填写 3 个字段 → 提交 → 验证成功消息
2. **search-local.yaml**：打开本地搜索 fixture → 输入关键词 → 验证搜索结果区域出现匹配项
3. **notepad-text.yaml**：打开记事本 → 输入文本 → UIA / 截图验证文本

每条流程提供手写 YAML 版本（确定性执行）。同时用 LLM 自主规划路径跑一遍作为 P1 对照。

---

## 2. 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 架构模式 | Agent-First | 两条执行路径（流程/LLM）统一为 StepPlan，共享工具层和安全层 |
| LLM 接入 | 多模型抽象层 | P0 只承诺一个 OpenAI-compatible provider；Claude 通过独立 adapter 接入，不纳入 P0 |
| Agent 框架 | Vercel AI SDK + 自研编排 | AI SDK 处理 tool 定义和流式响应，LLM 只产出 StepPlan，不直接执行副作用 |
| 聊天 UI | 完整聊天界面 | 左侧会话列表 + 中间消息流 + 底部输入栏 |
| 本地存储 | better-sqlite3 | 会话/流程/任务/日志统一存储，WAL 模式 |
| 记忆检索 | 关键词匹配 + 阈值选择 | 延迟向量检索到阶段 2，阶段 1 用 SQL LIKE + 分词匹配；高分自动选择，低分要求用户确认 |
| 阶段 1 P0 范围 | 确定性流程闭环 | LLM 自主规划降为 P1 对照实验，避免同时承担闭环工程化和 LLM 稳定性两个难题 |
| 样式方案 | Tailwind CSS + 暗色主题 | 轻量，不引入组件库 |
| API Key 存储 | OS 凭据管理器 | settings.json 只存非敏感配置，API Key 存入 Windows Credential Manager |

---

## 3. 整体架构

### 分层架构

```
┌─────────────────────────────────────────────────────────┐
│                 渲染进程 (React + Zustand)                │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ Sidebar   │ │ ChatView     │ │ InputBar             │ │
│  │ 会话列表  │ │ 消息流+工具卡│ │ 文本+附件+模式切换   │ │
│  └──────────┘ └──────────────┘ └──────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐│
│  │ TaskProgressPanel (内嵌在聊天流中)                     ││
│  └──────────────────────────────────────────────────────┘│
└────────────────────────┬────────────────────────────────┘
                    IPC (contextBridge)
┌────────────────────────┼────────────────────────────────┐
│                 主进程 (Electron)                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              AgentService (调度核心)                  │ │
│  │  ┌───────────┐ ┌──────────────┐ ┌────────────────┐  │ │
│  │  │MemoryStore│ │ TaskPlanner  │ │ ToolRouter     │  │ │
│  │  │记忆检索   │ │ LLM规划/流程 │ │ 工具自动路由   │  │ │
│  │  └───────────┘ └──────────────┘ └────────────────┘  │ │
│  │  ┌───────────┐ ┌──────────────┐ ┌────────────────┐  │ │
│  │  │StepExec   │ │ StateVerifier│ │ FailureHandler │  │ │
│  │  │步骤执行器 │ │ 状态验证     │ │ 失败分级处理   │  │ │
│  │  └───────────┘ └──────────────┘ └────────────────┘  │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              SafetyLayer (操作安全层)                 │ │
│  │  风险分级 │ 操作确认 │ 紧急停止 │ 人工接管 │ 日志     │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              StorageLayer (本地存储层)                │ │
│  │  better-sqlite3: 会话/流程/任务/日志 (WAL 模式)       │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              LLMProvider (多模型抽象层)               │ │
│  │  OpenAI 格式兼容 │ 多模态视觉 │ 流式响应              │ │
│  └─────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                    @agivar/core 工具层
┌────────────────────────┼────────────────────────────────┐
│  screenshot │ uia │ input │ browser │ recorder │ dpi    │
│                   (Phase 0 已交付)                        │
└─────────────────────────────────────────────────────────┘
```

### 包结构演进

Phase 0 的三包结构保持不变，新增内容在现有包内扩展：

```
packages/
├── core/src/
│   ├── tools/          # Phase 0 已有 (screenshot, uia, input, browser, recorder, dpi)
│   ├── agent/          # 新增：Agent 调度核心
│   │   ├── agent-service.ts      # AgentService 主循环
│   │   ├── task-context.ts       # TaskContext 定义和生命周期
│   │   ├── task-planner.ts       # 任务规划器（流程执行 + LLM 规划）
│   │   ├── step-executor.ts      # 步骤执行器
│   │   ├── state-verifier.ts     # 状态验证器
│   │   ├── failure-handler.ts    # 失败分级处理
│   │   └── tool-router.ts        # 工具适配路由
│   ├── memory/         # 新增：记忆系统
│   │   ├── memory-store.ts       # SQLite 存储 + 关键词检索
│   │   ├── workflow-parser.ts    # JSON/YAML 流程解析 + 变量 schema 验证
│   │   └── schema.ts             # 数据库 schema + 迁移
│   ├── llm/            # 新增：LLM 抽象层
│   │   ├── provider.ts           # LLMProvider interface
│   │   ├── openai-compatible.ts  # OpenAI 格式适配
│   │   └── prompts.ts            # 系统提示词
│   ├── safety/         # 新增：安全层
│   │   ├── risk-classifier.ts    # 风险分级
│   │   ├── abort-manager.ts      # AbortController 管理（纯 Node.js）
│   │   └── execution-log.ts      # 执行日志
│   └── types/          # Phase 0 已有，扩展
│
├── desktop/src/
│   ├── main/           # Phase 0 已有，扩展 IPC
│   │   ├── global-hotkey.ts      # 新增：Electron globalShortcut 适配
│   │   └── credential-store.ts   # 新增：OS 凭据管理器适配
│   ├── renderer/       # 重写：聊天 UI
│   │   ├── App.tsx
│   │   ├── pages/ChatPage.tsx
│   │   ├── components/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── ChatView.tsx
│   │   │   ├── InputBar.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ToolCallCard.tsx
│   │   │   └── TaskProgressPanel.tsx
│   │   └── stores/
│   │       ├── chat-store.ts
│   │       └── task-store.ts
│   └── preload.ts      # Phase 0 已有，扩展
│
└── native/             # Phase 0 已有，阶段 1 无新增
```

### 核心设计原则

1. **Agent 不依赖 Electron**：`packages/core/src/agent/` 纯 Node.js，可独立测试。紧急停止在 core 层使用 AbortController/signal 模式（`abort-manager.ts`），Electron `globalShortcut` 注册在 desktop 层（`global-hotkey.ts`）
2. **工具层零改动**：Phase 0 的 6 个 tools 模块直接复用，ToolRouter 通过适配器模式桥接
3. **LLM 只规划不执行**：LLM 产出 StepPlan，所有副作用统一经过 SafetyLayer → StepExecutor → ToolRouter → StateVerifier → ExecutionLog
4. **两条执行路径共享基础设施**：SafetyLayer、StateVerifier、ExecutionLog、ToolRouter

### 依赖关系

```
desktop (Electron 壳)
  ├── global-hotkey.ts            — globalShortcut → AbortManager (新增)
  ├── credential-store.ts         — Windows Credential Manager (新增)
  └── core (TypeScript 工具层 + Agent 核心)
        ├── native (Rust napi-rs)       — UIA / 录屏 / DPI (Phase 0)
        ├── @nut-tree/nut-js            — 键鼠控制 (Phase 0)
        ├── node-screenshots            — 截屏 (Phase 0)
        ├── playwright                  — 浏览器 (Phase 0)
        ├── ai + @ai-sdk/openai         — Vercel AI SDK (新增)
        ├── better-sqlite3              — 本地数据库 (新增)
        ├── js-yaml                     — YAML 流程解析 (新增)
        └── zod                         — schema 验证 (新增)
```

---

## 4. Agent 执行循环

### TaskContext 定义

所有执行模块共享的运行时上下文：

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

  browserSession?: BrowserSession;   // Phase 0 的 BrowserSession
  activeHwnd?: number;
  activeWindowTitle?: string;

  maxRetries: number;                // 从 settings.safety.maxRetries 初始化
  outputDir: string;                 // logs/{taskRunId}/
  abortController: AbortController;
  signal: AbortSignal;               // abortController.signal 的快捷引用

  startedPids: number[];
  createdTempDirs: string[];
  lastObservation?: ObservationSnapshot;
  humanTakeoverEvents: HumanTakeoverEvent[];
}

interface ObservationSnapshot {
  screenshot: Buffer;
  screenshotPath?: string;
  windowTitle: string;
  hwnd?: number;
  uiaTree?: UiaNode;
  timestamp: string;
}

interface HumanTakeoverEvent {
  stepIndex: number;
  reason: string;
  pausedAt: string;
  resumedAt?: string;
  userAction?: string;
}
```

**TaskContext 生命周期规则：**
- 同一时间默认只允许一个 active task
- 每个 task 创建独立 `AbortController`，任务结束后释放
- 任务结束时必须：关闭本任务启动的浏览器、停止录屏、清理临时目录
- 用户原本打开的浏览器和记事本不能被粗暴关闭
- `AbortController` 触发后不能复用，恢复任务时必须新建 signal
- 任务状态流转必须写入数据库

### 核心执行流程

```
用户输入目标
    │
    ▼
AgentService.run(goal)
    │
    ├─── MemoryStore.search(goal)
    │         │
    │    ┌────┴──────────────────────┐
    │    │score >= 0.8  │→ 自动选择最高分流程 → WorkflowExecutor
    │    │0.5 <= score   │→ 展示候选，用户确认 → WorkflowExecutor
    │    │score < 0.5   │→ 不自动执行 → LLMPlanner（P1）
    │    │无匹配         │→ LLMPlanner（P1）
    │    └───────────────────────────┘
    │
    ▼
执行循环（逐步，两条路径共享）
    │
    ├─── SafetyLayer.check(step, context)
    │       ├── 低风险 → 直接执行
    │       ├── 中风险 → 展示计划（可配置确认）
    │       ├── 高风险 → 强制弹窗确认
    │       └── 禁止   → 暂停，人工接管
    │
    ├─── StepExecutor.execute(step, context)
    │       ├── 截图（执行前）
    │       ├── ToolRouter.dispatch(step.action, context)
    │       └── 截图（执行后）
    │
    ├─── StateVerifier.verify(step.expectedState, context)
    │       ├── pass → 继续下一步
    │       └── fail → FailureHandler
    │
    ├─── ExecutionLog.write(step, result, verification, context)
    │
    └─── FailureHandler.handle(failure)
            ├── retryable   → 等待后重试（最多 2 次）
            ├── degradable  → 切换定位策略
            ├── takeover    → 暂停，等待用户
            └── terminal    → 停止任务，输出诊断
```

### 两条执行路径的统一接口

```typescript
interface StepPlan {
  intent: string;                    // "点击搜索框"
  action: StepAction;                // 具体动作
  expectedState?: ExpectedState;     // 验证条件
  riskLevel: 'low' | 'medium' | 'high' | 'forbidden';
  source: 'workflow' | 'llm';       // 来源标记
}

type StepAction =
  | { type: 'click'; target: TargetDescriptor }
  | { type: 'type'; text: string }
  | { type: 'press'; keys: string[] }
  | { type: 'scroll'; direction: 'up' | 'down'; amount: number }
  | { type: 'navigate'; url: string }
  | { type: 'wait'; condition: ExpectedState; timeoutMs: number }
  | { type: 'observe' }
  | { type: 'takeover'; reason: string }
  | { type: 'done'; summary: string };

// 判别联合类型，每种策略携带自己需要的参数
type TargetDescriptor =
  | { strategy: 'playwright'; selector: string; hint?: string }
  | { strategy: 'uia'; query: ElementQuery; hwnd?: number; hint?: string }
  | { strategy: 'coordinate'; point: Point; hint?: string }
  | { strategy: 'human'; hint: string };
```

### 流程执行路径（WorkflowExecutor）

```typescript
class WorkflowExecutor {
  async *execute(workflow: WorkflowMemory, context: TaskContext): AsyncGenerator<StepEvent> {
    // 1. 验证初始状态
    // 2. 遍历 workflow.steps，逐步生成 StepPlan
    // 3. 每步 yield 事件给 AgentService
    // 4. 验证失败次数 > 2 → 切换到 LLM 路径
  }
}
```

流程执行**失败后可降级到 LLM 路径**。如果按步骤执行连续 2 次验证失败，AgentService 切换到 LLMPlanner 接管剩余步骤。

### LLM 自主规划路径（LLMPlanner）

LLM 只产出 StepPlan，**不直接执行任何桌面操作**。所有副作用统一由 AgentService.executePlannedStep() 处理。

```typescript
interface PlannerOutput {
  step: StepPlan;
  confidence: number;
  rationale: string;
}

class LLMPlanner {
  async planNext(context: TaskContext): Promise<PlannerOutput> {
    // 1. 截图当前屏幕
    // 2. 获取活动窗口 UIA 树（可选）
    // 3. 组装 prompt：目标 + 截图 + 已执行步骤 + 当前状态
    // 4. 调用多模态 LLM（通过 Vercel AI SDK generateText + tools schema）
    // 5. 解析 LLM 返回的 tool_call → StepPlan（不执行，仅解析）
    // 6. 返回 PlannerOutput，交由 AgentService 走统一执行链
  }
}
```

Vercel AI SDK 的 `tool()` 定义只提供 `parameters` schema，**不提供 `execute`**。LLM 通过 tool_call 返回结构化动作意图，LLMPlanner 解析为 StepPlan 后返回。

### AgentService 主循环

```typescript
class AgentService {
  async *run(goal: string, sessionId: string): AsyncGenerator<AgentEvent> {
    const context = await this.createTaskContext(goal, sessionId);

    try {
      const searchResults = await this.memoryStore.search(goal);
      const selected = await this.selectMemory(searchResults, context);

      if (selected) {
        // 流程路径
        context.mode = 'workflow';
        const executor = new WorkflowExecutor(selected.memory);
        for await (const event of executor.execute(context)) {
          yield event;
          if (event.type === 'step-failed' && event.failCount > 2) {
            context.mode = 'hybrid';
            break;
          }
        }
      }

      // LLM 路径（无记忆、流程路径降级、或用户选择）
      if (!context.isDone && !context.isAborted) {
        context.mode = context.mode === 'hybrid' ? 'hybrid' : 'llm';
        while (!context.isDone && !context.isAborted) {
          const plannerOutput = await this.llmPlanner.planNext(context);
          if (plannerOutput.step.action.type === 'done') break;

          // 统一执行链：LLM 产出的 StepPlan 和流程路径走同一条管线
          const result = await this.executePlannedStep(plannerOutput.step, context);
          yield result;
        }
      }
    } finally {
      await this.cleanupTaskContext(context);
    }
  }

  async executePlannedStep(step: StepPlan, context: TaskContext): Promise<StepResult> {
    // 1. SafetyLayer.check(step, context)
    // 2. StepExecutor.execute(step, context)  — 包含执行前后截图
    // 3. StateVerifier.verify(step.expectedState, context)
    // 4. ExecutionLog.write(step, result, verification, context)
    // 5. 返回 StepResult
  }

  private async selectMemory(
    results: MemorySearchResult[],
    context: TaskContext,
  ): Promise<MemorySearchResult | null> {
    if (results.length === 0) return null;
    const best = results[0];
    if (best.score >= 0.8) return best;
    if (best.score >= 0.5) {
      // 展示候选流程，等待用户确认
      yield { type: 'memory-candidates', candidates: results };
      return await this.waitForUserSelection(context);
    }
    return null; // score < 0.5，不自动执行
  }
}
```

### ToolRouter 适配层

ToolRouter 通过适配器模式桥接 StepAction 到 Phase 0 实际工具 API。每个方法接收 `AbortSignal`，所有工具返回 `ToolResult<T>`。

```typescript
class ToolRouter {
  constructor(private tools: ToolAdapters) {}

  async dispatch(action: StepAction, context: TaskContext): Promise<ToolResult<unknown>> {
    if (context.signal.aborted) {
      return toolErr('TASK_ABORTED', 'Task was aborted', 0);
    }

    switch (action.type) {
      case 'click':
        return this.routeClick(action.target, context);
      case 'type':
        return this.tools.input.typeText(action.text);
      case 'press':
        return this.tools.input.pressKeys(action.keys);
      case 'scroll':
        return this.tools.input.scroll(action.direction, action.amount);
      case 'navigate':
        return this.routeNavigate(action.url, context);
      case 'wait':
        return this.waitForCondition(action.condition, action.timeoutMs, context);
      case 'observe':
        return this.captureState(context);
      case 'takeover':
        throw new TakeoverRequest(action.reason);
      case 'done':
        return toolOk({ done: true, summary: action.summary }, 0);
    }
  }

  private async routeClick(target: TargetDescriptor, ctx: TaskContext): Promise<ToolResult<void>> {
    switch (target.strategy) {
      case 'playwright': {
        const page = ctx.browserSession?.page;
        if (!page) return toolErr('BROWSER_NOT_READY', 'No active browser session', 0);
        return this.tools.browser.clickElement(page, target.selector);
      }
      case 'uia': {
        const hwnd = target.hwnd ?? ctx.activeHwnd;
        if (!hwnd) return toolErr('UIA_ELEMENT_NOT_FOUND', 'No active window hwnd', 0);
        return this.tools.uia.invokeElement(hwnd, target.query);
      }
      case 'coordinate': {
        return this.tools.input.clickPoint(target.point);
      }
      case 'human': {
        throw new TakeoverRequest(`需要人工定位: ${target.hint}`);
      }
    }
  }

  private async routeNavigate(url: string, ctx: TaskContext): Promise<ToolResult<void>> {
    const page = ctx.browserSession?.page;
    if (!page) return toolErr('BROWSER_NOT_READY', 'No active browser session', 0);
    return this.tools.browser.navigateTo(page, url);
  }
}
```

**ToolAdapters 接口（对齐 Phase 0 实际 API）：**

```typescript
interface ToolAdapters {
  browser: {
    clickElement(page: Page, selector: string): Promise<ToolResult<void>>;
    fillInput(page: Page, selector: string, value: string): Promise<ToolResult<void>>;
    navigateTo(page: Page, url: string): Promise<ToolResult<void>>;
    getPageText(page: Page): Promise<ToolResult<string>>;
  };
  uia: {
    invokeElement(hwnd: number, query: ElementQuery): Promise<ToolResult<void>>;
    findElement(hwnd: number, query: ElementQuery): Promise<ToolResult<UiaNode | null>>;
    setElementValue(hwnd: number, query: ElementQuery, value: string): Promise<ToolResult<void>>;
    getElementValue(hwnd: number, query: ElementQuery): Promise<ToolResult<string>>;
    getUiTree(hwnd: number): Promise<ToolResult<UiaNode>>;
  };
  input: {
    clickPoint(point: Point): Promise<ToolResult<void>>;
    typeText(text: string): Promise<ToolResult<void>>;
    pressKeys(keys: string[]): Promise<ToolResult<void>>;
    scroll(direction: 'up' | 'down', amount: number): Promise<ToolResult<void>>;
    releaseAllKeys(): Promise<ToolResult<void>>;
  };
  screenshot: {
    captureScreen(monitorIndex?: number): Promise<ToolResult<ScreenshotResult>>;
    captureWindow(hwnd: number): Promise<ToolResult<ScreenshotResult>>;
    getActiveWindow(): Promise<ToolResult<WindowInfo>>;
  };
}
```

> **AbortSignal 策略**：ToolAdapters 本身不携带 `signal` 参数 — Phase 0 工具层保持零改动。ToolRouter 在每次 `dispatch` 调用前统一检查 `context.signal.aborted`，长耗时操作（navigateTo、getUiTree）由 ToolRouter wrapper 加 `Promise.race([tool(), abortPromise])` 超时保护。实施计划中明确：阶段 1 在 ToolRouter 层统一处理中断，Phase 0 工具接口不变。

> **注意**：Phase 0 的 `input` 模块没有 `scroll` 和 `releaseAllKeys` 函数，需要在阶段 1 前置任务中补充实现。

### 任务状态机

```
pending ──→ running
              │
              ├── needs_takeover ──→ paused
              │                       │
              │                       ├── user_resume ──→ observing
              │                       │                     │
              │                       │                     ├── observation_pass ──→ running
              │                       │                     └── observation_mismatch ──→ paused
              │                       │
              │                       ├── user_abort ──→ aborted
              │                       └── timeout (5min) ──→ failed
              │
              ├── all_steps_pass ──→ success
              ├── terminal_failure ──→ failed
              └── emergency_stop ──→ aborted
```

**恢复条件：**
- 用户点击"继续"后必须重新截图和获取活动窗口
- 如果活动窗口不是预期窗口，继续前要求用户确认
- 恢复事件写入 `human_takeover_events`
- 接管期间不执行任何自动输入动作

### 事件流（Agent → UI）

```typescript
type AgentEventBase = {
  taskRunId: string;
  sessionId: string;
  timestamp: string;
};

type AgentEvent = AgentEventBase & (
  | { type: 'thinking'; message: string }
  | { type: 'memory-match'; workflow: WorkflowMemory }
  | { type: 'memory-candidates'; candidates: MemorySearchResult[] }
  | { type: 'step-start'; step: StepPlan; index: number }
  | { type: 'step-screenshot'; before?: string; after?: string }
  | { type: 'step-result'; success: boolean; verification?: VerifyResult }
  | { type: 'step-failed'; failure: FailureInfo; failCount: number }
  | { type: 'takeover-required'; reason: string }
  | { type: 'takeover-resumed' }
  | { type: 'tool-call'; tool: string; args: unknown; result?: unknown }
  | { type: 'task-complete'; summary: string }
  | { type: 'task-failed'; diagnosis: string }
  | { type: 'message'; role: 'assistant'; content: string }
);
```

事件通过 IPC 推送到渲染进程，ChatView 将其渲染为消息气泡和工具调用卡片。

---

## 5. 记忆系统

### 数据模型

```typescript
interface WorkflowMemory {
  id: string;
  appName: string;              // "Chrome", "记事本"
  platform: 'desktop' | 'browser' | 'hybrid';
  topic: string;                // "local-form/fill"
  triggerExamples: string[];    // ["帮我填表单", "填写测试表单"]
  summary: string;
  initialState: string;
  inputs?: WorkflowInput[];     // 变量定义
  steps: WorkflowStep[];
  successCriteria: string;
  riskLevel: 'low' | 'medium' | 'high';
  sourceType: 'manual' | 'text-teach' | 'recording';
  version: number;
  searchText: string;           // 预计算的搜索文本（为阶段 2 向量检索预留）
  embeddingStatus: 'not_indexed';  // 阶段 1 固定值
  createdAt: string;
  updatedAt: string;
}

interface WorkflowInput {
  name: string;                  // 变量名，如 "searchQuery"
  type: 'string' | 'number';
  required: boolean;
  prompt: string;                // 提示用户的文本
  secret?: boolean;              // true → 不写入日志/LLM prompt/截图文件名
  humanOnly?: boolean;           // true → 触发人工接管，Agent 不自动输入
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
}

interface WorkflowStep {
  id: string;
  order: number;
  intent: string;               // "点击搜索框"
  targetHint: string;           // "顶部搜索框，placeholder '搜索'"
  target: TargetDescriptor;     // 使用判别联合类型
  inputHint?: string;           // "非十科技" 或 "{{searchQuery}}"
  expectedState?: ExpectedState;
  fallback?: 'retry' | 'degrade' | 'takeover' | 'terminal';
  riskLevel: 'low' | 'medium' | 'high' | 'forbidden';
}
```

### 变量处理规则

- `secret: true` 的变量不能写入日志、截图文件名、LLM prompt 或 SQLite 明文
- `humanOnly: true` 的变量必须触发人工接管，Agent 不自动输入
- 执行前生成 `resolvedInputs`，日志中只保存脱敏值
- 未提供必填变量时，任务进入 `paused`，等待用户补充

### 检索策略（关键词 + 阈值）

```typescript
interface MemorySearchResult {
  memory: WorkflowMemory;
  score: number;                 // 0-1，匹配置信度
  matchedFields: string[];       // ["triggerExamples", "topic"]
}

class MemoryStore {
  async search(goal: string): Promise<MemorySearchResult[]> {
    // 1. 分词（简单空格 + 标点分割，中文按字符 bigram）
    // 2. SQL LIKE 匹配 trigger_examples, summary, topic, app_name, search_text
    // 3. 计算 score（匹配字段数 / 总字段数 + 匹配 token 覆盖率）
    // 4. 按 score 排序，返回 top-3
  }

  async importWorkflow(filePath: string): Promise<WorkflowMemory>
  async getById(id: string): Promise<WorkflowMemory | null>
  async list(filter?: { appName?: string; topic?: string }): Promise<WorkflowMemory[]>
  async update(id: string, patch: Partial<WorkflowMemory>): Promise<void>
  async delete(id: string): Promise<void>
}
```

**搜索阈值策略：**
- `score >= 0.8`：自动选择最高分流程
- `0.5 <= score < 0.8`：展示候选流程，让用户确认
- `score < 0.5`：不自动执行，进入 LLM 对照或提示导入流程

### 手写流程格式（JSON/YAML）

用户通过文件导入流程。示例模板：

```yaml
# workflows/form-fill-local.yaml
appName: Chrome
platform: browser
topic: local-form/fill
triggerExamples:
  - 帮我填表单
  - 填写测试表单
summary: 在本地测试页填写并提交表单
initialState: 浏览器已打开，当前在任意页面

inputs:
  userName:
    type: string
    required: true
    prompt: 请输入用户名
    minLength: 1
    maxLength: 50
  email:
    type: string
    required: true
    prompt: 请输入邮箱

riskLevel: low

steps:
  - intent: 打开本地测试页
    targetHint: 浏览器地址栏
    target:
      strategy: playwright
      selector: "body"
    inputHint: "http://127.0.0.1:12827/test-form.html"
    expectedState:
      any:
        - type: page_text_contains
          value: 测试表单
    riskLevel: low

  - intent: 填写用户名
    targetHint: 用户名输入框
    target:
      strategy: playwright
      selector: "#username"
    inputHint: "{{userName}}"
    riskLevel: low

  - intent: 填写邮箱
    targetHint: 邮箱输入框
    target:
      strategy: playwright
      selector: "#email"
    inputHint: "{{email}}"
    riskLevel: low

  - intent: 提交表单
    targetHint: 提交按钮
    target:
      strategy: playwright
      selector: "button[type='submit']"
    expectedState:
      any:
        - type: page_text_contains
          value: 提交成功
    riskLevel: medium

successCriteria: 页面显示提交成功消息
```

---

## 6. LLM 抽象层

### LLMProvider 接口

```typescript
interface LLMProvider {
  id: string;                    // "openai", "deepseek", "qwen"
  displayName: string;
  supportsVision: boolean;

  generateText(params: {
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<GenerateResult>;

  streamText(params: {
    messages: Message[];
    tools?: ToolDefinition[];
  }): AsyncGenerator<StreamChunk>;
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}
```

### Vercel AI SDK 集成

```typescript
import { generateText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

// P0 只承诺一个 OpenAI-compatible provider
// 多 provider 切换作为 P1
function createProvider(config: LLMConfig) {
  return createOpenAI({
    apiKey: config.apiKey,       // 从 OS 凭据管理器读取
    baseURL: config.baseURL,     // 可选自定义 baseURL（DeepSeek/Qwen 兼容）
  });
}
```

### Agent 工具 Schema（仅 Schema，无 execute）

LLM 通过 tool_call 返回动作意图。工具定义**只提供 parameters schema**，不提供 `execute`。LLMPlanner 解析 tool_call 为 StepPlan，交由 AgentService 统一执行。

```typescript
const planningTools = {
  click: tool({
    description: '点击屏幕上的目标元素',
    parameters: z.object({
      target: z.string().describe('目标描述，如"搜索按钮"'),
      selector: z.string().optional().describe('CSS selector 或 UIA query'),
    }),
    // 无 execute — LLM 只产出意图
  }),

  type_text: tool({
    description: '在当前焦点位置输入文本',
    parameters: z.object({ text: z.string() }),
  }),

  press_keys: tool({
    description: '按快捷键',
    parameters: z.object({ keys: z.array(z.string()) }),
  }),

  navigate: tool({
    description: '在浏览器中打开URL',
    parameters: z.object({ url: z.string() }),
  }),

  observe: tool({
    description: '截取当前屏幕，观察状态',
    parameters: z.object({}),
  }),

  scroll: tool({
    description: '滚动页面',
    parameters: z.object({
      direction: z.enum(['up', 'down']),
      amount: z.number().default(3),
    }),
  }),

  ask_user: tool({
    description: '遇到密码、验证码或不确定时请求用户接管',
    parameters: z.object({ reason: z.string() }),
  }),

  task_complete: tool({
    description: '任务完成',
    parameters: z.object({ summary: z.string() }),
  }),
};
```

### 系统提示词

```typescript
const SYSTEM_PROMPT = `你是一个桌面自动化助手。你可以看到用户的屏幕截图，并通过工具描述你想要执行的操作。

## 能力
- 浏览器操作（通过 Playwright）
- 桌面应用控件操作（通过 UIA）
- 键鼠模拟
- 截屏观察

## 规则
1. 每次只建议一步操作，执行后观察结果
2. 优先使用 Playwright DOM 定位（浏览器）或 UIA 控件定位（桌面应用）
3. 遇到密码框、验证码、支付页面时必须调用 ask_user
4. 不确定时先 observe 再决定
5. 操作完成后调用 task_complete

## 当前任务
{goal}

## 已执行步骤
{stepHistory}

## 匹配的流程记忆（如有）
{memoryContext}
`;
```

### 配置管理

```typescript
// ~/.agivar/settings.json — 只存非敏感配置
interface AppSettings {
  llm: {
    provider: 'openai-compatible';   // P0 只支持一种
    model: string;                   // "gpt-4o", "deepseek-chat", "qwen-vl-max"
    baseURL?: string;                // 自定义 API endpoint
    visionModel?: string;
    maxTokens: number;               // 默认 4096
    temperature: number;             // 默认 0.1
    // apiKey 不在此处 — 存入 OS 凭据管理器
  };
  safety: {
    emergencyStopHotkey: string;     // 默认 "Ctrl+Alt+Space"
    confirmMediumRisk: boolean;      // 默认 false
    maxRetries: number;              // 默认 2
    takeoverTimeoutMs: number;       // 默认 300000 (5min)
  };
  storage: {
    dataDir: string;                 // 开发: <repo>/.agivar-dev/  生产: app.getPath('userData')
    logRetentionDays: number;        // 默认 30
  };
  privacy: {
    screenshotOnlyForTask: boolean;  // 默认 true，只保存任务必要截图
    logLlmRequests: boolean;         // 默认 true，记录发送时间/provider/用途
    // API Key 永远不写入日志
  };
}
```

**API Key 存储方案：**
- 设置页只显示掩码（如 `sk-...abcd`）
- 读写通过 `desktop/src/main/credential-store.ts` → Windows Credential Manager
- 日志、错误上报和调试输出必须过滤 API Key
- 阶段 1 若暂时无法接入系统凭据管理器，使用 DPAPI 本机加密，明确标注为临时方案

---

## 7. 操作安全层

### 风险分级

```typescript
class RiskClassifier {
  classify(step: StepPlan): RiskLevel {
    // 1. 流程路径：使用 step.riskLevel（手写流程已标注）
    // 2. LLM 路径：基于规则推断
    //    - navigate/observe/scroll → low
    //    - click/type 常规 → low
    //    - 检测到"删除/提交/发送/支付"关键词 → high
    //    - 检测到密码框/验证码 → forbidden
    //    - 文件操作（保存/删除）→ medium
  }
}
```

四级风险（与落地方案一致）：

| 等级 | UI 行为 | 示例 |
|------|---------|------|
| low | 直接执行，记日志 | 查询、筛选、截图、导航 |
| medium | 展示即将执行的动作（可配置弹窗） | 填写表单、修改字段 |
| high | 强制弹窗确认 | 删除、提交、批量操作 |
| forbidden | 暂停，人工接管 | 密码、验证码、支付 |

### 紧急停止（core/desktop 分层）

```typescript
// packages/core/src/safety/abort-manager.ts — 纯 Node.js
class AbortManager {
  private controllers = new Map<string, AbortController>();

  createTaskSignal(taskRunId: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(taskRunId, controller);
    return controller.signal;
  }

  abortTask(taskRunId: string, source: AbortSource): void {
    const controller = this.controllers.get(taskRunId);
    if (controller) {
      controller.abort(source);
      this.controllers.delete(taskRunId);
    }
    // 1. 立即停止所有工具操作（signal 传播）
    // 2. 释放被按住的键（input.releaseAllKeys）
    // 3. 停止所有录屏 session
    // 4. 发送事件到 UI
  }

  isAborted(taskRunId: string): boolean {
    return this.controllers.get(taskRunId)?.signal.aborted ?? true;
  }
}

type AbortSource = 'hotkey' | 'tray' | 'ui' | 'timeout';

// packages/desktop/src/main/global-hotkey.ts — Electron 专用
class GlobalHotkeyAdapter {
  constructor(private abortManager: AbortManager) {}

  register(hotkey: string, taskRunId: string): void {
    globalShortcut.register(hotkey, () => {
      this.abortManager.abortTask(taskRunId, 'hotkey');
    });
  }

  unregister(): void {
    globalShortcut.unregisterAll();
  }
}
```

**紧急停止补充验收要求：**
- 热键注册失败时降级为 UI 停止按钮，并在环境检查中显示警告
- `AbortController` 触发后不能复用，恢复任务时必须新建 signal
- 所有长耗时工具都必须接收 `AbortSignal` 或 timeout
- `releaseAllKeys()` 若 Phase 0 尚未实现，需要加入阶段 1 前置任务
- 每个工具操作前检查 `signal.aborted`，保证 500ms 内响应

### 人工接管

```typescript
interface TakeoverRequest {
  reason: string;           // "检测到密码输入框"
  screenshot: string;       // 当前截图路径
  stepIndex: number;
  canResume: boolean;       // 用户处理后是否可继续
}
```

**接管状态流转（见第 4 节任务状态机）：**

UI 显示：暂停状态 + 原因 + 截图 + "继续"/"放弃"按钮。

恢复流程：
1. 用户点击"继续"
2. AgentService 重新截图 + 获取活动窗口
3. 如果活动窗口不是预期窗口 → 要求用户确认
4. 截图匹配 → 继续执行
5. 截图不匹配 → 再次暂停，展示差异

### 执行日志

```typescript
interface TaskStepLog {
  taskRunId: string;
  stepIndex: number;
  timestamp: string;
  intent: string;
  action: StepAction;
  locatorStrategy: string;
  beforeScreenshot: string;          // 文件路径
  afterScreenshot: string;
  uiaSnapshot?: string;              // UIA 树 JSON 路径
  expectedState?: ExpectedState;
  verificationResult: 'pass' | 'fail' | 'skipped';
  errorType?: 'retryable' | 'degradable' | 'takeover' | 'terminal';
  workflowStepSnapshot?: string;     // JSON: 执行时的流程步骤快照
  targetSnapshot?: string;           // JSON: 实际解析的 TargetDescriptor
  toolResult?: string;               // JSON: ToolResult<T> 原始返回
  failureInfo?: string;              // JSON: 失败详情
  durationMs: number;
}
```

每步日志写入 SQLite + 截图保存到 `{dataDir}/logs/{taskRunId}/`。

> **性能注意**：better-sqlite3 同步写入不要放在高频 UI 事件路径中。执行日志可通过内存队列批量写入（每 5 步或任务结束时 flush）。

---

## 8. 状态验证

### ExpectedState DSL

```typescript
interface ExpectedState {
  any?: StateCondition[];    // 满足任一即通过
  all?: StateCondition[];    // 全部满足才通过
}

type StateCondition =
  | { type: 'window_title_contains'; value: string }
  | { type: 'page_text_contains'; value: string; pageRef?: 'managed' }
  | { type: 'uia_element_exists'; query: ElementQuery }
  | { type: 'element_text_equals'; target: TargetDescriptor; value: string }
  | { type: 'file_exists'; path: string; scope: 'app-data' | 'user-approved' };
```

> **阶段 1 不使用 OCR**。所有验证条件通过 DOM 查询（Playwright）或 UIA 控件查询实现。

### StateVerifier 实现

```typescript
class StateVerifier {
  async verify(expected: ExpectedState, context: TaskContext): Promise<VerifyResult> {
    // 对每个条件执行检查：
    // window_title_contains → getActiveWindow().title.includes(value)
    // page_text_contains → Playwright page.locator('body').textContent()
    // uia_element_exists → findElement(hwnd, query)
    // element_text_equals → Playwright locator.textContent() 或 UIA getElementValue
    // file_exists → fs.existsSync（限定在 scope 目录内）
  }
}

interface VerifyResult {
  passed: boolean;
  conditions: { condition: StateCondition; passed: boolean; actual?: string }[];
  screenshot?: string;
}
```

### FailureHandler 失败分级

```typescript
class FailureHandler {
  async handle(failure: FailureInfo, step: StepPlan, context: TaskContext): Promise<FailureAction> {
    const errorType = failure.errorType ?? this.classify(failure);

    switch (errorType) {
      case 'retryable':
        // 页面加载慢、按钮暂不可点击、网络超时
        const retryCount = context.retryCountByStep.get(context.stepIndex) ?? 0;
        if (retryCount < context.maxRetries) {
          context.retryCountByStep.set(context.stepIndex, retryCount + 1);
          await sleep(1000 * (retryCount + 1));
          return { action: 'retry' };
        }
        return { action: 'degrade' };

      case 'degradable':
        // UIA 定位失败但可尝试其他策略
        const nextStrategy = this.getNextStrategy(step.action);
        if (nextStrategy) return { action: 'degrade', newStrategy: nextStrategy };
        return { action: 'takeover', reason: '所有定位策略均失败' };

      case 'takeover':
        // 登录页、验证码、权限弹窗
        return { action: 'takeover', reason: failure.message };

      case 'terminal':
        // 高风险动作不确定、连续失败
        return { action: 'abort', diagnosis: this.buildDiagnosis(failure, context) };
    }
  }

  private getNextStrategy(action: StepAction): string | null {
    // 定位优先级降级链：playwright → uia → coordinate
    if (action.type !== 'click') return null;
    const chain: string[] = ['playwright', 'uia', 'coordinate'];
    const current = action.target.strategy;
    const idx = chain.indexOf(current);
    return idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null;
  }
}
```

---

## 9. 聊天 UI

### 组件结构

```
App.tsx
├── Sidebar                      # 左侧 240px
│   ├── NewChatButton            # + 新对话
│   ├── SessionList              # 会话列表（日期分组）
│   │   └── SessionItem          # 标题 + 时间 + 删除
│   └── SettingsButton           # 底部设置入口
│
├── ChatPage                     # 中间主区域
│   ├── ChatHeader               # 标题栏
│   ├── ChatView                 # 消息流（虚拟滚动）
│   │   ├── MessageBubble        # 用户/助手消息
│   │   ├── ToolCallCard         # 工具调用卡片（截图预览、UIA 树）
│   │   ├── StepProgressCard     # 步骤执行进度（before/after 截图）
│   │   ├── TakeoverCard         # 人工接管提示（原因 + 继续/放弃按钮）
│   │   ├── MemoryCandidateCard  # 流程候选列表（用户选择确认）
│   │   └── TaskSummaryCard      # 任务完成/失败摘要
│   └── InputBar                 # 底部输入
│       ├── TextInput            # 文本框（Shift+Enter 换行）
│       ├── AttachButton         # 附件（截图/文件）
│       └── SendButton           # 发送
│
└── SettingsPage                 # 设置页（路由切换）
    ├── LLMConfig                # 模型配置（provider/baseURL/model，API Key 显示掩码）
    ├── SafetyConfig             # 安全设置（热键/确认级别/接管超时）
    ├── MemoryManager            # 流程记忆管理（导入/列表/删除）
    ├── StorageConfig            # 存储路径 + 日志保留天数
    └── PrivacyConfig            # 隐私设置（截图策略/LLM 请求日志）
```

### Zustand Stores

```typescript
// chat-store.ts
interface ChatStore {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Message[];

  createSession(): string;
  switchSession(id: string): void;
  deleteSession(id: string): void;
  addMessage(msg: Message): void;
  updateMessage(id: string, patch: Partial<Message>): void;
}

// task-store.ts
interface TaskStore {
  currentTask: TaskRun | null;
  isRunning: boolean;
  isPaused: boolean;

  startTask(goal: string): void;
  updateStep(event: AgentEvent): void;
  resumeAfterTakeover(): void;
  abort(): void;
}

interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
```

### IPC 扩展

Phase 0 已有 13 个工具 IPC 通道。阶段 1 新增：

```typescript
contextBridge.exposeInMainWorld('agivar', {
  // Phase 0 已有的 screenshot/uia/input/browser/recorder/dpi ...

  agent: {
    runTask: (goal: string, sessionId: string) =>
      ipcRenderer.invoke('agent:runTask', goal, sessionId),
    abort: () => ipcRenderer.invoke('agent:abort'),
    resumeTakeover: () => ipcRenderer.invoke('agent:resumeTakeover'),
    selectMemory: (memoryId: string) =>
      ipcRenderer.invoke('agent:selectMemory', memoryId),
    onEvent: (taskRunId: string, callback: (event: AgentEvent) => void) => {
      const handler = (_: unknown, event: AgentEvent) => {
        if (event.taskRunId === taskRunId) callback(event);
      };
      ipcRenderer.on('agent:event', handler);
      return () => ipcRenderer.removeListener('agent:event', handler);
    },
  },

  memory: {
    import: (filePath: string) => ipcRenderer.invoke('memory:import', filePath),
    list: (filter?: { appName?: string; topic?: string }) =>
      ipcRenderer.invoke('memory:list', filter),
    get: (id: string) => ipcRenderer.invoke('memory:get', id),
    delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
  },

  session: {
    list: () => ipcRenderer.invoke('session:list'),
    create: () => ipcRenderer.invoke('session:create'),
    delete: (id: string) => ipcRenderer.invoke('session:delete', id),
    getMessages: (sessionId: string) =>
      ipcRenderer.invoke('session:getMessages', sessionId),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>) =>
      ipcRenderer.invoke('settings:update', patch),
    getApiKeyMask: () => ipcRenderer.invoke('settings:getApiKeyMask'),
    setApiKey: (key: string) => ipcRenderer.invoke('settings:setApiKey', key),
  },
});
```

Agent 事件通过 `mainWindow.webContents.send('agent:event', event)` 推送到渲染进程。

---

## 10. SQLite 数据库 Schema

### 迁移机制

```sql
-- 迁移版本表
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

启动时运行 migrations。数据库配置：

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

### 业务表

```sql
-- 会话
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 消息
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  metadata TEXT,              -- JSON: tool_calls, screenshots, etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);

-- 流程记忆
CREATE TABLE workflow_memories (
  id TEXT PRIMARY KEY,
  app_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('desktop', 'browser', 'hybrid')),
  topic TEXT NOT NULL,
  trigger_examples TEXT NOT NULL,  -- JSON array
  summary TEXT NOT NULL,
  initial_state TEXT NOT NULL,
  inputs TEXT,                     -- JSON array of WorkflowInput
  steps TEXT NOT NULL,             -- JSON array of WorkflowStep
  success_criteria TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low',
  source_type TEXT NOT NULL DEFAULT 'manual',
  version INTEGER NOT NULL DEFAULT 1,
  search_text TEXT NOT NULL DEFAULT '',       -- 预计算搜索文本
  embedding_status TEXT NOT NULL DEFAULT 'not_indexed',  -- 阶段 2 预留
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_memories_app ON workflow_memories(app_name);
CREATE INDEX idx_memories_topic ON workflow_memories(topic);

-- 任务执行记录
CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  user_goal TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'workflow'
    CHECK (mode IN ('workflow', 'llm', 'hybrid')),
  matched_memory_id TEXT REFERENCES workflow_memories(id),
  selected_memory_ids TEXT,        -- JSON array（多候选场景）
  plan_json TEXT,                  -- JSON: StepPlan[] 执行时的计划快照
  run_config TEXT,                 -- JSON: provider/model/safety settings 快照
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'paused', 'success', 'failed', 'aborted')),
  summary TEXT,
  started_at TEXT,
  finished_at TEXT
);

-- 步骤级执行日志
CREATE TABLE task_step_logs (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  intent TEXT NOT NULL,
  action TEXT NOT NULL,                -- JSON: StepAction
  locator_strategy TEXT,
  before_screenshot TEXT,              -- 文件路径
  after_screenshot TEXT,
  uia_snapshot TEXT,                   -- 文件路径
  expected_state TEXT,                 -- JSON: ExpectedState
  verification_result TEXT CHECK (verification_result IN ('pass', 'fail', 'skipped')),
  error_type TEXT,
  workflow_step_snapshot TEXT,          -- JSON: 执行时的 WorkflowStep 快照
  target_snapshot TEXT,                -- JSON: 实际 TargetDescriptor
  tool_result TEXT,                    -- JSON: ToolResult<T>
  failure_info TEXT,                   -- JSON: FailureInfo
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_step_logs_task ON task_step_logs(task_run_id, step_index);

-- 设置（KV 存储，非敏感配置）
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

---

## 11. 本地数据目录

```
{dataDir}/                          # 开发: <repo>/.agivar-dev/  生产: app.getPath('userData')
├── settings.json                   # 应用配置（不含 API Key）
├── agivar.db                       # SQLite 数据库（WAL 模式）
├── workflows/                      # 导入的流程 YAML/JSON
│   ├── form-fill-local.yaml
│   ├── search-local.yaml
│   └── notepad-text.yaml
├── logs/
│   └── {taskRunId}/
│       ├── step-0-before.png
│       ├── step-0-after.png
│       ├── step-0-uia.json
│       └── ...
└── screenshots/                    # 临时截图（按 privacy.screenshotOnlyForTask 清理）
```

**目录选择：**
- 开发环境：`<repo>/.agivar-dev/`（gitignore）
- 生产环境：`app.getPath('userData')`（符合 Windows 用户数据目录习惯，利于卸载/备份/权限处理）
- 可通过 `settings.storage.dataDir` 自定义

---

## 12. 新增依赖清单

| 包 | 用途 | 引入位置 |
|---|---|---|
| `ai` | Vercel AI SDK 核心 | @agivar/core |
| `@ai-sdk/openai` | OpenAI 兼容 provider | @agivar/core |
| `better-sqlite3` | SQLite 数据库 | @agivar/core |
| `@types/better-sqlite3` | 类型定义 | @agivar/core (dev) |
| `js-yaml` | YAML 流程解析 | @agivar/core |
| `@types/js-yaml` | 类型定义 | @agivar/core (dev) |
| `zod` | Schema 验证 | @agivar/core |
| `nanoid` | ID 生成 | @agivar/core |
| `tailwindcss` | CSS 框架 | @agivar/desktop |
| `postcss` + `autoprefixer` | Tailwind 构建依赖 | @agivar/desktop (dev) |
| `zustand` | 状态管理 | @agivar/desktop |
| `react-router-dom` | 页面路由 | @agivar/desktop |

---

## 13. 阶段 1 范围总结

### P0 必做

- Phase 0 遗留补验（输入、紧急停止、录屏帧捕获）
- 手写 YAML / JSON 流程导入 + 变量 schema 验证
- MemoryStore 关键词检索 + 阈值选择策略
- StepPlan 统一模型 + TaskContext 生命周期管理
- ToolRouter 适配 Phase 0 工具 API
- StepExecutor 执行前后截图
- StateVerifier 非 OCR 验证
- SafetyLayer 风险分级和高风险拦截
- AbortManager + GlobalHotkey 真实中断交互动作
- Human Takeover 暂停与恢复状态机
- SQLite 任务/消息/流程/步骤日志持久化 + 迁移机制
- 聊天主界面和内嵌任务进度面板
- 3 条本地可控评测流程
- API Key 安全存储（OS 凭据管理器或 DPAPI 加密）

### P1 对照（不作为 Go/No-Go）

- LLM 生成 StepPlan（不直接执行工具），走统一执行链
- 本地测试页上的 LLM 自主规划 3/5 成功率统计
- 多 provider 配置（P0 只支持一个 OpenAI-compatible provider）

### 明确不做

- 外网站点自动化验收（评测全部用本地 fixture）
- 账号登录态复用
- OCR 视觉定位
- 录屏教学（阶段 3）
- 文字教学生成流程（阶段 2）
- 流程编辑器（阶段 2）
- Python 脚本执行
- macOS 支持
- 自动更新
- 批量执行
- 独立任务进度悬浮窗（内嵌在聊天流中）
- 云端同步、用户登录
- sqlite-vec 向量检索（用关键词匹配，但预留 search_text 和 embedding_status 字段）

---

## 14. 隐私与日志保留

### 截图策略

- 默认只保存任务执行的 before/after 截图
- 截图路径中不包含用户输入的变量值（尤其是 `secret: true` 的变量）
- 密码框、验证码、支付页面触发人工接管，接管前的截图需要用户确认后才保存

### LLM 请求日志

- 记录：发送时间、provider、model、用途（plan/observe）、token 用量
- 不记录：API Key、用户标记为 `secret: true` 的变量值
- 发送给 LLM 的截图在日志中记录文件路径，不重复存储

### 数据清理

- 日志保留天数可配置（默认 30 天）
- 用户可以删除某个 TaskRun 的所有截图、UIA 快照和数据库记录
- 过期日志定期清理（应用启动时检查）

### 向量检索迁移预留（阶段 2）

阶段 1 使用关键词检索，不生成 embedding。但 `workflow_memories` 表已预留 `search_text`（预计算搜索文本）和 `embedding_status`（默认 `not_indexed`）字段，阶段 2 迁移时直接使用。
