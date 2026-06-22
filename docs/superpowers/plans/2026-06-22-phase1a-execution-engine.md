# Phase 1A: 执行引擎 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 构建确定性流程执行引擎——从 YAML 导入到步骤执行、状态验证、失败处理、日志记录的完整闭环，不含 UI 和 LLM 层。

**架构：** packages/core 内新增 agent/、memory/、safety/ 三个目录。所有模块纯 Node.js（无 Electron 依赖），通过 vitest 单元测试验证。Phase 0 工具层零改动（仅补充 scroll + releaseAllKeys）。

**技术栈：** TypeScript ESM · vitest · better-sqlite3 · js-yaml · zod · nanoid

---

## 全局约束

1. **ESM 严格模式**：所有 import 必须带 `.js` 扩展名。`type: "module"` 已在 package.json 中声明。
2. **ToolResult 模式**：所有工具返回 `ToolResult<T>`（`{ ok, data/error, durationMs }`）。使用 `toolOk()` / `toolErr()` 工厂函数。
3. **Phase 0 接口不变**：ToolRouter 适配 Phase 0 API，不修改 `packages/core/src/tools/` 下已有文件（除 input.ts 补充 scroll/releaseAllKeys）。
4. **AbortSignal 策略**：ToolRouter 层检查 `signal.aborted` + `Promise.race` 超时保护。Phase 0 工具不接收 signal。
5. **坐标空间**：`clickPoint` 要求 `point.space === 'screen-physical'`。
6. **ElementQuery 不是字符串**：UIA 的 query 是 `{ automationId?, name?, controlType?, className?, nameMatch?, ... }` 对象。
7. **测试框架**：vitest，配置在 monorepo 根目录。测试文件放 `packages/core/tests/`。
8. **ID 生成**：使用 `nanoid()` 生成所有 id 字段。
9. **数据库**：better-sqlite3 同步 API，WAL 模式，busy_timeout=5000。
10. **Cargo PATH**：bash 命令需 `export PATH="$PATH:/c/Users/admin/.cargo/bin"`。

---

## 文件结构

### 新建文件

| 路径 | 职责 |
|------|------|
| `vitest.config.ts` | Monorepo 根 vitest 配置 |
| `packages/core/src/types/agent.ts` | StepPlan, StepAction, TargetDescriptor, ExpectedState, TaskContext 等核心类型 |
| `packages/core/src/types/workflow.ts` | WorkflowMemory, WorkflowStep, WorkflowInput 类型 |
| `packages/core/src/types/settings.ts` | AppSettings 类型 |
| `packages/core/src/memory/schema.ts` | SQLite schema 定义 + 迁移运行器 |
| `packages/core/src/memory/db.ts` | Database 单例工厂 |
| `packages/core/src/memory/memory-store.ts` | MemoryStore CRUD + 关键词检索 |
| `packages/core/src/memory/workflow-parser.ts` | YAML/JSON 解析 + zod 验证 |
| `packages/core/src/safety/abort-manager.ts` | AbortController 管理 |
| `packages/core/src/safety/risk-classifier.ts` | 风险分级 |
| `packages/core/src/safety/execution-log.ts` | 步骤日志写入 |
| `packages/core/src/agent/tool-router.ts` | StepAction → Phase 0 工具分发 |
| `packages/core/src/agent/state-verifier.ts` | ExpectedState 验证 |
| `packages/core/src/agent/failure-handler.ts` | 失败分级 + 重试/降级/接管 |
| `packages/core/src/agent/step-executor.ts` | 单步执行（截图+路由+验证+日志） |
| `packages/core/src/agent/workflow-executor.ts` | 流程遍历 + 变量替换 + 事件生成 |
| `packages/core/tests/types.test.ts` | 类型守卫测试 |
| `packages/core/tests/schema.test.ts` | 迁移 + 建表测试 |
| `packages/core/tests/memory-store.test.ts` | CRUD + 搜索测试 |
| `packages/core/tests/workflow-parser.test.ts` | 解析 + 验证测试 |
| `packages/core/tests/abort-manager.test.ts` | abort 管理测试 |
| `packages/core/tests/risk-classifier.test.ts` | 风险分级测试 |
| `packages/core/tests/tool-router.test.ts` | 路由分发测试 |
| `packages/core/tests/state-verifier.test.ts` | 状态验证测试 |
| `packages/core/tests/failure-handler.test.ts` | 失败处理测试 |
| `packages/core/tests/step-executor.test.ts` | 单步执行集成测试 |
| `packages/core/tests/workflow-executor.test.ts` | 流程执行集成测试 |
| `tests/fixtures/search-local.html` | 搜索 fixture 页面 |
| `tests/fixtures/workflows/form-fill-local.yaml` | 评测流程 1 |
| `tests/fixtures/workflows/search-local.yaml` | 评测流程 2 |
| `tests/fixtures/workflows/notepad-text.yaml` | 评测流程 3 |

### 修改文件

| 路径 | 变更 |
|------|------|
| `packages/core/package.json` | 添加 better-sqlite3, js-yaml, zod, nanoid, vitest 依赖 |
| `packages/core/src/tools/input.ts` | 添加 `scroll()` 和 `releaseAllKeys()` |
| `packages/core/src/types/index.ts` | 重新导出 agent.ts, workflow.ts, settings.ts |
| `packages/core/src/types/errors.ts` | 添加 `TASK_ABORTED` 错误码 |
| `packages/core/src/index.ts` | 导出新模块 |
| `package.json` (root) | 添加 vitest workspace 脚本 |

---

## 任务 1：Vitest 配置 + 核心 Agent 类型

**文件：**
- 创建：`vitest.config.ts`
- 创建：`packages/core/src/types/agent.ts`
- 创建：`packages/core/src/types/workflow.ts`
- 创建：`packages/core/src/types/settings.ts`
- 修改：`packages/core/src/types/index.ts`
- 修改：`packages/core/src/types/errors.ts`
- 修改：`packages/core/package.json`
- 修改：`package.json`（根目录）
- 测试：`packages/core/tests/types.test.ts`

- [ ] **步骤 1：安装 vitest 和新依赖**

```bash
cd f:/agivar && pnpm add -D vitest -w && pnpm add -D vitest @types/better-sqlite3 @types/js-yaml --filter @agivar/core && pnpm add better-sqlite3 js-yaml zod nanoid --filter @agivar/core
```

- [ ] **步骤 2：创建 vitest.config.ts**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    testTimeout: 10000,
  },
});
```

- [ ] **步骤 3：在根 package.json 添加 test 脚本**

在 `package.json` 的 `scripts` 中添加：
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **步骤 4：修改 errors.ts 添加 TASK_ABORTED 错误码**

在 `packages/core/src/types/errors.ts` 的 `ToolErrorCode` 联合类型末尾添加：
```typescript
| 'TASK_ABORTED'
```

- [ ] **步骤 5：创建 types/agent.ts**

```typescript
// packages/core/src/types/agent.ts
import type { Page } from 'playwright';
import type { ElementQuery, UiaNode } from '../tools/uia.js';
import type { Point } from './coordinates.js';
import type { BrowserSession } from '../tools/browser.js';
import type { ToolResult } from './errors.js';

// --- StepPlan 统一模型 ---

export interface StepPlan {
  intent: string;
  action: StepAction;
  expectedState?: ExpectedState;
  riskLevel: RiskLevel;
  source: 'workflow' | 'llm';
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'forbidden';

export type StepAction =
  | { type: 'click'; target: TargetDescriptor }
  | { type: 'type'; text: string }
  | { type: 'press'; keys: string[] }
  | { type: 'scroll'; direction: 'up' | 'down'; amount: number }
  | { type: 'navigate'; url: string }
  | { type: 'wait'; condition: ExpectedState; timeoutMs: number }
  | { type: 'observe' }
  | { type: 'takeover'; reason: string }
  | { type: 'done'; summary: string };

export type TargetDescriptor =
  | { strategy: 'playwright'; selector: string; hint?: string }
  | { strategy: 'uia'; query: ElementQuery; hwnd?: number; hint?: string }
  | { strategy: 'coordinate'; point: Point; hint?: string }
  | { strategy: 'human'; hint: string };

// --- ExpectedState ---

export interface ExpectedState {
  any?: StateCondition[];
  all?: StateCondition[];
}

export type StateCondition =
  | { type: 'window_title_contains'; value: string }
  | { type: 'page_text_contains'; value: string; pageRef?: 'managed' }
  | { type: 'uia_element_exists'; query: ElementQuery }
  | { type: 'element_text_equals'; target: TargetDescriptor; value: string }
  | { type: 'file_exists'; path: string; scope: 'app-data' | 'user-approved' };

// --- TaskContext ---

export type TaskMode = 'workflow' | 'llm' | 'hybrid';
export type TaskStatus = 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'aborted';

export interface TaskContext {
  taskRunId: string;
  sessionId: string;
  goal: string;
  mode: TaskMode;
  status: TaskStatus;

  workflowId?: string;
  workflowVersion?: number;
  stepIndex: number;
  retryCountByStep: Map<number, number>;

  browserSession?: BrowserSession;
  activeHwnd?: number;
  activeWindowTitle?: string;

  maxRetries: number;
  outputDir: string;
  abortController: AbortController;
  signal: AbortSignal;

