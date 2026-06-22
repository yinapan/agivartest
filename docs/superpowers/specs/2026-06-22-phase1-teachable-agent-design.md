# 阶段 1：可教学桌面流程 Agent — 技术设计文档

> 日期：2026-06-22
> 状态：设计完成，待实现
> 关联：[落地方案.md](../../../落地方案.md) 阶段 1 | [Phase 0 设计](../../specs/2026-06-21-phase0-desktop-poc-design.md) | [Phase 0 验收报告](../../phase0-acceptance-report.md)

---

## 1. 目标

跑通「手写流程记忆 → 观察 → 执行 → 验证 → 日志」完整闭环，同时支持 LLM 自主规划路径。阶段 0 已验证的 6 项桌面控制能力（截图、UIA、键鼠输入、Playwright、DPI、录屏）作为底层直接复用。

### 验收条件

| 条件 | 指标 |
|------|------|
| 手写流程导入到执行成功 | < 10 分钟 |
| 固定流程重复执行成功率 | > 80%（3 条流程各执行 5 次） |
| 失败可诊断率 | > 80%（失败时能定位到步骤和原因） |
| LLM 自主规划完成简单任务 | 3/5 成功（打开网页→填表单→截图） |
| 紧急停止响应 | < 500ms |
| 人工接管后可继续 | 100% |

### 必交付评测流程（3 条）

1. **浏览器表单填写**：打开本地测试页 → 填写 3 个字段 → 提交 → 验证成功消息
2. **浏览器搜索**：打开浏览器 → 导航到目标网站 → 搜索关键词 → 验证搜索结果出现
3. **记事本操作**：打开记事本 → 输入文本 → 验证文本正确（UIA/截图）

每条流程提供手写 YAML 版本（确定性执行）。同时用 LLM 自主规划路径跑一遍作为对照。

---

## 2. 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 架构模式 | Agent-First | 两条执行路径（流程/LLM）统一为 StepPlan，共享工具层和安全层 |
| LLM 接入 | 多模型抽象层（OpenAI 格式兼容） | 支持 GPT-4o / Claude / Qwen-VL / DeepSeek，用户可切换 |
| Agent 框架 | Vercel AI SDK + 自研编排 | AI SDK 处理工具调用和流式响应，自研编排处理流程执行和失败恢复 |
| 聊天 UI | 完整聊天界面 | 左侧会话列表 + 中间消息流 + 底部输入栏 |
| 本地存储 | better-sqlite3 | 会话/流程/任务/日志统一存储 |
| 记忆检索 | 关键词匹配 | 延迟向量检索到阶段 2，阶段 1 用 SQL LIKE + 分词匹配 |
| 执行路径 | 手写流程 + LLM 自主规划并行 | 有记忆按步骤执行，无记忆 LLM 截图→规划→执行 |
| 样式方案 | Tailwind CSS + 暗色主题 | 轻量，不引入组件库 |

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
│  │ TaskProgressOverlay (悬浮窗/内嵌进度面板)             ││
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
│  │  better-sqlite3: 会话/流程/任务/日志                  │ │
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
│   │   ├── task-planner.ts       # 任务规划器（流程执行 + LLM 规划）
│   │   ├── step-executor.ts      # 步骤执行器
│   │   ├── state-verifier.ts     # 状态验证器
│   │   ├── failure-handler.ts    # 失败分级处理
│   │   └── tool-router.ts        # 工具自动路由
│   ├── memory/         # 新增：记忆系统
│   │   ├── memory-store.ts       # SQLite 存储 + 关键词检索
│   │   ├── workflow-parser.ts    # JSON/YAML 流程解析
│   │   └── schema.ts             # 数据库 schema
│   ├── llm/            # 新增：LLM 抽象层
│   │   ├── provider.ts           # LLMProvider interface
│   │   ├── openai-compatible.ts  # OpenAI 格式适配
│   │   └── prompts.ts            # 系统提示词
│   ├── safety/         # 新增：安全层
│   │   ├── risk-classifier.ts    # 风险分级
│   │   ├── emergency-stop.ts     # 紧急停止
│   │   └── execution-log.ts      # 执行日志
│   └── types/          # Phase 0 已有，扩展
│
├── desktop/src/
│   ├── main/           # Phase 0 已有，扩展 IPC
│   ├── renderer/       # 重写：聊天 UI
│   │   ├── App.tsx
│   │   ├── pages/ChatPage.tsx
│   │   ├── components/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── ChatView.tsx
│   │   │   ├── InputBar.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ToolCallCard.tsx
│   │   │   └── TaskProgress.tsx
│   │   └── stores/
│   │       ├── chat-store.ts
│   │       └── task-store.ts
│   └── preload.ts      # Phase 0 已有，扩展
│
└── native/             # Phase 0 已有，阶段 1 无新增
```

### 核心设计原则

1. **Agent 不依赖 Electron**：`packages/core/src/agent/` 纯 Node.js，可独立测试。紧急停止在 core 层使用 AbortController/signal 模式，Electron `globalShortcut` 注册在 desktop 层
2. **工具层零改动**：Phase 0 的 6 个 tools 模块直接复用
3. **LLM 可切换**：OpenAI 格式兼容层，支持 GPT-4o / Claude / Qwen-VL / DeepSeek
4. **两条执行路径共享基础设施**：SafetyLayer、StateVerifier、ExecutionLog、ToolRouter

### 依赖关系

```
desktop (Electron 壳)
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