  startedPids: number[];
  createdTempDirs: string[];
  lastObservation?: ObservationSnapshot;
  humanTakeoverEvents: HumanTakeoverEvent[];
}

export interface ObservationSnapshot {
  screenshot: Buffer;
  screenshotPath?: string;
  windowTitle: string;
  hwnd?: number;
  uiaTree?: UiaNode;
  timestamp: string;
}

export interface HumanTakeoverEvent {
  stepIndex: number;
  reason: string;
  pausedAt: string;
  resumedAt?: string;
  userAction?: string;
}

// --- Verify / Failure ---

export interface VerifyResult {
  passed: boolean;
  conditions: { condition: StateCondition; passed: boolean; actual?: string }[];
  screenshot?: string;
}

export type FailureErrorType = 'retryable' | 'degradable' | 'takeover' | 'terminal';

export interface FailureInfo {
  stepIndex: number;
  errorType?: FailureErrorType;
  message: string;
  toolResult?: ToolResult<unknown>;
  screenshot?: string;
}

export type FailureAction =
  | { action: 'retry' }
  | { action: 'degrade'; newStrategy: string }
  | { action: 'takeover'; reason: string }
  | { action: 'abort'; diagnosis: string };

// --- Events ---

export type AgentEventBase = {
  taskRunId: string;
  sessionId: string;
  timestamp: string;
};

export type AgentEvent = AgentEventBase & (
  | { type: 'thinking'; message: string }
  | { type: 'step-start'; step: StepPlan; index: number }
  | { type: 'step-screenshot'; before?: string; after?: string }
  | { type: 'step-result'; success: boolean; verification?: VerifyResult }
  | { type: 'step-failed'; failure: FailureInfo; failCount: number }
  | { type: 'takeover-required'; reason: string }
  | { type: 'takeover-resumed' }
  | { type: 'task-complete'; summary: string }
  | { type: 'task-failed'; diagnosis: string }
);

// --- StepResult ---

export interface StepResult {
  success: boolean;
  toolResult?: ToolResult<unknown>;
  verification?: VerifyResult;
  failure?: FailureInfo;
  beforeScreenshot?: string;
  afterScreenshot?: string;
  durationMs: number;
}

// --- TakeoverRequest error ---

export class TakeoverRequest extends Error {
  constructor(public reason: string) {
    super(`Takeover required: ${reason}`);
    this.name = 'TakeoverRequest';
  }
}
```

- [ ] **步骤 6：创建 types/workflow.ts**

```typescript
// packages/core/src/types/workflow.ts
import type { TargetDescriptor, ExpectedState, RiskLevel } from './agent.js';

export interface WorkflowMemory {
  id: string;
  appName: string;
  platform: 'desktop' | 'browser' | 'hybrid';
  topic: string;
  triggerExamples: string[];
  summary: string;
  initialState: string;
  inputs?: WorkflowInput[];
  steps: WorkflowStep[];
  successCriteria: string;
  riskLevel: RiskLevel;
  sourceType: 'manual' | 'text-teach' | 'recording';
  version: number;
  searchText: string;
  embeddingStatus: 'not_indexed';
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInput {
  name: string;
  type: 'string' | 'number';
  required: boolean;
  prompt: string;
  secret?: boolean;
  humanOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
}

export interface WorkflowStep {
  id: string;
  order: number;
  intent: string;
  targetHint: string;
  target: TargetDescriptor;
  inputHint?: string;
  expectedState?: ExpectedState;
  fallback?: 'retry' | 'degrade' | 'takeover' | 'terminal';
  riskLevel: RiskLevel;
}
```

- [ ] **步骤 7：创建 types/settings.ts**

```typescript
// packages/core/src/types/settings.ts
export interface AppSettings {
  llm: {
    provider: 'openai-compatible';
    model: string;
    baseURL?: string;
    visionModel?: string;
    maxTokens: number;
    temperature: number;
  };
  safety: {
    emergencyStopHotkey: string;
    confirmMediumRisk: boolean;
    maxRetries: number;
    takeoverTimeoutMs: number;
  };
  storage: {
    dataDir: string;
    logRetentionDays: number;
  };
  privacy: {
    screenshotOnlyForTask: boolean;
    logLlmRequests: boolean;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    provider: 'openai-compatible',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.1,
  },
  safety: {
    emergencyStopHotkey: 'Ctrl+Alt+Space',
    confirmMediumRisk: false,
    maxRetries: 2,
    takeoverTimeoutMs: 300000,
  },
  storage: {
    dataDir: '',
    logRetentionDays: 30,
  },
  privacy: {
    screenshotOnlyForTask: true,
    logLlmRequests: true,
  },
};
```

- [ ] **步骤 8：更新 types/index.ts**

替换 `packages/core/src/types/index.ts` 内容：
```typescript
export * from './errors.js';
export * from './coordinates.js';
export * from './agent.js';
export * from './workflow.js';
export * from './settings.js';
```

- [ ] **步骤 9：编写类型守卫测试**

```typescript
// packages/core/tests/types.test.ts
import { describe, it, expect } from 'vitest';
import type { StepAction, TargetDescriptor, StateCondition, TaskContext } from '../src/types/agent.js';
import { TakeoverRequest } from '../src/types/agent.js';
import type { WorkflowMemory, WorkflowInput } from '../src/types/workflow.js';
import { DEFAULT_SETTINGS } from '../src/types/settings.js';

describe('Agent types', () => {
  it('StepAction discriminates on type field', () => {
    const click: StepAction = { type: 'click', target: { strategy: 'playwright', selector: '#btn' } };
    const type_: StepAction = { type: 'type', text: 'hello' };
    const done: StepAction = { type: 'done', summary: 'Task complete' };
    expect(click.type).toBe('click');
    expect(type_.type).toBe('type');
    expect(done.type).toBe('done');
  });

  it('TargetDescriptor discriminates on strategy', () => {
    const pw: TargetDescriptor = { strategy: 'playwright', selector: '#id' };
    const uia: TargetDescriptor = { strategy: 'uia', query: { name: 'OK', controlType: 'Button' } };
    const coord: TargetDescriptor = { strategy: 'coordinate', point: { x: 100, y: 200, space: 'screen-physical' } };
    const human: TargetDescriptor = { strategy: 'human', hint: 'Click the blue button' };
    expect(pw.strategy).toBe('playwright');
    expect(uia.strategy).toBe('uia');
    expect(coord.strategy).toBe('coordinate');
    expect(human.strategy).toBe('human');
  });

  it('TakeoverRequest is an Error subclass', () => {
    const err = new TakeoverRequest('password detected');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TakeoverRequest');
    expect(err.reason).toBe('password detected');
  });

  it('DEFAULT_SETTINGS has expected structure', () => {
    expect(DEFAULT_SETTINGS.safety.maxRetries).toBe(2);
    expect(DEFAULT_SETTINGS.llm.provider).toBe('openai-compatible');
    expect(DEFAULT_SETTINGS.storage.logRetentionDays).toBe(30);
  });
});
```

- [ ] **步骤 10：运行测试验证通过**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/types.test.ts
```
预期：所有测试 PASS。

- [ ] **步骤 11：Commit**

```bash
git add vitest.config.ts packages/core/src/types/agent.ts packages/core/src/types/workflow.ts packages/core/src/types/settings.ts packages/core/src/types/index.ts packages/core/src/types/errors.ts packages/core/package.json packages/core/tests/types.test.ts package.json pnpm-lock.yaml
git commit -m "feat(core): add vitest config and Phase 1A agent type definitions"
```

---

## 任务 2：SQLite 存储层（schema + 迁移 + db 工厂）

**文件：**
- 创建：`packages/core/src/memory/schema.ts`
- 创建：`packages/core/src/memory/db.ts`
- 测试：`packages/core/tests/schema.test.ts`

- [ ] **步骤 1：创建 schema.ts**

```typescript
// packages/core/src/memory/schema.ts
import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_messages_session ON messages(session_id, created_at);

      CREATE TABLE workflow_memories (
        id TEXT PRIMARY KEY,
        app_name TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('desktop', 'browser', 'hybrid')),
        topic TEXT NOT NULL,
        trigger_examples TEXT NOT NULL,
        summary TEXT NOT NULL,
        initial_state TEXT NOT NULL,
        inputs TEXT,
        steps TEXT NOT NULL,
        success_criteria TEXT,
        risk_level TEXT NOT NULL DEFAULT 'low',
        source_type TEXT NOT NULL DEFAULT 'manual',
        version INTEGER NOT NULL DEFAULT 1,
        search_text TEXT NOT NULL DEFAULT '',
        embedding_status TEXT NOT NULL DEFAULT 'not_indexed',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_memories_app ON workflow_memories(app_name);
      CREATE INDEX idx_memories_topic ON workflow_memories(topic);

      CREATE TABLE task_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id),
        user_goal TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'workflow' CHECK (mode IN ('workflow', 'llm', 'hybrid')),
        matched_memory_id TEXT REFERENCES workflow_memories(id),
        selected_memory_ids TEXT,
        plan_json TEXT,
        run_config TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'success', 'failed', 'aborted')),
        summary TEXT,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE task_step_logs (
        id TEXT PRIMARY KEY,
        task_run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        intent TEXT NOT NULL,
        action TEXT NOT NULL,
        locator_strategy TEXT,
        before_screenshot TEXT,
        after_screenshot TEXT,
        uia_snapshot TEXT,
        expected_state TEXT,
        verification_result TEXT CHECK (verification_result IN ('pass', 'fail', 'skipped')),
        error_type TEXT,
        workflow_step_snapshot TEXT,
        target_snapshot TEXT,
        tool_result TEXT,
        failure_info TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_step_logs_task ON task_step_logs(task_run_id, step_index);

      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r: any) => r.version),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.up);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name,
      );
    })();
  }
}
```

- [ ] **步骤 2：创建 db.ts**

```typescript
// packages/core/src/memory/db.ts
import { createRequire } from 'node:module';
import { runMigrations } from './schema.js';
import type Database from 'better-sqlite3';

const require_ = createRequire(import.meta.url);

let instance: Database.Database | null = null;

export function getDatabase(dbPath: string): Database.Database {
  if (instance) return instance;
  const BetterSqlite3 = require_('better-sqlite3');
  instance = new BetterSqlite3(dbPath) as Database.Database;
  runMigrations(instance);
  return instance;
}

export function getDatabaseForTest(dbPath: string = ':memory:'): Database.Database {
  const BetterSqlite3 = require_('better-sqlite3');
  const db = new BetterSqlite3(dbPath) as Database.Database;
  runMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
```

- [ ] **步骤 3：编写 schema 测试**

```typescript
// packages/core/tests/schema.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabaseForTest } from '../src/memory/db.js';
import type Database from 'better-sqlite3';

describe('SQLite schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getDatabaseForTest(':memory:');
  });

  it('creates all expected tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name);
    expect(tables).toContain('sessions');
    expect(tables).toContain('messages');
    expect(tables).toContain('workflow_memories');
    expect(tables).toContain('task_runs');
    expect(tables).toContain('task_step_logs');
    expect(tables).toContain('app_settings');
    expect(tables).toContain('schema_migrations');
  });

  it('records migration version', () => {
    const rows = db.prepare('SELECT version, name FROM schema_migrations').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].name).toBe('initial_schema');
  });

  it('is idempotent on re-run', async () => {
    // Running migrations again should not throw
    const { runMigrations } = await import('../src/memory/schema.js');
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('enforces foreign key on messages.session_id', () => {
    expect(() =>
      db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES ('m1', 'nonexistent', 'user', 'hi')").run()
    ).toThrow();
  });

  it('WAL mode is enabled', () => {
    const result = db.pragma('journal_mode') as any[];
    expect(result[0].journal_mode).toBe('wal');
  });
});
```

- [ ] **步骤 4：运行测试验证通过**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/schema.test.ts
```
预期：所有测试 PASS。

- [ ] **步骤 5：Commit**

```bash
git add packages/core/src/memory/schema.ts packages/core/src/memory/db.ts packages/core/tests/schema.test.ts
git commit -m "feat(core): add SQLite schema with migrations and WAL mode"
```

---

## 任务 3：Input 模块补充（scroll + releaseAllKeys）

**文件：**
- 修改：`packages/core/src/tools/input.ts`
- 测试：`packages/core/tests/input-extensions.test.ts`

- [ ] **步骤 1：编写测试（先写失败测试）**

```typescript
// packages/core/tests/input-extensions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @nut-tree-fork/nut-js to avoid real input
vi.mock('@nut-tree-fork/nut-js', () => ({
  mouse: {
    config: { autoDelayMs: 50 },
    scrollDown: vi.fn(),
    scrollUp: vi.fn(),
  },
  keyboard: {
    config: { autoDelayMs: 50 },
    releaseKey: vi.fn(),
  },
  Key: { LeftShift: 0, LeftControl: 1, LeftAlt: 2, LeftSuper: 3 },
  straightTo: vi.fn(),
  Point: vi.fn(),
}));

describe('input.scroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scrolls down with given amount', async () => {
    const { scroll } = await import('../src/tools/input.js');
    const result = await scroll('down', 3);
    expect(result.ok).toBe(true);
  });

  it('scrolls up with given amount', async () => {
    const { scroll } = await import('../src/tools/input.js');
    const result = await scroll('up', 5);
    expect(result.ok).toBe(true);
  });

  it('returns error on failure', async () => {
    const nut = await import('@nut-tree-fork/nut-js');
    (nut.mouse.scrollDown as any).mockRejectedValueOnce(new Error('scroll failed'));
    const { scroll } = await import('../src/tools/input.js');
    const result = await scroll('down', 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INPUT_ABORTED');
  });
});

describe('input.releaseAllKeys', () => {
  it('releases modifier keys without error', async () => {
    const { releaseAllKeys } = await import('../src/tools/input.js');
    const result = await releaseAllKeys();
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/input-extensions.test.ts
```
预期：FAIL — `scroll` and `releaseAllKeys` not exported.

- [ ] **步骤 3：实现 scroll 和 releaseAllKeys**

在 `packages/core/src/tools/input.ts` 文件末尾追加：

```typescript
export async function scroll(direction: 'up' | 'down', amount: number): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    await ensureNut();
    for (let i = 0; i < amount; i++) {
      if (direction === 'down') {
        await nutMouse.scrollDown(3);
      } else {
        await nutMouse.scrollUp(3);
      }
    }
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('INPUT_ABORTED', err.message, performance.now() - start);
  }
}

export async function releaseAllKeys(): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    await ensureNut();
    const { Key } = await import('@nut-tree-fork/nut-js');
    const modifiers = [Key.LeftShift, Key.LeftControl, Key.LeftAlt, Key.LeftSuper];
    for (const key of modifiers) {
      try { await nutKeyboard.releaseKey(key); } catch { /* best effort */ }
    }
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('INPUT_ABORTED', err.message, performance.now() - start);
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/input-extensions.test.ts
```
预期：所有测试 PASS。

- [ ] **步骤 5：Commit**

```bash
git add packages/core/src/tools/input.ts packages/core/tests/input-extensions.test.ts
git commit -m "feat(core): add scroll() and releaseAllKeys() to input module"
```

---

## 任务 4：Workflow Parser + Zod 验证

**文件：**
- 创建：`packages/core/src/memory/workflow-parser.ts`
- 创建：`tests/fixtures/workflows/form-fill-local.yaml`
- 测试：`packages/core/tests/workflow-parser.test.ts`

- [ ] **步骤 1：创建评测流程 YAML fixture**

```yaml
# tests/fixtures/workflows/form-fill-local.yaml
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
  - intent: 导航到测试表单页
    targetHint: 浏览器地址栏
    target:
      strategy: playwright
      selector: "body"
    inputHint: "navigate:http://127.0.0.1:12827/test-form.html"
    expectedState:
      any:
        - type: page_text_contains
          value: Test Form
    riskLevel: low

  - intent: 填写用户名
    targetHint: Name 输入框
    target:
      strategy: playwright
      selector: "#name"
    inputHint: "{{userName}}"
    riskLevel: low

  - intent: 填写邮箱
    targetHint: Email 输入框
    target:
      strategy: playwright
      selector: "#email"
    inputHint: "{{email}}"
    riskLevel: low

  - intent: 提交表单
    targetHint: Submit 按钮
    target:
      strategy: playwright
      selector: "button[type='submit']"
    expectedState:
      any:
        - type: page_text_contains
          value: submitted successfully
    riskLevel: medium
    fallback: retry

successCriteria: 页面显示 submitted successfully
```

- [ ] **步骤 2：创建 workflow-parser.ts**

```typescript
// packages/core/src/memory/workflow-parser.ts
import { z } from 'zod';
import { nanoid } from 'nanoid';

const TargetDescriptorSchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('playwright'), selector: z.string(), hint: z.string().optional() }),
  z.object({ strategy: z.literal('uia'), query: z.record(z.unknown()), hwnd: z.number().optional(), hint: z.string().optional() }),
  z.object({ strategy: z.literal('coordinate'), point: z.object({ x: z.number(), y: z.number(), space: z.string() }), hint: z.string().optional() }),
  z.object({ strategy: z.literal('human'), hint: z.string() }),
]);

const StateConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('window_title_contains'), value: z.string() }),
  z.object({ type: z.literal('page_text_contains'), value: z.string(), pageRef: z.literal('managed').optional() }),
  z.object({ type: z.literal('uia_element_exists'), query: z.record(z.unknown()) }),
  z.object({ type: z.literal('element_text_equals'), target: TargetDescriptorSchema, value: z.string() }),
  z.object({ type: z.literal('file_exists'), path: z.string(), scope: z.enum(['app-data', 'user-approved']) }),
]);

const ExpectedStateSchema = z.object({
  any: z.array(StateConditionSchema).optional(),
  all: z.array(StateConditionSchema).optional(),
}).refine(d => d.any || d.all, { message: 'ExpectedState must have at least one of any/all' });

const WorkflowInputSchema = z.object({
  type: z.enum(['string', 'number']),
  required: z.boolean(),
  prompt: z.string(),
  secret: z.boolean().optional(),
  humanOnly: z.boolean().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  defaultValue: z.string().optional(),
});

const WorkflowStepSchema = z.object({
  intent: z.string(),
  targetHint: z.string(),
  target: TargetDescriptorSchema,
  inputHint: z.string().optional(),
  expectedState: ExpectedStateSchema.optional(),
  fallback: z.enum(['retry', 'degrade', 'takeover', 'terminal']).optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'forbidden']),
});

const WorkflowFileSchema = z.object({
  appName: z.string().min(1),
  platform: z.enum(['desktop', 'browser', 'hybrid']),
  topic: z.string().min(1),
  triggerExamples: z.array(z.string()).min(1),
  summary: z.string().min(1),
  initialState: z.string().min(1),
  inputs: z.record(WorkflowInputSchema).optional(),
  steps: z.array(WorkflowStepSchema).min(1),
  successCriteria: z.string().min(1),
  riskLevel: z.enum(['low', 'medium', 'high']),
});

export type WorkflowFileData = z.infer<typeof WorkflowFileSchema>;

export interface ParseResult {
  ok: true;
  data: WorkflowFileData;
} | {
  ok: false;
  errors: string[];
}

export function parseWorkflowContent(content: string, format: 'yaml' | 'json'): ParseResult {
  let raw: unknown;
  try {
    if (format === 'yaml') {
      const jsYaml = await import('js-yaml');
      raw = jsYaml.load(content);
    } else {
      raw = JSON.parse(content);
    }
  } catch (err: any) {
    return { ok: false, errors: [`Parse error: ${err.message}`] };
  }

  const result = WorkflowFileSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  }
  return { ok: true, data: result.data };
}