### 核心执行流程

```
用户输入目标
    │
    ▼
AgentService.run(goal)
    │
    ├─── MemoryStore.search(goal)
    │         │
    │    ┌────┴────┐
    │    │有匹配记忆│──→ WorkflowExecutor（确定性路径）
    │    │无匹配    │──→ LLMPlanner（自主规划路径）
    │    └─────────┘
    │
    ▼
TaskPlanner.plan(goal, memories?)
    │
    ├─── 流程路径：解析 WorkflowMemory.steps → StepPlan[]
    │
    └─── LLM 路径：截图 → LLM 分析 → 生成下一步 StepPlan
    │
    ▼
执行循环（逐步）
    │
    ├─── SafetyLayer.check(step)     // 风险分级检查
    │       ├── 低风险 → 直接执行
    │       ├── 中风险 → 展示计划（可配置确认）
    │       ├── 高风险 → 强制弹窗确认
    │       └── 禁止   → 暂停，人工接管
    │
    ├─── StepExecutor.execute(step)
    │       ├── 截图（执行前）
    │       ├── ToolRouter.dispatch(step.action)
    │       │     ├── browser → Playwright
    │       │     ├── uia     → UIA 控件操作
    │       │     ├── input   → 键鼠模拟
    │       │     └── observe → 截图/UIA 树
    │       └── 截图（执行后）
    │
    ├─── StateVerifier.verify(step.expected_state)
    │       ├── pass → 继续下一步
    │       └── fail → FailureHandler
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
  | { type: 'observe' }             // 截图 + UIA 树，供 LLM 分析
  | { type: 'takeover'; reason: string }
  | { type: 'done'; summary: string };  // LLM 判断任务已完成

interface TargetDescriptor {
  hint: string;                      // "顶部搜索框"
  locator?: {
    strategy: 'playwright' | 'uia' | 'coordinate';
    selector?: string;               // CSS selector / UIA query
    point?: { x: number; y: number; space: CoordinateSpace };
  };
}
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

```typescript
class LLMPlanner {
  async planNext(context: TaskContext): Promise<StepPlan> {
    // 1. 截图当前屏幕
    // 2. 获取活动窗口 UIA 树（可选）
    // 3. 组装 prompt：目标 + 截图 + 已执行步骤 + 当前状态
    // 4. 调用多模态 LLM（通过 Vercel AI SDK）
    // 5. 解析 LLM 返回的 tool_call → StepPlan
    // 6. LLM 判断任务完成 → 返回 done
  }
}
```

LLM 路径使用 Vercel AI SDK 的 `generateText` + `tools` 定义，LLM 通过 tool_call 返回结构化动作。每次只规划一步，执行后再截图给 LLM 看下一步。

### AgentService 主循环

```typescript
class AgentService {
  async *run(goal: string, sessionId: string): AsyncGenerator<AgentEvent> {
    const memories = await this.memoryStore.search(goal);
    
    if (memories.length > 0) {
      // 流程路径
      const executor = new WorkflowExecutor(memories[0]);
      for await (const event of executor.execute(taskContext)) {
        yield event;
        if (event.type === 'step-failed' && event.failCount > 2) {
          // 降级到 LLM 路径
          break;
        }
      }
    }
    
    // LLM 路径（无记忆或流程路径降级后）
    while (!taskContext.isDone && !taskContext.isAborted) {
      const step = await this.llmPlanner.planNext(taskContext);
      if (step.action.type === 'done') break;
      
      const result = await this.executeStep(step);
      yield result;
    }
  }
}
```

### ToolRouter 分发逻辑

ToolRouter 根据 `StepAction.type` 和当前上下文选择底层工具：

```typescript
class ToolRouter {
  async dispatch(action: StepAction, context: TaskContext): Promise<ActionResult> {
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
        return this.tools.browser.navigateTo(action.url);
      case 'wait':
        return this.waitForCondition(action.condition, action.timeoutMs);
      case 'observe':
        return this.captureState(context);
      case 'takeover':
        throw new TakeoverRequest(action.reason);
      case 'done':
        return { done: true, summary: action.summary };
    }
  }

  private async routeClick(target: TargetDescriptor, context: TaskContext): Promise<ActionResult> {
    const locator = target.locator;
    if (!locator) {
      // 无定位器 → 截图 + UIA 分析，尝试自动定位
      return this.autoLocate(target.hint, context);
    }
    switch (locator.strategy) {
      case 'playwright': return this.tools.browser.click(locator.selector!);
      case 'uia':        return this.tools.uia.clickElement(locator.selector!);
      case 'coordinate': return this.tools.input.click(locator.point!);
    }
  }
}
```

路由规则：
- **浏览器内操作**（有 CSS selector）→ Playwright
- **桌面控件操作**（有 UIA query）→ UIA 模块
- **坐标点击**（有 point）→ 键鼠模拟（input 模块）
- **无定位器**（仅 hint 文本）→ 截图 + 分析后自动选择策略

### 事件流（Agent → UI）

```typescript
type AgentEvent =
  | { type: 'thinking'; message: string }
  | { type: 'memory-match'; workflow: WorkflowMemory }
  | { type: 'step-start'; step: StepPlan; index: number }
  | { type: 'step-screenshot'; before?: string; after?: string }
  | { type: 'step-result'; success: boolean; verification?: VerifyResult }
  | { type: 'step-failed'; failure: FailureInfo; failCount: number }
  | { type: 'takeover-required'; reason: string }
  | { type: 'takeover-resumed' }
  | { type: 'tool-call'; tool: string; args: unknown; result?: unknown }
  | { type: 'task-complete'; summary: string }
  | { type: 'task-failed'; diagnosis: string }
  | { type: 'message'; role: 'assistant'; content: string };
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
  topic: string;                // "bilibili/投币"
  triggerExamples: string[];    // ["帮我投币", "给视频投2个币"]
  summary: string;
  initialState: string;
  steps: WorkflowStep[];
  successCriteria: string;
  riskLevel: 'low' | 'medium' | 'high';
  sourceType: 'manual' | 'text-teach' | 'recording';
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowStep {
  id: string;
  order: number;
  intent: string;               // "点击搜索框"
  targetHint: string;           // "顶部搜索框，placeholder '搜索'"
  locatorStrategy: 'playwright' | 'uia' | 'vision' | 'coordinate' | 'human';
  targetLocator?: string;       // CSS selector / UIA query JSON
  inputHint?: string;           // "非十科技"
  expectedState?: ExpectedState;
  fallback?: 'retry' | 'degrade' | 'takeover' | 'terminal';
  riskLevel: 'low' | 'medium' | 'high' | 'forbidden';
}
```

### 检索策略（关键词，阶段 1）

```typescript
class MemoryStore {
  async search(goal: string): Promise<WorkflowMemory[]> {
    // 1. 分词（简单空格 + 标点分割，中文按字符 bigram）
    // 2. SQL LIKE 匹配 trigger_examples, summary, topic, app_name
    // 3. 按匹配度排序，返回 top-3
  }
  
  async importWorkflow(filePath: string): Promise<WorkflowMemory>
  async getById(id: string): Promise<WorkflowMemory | null>
  async list(filter?: { appName?: string; topic?: string }): Promise<WorkflowMemory[]>
  async update(id: string, patch: Partial<WorkflowMemory>): Promise<void>
  async delete(id: string): Promise<void>
}
```

### 手写流程格式（JSON/YAML）

用户通过文件导入流程。示例模板：

```yaml
# workflows/bilibili-coin.yaml
appName: Chrome
platform: browser
topic: bilibili/投币
triggerExamples:
  - 帮我给视频投币
  - 投2个币
summary: 在B站搜索视频并投币
initialState: 浏览器已打开，当前在任意页面
riskLevel: medium
steps:
  - intent: 打开B站
    targetHint: 浏览器地址栏
    locatorStrategy: playwright
    targetLocator: "[role='textbox'][name='地址栏']"
    inputHint: bilibili.com
    expectedState:
      any:
        - type: page_text_contains
          value: 搜索
    riskLevel: low

  - intent: 搜索目标
    targetHint: 顶部搜索框
    locatorStrategy: playwright
    targetLocator: ".nav-search-input"
    inputHint: "{{searchQuery}}"
    expectedState:
      any:
        - type: page_text_contains
          value: 搜索结果
    riskLevel: low