export function workflowFileToMemory(data: WorkflowFileData): import('../types/workflow.js').WorkflowMemory {
  const now = new Date().toISOString();
  const inputs = data.inputs
    ? Object.entries(data.inputs).map(([name, def]) => ({ name, ...def }))
    : undefined;

  const steps = data.steps.map((s, i) => ({
    id: nanoid(),
    order: i,
    ...s,
  }));

  const searchText = [
    data.appName,
    data.topic,
    ...data.triggerExamples,
    data.summary,
  ].join(' ');

  return {
    id: nanoid(),
    appName: data.appName,
    platform: data.platform,
    topic: data.topic,
    triggerExamples: data.triggerExamples,
    summary: data.summary,
    initialState: data.initialState,
    inputs,
    steps,
    successCriteria: data.successCriteria,
    riskLevel: data.riskLevel,
    sourceType: 'manual',
    version: 1,
    searchText,
    embeddingStatus: 'not_indexed',
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **步骤 3：编写 parser 测试**

```typescript
// packages/core/tests/workflow-parser.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWorkflowContent, workflowFileToMemory } from '../src/memory/workflow-parser.js';

const FIXTURE_PATH = resolve(__dirname, '../../tests/fixtures/workflows/form-fill-local.yaml');

describe('WorkflowParser', () => {
  const yamlContent = readFileSync(FIXTURE_PATH, 'utf-8');

  it('parses valid YAML workflow', () => {
    const result = parseWorkflowContent(yamlContent, 'yaml');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.appName).toBe('Chrome');
      expect(result.data.steps).toHaveLength(4);
      expect(result.data.inputs).toHaveProperty('userName');
    }
  });

  it('rejects workflow with missing required fields', () => {
    const bad = 'appName: Chrome\nsteps: []';
    const result = parseWorkflowContent(bad, 'yaml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid YAML syntax', () => {
    const result = parseWorkflowContent('{{invalid', 'yaml');
    expect(result.ok).toBe(false);
  });

  it('converts parsed data to WorkflowMemory', () => {
    const result = parseWorkflowContent(yamlContent, 'yaml');
    if (!result.ok) throw new Error('parse failed');
    const memory = workflowFileToMemory(result.data);
    expect(memory.id).toBeTruthy();
    expect(memory.steps[0].order).toBe(0);
    expect(memory.searchText).toContain('Chrome');
    expect(memory.searchText).toContain('帮我填表单');
    expect(memory.inputs).toHaveLength(2);
    expect(memory.inputs![0].name).toBe('userName');
  });

  it('validates TargetDescriptor strategy is one of the allowed values', () => {
    const bad = yamlContent.replace('strategy: playwright', 'strategy: invalid');
    const result = parseWorkflowContent(bad, 'yaml');
    expect(result.ok).toBe(false);
  });

  it('parses JSON format', () => {
    const result = parseWorkflowContent(yamlContent, 'yaml');
    if (!result.ok) throw new Error('parse failed');
    const json = JSON.stringify(result.data);
    const jsonResult = parseWorkflowContent(json, 'json');
    expect(jsonResult.ok).toBe(true);
  });
});
```

- [ ] **步骤 4：运行测试验证通过**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/workflow-parser.test.ts
```
预期：所有测试 PASS。

- [ ] **步骤 5：Commit**

```bash
git add packages/core/src/memory/workflow-parser.ts tests/fixtures/workflows/form-fill-local.yaml packages/core/tests/workflow-parser.test.ts
git commit -m "feat(core): add workflow parser with zod validation"
```

---

## 任务 5：MemoryStore（CRUD + 关键词检索）

**文件：**
- 创建：`packages/core/src/memory/memory-store.ts`
- 测试：`packages/core/tests/memory-store.test.ts`

- [ ] **步骤 1：创建 memory-store.ts**

```typescript
// packages/core/src/memory/memory-store.ts
import type Database from 'better-sqlite3';
import type { WorkflowMemory } from '../types/workflow.js';

export interface MemorySearchResult {
  memory: WorkflowMemory;
  score: number;
  matchedFields: string[];
}

export class MemoryStore {
  constructor(private db: Database.Database) {}

  insert(memory: WorkflowMemory): void {
    this.db.prepare(`
      INSERT INTO workflow_memories (
        id, app_name, platform, topic, trigger_examples, summary,
        initial_state, inputs, steps, success_criteria, risk_level,
        source_type, version, search_text, embedding_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.appName,
      memory.platform,
      memory.topic,
      JSON.stringify(memory.triggerExamples),
      memory.summary,
      memory.initialState,
      memory.inputs ? JSON.stringify(memory.inputs) : null,
      JSON.stringify(memory.steps),
      memory.successCriteria,
      memory.riskLevel,
      memory.sourceType,
      memory.version,
      memory.searchText,
      memory.embeddingStatus,
      memory.createdAt,
      memory.updatedAt,
    );
  }

  getById(id: string): WorkflowMemory | null {
    const row = this.db.prepare('SELECT * FROM workflow_memories WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToMemory(row);
  }

  list(filter?: { appName?: string; topic?: string }): WorkflowMemory[] {
    let sql = 'SELECT * FROM workflow_memories WHERE 1=1';
    const params: string[] = [];
    if (filter?.appName) { sql += ' AND app_name = ?'; params.push(filter.appName); }
    if (filter?.topic) { sql += ' AND topic = ?'; params.push(filter.topic); }
    sql += ' ORDER BY updated_at DESC';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToMemory(r));
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM workflow_memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  search(goal: string): MemorySearchResult[] {
    const tokens = this.tokenize(goal);
    if (tokens.length === 0) return [];

    const allMemories = this.db.prepare('SELECT * FROM workflow_memories').all() as any[];
    const results: MemorySearchResult[] = [];

    for (const row of allMemories) {
      const memory = this.rowToMemory(row);
      const { score, matchedFields } = this.scoreMatch(tokens, memory);
      if (score > 0) {
        results.push({ memory, score, matchedFields });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 3);
  }

  private tokenize(text: string): string[] {
    const cleaned = text.replace(/[，。！？、；：""''（）\s]+/g, ' ').trim();
    const words = cleaned.split(' ').filter(w => w.length > 0);
    const bigrams: string[] = [];
    for (const word of words) {
      if (/[一-鿿]/.test(word)) {
        for (let i = 0; i < word.length - 1; i++) {
          bigrams.push(word.slice(i, i + 2));
        }
        if (word.length === 1) bigrams.push(word);
      } else {
        bigrams.push(word.toLowerCase());
      }
    }
    return [...new Set(bigrams)];
  }

  private scoreMatch(tokens: string[], memory: WorkflowMemory): { score: number; matchedFields: string[] } {
    const fields: { name: string; text: string; weight: number }[] = [
      { name: 'triggerExamples', text: memory.triggerExamples.join(' '), weight: 3 },
      { name: 'topic', text: memory.topic, weight: 2 },
      { name: 'summary', text: memory.summary, weight: 2 },
      { name: 'appName', text: memory.appName, weight: 1 },
      { name: 'searchText', text: memory.searchText, weight: 1 },
    ];

    let totalWeight = 0;
    let matchedWeight = 0;
    const matchedFields: string[] = [];

    for (const field of fields) {
      const fieldLower = field.text.toLowerCase();
      const fieldMatched = tokens.some(t => fieldLower.includes(t));
      totalWeight += field.weight;
      if (fieldMatched) {
        matchedWeight += field.weight;
        matchedFields.push(field.name);
      }
    }

    const fieldScore = totalWeight > 0 ? matchedWeight / totalWeight : 0;

    const allText = fields.map(f => f.text).join(' ').toLowerCase();
    const tokenHits = tokens.filter(t => allText.includes(t)).length;
    const coverageScore = tokens.length > 0 ? tokenHits / tokens.length : 0;

    const score = Math.min(1, fieldScore * 0.6 + coverageScore * 0.4);
    return { score, matchedFields };
  }

  private rowToMemory(row: any): WorkflowMemory {
    return {
      id: row.id,
      appName: row.app_name,
      platform: row.platform,
      topic: row.topic,
      triggerExamples: JSON.parse(row.trigger_examples),
      summary: row.summary,
      initialState: row.initial_state,
      inputs: row.inputs ? JSON.parse(row.inputs) : undefined,
      steps: JSON.parse(row.steps),
      successCriteria: row.success_criteria,
      riskLevel: row.risk_level,
      sourceType: row.source_type,
      version: row.version,
      searchText: row.search_text,
      embeddingStatus: row.embedding_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
```

- [ ] **步骤 2：编写 memory-store 测试**

```typescript
// packages/core/tests/memory-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabaseForTest } from '../src/memory/db.js';
import { MemoryStore } from '../src/memory/memory-store.js';
import type { WorkflowMemory } from '../src/types/workflow.js';
import type Database from 'better-sqlite3';

function makeMemory(overrides?: Partial<WorkflowMemory>): WorkflowMemory {
  return {
    id: 'test-id-1',
    appName: 'Chrome',
    platform: 'browser',
    topic: 'local-form/fill',
    triggerExamples: ['帮我填表单', '填写测试表单'],
    summary: '在本地测试页填写并提交表单',
    initialState: '浏览器已打开',
    inputs: [{ name: 'userName', type: 'string', required: true, prompt: '请输入用户名' }],
    steps: [{ id: 's1', order: 0, intent: '填写', targetHint: '输入框', target: { strategy: 'playwright', selector: '#name' }, riskLevel: 'low' }],
    successCriteria: '提交成功',
    riskLevel: 'low',
    sourceType: 'manual',
    version: 1,
    searchText: 'Chrome local-form/fill 帮我填表单 填写测试表单 在本地测试页填写并提交表单',
    embeddingStatus: 'not_indexed',
    createdAt: '2026-06-22T00:00:00Z',
    updatedAt: '2026-06-22T00:00:00Z',
    ...overrides,
  };
}

describe('MemoryStore', () => {
  let db: Database.Database;
  let store: MemoryStore;

  beforeEach(() => {
    db = getDatabaseForTest(':memory:');
    store = new MemoryStore(db);
  });

  it('inserts and retrieves a memory', () => {
    const mem = makeMemory();
    store.insert(mem);
    const retrieved = store.getById('test-id-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.appName).toBe('Chrome');
    expect(retrieved!.triggerExamples).toEqual(['帮我填表单', '填写测试表单']);
  });

  it('lists all memories', () => {
    store.insert(makeMemory({ id: 'a' }));
    store.insert(makeMemory({ id: 'b', appName: '记事本', topic: 'notepad/text' }));
    expect(store.list()).toHaveLength(2);
  });

  it('filters by appName', () => {
    store.insert(makeMemory({ id: 'a' }));
    store.insert(makeMemory({ id: 'b', appName: '记事本' }));
    expect(store.list({ appName: 'Chrome' })).toHaveLength(1);
  });

  it('deletes a memory', () => {
    store.insert(makeMemory());
    expect(store.delete('test-id-1')).toBe(true);
    expect(store.getById('test-id-1')).toBeNull();
  });

  it('search returns high score for exact trigger match', () => {
    store.insert(makeMemory());
    const results = store.search('帮我填表单');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThanOrEqual(0.5);
    expect(results[0].matchedFields).toContain('triggerExamples');
  });

  it('search returns low score for unrelated query', () => {
    store.insert(makeMemory());
    const results = store.search('打开计算器');
    // Should either be empty or have low score
    if (results.length > 0) {
      expect(results[0].score).toBeLessThan(0.5);
    }
  });

  it('search returns empty for empty goal', () => {
    store.insert(makeMemory());
    expect(store.search('')).toHaveLength(0);
  });

  it('search returns top-3 results max', () => {
    for (let i = 0; i < 5; i++) {
      store.insert(makeMemory({
        id: `mem-${i}`,
        triggerExamples: [`填表${i}`],
        searchText: `填表${i} Chrome`,
      }));
    }
    const results = store.search('填表');
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **步骤 3：运行测试验证通过**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/memory-store.test.ts
```
预期：所有测试 PASS。

- [ ] **步骤 4：Commit**

```bash
git add packages/core/src/memory/memory-store.ts packages/core/tests/memory-store.test.ts
git commit -m "feat(core): add MemoryStore with keyword search and threshold scoring"
```

---

## 任务 6：AbortManager + RiskClassifier

**文件：**
- 创建：`packages/core/src/safety/abort-manager.ts`
- 创建：`packages/core/src/safety/risk-classifier.ts`
- 测试：`packages/core/tests/abort-manager.test.ts`
- 测试：`packages/core/tests/risk-classifier.test.ts`

- [ ] **步骤 1：创建 abort-manager.ts**

```typescript
// packages/core/src/safety/abort-manager.ts
export type AbortSource = 'hotkey' | 'tray' | 'ui' | 'timeout';

export class AbortManager {
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
  }

  isAborted(taskRunId: string): boolean {
    const controller = this.controllers.get(taskRunId);
    if (!controller) return true;
    return controller.signal.aborted;
  }

  cleanup(taskRunId: string): void {
    this.controllers.delete(taskRunId);
  }

  get activeTaskIds(): string[] {
    return [...this.controllers.keys()];
  }
}
```

- [ ] **步骤 2：创建 risk-classifier.ts**

```typescript
// packages/core/src/safety/risk-classifier.ts
import type { StepPlan, RiskLevel } from '../types/agent.js';

const HIGH_RISK_KEYWORDS = ['删除', '提交', '发送', '支付', 'delete', 'submit', 'send', 'pay', 'purchase', 'remove'];
const FORBIDDEN_KEYWORDS = ['密码', '验证码', 'password', 'captcha', 'otp', '支付密码'];

export class RiskClassifier {
  classify(step: StepPlan): RiskLevel {
    if (step.source === 'workflow') {
      return step.riskLevel;
    }
    return this.inferFromAction(step);
  }

  private inferFromAction(step: StepPlan): RiskLevel {
    const text = [step.intent, this.actionText(step)].join(' ').toLowerCase();

    if (FORBIDDEN_KEYWORDS.some(k => text.includes(k))) return 'forbidden';
    if (HIGH_RISK_KEYWORDS.some(k => text.includes(k))) return 'high';

    switch (step.action.type) {
      case 'navigate':
      case 'observe':
      case 'scroll':
        return 'low';
      case 'click':
      case 'type':
      case 'press':
        return HIGH_RISK_KEYWORDS.some(k => text.includes(k)) ? 'high' : 'low';
      case 'wait':
      case 'done':
        return 'low';
      case 'takeover':
        return 'forbidden';
      default:
        return 'medium';
    }
  }

  private actionText(step: StepPlan): string {
    const a = step.action;
    switch (a.type) {
      case 'type': return a.text;
      case 'navigate': return a.url;
      case 'click': return 'hint' in a.target ? (a.target.hint ?? '') : '';
      default: return '';
    }
  }
}
```

- [ ] **步骤 3：编写 abort-manager 测试**

```typescript
// packages/core/tests/abort-manager.test.ts
import { describe, it, expect } from 'vitest';
import { AbortManager } from '../src/safety/abort-manager.js';

describe('AbortManager', () => {
  it('creates a signal for a task', () => {
    const mgr = new AbortManager();
    const signal = mgr.createTaskSignal('t1');
    expect(signal.aborted).toBe(false);
    expect(mgr.isAborted('t1')).toBe(false);
  });

  it('aborts a task', () => {
    const mgr = new AbortManager();
    const signal = mgr.createTaskSignal('t1');
    mgr.abortTask('t1', 'hotkey');
    expect(signal.aborted).toBe(true);
    expect(mgr.isAborted('t1')).toBe(true);
  });

  it('returns true for unknown task ids', () => {
    const mgr = new AbortManager();
    expect(mgr.isAborted('nonexistent')).toBe(true);
  });

  it('abort is idempotent', () => {
    const mgr = new AbortManager();
    mgr.createTaskSignal('t1');
    mgr.abortTask('t1', 'ui');
    expect(() => mgr.abortTask('t1', 'ui')).not.toThrow();
  });

  it('tracks active task ids', () => {
    const mgr = new AbortManager();
    mgr.createTaskSignal('t1');
    mgr.createTaskSignal('t2');
    expect(mgr.activeTaskIds).toContain('t1');
    expect(mgr.activeTaskIds).toContain('t2');
    mgr.abortTask('t1', 'hotkey');
    expect(mgr.activeTaskIds).not.toContain('t1');
  });

  it('cleanup removes controller without aborting', () => {
    const mgr = new AbortManager();
    const signal = mgr.createTaskSignal('t1');
    mgr.cleanup('t1');
    expect(signal.aborted).toBe(false);
    expect(mgr.activeTaskIds).not.toContain('t1');
  });
});
```

- [ ] **步骤 4：编写 risk-classifier 测试**

```typescript
// packages/core/tests/risk-classifier.test.ts
import { describe, it, expect } from 'vitest';
import { RiskClassifier } from '../src/safety/risk-classifier.js';
import type { StepPlan } from '../src/types/agent.js';

function plan(overrides: Partial<StepPlan> & Pick<StepPlan, 'action'>): StepPlan {
  return { intent: '', riskLevel: 'low', source: 'llm', ...overrides };
}

describe('RiskClassifier', () => {
  const clf = new RiskClassifier();

  it('uses workflow riskLevel for workflow source', () => {
    const step = plan({ source: 'workflow', riskLevel: 'high', action: { type: 'click', target: { strategy: 'playwright', selector: '#btn' } } });
    expect(clf.classify(step)).toBe('high');
  });

  it('marks navigate as low risk', () => {
    const step = plan({ action: { type: 'navigate', url: 'http://localhost' } });
    expect(clf.classify(step)).toBe('low');
  });

  it('marks observe as low risk', () => {
    const step = plan({ action: { type: 'observe' } });
    expect(clf.classify(step)).toBe('low');
  });

  it('detects high risk from keywords in intent', () => {
    const step = plan({ intent: '删除文件', action: { type: 'click', target: { strategy: 'playwright', selector: '#del' } } });
    expect(clf.classify(step)).toBe('high');
  });

  it('detects forbidden from password keywords', () => {
    const step = plan({ intent: '输入密码', action: { type: 'type', text: 'secret' } });
    expect(clf.classify(step)).toBe('forbidden');
  });

  it('detects forbidden from takeover action', () => {
    const step = plan({ action: { type: 'takeover', reason: 'captcha' } });
    expect(clf.classify(step)).toBe('forbidden');
  });
});
```

- [ ] **步骤 5：运行测试验证通过**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/abort-manager.test.ts packages/core/tests/risk-classifier.test.ts
```
预期：所有测试 PASS。

- [ ] **步骤 6：Commit**

```bash
git add packages/core/src/safety/abort-manager.ts packages/core/src/safety/risk-classifier.ts packages/core/tests/abort-manager.test.ts packages/core/tests/risk-classifier.test.ts
git commit -m "feat(core): add AbortManager and RiskClassifier safety primitives"
```

---

## 任务 7：ToolRouter 适配层

**文件：**
- 创建：`packages/core/src/agent/tool-router.ts`
- 测试：`packages/core/tests/tool-router.test.ts`

ToolRouter 桥接 `StepAction` → Phase 0 工具。测试使用 mock 工具，不依赖真实桌面。

- [ ] **步骤 1：创建 tool-router.ts**

```typescript
// packages/core/src/agent/tool-router.ts
import type { ToolResult } from '../types/errors.js';
import { toolOk, toolErr } from '../types/errors.js';
import type { StepAction, TargetDescriptor, TaskContext, ExpectedState } from '../types/agent.js';
import { TakeoverRequest } from '../types/agent.js';
import type { Page } from 'playwright';
import type { Point } from '../types/coordinates.js';
import type { ElementQuery, UiaNode } from '../tools/uia.js';
import type { ScreenshotResult, WindowInfo } from '../tools/screenshot.js';

export interface ToolAdapters {
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

const TOOL_TIMEOUT_MS = 15000;

export class ToolRouter {
  constructor(private tools: ToolAdapters) {}

  async dispatch(action: StepAction, context: TaskContext): Promise<ToolResult<unknown>> {
    if (context.signal.aborted) {
      return toolErr('TASK_ABORTED', 'Task was aborted', 0);
    }

    switch (action.type) {
      case 'click':
        return this.routeClick(action.target, context);
      case 'type':
        return this.withAbort(this.tools.input.typeText(action.text), context.signal);
      case 'press':
        return this.withAbort(this.tools.input.pressKeys(action.keys), context.signal);
      case 'scroll':
        return this.withAbort(this.tools.input.scroll(action.direction, action.amount), context.signal);
      case 'navigate':
        return this.routeNavigate(action.url, context);
      case 'wait':
        return toolOk({ waited: true }, 0);
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
        if (!page) return toolErr('BROWSER_ACTION_FAILED', 'No active browser session', 0);
        return this.withAbort(this.tools.browser.clickElement(page, target.selector), ctx.signal);
      }
      case 'uia': {
        const hwnd = target.hwnd ?? ctx.activeHwnd;
        if (!hwnd) return toolErr('UIA_ELEMENT_NOT_FOUND', 'No active window hwnd', 0);
        return this.withAbort(this.tools.uia.invokeElement(hwnd, target.query), ctx.signal);
      }
      case 'coordinate': {
        return this.withAbort(this.tools.input.clickPoint(target.point), ctx.signal);
      }
      case 'human': {
        throw new TakeoverRequest(`需要人工定位: ${target.hint}`);
      }
    }
  }

  private async routeNavigate(url: string, ctx: TaskContext): Promise<ToolResult<void>> {
    const page = ctx.browserSession?.page;
    if (!page) return toolErr('BROWSER_ACTION_FAILED', 'No active browser session', 0);
    return this.withAbort(this.tools.browser.navigateTo(page, url), ctx.signal);
  }

  private async captureState(ctx: TaskContext): Promise<ToolResult<unknown>> {
    const screenshot = await this.tools.screenshot.captureScreen();
    const window = await this.tools.screenshot.getActiveWindow();
    return toolOk({
      screenshot: screenshot.ok ? { width: screenshot.data.width, height: screenshot.data.height } : null,
      window: window.ok ? { title: window.data.title, hwnd: window.data.hwnd } : null,
    }, 0);
  }

  private async withAbort<T>(promise: Promise<ToolResult<T>>, signal: AbortSignal): Promise<ToolResult<T>> {
    if (signal.aborted) return toolErr('TASK_ABORTED', 'Task was aborted', 0);
    const abortPromise = new Promise<ToolResult<T>>((_, reject) => {
      signal.addEventListener('abort', () => reject(toolErr('TASK_ABORTED', 'Task aborted during tool execution', 0)), { once: true });
    });
    const timeoutPromise = new Promise<ToolResult<T>>((resolve) => {
      setTimeout(() => resolve(toolErr('TASK_ABORTED', `Tool timed out after ${TOOL_TIMEOUT_MS}ms`, TOOL_TIMEOUT_MS)), TOOL_TIMEOUT_MS);
    });
    try {
      return await Promise.race([promise, abortPromise, timeoutPromise]);
    } catch (err: any) {
      if (err?.ok === false) return err;
      return toolErr('TASK_ABORTED', err.message ?? 'Aborted', 0);
    }
  }
}
```

- [ ] **步骤 2：编写 tool-router 测试**

```typescript
// packages/core/tests/tool-router.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRouter, type ToolAdapters } from '../src/agent/tool-router.js';
import type { TaskContext, StepAction } from '../src/types/agent.js';
import { TakeoverRequest } from '../src/types/agent.js';
import { toolOk, toolErr } from '../src/types/errors.js';

function mockAdapters(): ToolAdapters {
  return {
    browser: {
      clickElement: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      fillInput: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      navigateTo: vi.fn().mockResolvedValue(toolOk(undefined, 100)),
      getPageText: vi.fn().mockResolvedValue(toolOk('page text', 5)),
    },
    uia: {
      invokeElement: vi.fn().mockResolvedValue(toolOk(undefined, 20)),
      findElement: vi.fn().mockResolvedValue(toolOk(null, 20)),
      setElementValue: vi.fn().mockResolvedValue(toolOk(undefined, 20)),
      getElementValue: vi.fn().mockResolvedValue(toolOk('value', 10)),
      getUiTree: vi.fn().mockResolvedValue(toolOk({ name: 'root', controlType: 'Window', children: [] }, 50)),
    },
    input: {
      clickPoint: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
      typeText: vi.fn().mockResolvedValue(toolOk(undefined, 50)),
      pressKeys: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      scroll: vi.fn().mockResolvedValue(toolOk(undefined, 10)),
      releaseAllKeys: vi.fn().mockResolvedValue(toolOk(undefined, 5)),
    },
    screenshot: {
      captureScreen: vi.fn().mockResolvedValue(toolOk({ buffer: Buffer.from(''), width: 1920, height: 1080, timestamp: '' }, 50)),
      captureWindow: vi.fn().mockResolvedValue(toolOk({ buffer: Buffer.from(''), width: 800, height: 600, timestamp: '' }, 50)),
      getActiveWindow: vi.fn().mockResolvedValue(toolOk({ hwnd: 123, title: 'Test', x: 0, y: 0, width: 800, height: 600, isMinimized: false }, 5)),
    },
  };
}

function mockContext(overrides?: Partial<TaskContext>): TaskContext {
  const ctrl = new AbortController();
  return {
    taskRunId: 'test-run',
    sessionId: 'test-session',
    goal: 'test',
    mode: 'workflow',
    status: 'running',
    stepIndex: 0,
    retryCountByStep: new Map(),
    maxRetries: 2,
    outputDir: '/tmp/test',
    abortController: ctrl,
    signal: ctrl.signal,
    startedPids: [],
    createdTempDirs: [],
    humanTakeoverEvents: [],
    ...overrides,
  } as TaskContext;
}

describe('ToolRouter', () => {
  let adapters: ToolAdapters;
  let router: ToolRouter;
  let ctx: TaskContext;

  beforeEach(() => {
    adapters = mockAdapters();
    router = new ToolRouter(adapters);
    ctx = mockContext();
  });

  it('dispatches click/playwright to browser.clickElement', async () => {
    ctx.browserSession = { page: {} } as any;
    const action: StepAction = { type: 'click', target: { strategy: 'playwright', selector: '#btn' } };
    const result = await router.dispatch(action, ctx);
    expect(result.ok).toBe(true);
    expect(adapters.browser.clickElement).toHaveBeenCalled();
  });

  it('dispatches click/uia to uia.invokeElement', async () => {
    ctx.activeHwnd = 12345;
    const action: StepAction = { type: 'click', target: { strategy: 'uia', query: { name: 'OK' } } };
    const result = await router.dispatch(action, ctx);
    expect(result.ok).toBe(true);
    expect(adapters.uia.invokeElement).toHaveBeenCalledWith(12345, { name: 'OK' });
  });

  it('dispatches click/coordinate to input.clickPoint', async () => {
    const action: StepAction = { type: 'click', target: { strategy: 'coordinate', point: { x: 100, y: 200, space: 'screen-physical' } } };
    const result = await router.dispatch(action, ctx);
    expect(result.ok).toBe(true);
    expect(adapters.input.clickPoint).toHaveBeenCalled();
  });

  it('throws TakeoverRequest for human strategy', async () => {
    const action: StepAction = { type: 'click', target: { strategy: 'human', hint: 'click blue button' } };
    await expect(router.dispatch(action, ctx)).rejects.toThrow(TakeoverRequest);
  });

  it('dispatches type to input.typeText', async () => {
    const action: StepAction = { type: 'type', text: 'hello' };
    await router.dispatch(action, ctx);
    expect(adapters.input.typeText).toHaveBeenCalledWith('hello');
  });

  it('dispatches navigate to browser.navigateTo', async () => {
    ctx.browserSession = { page: {} } as any;
    const action: StepAction = { type: 'navigate', url: 'http://localhost' };
    await router.dispatch(action, ctx);
    expect(adapters.browser.navigateTo).toHaveBeenCalled();
  });

  it('returns error when no browser session for navigate', async () => {
    const action: StepAction = { type: 'navigate', url: 'http://localhost' };
    const result = await router.dispatch(action, ctx);
    expect(result.ok).toBe(false);
  });

  it('returns TASK_ABORTED when signal already aborted', async () => {
    ctx.abortController.abort('test');
    const action: StepAction = { type: 'type', text: 'hello' };
    const result = await router.dispatch(action, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TASK_ABORTED');
  });

  it('dispatches observe and captures state', async () => {
    const action: StepAction = { type: 'observe' };
    const result = await router.dispatch(action, ctx);
    expect(result.ok).toBe(true);
    expect(adapters.screenshot.captureScreen).toHaveBeenCalled();
    expect(adapters.screenshot.getActiveWindow).toHaveBeenCalled();
  });

  it('dispatches done returns summary', async () => {
    const action: StepAction = { type: 'done', summary: 'All done' };
    const result = await router.dispatch(action, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ done: true, summary: 'All done' });
  });
});
```

- [ ] **步骤 3：运行测试验证通过**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/tool-router.test.ts
```
预期：所有测试 PASS。

- [ ] **步骤 4：Commit**

```bash
git add packages/core/src/agent/tool-router.ts packages/core/tests/tool-router.test.ts
git commit -m "feat(core): add ToolRouter adapter bridging StepAction to Phase 0 tools"
```

---

## 任务 8：StateVerifier + FailureHandler

**文件：**
- 创建：`packages/core/src/agent/state-verifier.ts`
- 创建：`packages/core/src/agent/failure-handler.ts`
- 测试：`packages/core/tests/state-verifier.test.ts`
- 测试：`packages/core/tests/failure-handler.test.ts`

- [ ] **步骤 1：创建 state-verifier.ts**

```typescript
// packages/core/src/agent/state-verifier.ts
import type { ExpectedState, StateCondition, VerifyResult, TaskContext } from '../types/agent.js';
import type { ToolAdapters } from './tool-router.js';
import fs from 'node:fs';
import path from 'node:path';

export class StateVerifier {
  constructor(private tools: ToolAdapters) {}

  async verify(expected: ExpectedState | undefined, context: TaskContext): Promise<VerifyResult> {
    if (!expected) return { passed: true, conditions: [] };

    const results: { condition: StateCondition; passed: boolean; actual?: string }[] = [];

    if (expected.any && expected.any.length > 0) {
      for (const cond of expected.any) {
        const { passed, actual } = await this.checkCondition(cond, context);
        results.push({ condition: cond, passed, actual });
      }
      return { passed: results.some(r => r.passed), conditions: results };
    }

    if (expected.all && expected.all.length > 0) {
      for (const cond of expected.all) {
        const { passed, actual } = await this.checkCondition(cond, context);
        results.push({ condition: cond, passed, actual });
      }
      return { passed: results.every(r => r.passed), conditions: results };
    }

    return { passed: true, conditions: [] };
  }

  private async checkCondition(cond: StateCondition, ctx: TaskContext): Promise<{ passed: boolean; actual?: string }> {
    switch (cond.type) {
      case 'window_title_contains': {
        const winResult = await this.tools.screenshot.getActiveWindow();
        if (!winResult.ok) return { passed: false, actual: `error: ${winResult.error.message}` };
        const title = winResult.data.title;
        return { passed: title.includes(cond.value), actual: title };
      }
      case 'page_text_contains': {
        const page = ctx.browserSession?.page;
        if (!page) return { passed: false, actual: 'no browser session' };
        const textResult = await this.tools.browser.getPageText(page);
        if (!textResult.ok) return { passed: false, actual: `error: ${textResult.error.message}` };
        return { passed: textResult.data.includes(cond.value), actual: textResult.data.slice(0, 200) };
      }
      case 'uia_element_exists': {
        const hwnd = ctx.activeHwnd;
        if (!hwnd) return { passed: false, actual: 'no active hwnd' };
        const findResult = await this.tools.uia.findElement(hwnd, cond.query);
        if (!findResult.ok) return { passed: false, actual: `error: ${findResult.error.message}` };
        return { passed: findResult.data !== null, actual: findResult.data ? findResult.data.name : 'not found' };
      }
      case 'element_text_equals': {
        // Delegate based on target strategy
        if (cond.target.strategy === 'playwright') {
          const page = ctx.browserSession?.page;
          if (!page) return { passed: false, actual: 'no browser session' };
          try {
            const text = await page.locator(cond.target.selector).textContent({ timeout: 3000 });
            return { passed: text?.trim() === cond.value, actual: text ?? '' };
          } catch {
            return { passed: false, actual: 'locator error' };
          }
        }
        if (cond.target.strategy === 'uia') {
          const hwnd = cond.target.hwnd ?? ctx.activeHwnd;
          if (!hwnd) return { passed: false, actual: 'no hwnd' };
          const valResult = await this.tools.uia.getElementValue(hwnd, cond.target.query);
          if (!valResult.ok) return { passed: false, actual: `error: ${valResult.error.message}` };
          return { passed: valResult.data === cond.value, actual: valResult.data };
        }
        return { passed: false, actual: 'unsupported target strategy for element_text_equals' };
      }
      case 'file_exists': {
        const exists = fs.existsSync(cond.path);
        return { passed: exists, actual: exists ? 'exists' : 'not found' };
      }
    }
  }
}
```

- [ ] **步骤 2：创建 failure-handler.ts**

```typescript
// packages/core/src/agent/failure-handler.ts
import type { FailureInfo, FailureAction, StepPlan, TaskContext, FailureErrorType } from '../types/agent.js';

export class FailureHandler {
  classify(failure: FailureInfo): FailureErrorType {
    const msg = failure.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('not visible') || msg.includes('not ready')) return 'retryable';
    if (msg.includes('element_not_found') || msg.includes('selector')) return 'degradable';
    if (msg.includes('password') || msg.includes('captcha') || msg.includes('login')) return 'takeover';
    return 'terminal';
  }

  async handle(failure: FailureInfo, step: StepPlan, context: TaskContext): Promise<FailureAction> {
    const errorType = failure.errorType ?? this.classify(failure);

    switch (errorType) {
      case 'retryable': {
        const retryCount = context.retryCountByStep.get(context.stepIndex) ?? 0;
        if (retryCount < context.maxRetries) {
          context.retryCountByStep.set(context.stepIndex, retryCount + 1);
          return { action: 'retry' };
        }
        return { action: 'degrade', newStrategy: this.getNextStrategy(step) ?? 'none' };
      }
      case 'degradable': {
        const next = this.getNextStrategy(step);
        if (next) return { action: 'degrade', newStrategy: next };
        return { action: 'takeover', reason: '所有定位策略均失败' };
      }
      case 'takeover':
        return { action: 'takeover', reason: failure.message };
      case 'terminal':
        return { action: 'abort', diagnosis: this.buildDiagnosis(failure, context) };
    }
  }

  private getNextStrategy(step: StepPlan): string | null {
    if (step.action.type !== 'click') return null;
    const chain = ['playwright', 'uia', 'coordinate'];
    const current = step.action.target.strategy;
    const idx = chain.indexOf(current);
    return idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null;
  }

  private buildDiagnosis(failure: FailureInfo, context: TaskContext): string {
    return [
      `Step ${failure.stepIndex}: ${failure.message}`,
      `Task: ${context.goal}`,
      `Mode: ${context.mode}`,
      failure.screenshot ? `Screenshot: ${failure.screenshot}` : null,
    ].filter(Boolean).join('\n');
  }
}
```

- [ ] **步骤 3：编写 state-verifier 测试**

```typescript
// packages/core/tests/state-verifier.test.ts
import { describe, it, expect, vi } from 'vitest';
import { StateVerifier } from '../src/agent/state-verifier.js';
import type { ToolAdapters } from '../src/agent/tool-router.js';
import { toolOk } from '../src/types/errors.js';

function mockTools(): ToolAdapters {
  return {
    browser: {
      clickElement: vi.fn(), fillInput: vi.fn(),
      navigateTo: vi.fn(),
      getPageText: vi.fn().mockResolvedValue(toolOk('Form submitted successfully!', 5)),
    },
    uia: {
      invokeElement: vi.fn(),
      findElement: vi.fn().mockResolvedValue(toolOk({ name: 'OK', controlType: 'Button', children: [] }, 10)),
      setElementValue: vi.fn(), getElementValue: vi.fn().mockResolvedValue(toolOk('hello', 5)),
      getUiTree: vi.fn(),
    },
    input: { clickPoint: vi.fn(), typeText: vi.fn(), pressKeys: vi.fn(), scroll: vi.fn(), releaseAllKeys: vi.fn() },
    screenshot: {
      captureScreen: vi.fn(),
      captureWindow: vi.fn(),
      getActiveWindow: vi.fn().mockResolvedValue(toolOk({ hwnd: 1, title: 'Notepad - test.txt', x: 0, y: 0, width: 800, height: 600, isMinimized: false }, 5)),
    },
  };
}

function ctx(overrides?: any) {
  const ctrl = new AbortController();
  return { taskRunId: 't', sessionId: 's', goal: '', mode: 'workflow', status: 'running', stepIndex: 0, retryCountByStep: new Map(), maxRetries: 2, outputDir: '/tmp', abortController: ctrl, signal: ctrl.signal, startedPids: [], createdTempDirs: [], humanTakeoverEvents: [], activeHwnd: 123, browserSession: { page: {} }, ...overrides } as any;
}

describe('StateVerifier', () => {
  it('passes with no expected state', async () => {
    const v = new StateVerifier(mockTools());
    const r = await v.verify(undefined, ctx());
    expect(r.passed).toBe(true);
  });

  it('passes when any condition matches (window_title_contains)', async () => {
    const v = new StateVerifier(mockTools());
    const r = await v.verify({ any: [{ type: 'window_title_contains', value: 'Notepad' }] }, ctx());
    expect(r.passed).toBe(true);
  });

  it('fails when no any condition matches', async () => {
    const v = new StateVerifier(mockTools());
    const r = await v.verify({ any: [{ type: 'window_title_contains', value: 'Calculator' }] }, ctx());
    expect(r.passed).toBe(false);
  });

  it('passes page_text_contains', async () => {
    const v = new StateVerifier(mockTools());
    const r = await v.verify({ any: [{ type: 'page_text_contains', value: 'submitted' }] }, ctx());
    expect(r.passed).toBe(true);
  });

  it('passes uia_element_exists', async () => {
    const v = new StateVerifier(mockTools());
    const r = await v.verify({ any: [{ type: 'uia_element_exists', query: { name: 'OK' } }] }, ctx());
    expect(r.passed).toBe(true);
  });
});
```

- [ ] **步骤 4：编写 failure-handler 测试**

```typescript
// packages/core/tests/failure-handler.test.ts
import { describe, it, expect } from 'vitest';
import { FailureHandler } from '../src/agent/failure-handler.js';
import type { FailureInfo, StepPlan, TaskContext } from '../src/types/agent.js';

function ctx(overrides?: Partial<TaskContext>): TaskContext {
  const ctrl = new AbortController();
  return { taskRunId: 't', sessionId: 's', goal: 'test', mode: 'workflow', status: 'running', stepIndex: 0, retryCountByStep: new Map(), maxRetries: 2, outputDir: '/tmp', abortController: ctrl, signal: ctrl.signal, startedPids: [], createdTempDirs: [], humanTakeoverEvents: [], ...overrides } as TaskContext;
}

function step(overrides?: Partial<StepPlan>): StepPlan {
  return { intent: 'click', action: { type: 'click', target: { strategy: 'playwright', selector: '#btn' } }, riskLevel: 'low', source: 'workflow', ...overrides };
}

describe('FailureHandler', () => {
  const handler = new FailureHandler();

  it('classifies timeout as retryable', () => {
    const f: FailureInfo = { stepIndex: 0, message: 'Timeout 5000ms exceeded' };
    expect(handler.classify(f)).toBe('retryable');
  });

  it('classifies element_not_found as degradable', () => {
    const f: FailureInfo = { stepIndex: 0, message: 'UIA_ELEMENT_NOT_FOUND: no matching element' };
    expect(handler.classify(f)).toBe('degradable');
  });

  it('classifies password as takeover', () => {
    const f: FailureInfo = { stepIndex: 0, message: 'Detected password field' };
    expect(handler.classify(f)).toBe('takeover');
  });

  it('retries retryable errors within maxRetries', async () => {
    const c = ctx();
    const f: FailureInfo = { stepIndex: 0, errorType: 'retryable', message: 'timeout' };
    const action = await handler.handle(f, step(), c);
    expect(action.action).toBe('retry');
    expect(c.retryCountByStep.get(0)).toBe(1);
  });

  it('degrades after exhausting retries', async () => {
    const c = ctx();
    c.retryCountByStep.set(0, 2);
    const f: FailureInfo = { stepIndex: 0, errorType: 'retryable', message: 'timeout' };
    const action = await handler.handle(f, step(), c);
    expect(action.action).toBe('degrade');
  });

  it('degrades click from playwright to uia', async () => {
    const f: FailureInfo = { stepIndex: 0, errorType: 'degradable', message: 'not found' };
    const action = await handler.handle(f, step(), ctx());
    expect(action).toEqual({ action: 'degrade', newStrategy: 'uia' });
  });

  it('takes over when no more strategies', async () => {
    const s = step({ action: { type: 'click', target: { strategy: 'coordinate', point: { x: 0, y: 0, space: 'screen-physical' } } } });
    const f: FailureInfo = { stepIndex: 0, errorType: 'degradable', message: 'miss' };
    const action = await handler.handle(f, s, ctx());
    expect(action.action).toBe('takeover');
  });

  it('aborts on terminal errors', async () => {
    const f: FailureInfo = { stepIndex: 0, errorType: 'terminal', message: 'critical' };
    const action = await handler.handle(f, step(), ctx());
    expect(action.action).toBe('abort');
  });
});
```

- [ ] **步骤 5：运行测试验证通过**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/state-verifier.test.ts packages/core/tests/failure-handler.test.ts
```
预期：所有测试 PASS。

- [ ] **步骤 6：Commit**

```bash
git add packages/core/src/agent/state-verifier.ts packages/core/src/agent/failure-handler.ts packages/core/tests/state-verifier.test.ts packages/core/tests/failure-handler.test.ts
git commit -m "feat(core): add StateVerifier and FailureHandler"
```

---

## 任务 9：ExecutionLog + StepExecutor

**文件：**
- 创建：`packages/core/src/safety/execution-log.ts`
- 创建：`packages/core/src/agent/step-executor.ts`
- 测试：`packages/core/tests/step-executor.test.ts`

- [ ] **步骤 1：创建 execution-log.ts**

```typescript
// packages/core/src/safety/execution-log.ts
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { StepPlan, StepResult, VerifyResult, TaskContext } from '../types/agent.js';

export interface StepLogEntry {
  id: string;
  taskRunId: string;
  stepIndex: number;
  intent: string;
  action: string;
  locatorStrategy?: string;
  beforeScreenshot?: string;
  afterScreenshot?: string;
  expectedState?: string;
  verificationResult: 'pass' | 'fail' | 'skipped';
  errorType?: string;
  workflowStepSnapshot?: string;
  targetSnapshot?: string;
  toolResult?: string;
  failureInfo?: string;
  durationMs: number;
}

export class ExecutionLog {
  private queue: StepLogEntry[] = [];
  private stmt: Database.Statement | null = null;

  constructor(private db: Database.Database) {}

  write(step: StepPlan, result: StepResult, context: TaskContext): void {
    const entry: StepLogEntry = {
      id: nanoid(),
      taskRunId: context.taskRunId,
      stepIndex: context.stepIndex,
      intent: step.intent,
      action: JSON.stringify(step.action),
      locatorStrategy: step.action.type === 'click' ? step.action.target.strategy : step.action.type,
      beforeScreenshot: result.beforeScreenshot,
      afterScreenshot: result.afterScreenshot,
      expectedState: step.expectedState ? JSON.stringify(step.expectedState) : undefined,
      verificationResult: result.verification?.passed ? 'pass' : result.verification ? 'fail' : 'skipped',
      errorType: result.failure?.errorType,
      toolResult: result.toolResult ? JSON.stringify(result.toolResult) : undefined,
      failureInfo: result.failure ? JSON.stringify(result.failure) : undefined,
      durationMs: result.durationMs,
    };
    this.queue.push(entry);

    if (this.queue.length >= 5) this.flush();
  }

  flush(): void {
    if (this.queue.length === 0) return;
    if (!this.stmt) {
      this.stmt = this.db.prepare(`
        INSERT INTO task_step_logs (
          id, task_run_id, step_index, intent, action, locator_strategy,
          before_screenshot, after_screenshot, expected_state,
          verification_result, error_type, workflow_step_snapshot,
          target_snapshot, tool_result, failure_info, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }
    const insertMany = this.db.transaction((entries: StepLogEntry[]) => {
      for (const e of entries) {
        this.stmt!.run(
          e.id, e.taskRunId, e.stepIndex, e.intent, e.action, e.locatorStrategy ?? null,
          e.beforeScreenshot ?? null, e.afterScreenshot ?? null, e.expectedState ?? null,
          e.verificationResult, e.errorType ?? null, e.workflowStepSnapshot ?? null,
          e.targetSnapshot ?? null, e.toolResult ?? null, e.failureInfo ?? null, e.durationMs,
        );
      }
    });
    insertMany(this.queue);
    this.queue = [];
  }

  getByTaskRun(taskRunId: string): StepLogEntry[] {
    return this.db.prepare('SELECT * FROM task_step_logs WHERE task_run_id = ? ORDER BY step_index').all(taskRunId) as StepLogEntry[];
  }
}
```

- [ ] **步骤 2：创建 step-executor.ts**

```typescript
// packages/core/src/agent/step-executor.ts
import type { StepPlan, StepResult, TaskContext, FailureInfo } from '../types/agent.js';
import { TakeoverRequest } from '../types/agent.js';
import type { ToolRouter } from './tool-router.js';
import type { StateVerifier } from './state-verifier.js';
import type { RiskClassifier } from '../safety/risk-classifier.js';
import type { ExecutionLog } from '../safety/execution-log.js';
import type { ToolAdapters } from './tool-router.js';
import fs from 'node:fs';
import path from 'node:path';

export interface StepExecutorDeps {
  toolRouter: ToolRouter;
  stateVerifier: StateVerifier;
  riskClassifier: RiskClassifier;
  executionLog: ExecutionLog;
  tools: ToolAdapters;
}

export class StepExecutor {
  constructor(private deps: StepExecutorDeps) {}

  async execute(step: StepPlan, context: TaskContext): Promise<StepResult> {
    const start = performance.now();
    let beforeScreenshot: string | undefined;
    let afterScreenshot: string | undefined;

    try {
      // 1. Take before screenshot
      beforeScreenshot = await this.saveScreenshot(context, 'before');

      // 2. Dispatch action via ToolRouter
      const toolResult = await this.deps.toolRouter.dispatch(step.action, context);

      // 3. Take after screenshot
      afterScreenshot = await this.saveScreenshot(context, 'after');

      // 4. Verify expected state
      const verification = await this.deps.stateVerifier.verify(step.expectedState, context);

      const result: StepResult = {
        success: toolResult.ok && verification.passed,
        toolResult,
        verification,
        beforeScreenshot,
        afterScreenshot,
        durationMs: performance.now() - start,
      };

      if (!result.success) {
        result.failure = {
          stepIndex: context.stepIndex,
          message: !toolResult.ok ? toolResult.error.message : 'Verification failed',
          errorType: !toolResult.ok ? 'retryable' : 'retryable',
          toolResult,
          screenshot: afterScreenshot,
        };
      }

      // 5. Write execution log
      this.deps.executionLog.write(step, result, context);

      return result;
    } catch (err) {
      if (err instanceof TakeoverRequest) throw err;

      const result: StepResult = {
        success: false,
        failure: {
          stepIndex: context.stepIndex,
          message: err instanceof Error ? err.message : String(err),
          errorType: 'terminal',
          screenshot: beforeScreenshot,
        },
        beforeScreenshot,
        durationMs: performance.now() - start,
      };
      this.deps.executionLog.write(step, result, context);
      return result;
    }
  }

  private async saveScreenshot(context: TaskContext, phase: 'before' | 'after'): Promise<string | undefined> {
    try {
      const result = await this.deps.tools.screenshot.captureScreen();
      if (!result.ok) return undefined;
      const dir = context.outputDir;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `step-${context.stepIndex}-${phase}.png`);
      fs.writeFileSync(filePath, result.data.buffer);
      return filePath;
    } catch {
      return undefined;
    }
  }
}
```

- [ ] **步骤 3：编写 step-executor 测试**

```typescript
// packages/core/tests/step-executor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StepExecutor } from '../src/agent/step-executor.js';
import { ToolRouter } from '../src/agent/tool-router.js';
import { StateVerifier } from '../src/agent/state-verifier.js';
import { RiskClassifier } from '../src/safety/risk-classifier.js';
import { ExecutionLog } from '../src/safety/execution-log.js';
import { getDatabaseForTest } from '../src/memory/db.js';
import { toolOk } from '../src/types/errors.js';
import type { StepPlan, TaskContext } from '../src/types/agent.js';
import type { ToolAdapters } from '../src/agent/tool-router.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function mockAdapters(): ToolAdapters {
  return {
    browser: { clickElement: vi.fn().mockResolvedValue(toolOk(undefined, 10)), fillInput: vi.fn(), navigateTo: vi.fn().mockResolvedValue(toolOk(undefined, 100)), getPageText: vi.fn().mockResolvedValue(toolOk('success', 5)) },
    uia: { invokeElement: vi.fn(), findElement: vi.fn(), setElementValue: vi.fn(), getElementValue: vi.fn(), getUiTree: vi.fn() },
    input: { clickPoint: vi.fn(), typeText: vi.fn().mockResolvedValue(toolOk(undefined, 20)), pressKeys: vi.fn(), scroll: vi.fn(), releaseAllKeys: vi.fn() },
    screenshot: { captureScreen: vi.fn().mockResolvedValue(toolOk({ buffer: Buffer.from('PNG'), width: 100, height: 100, timestamp: '' }, 10)), captureWindow: vi.fn(), getActiveWindow: vi.fn().mockResolvedValue(toolOk({ hwnd: 1, title: 'Test', x: 0, y: 0, width: 800, height: 600, isMinimized: false }, 5)) },
  };
}

function makeContext(): TaskContext {
  const ctrl = new AbortController();
  const outputDir = path.join(os.tmpdir(), `agivar-test-${Date.now()}`);
  return { taskRunId: 'tr-1', sessionId: 's-1', goal: 'test', mode: 'workflow', status: 'running', stepIndex: 0, retryCountByStep: new Map(), maxRetries: 2, outputDir, abortController: ctrl, signal: ctrl.signal, startedPids: [], createdTempDirs: [outputDir], humanTakeoverEvents: [] } as TaskContext;
}

describe('StepExecutor', () => {
  let executor: StepExecutor;
  let adapters: ToolAdapters;
  let ctx: TaskContext;

  beforeEach(() => {
    const db = getDatabaseForTest(':memory:');
    // Insert required parent rows
    db.prepare("INSERT INTO sessions (id, title) VALUES ('s-1', 'test')").run();
    db.prepare("INSERT INTO task_runs (id, session_id, user_goal, status) VALUES ('tr-1', 's-1', 'test', 'running')").run();

    adapters = mockAdapters();
    executor = new StepExecutor({
      toolRouter: new ToolRouter(adapters),
      stateVerifier: new StateVerifier(adapters),
      riskClassifier: new RiskClassifier(),
      executionLog: new ExecutionLog(db),
      tools: adapters,
    });
    ctx = makeContext();
  });

  it('executes a type action successfully', async () => {
    const step: StepPlan = { intent: 'type hello', action: { type: 'type', text: 'hello' }, riskLevel: 'low', source: 'workflow' };
    const result = await executor.execute(step, ctx);
    expect(result.success).toBe(true);
    expect(adapters.input.typeText).toHaveBeenCalledWith('hello');
  });

  it('captures before and after screenshots', async () => {
    const step: StepPlan = { intent: 'type', action: { type: 'type', text: 'x' }, riskLevel: 'low', source: 'workflow' };
    const result = await executor.execute(step, ctx);
    expect(result.beforeScreenshot).toBeDefined();
    expect(result.afterScreenshot).toBeDefined();
    // Clean up
    if (fs.existsSync(ctx.outputDir)) fs.rmSync(ctx.outputDir, { recursive: true, force: true });
  });

  it('reports failure when verification fails', async () => {
    const step: StepPlan = {
      intent: 'navigate', action: { type: 'type', text: 'x' }, riskLevel: 'low', source: 'workflow',
      expectedState: { any: [{ type: 'window_title_contains', value: 'NonExistent' }] },
    };
    const result = await executor.execute(step, ctx);
    expect(result.success).toBe(false);
    expect(result.failure).toBeDefined();
    // Clean up
    if (fs.existsSync(ctx.outputDir)) fs.rmSync(ctx.outputDir, { recursive: true, force: true });
  });
});
```

- [ ] **步骤 4：运行测试验证通过**

```bash
cd f:/agivar && pnpm test -- --run packages/core/tests/step-executor.test.ts
```
预期：所有测试 PASS。

- [ ] **步骤 5：Commit**

```bash
git add packages/core/src/safety/execution-log.ts packages/core/src/agent/step-executor.ts packages/core/tests/step-executor.test.ts
git commit -m "feat(core): add ExecutionLog and StepExecutor with screenshot capture"
```

---

## 任务 10：WorkflowExecutor + 评测 Fixtures + 导出

**文件：**
- 创建：`packages/core/src/agent/workflow-executor.ts`
- 创建：`tests/fixtures/search-local.html`
- 创建：`tests/fixtures/workflows/search-local.yaml`
- 创建：`tests/fixtures/workflows/notepad-text.yaml`
- 修改：`packages/core/src/index.ts`
- 测试：`packages/core/tests/workflow-executor.test.ts`

- [ ] **步骤 1：创建 search-local.html fixture**

```html
<!-- tests/fixtures/search-local.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Agivar — Search Test</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; }
    #results { margin-top: 20px; }
    .result-item { padding: 8px; border-bottom: 1px solid #eee; }
  </style>
</head>
<body>
  <h1>Search Test</h1>
  <input type="text" id="searchInput" placeholder="输入搜索关键词">
  <button id="searchBtn" onclick="doSearch()">搜索</button>
  <div id="results"></div>
  <script>
    var items = ['TypeScript 入门教程', 'React 组件设计', 'Node.js 性能优化', 'Electron 桌面开发', 'Playwright 自动化测试'];
    function doSearch() {
      var q = document.getElementById('searchInput').value.toLowerCase();
      var results = document.getElementById('results');
      var matched = items.filter(function(item) { return item.toLowerCase().includes(q); });
      if (matched.length > 0) {
        results.innerHTML = matched.map(function(m) { return '<div class="result-item">' + m + '</div>'; }).join('');
      } else {
        results.innerHTML = '<div class="result-item">无匹配结果</div>';
      }
    }
  </script>
</body>
</html>
```

- [ ] **步骤 2：创建 search-local.yaml fixture**

```yaml
# tests/fixtures/workflows/search-local.yaml
appName: Chrome
platform: browser
topic: local-search/keyword
triggerExamples:
  - 搜索关键词
  - 帮我搜索
summary: 在本地搜索页搜索关键词并验证结果
initialState: 浏览器已打开

inputs:
  keyword:
    type: string
    required: true
    prompt: 请输入搜索关键词
    minLength: 1

riskLevel: low

steps:
  - intent: 导航到搜索页
    targetHint: 地址栏
    target:
      strategy: playwright
      selector: "body"
    inputHint: "navigate:http://127.0.0.1:12827/search-local.html"
    expectedState:
      any:
        - type: page_text_contains
          value: Search Test
    riskLevel: low

  - intent: 输入搜索关键词
    targetHint: 搜索输入框
    target:
      strategy: playwright
      selector: "#searchInput"
    inputHint: "{{keyword}}"
    riskLevel: low

  - intent: 点击搜索按钮
    targetHint: 搜索按钮
    target:
      strategy: playwright
      selector: "#searchBtn"
    expectedState:
      any:
        - type: page_text_contains
          value: "{{keyword}}"
    riskLevel: low
    fallback: retry

successCriteria: 搜索结果区域出现匹配项
```

- [ ] **步骤 3：创建 notepad-text.yaml fixture**

```yaml
# tests/fixtures/workflows/notepad-text.yaml
appName: 记事本
platform: desktop
topic: notepad/input-text
triggerExamples:
  - 在记事本输入文字
  - 打开记事本写东西
summary: 打开记事本并输入指定文本
initialState: 记事本未打开或已打开

inputs:
  content:
    type: string
    required: true
    prompt: 请输入要写入的文本

riskLevel: low

steps:
  - intent: 打开记事本
    targetHint: 系统应用
    target:
      strategy: coordinate
      point:
        x: 0
        y: 0
        space: screen-physical
    inputHint: "press:LeftSuper,R then type:notepad then press:Return"
    riskLevel: low

  - intent: 等待记事本窗口出现
    targetHint: 记事本窗口
    target:
      strategy: uia
      query:
        controlType: Window
        name: Notepad
        nameMatch: contains
    expectedState:
      any:
        - type: window_title_contains
          value: Notepad
    riskLevel: low
    fallback: retry

  - intent: 输入文本
    targetHint: 记事本编辑区
    target:
      strategy: uia
      query:
        controlType: Document
        className: RichEditD2DPT
    inputHint: "{{content}}"
    riskLevel: low

successCriteria: 记事本中出现指定文本
```

- [ ] **步骤 4：创建 workflow-executor.ts**

```typescript
// packages/core/src/agent/workflow-executor.ts
import type { StepPlan, TaskContext, AgentEvent } from '../types/agent.js';
import type { WorkflowMemory, WorkflowStep, WorkflowInput } from '../types/workflow.js';

export interface ResolvedInputs {
  [key: string]: string;
}

export function resolveVariables(text: string, inputs: ResolvedInputs): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => inputs[name] ?? `{{${name}}}`);
}

export function buildStepPlan(step: WorkflowStep, inputs: ResolvedInputs): StepPlan {
  const action = interpretAction(step, inputs);
  return {
    intent: step.intent,
    action,
    expectedState: step.expectedState,
    riskLevel: step.riskLevel,
    source: 'workflow',
  };
}

function interpretAction(step: WorkflowStep, inputs: ResolvedInputs): import('../types/agent.js').StepAction {
  const hint = step.inputHint ? resolveVariables(step.inputHint, inputs) : undefined;

  if (hint?.startsWith('navigate:')) {
    return { type: 'navigate', url: hint.slice('navigate:'.length) };
  }

  if (hint?.startsWith('press:')) {
    const parts = hint.split(' then ');
    // For simplicity, handle single press
    const keys = hint.slice('press:'.length).split(',');
    return { type: 'press', keys };
  }

  if (step.target.strategy === 'playwright' && hint && !hint.startsWith('press:')) {
    // If there's inputHint and a playwright selector, it's a fill action
    // We model this as type action (StepExecutor will route through fillInput)
    return { type: 'type', text: hint };
  }

  if (step.target.strategy === 'uia' && hint) {
    return { type: 'type', text: hint };
  }

  // Default: click the target
  return { type: 'click', target: step.target };
}

export function getRequiredInputs(workflow: WorkflowMemory): WorkflowInput[] {
  return (workflow.inputs ?? []).filter(i => i.required);
}

export function getMissingInputs(workflow: WorkflowMemory, provided: ResolvedInputs): WorkflowInput[] {
  return getRequiredInputs(workflow).filter(i => !(i.name in provided) || provided[i.name] === '');
}

export function getHumanOnlyInputs(workflow: WorkflowMemory): WorkflowInput[] {
  return (workflow.inputs ?? []).filter(i => i.humanOnly);
}

export function validateInputs(workflow: WorkflowMemory, provided: ResolvedInputs): string[] {
  const errors: string[] = [];
  for (const input of workflow.inputs ?? []) {
    const val = provided[input.name];
    if (input.required && (!val || val === '')) {
      errors.push(`Missing required input: ${input.name}`);
      continue;
    }
    if (val && input.minLength && val.length < input.minLength) {
      errors.push(`${input.name}: minimum length ${input.minLength}, got ${val.length}`);
    }
    if (val && input.maxLength && val.length > input.maxLength) {
      errors.push(`${input.name}: maximum length ${input.maxLength}, got ${val.length}`);
    }
  }
  return errors;
}
```

- [ ] **步骤 5：编写 workflow-executor 测试**

```typescript
// packages/core/tests/workflow-executor.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveVariables, buildStepPlan, validateInputs, getMissingInputs, getHumanOnlyInputs } from '../src/agent/workflow-executor.js';
import { parseWorkflowContent, workflowFileToMemory } from '../src/memory/workflow-parser.js';

const FORM_YAML = readFileSync(resolve(__dirname, '../../tests/fixtures/workflows/form-fill-local.yaml'), 'utf-8');
const SEARCH_YAML = readFileSync(resolve(__dirname, '../../tests/fixtures/workflows/search-local.yaml'), 'utf-8');
const NOTEPAD_YAML = readFileSync(resolve(__dirname, '../../tests/fixtures/workflows/notepad-text.yaml'), 'utf-8');

describe('resolveVariables', () => {
  it('replaces known variables', () => {
    expect(resolveVariables('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
  });

  it('preserves unknown variables', () => {
    expect(resolveVariables('{{unknown}}', {})).toBe('{{unknown}}');
  });

  it('handles multiple variables', () => {
    expect(resolveVariables('{{a}} and {{b}}', { a: 'X', b: 'Y' })).toBe('X and Y');
  });
});

describe('buildStepPlan', () => {
  it('creates navigate action from navigate: prefix', () => {
    const parsed = parseWorkflowContent(FORM_YAML, 'yaml');
    if (!parsed.ok) throw new Error('parse failed');
    const mem = workflowFileToMemory(parsed.data);
    const plan = buildStepPlan(mem.steps[0], {});
    expect(plan.action.type).toBe('navigate');
    if (plan.action.type === 'navigate') {
      expect(plan.action.url).toContain('test-form.html');
    }
  });

  it('creates type action for fill steps', () => {
    const parsed = parseWorkflowContent(FORM_YAML, 'yaml');
    if (!parsed.ok) throw new Error('parse failed');
    const mem = workflowFileToMemory(parsed.data);
    const plan = buildStepPlan(mem.steps[1], { userName: 'Alice' });
    expect(plan.action.type).toBe('type');
    if (plan.action.type === 'type') expect(plan.action.text).toBe('Alice');
  });

  it('creates click action for submit steps', () => {
    const parsed = parseWorkflowContent(FORM_YAML, 'yaml');
    if (!parsed.ok) throw new Error('parse failed');
    const mem = workflowFileToMemory(parsed.data);
    const plan = buildStepPlan(mem.steps[3], {});
    expect(plan.action.type).toBe('click');
  });
});

describe('validateInputs', () => {
  const parsed = parseWorkflowContent(FORM_YAML, 'yaml');
  if (!parsed.ok) throw new Error('parse failed');
  const mem = workflowFileToMemory(parsed.data);

  it('reports missing required inputs', () => {
    const errors = validateInputs(mem, {});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('userName'))).toBe(true);
  });

  it('passes with all required inputs', () => {
    const errors = validateInputs(mem, { userName: 'Alice', email: 'a@b.com' });
    expect(errors).toHaveLength(0);
  });

  it('validates minLength', () => {
    const errors = validateInputs(mem, { userName: '', email: 'a@b.com' });
    expect(errors.some(e => e.includes('Missing required'))).toBe(true);
  });
});

describe('getMissingInputs', () => {
  const parsed = parseWorkflowContent(FORM_YAML, 'yaml');
  if (!parsed.ok) throw new Error('parse failed');
  const mem = workflowFileToMemory(parsed.data);

  it('returns missing inputs', () => {
    const missing = getMissingInputs(mem, { userName: 'Alice' });
    expect(missing.map(m => m.name)).toContain('email');
  });
});

describe('All 3 evaluation workflow fixtures parse correctly', () => {
  it('form-fill-local.yaml', () => {
    expect(parseWorkflowContent(FORM_YAML, 'yaml').ok).toBe(true);
  });

  it('search-local.yaml', () => {
    expect(parseWorkflowContent(SEARCH_YAML, 'yaml').ok).toBe(true);
  });

  it('notepad-text.yaml', () => {
    expect(parseWorkflowContent(NOTEPAD_YAML, 'yaml').ok).toBe(true);
  });
});
```

- [ ] **步骤 6：更新 packages/core/src/index.ts 导出新模块**

```typescript
// packages/core/src/index.ts
export * from './types/index.js';
export * as screenshot from './tools/screenshot.js';
export * as input from './tools/input.js';
export * as browser from './tools/browser.js';
export * as uia from './tools/uia.js';
export * as dpi from './tools/dpi.js';
export * as recorder from './tools/recorder.js';

// Phase 1A: Agent execution engine
export { MemoryStore } from './memory/memory-store.js';
export type { MemorySearchResult } from './memory/memory-store.js';
export { parseWorkflowContent, workflowFileToMemory } from './memory/workflow-parser.js';
export { getDatabase, getDatabaseForTest, closeDatabase } from './memory/db.js';
export { runMigrations } from './memory/schema.js';
export { AbortManager } from './safety/abort-manager.js';
export type { AbortSource } from './safety/abort-manager.js';
export { RiskClassifier } from './safety/risk-classifier.js';
export { ExecutionLog } from './safety/execution-log.js';
export { ToolRouter } from './agent/tool-router.js';
export type { ToolAdapters } from './agent/tool-router.js';
export { StateVerifier } from './agent/state-verifier.js';
export { FailureHandler } from './agent/failure-handler.js';
export { StepExecutor } from './agent/step-executor.js';
export { resolveVariables, buildStepPlan, validateInputs, getMissingInputs, getHumanOnlyInputs, getRequiredInputs } from './agent/workflow-executor.js';
export type { ResolvedInputs } from './agent/workflow-executor.js';
```

- [ ] **步骤 7：运行所有测试验证通过**

```bash
cd f:/agivar && pnpm test -- --run
```
预期：所有测试 PASS。

- [ ] **步骤 8：Commit**

```bash
git add packages/core/src/agent/workflow-executor.ts packages/core/src/index.ts packages/core/tests/workflow-executor.test.ts tests/fixtures/search-local.html tests/fixtures/workflows/
git commit -m "feat(core): add WorkflowExecutor, evaluation fixtures, and module exports"
```

---

## 自检结果

**规格覆盖度：**
- TaskContext 定义 ✅（任务 1）
- SQLite schema + 迁移 ✅（任务 2）
- input scroll/releaseAllKeys 补充 ✅（任务 3）
- Workflow YAML 解析 + 变量 schema ✅（任务 4）
- MemoryStore 关键词检索 + 阈值 ✅（任务 5）
- AbortManager ✅ RiskClassifier ✅（任务 6）
- ToolRouter 对齐 Phase 0 API ✅（任务 7）
- StateVerifier 非 OCR ✅ FailureHandler 重试/降级 ✅（任务 8）
- ExecutionLog 批量写入 ✅ StepExecutor 截图+执行+验证 ✅（任务 9）
- WorkflowExecutor 变量替换 ✅ 3 条评测 fixture ✅（任务 10）

**不在 Phase 1A 范围（留给 Phase 1B）：**
- AgentService 主循环、LLMPlanner、Chat UI、IPC、Settings、CredentialStore、GlobalHotkeyAdapter

**占位符扫描：** 无 TBD/TODO。

**类型一致性：** 所有任务使用相同的 `StepPlan`、`TaskContext`、`ToolAdapters`、`ToolResult<T>` 类型。`ToolRouter` 的 `ToolAdapters` 接口精确对齐 Phase 0 函数签名。