successCriteria: 投币按钮状态变为已投
```

`{{变量}}` 语法支持运行时参数替换，用户在执行前通过对话提供。

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
import { generateText, streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const providers = {
  openai: createOpenAI({ apiKey: config.openaiKey }),
  deepseek: createOpenAI({
    apiKey: config.deepseekKey,
    baseURL: 'https://api.deepseek.com',
  }),
  qwen: createOpenAI({
    apiKey: config.qwenKey,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  }),
};
```

### Agent 工具定义（给 LLM 用）

LLM 通过 tool_call 返回动作，Vercel AI SDK 的 `tool()` 注册：

```typescript
const agentTools = {
  click: tool({
    description: '点击屏幕上的目标元素',
    parameters: z.object({
      target: z.string().describe('目标描述，如"搜索按钮"'),
      selector: z.string().optional().describe('CSS selector 或 UIA query'),
    }),
    execute: async ({ target, selector }) => { /* ToolRouter 分发 */ }
  }),
  
  type_text: tool({
    description: '在当前焦点位置输入文本',
    parameters: z.object({ text: z.string() }),
    execute: async ({ text }) => { /* input.typeText */ }
  }),
  
  press_keys: tool({
    description: '按快捷键',
    parameters: z.object({ keys: z.array(z.string()) }),
    execute: async ({ keys }) => { /* input.pressKeys */ }
  }),
  
  navigate: tool({
    description: '在浏览器中打开URL',
    parameters: z.object({ url: z.string() }),
    execute: async ({ url }) => { /* browser.navigateTo */ }
  }),
  
  observe: tool({
    description: '截取当前屏幕，观察状态',
    parameters: z.object({}),
    execute: async () => { /* screenshot + optional UIA tree */ }
  }),
  
  scroll: tool({
    description: '滚动页面',
    parameters: z.object({
      direction: z.enum(['up', 'down']),
      amount: z.number().default(3),
    }),
    execute: async ({ direction, amount }) => { /* input.scroll */ }
  }),
  
  ask_user: tool({
    description: '遇到密码、验证码或不确定时请求用户接管',
    parameters: z.object({ reason: z.string() }),
    execute: async ({ reason }) => { /* 触发 takeover */ }
  }),
  
  task_complete: tool({
    description: '任务完成',
    parameters: z.object({ summary: z.string() }),
    execute: async ({ summary }) => { /* 标记完成 */ }
  }),
};
```

### 系统提示词

```typescript
const SYSTEM_PROMPT = `你是一个桌面自动化助手。你可以看到用户的屏幕截图，并使用工具操作桌面。

## 能力
- 浏览器操作（通过 Playwright）
- 桌面应用控件操作（通过 UIA）
- 键鼠模拟
- 截屏观察

## 规则
1. 每次只执行一步操作，执行后观察结果
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
// ~/.agivar/settings.json
interface AppSettings {
  llm: {
    provider: 'openai' | 'deepseek' | 'qwen' | 'custom';
    model: string;           // "gpt-4o", "deepseek-chat", "qwen-vl-max"
    apiKey: string;
    baseURL?: string;
    visionModel?: string;
    maxTokens: number;       // 默认 4096
    temperature: number;     // 默认 0.1
  };
  safety: {
    emergencyStopHotkey: string;  // 默认 "Ctrl+Alt+Space"
    confirmMediumRisk: boolean;   // 默认 false
    maxRetries: number;           // 默认 2
  };
  storage: {
    dataDir: string;         // 默认 ~/.agivar/
  };
}
```

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

### 紧急停止

```typescript
class EmergencyStop {
  private abortController: AbortController;
  
  register() {
    globalShortcut.register(settings.emergencyStopHotkey, () => {
      this.trigger('hotkey');
    });
  }
  
  trigger(source: 'hotkey' | 'tray' | 'ui') {
    this.abortController.abort();
    // 1. 立即停止所有工具操作
    // 2. 释放被按住的键（input.releaseAllKeys）
    // 3. 停止所有录屏 session
    // 4. 关闭 Playwright 浏览器（可选）
    // 5. 发送事件到 UI
  }
  
  get signal(): AbortSignal { return this.abortController.signal; }
}
```

每个工具操作前检查 `signal.aborted`，保证 500ms 内响应。

### 人工接管

```typescript
interface TakeoverRequest {
  reason: string;           // "检测到密码输入框"
  screenshot: string;       // 当前截图
  stepIndex: number;
  canResume: boolean;       // 用户处理后是否可继续
}
```

UI 显示：暂停状态 + 原因 + 截图 + "继续"按钮。用户点击"继续"后，AgentService 重新截图观察状态，继续执行。

### 执行日志

```typescript
interface TaskStepLog {
  taskRunId: string;
  stepIndex: number;
  timestamp: string;
  intent: string;
  action: StepAction;
  locatorStrategy: string;
  beforeScreenshot: string;      // 文件路径
  afterScreenshot: string;
  uiaSnapshot?: string;          // UIA 树 JSON 路径
  expectedState?: ExpectedState;
  verificationResult: 'pass' | 'fail' | 'skipped';
  errorType?: 'retryable' | 'degradable' | 'takeover' | 'terminal';
  durationMs: number;
}
```

每步日志写入 SQLite + 截图保存到 `~/.agivar/logs/{taskRunId}/`。

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
  | { type: 'page_text_contains'; value: string }
  | { type: 'uia_element_exists'; name: string; controlType?: string }
  | { type: 'file_exists'; path: string }
  | { type: 'element_text_equals'; locator: string; value: string }
  | { type: 'clipboard_contains'; value: string };
```

### StateVerifier 实现

```typescript
class StateVerifier {
  async verify(expected: ExpectedState, context: TaskContext): Promise<VerifyResult> {
    // 对每个条件执行检查：
    // window_title_contains → getActiveWindow().title.includes(value)
    // page_text_contains → Playwright page.textContent() 或截图 OCR
    // uia_element_exists → findElement(query)
    // file_exists → fs.existsSync
    // element_text_equals → Playwright locator.textContent() 或 UIA getValue
    // clipboard_contains → clipboard.readText()
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
        if (context.retryCount < settings.maxRetries) {
          await sleep(1000 * (context.retryCount + 1));
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
    const chain = ['playwright', 'uia', 'coordinate'];
    const current = action.type === 'click' ? action.target.locator?.strategy : null;
    if (!current) return null;
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
│   │   ├── TakeoverCard         # 人工接管提示（原因 + 继续按钮）
│   │   └── TaskSummaryCard      # 任务完成/失败摘要
│   └── InputBar                 # 底部输入
│       ├── TextInput            # 文本框（Shift+Enter 换行）
│       ├── AttachButton         # 附件（截图/文件）
│       └── SendButton           # 发送
│
└── SettingsPage                 # 设置页（路由切换）
    ├── LLMConfig                # 模型配置（provider/key/model）
    ├── SafetyConfig             # 安全设置（热键/确认级别）
    ├── MemoryManager            # 流程记忆管理（导入/列表/删除）
    └── StorageConfig            # 存储路径
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
    onEvent: (callback: (event: AgentEvent) => void) => {
      ipcRenderer.on('agent:event', (_, event) => callback(event));
    },
  },
  
  memory: {
    import: (filePath: string) => ipcRenderer.invoke('memory:import', filePath),
    list: (filter?: any) => ipcRenderer.invoke('memory:list', filter),
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
    update: (patch: any) => ipcRenderer.invoke('settings:update', patch),
  },
});
```

Agent 事件通过 `mainWindow.webContents.send('agent:event', event)` 推送到渲染进程。

---

## 10. SQLite 数据库 Schema

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
  steps TEXT NOT NULL,             -- JSON array of WorkflowStep
  success_criteria TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low',
  source_type TEXT NOT NULL DEFAULT 'manual',
  version INTEGER NOT NULL DEFAULT 1,
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
  matched_memory_id TEXT REFERENCES workflow_memories(id),
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
  action TEXT NOT NULL,           -- JSON
  locator_strategy TEXT,
  before_screenshot TEXT,         -- 文件路径
  after_screenshot TEXT,
  uia_snapshot TEXT,              -- 文件路径
  expected_state TEXT,            -- JSON
  verification_result TEXT CHECK (verification_result IN ('pass', 'fail', 'skipped')),
  error_type TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_step_logs_task ON task_step_logs(task_run_id, step_index);

-- 设置（KV 存储）
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

---

## 11. 本地数据目录

```
~/.agivar/
├── settings.json               # 应用配置
├── agivar.db                   # SQLite 数据库
├── workflows/                  # 导入的流程 YAML/JSON
│   ├── bilibili-coin.yaml
│   ├── form-fill.yaml
│   └── notepad-test.yaml
├── logs/
│   └── {taskRunId}/
│       ├── step-0-before.png
│       ├── step-0-after.png
│       ├── step-0-uia.json
│       └── ...
└── screenshots/                # 临时截图
```

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

## 13. 阶段 1 不做的事（明确排除）

- 不做 sqlite-vec 向量检索（用关键词匹配）
- 不做云端同步、用户登录
- 不做录屏教学（阶段 3）
- 不做文字教学生成流程（阶段 2）
- 不做流程编辑器（阶段 2）
- 不做 Python 脚本执行
- 不做 macOS 支持
- 不做自动更新
- 不做批量执行
- 不做 OCR 视觉定位（坐标兜底足够）
- 不做任务进度悬浮窗（内嵌在聊天流中）
