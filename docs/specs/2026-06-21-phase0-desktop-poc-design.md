# 阶段 0：桌面控制 PoC — 技术设计文档

> 日期：2026-06-21
> 状态：实施级规格（已整合四轮评审，可进入实现准备）
> 关联：[落地方案.md](../../落地方案.md) 阶段 0

---

## 1. 目标

验证 Windows 桌面控制链路的技术可行性，确认核心技术无阻塞。阶段 0 的代码直接成为阶段 1 的项目骨架（Electron-first 策略），不需要二次迁移。

### 验证项

| # | 验证项 | 验收标准 | 量化指标 |
|---|---|---|---|
| 1 | 屏幕截取 | 主屏和活动窗口均可稳定截取，窗口标题正确 | 连续 30 次成功率 ≥ 95%；平均耗时 < 200ms；图片尺寸与屏幕分辨率一致 |
| 2 | UIA 控件读取 | 能识别记事本编辑区和 Chrome 顶层窗口，能读写控件值 | 记事本编辑区命中率 100%；Chrome/Edge 顶层窗口识别成功率 100%；Chrome 页面内部 DOM 不通过 UIA 验证（由 Playwright 负责）；遍历耗时 < 2s；ValuePattern 读写成功 |
| 3 | 鼠标键盘执行 | 能自动打开记事本 → 输入文本 → UIA 验证文本正确 | 连续 10 次输入成功率 ≥ 90%；焦点窗口验证通过 |
| 4 | Playwright 浏览器 | 能打开本地测试页并完成表单填写 | 表单填写成功率 ≥ 95%；平均耗时 < 5s；失败原因可分类 |
| 5 | DPI 坐标映射 | 100%/125%/150% 缩放下点击准确 | 点击偏差 < 5px（物理像素） |
| 6 | 录屏技术验证 | 对比 DXGI 和 WGC 的稳定性、权限、性能 | 帧率 ≥ 5fps；丢帧率 < 10%；CPU 占用 < 15%；输出文件大小合理；连续 start/stop 5 次无泄漏；stop 后 session map 清空；`forceStopAllRecordings()` 可清理异常残留 |

所有验证结果统一写入 `tests/output/<timestamp>/poc-report.json`，便于后续回归。`tests/output/latest.json` 保存最近一次运行的摘要和实际 timestamp 目录路径（Windows 上不使用 symlink）。

### 推荐测试目标应用

| 应用 | 用途 |
|---|---|
| 记事本 | UIA 控件读写、键盘输入、文本验证 |
| Chrome 或 Edge | 浏览器窗口识别、Playwright 表单验证 |
| 文件资源管理器 | 活动窗口识别、基础 UIA 遍历 |
| 本地 HTML 测试页 | Playwright 稳定验证（不依赖外网） |

不依赖外网页面作为唯一浏览器验证目标。

### 额外验收

Electron 环境中加载 native addon 成功，6 个验证项均可通过 Electron UI 面板触发运行。

### Native Addon ABI 验收门槛（Day 1 硬门槛）

native addon 必须在以下三个环境中均加载成功，否则不进入后续 PoC：

1. `@agivar/native` 在普通 Node.js 中加载成功。
2. `@agivar/native` 在 Electron 主进程中加载成功。
3. `@agivar/native` 在 packaged 或模拟 packaged 环境中加载路径正确。

失败时输出诊断信息：Node ABI 版本、Electron 版本、platform、arch、module path。

验证脚本：

```bash
pnpm native:doctor          # Node.js 环境加载验证
pnpm desktop:doctor-native   # Electron 环境加载验证
pnpm desktop:package:dir     # packaged 环境验证（electron-builder --dir）
```

Packaged 验证要求：

- 使用 `electron-builder --dir` 生成目录包（不生成安装程序，加速验证）。
- `.node` 文件不被打进 `asar` 内，位于 `asarUnpack` 或等效 unpack 路径。
- Packaged 主进程能成功加载 native addon 并调用至少一个函数。
- 报告记录 packaged module path。
- 此项容易到打包阶段才暴雷，Phase 0 必须提前验证。

---

## 2. 架构决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 项目策略 | Electron-first，非独立脚本验证 | 阶段 0 代码直接成为阶段 1 骨架 |
| Monorepo | pnpm workspaces + Turborepo | Node 生态标配，构建管线自动解析依赖 |
| 键鼠控制 | `@nut-tree/nut-js` (npm) | 成熟、TypeScript 原生、跨平台、UI-TARS-Desktop 同选型 |
| 截屏 | `node-screenshots` (npm, 基于 Rust xcap napi-rs 绑定) | 跨平台、性能好、同为 napi-rs 技术栈一致 |
| Windows UIA | Rust napi-rs + `uiautomation` crate | Node 生态无成熟 UIA 包，Rust `uiautomation` crate 成熟（193 stars，持续更新） |
| 浏览器控制 | Playwright | 浏览器自动化最优解 |
| 录屏 | Rust `windows-capture` (WGC) + `win_desktop_duplication` (DXGI) 对比 | 阶段 0 同时实现两种，输出对比报告后选一 |
| 视频编码 | FFmpeg CLI 或 `ffmpeg-next` crate | 成熟稳定 |
| DPI | nut.js 内置 + Windows API 补充 | nut.js 已处理部分 DPI 场景 |

---

## 3. 技术栈

### 核心依赖

| 层级 | 技术 | 版本要求 |
|---|---|---|
| 桌面框架 | Electron | >= 33 |
| 前端 | React + TypeScript | React 19, TS 5.x |
| 构建 | Vite (electron-vite) | >= 6 |
| 包管理 | pnpm | >= 9 |
| Monorepo | Turborepo | ^2 |
| 运行时 | Node.js | >= 20 LTS |
| Native 语言 | Rust (stable) | >= 1.80 |
| Native 绑定 | napi-rs | v3 |
| 状态管理 | Zustand | ^5 |

### npm 依赖

| 包 | 用途 |
|---|---|
| `@nut-tree/nut-js` | 鼠标、键盘控制 |
| `node-screenshots` | 截屏（基于 Rust xcap 的 napi-rs 绑定，跨平台，性能优于 screenshot-desktop） |
| `playwright` | 浏览器自动化 |

### Rust crate 依赖

| crate | 用途 |
|---|---|
| `napi` + `napi-derive` | Node.js native addon 框架 |
| `uiautomation` | Windows UI Automation 封装 |
| `windows-capture` | Windows Graphics Capture (WGC) 录屏 |
| `win_desktop_duplication` | DXGI Desktop Duplication 录屏 |
| `image` | PNG 编码 |
| `ffmpeg-next` 或 FFmpeg CLI | 视频编码 |

### 构建环境

| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | >= 20 LTS | 运行时 |
| pnpm | >= 9 | 包管理 |
| Rust | stable >= 1.80 | native 模块编译 |
| Visual Studio Build Tools | 2022 | MSVC 工具链 |

---

## 4. Monorepo 结构

```
agivar/
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── packages/
│   ├── desktop/                  # Electron 主应用
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── index.ts     # app 入口
│   │   │   │   ├── ipc.ts       # IPC handler 注册
│   │   │   │   └── windows.ts   # 窗口管理
│   │   │   ├── renderer/
│   │   │   │   ├── App.tsx      # 验证结果面板
│   │   │   │   └── main.tsx     # React 入口
│   │   │   └── preload.ts       # contextBridge
│   │   ├── electron-builder.yml
│   │   └── package.json
│   │
│   ├── core/                    # Agent 核心逻辑（纯 Node，不依赖 Electron）
│   │   ├── src/
│   │   │   ├── tools/
│   │   │   │   ├── screenshot.ts
│   │   │   │   ├── uia.ts
│   │   │   │   ├── input.ts
│   │   │   │   ├── browser.ts
│   │   │   │   ├── recorder.ts
│   │   │   │   └── dpi.ts
│   │   │   ├── types/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── native/                  # Rust napi-rs native addon
│       ├── src/
│       │   ├── lib.rs
│       │   ├── uia.rs          # Windows UI Automation
│       │   ├── recorder.rs     # 录屏 (WGC + DXGI)
│       │   └── dpi.rs          # DPI 补充（如 nut.js 不足时）
│       ├── Cargo.toml
│       ├── build.rs
│       └── package.json
│
├── tests/                       # 阶段 0 验证脚本
│   ├── poc-runner.ts            # 统一 runner（环境检查→执行→汇总→清理）
│   ├── poc-env.ts               # 环境探测（Windows/Node/Rust/FFmpeg/DPI/显示器/权限）
│   ├── poc-screenshot.ts
│   ├── poc-uia.ts
│   ├── poc-input.ts
│   ├── poc-playwright.ts
│   ├── poc-dpi.ts
│   ├── poc-recorder.ts
│   ├── fixtures/
│   │   └── test-form.html       # Playwright 本地测试页
│   └── output/                  # 验证结果输出目录
│
└── docs/
```

### 依赖关系

```
desktop (Electron 壳)
  └── core (TypeScript 工具层)
        ├── native (Rust napi-rs)  — UIA / 录屏 / DPI
        ├── @nut-tree/nut-js      — 键鼠控制
        ├── node-screenshots       — 截屏
        └── playwright             — 浏览器
```

---

## 5. Rust Native 模块 API

native 包只封装 Node 生态没有现成库的能力：UIA 控件树读取和录屏。

### UIA 模块 (uia.rs)

```rust
// 基于 uiautomation crate 封装
// Rust 侧同步支持 UiaOptions 中的 timeoutMs / maxDepth / maxNodes / includeOffscreen
#[napi]
fn get_ui_tree(hwnd: i64, options: Option<UiaOptions>) -> Result<UiaNode>

#[napi]
fn find_element(hwnd: i64, query: ElementQuery, options: Option<UiaOptions>) -> Result<Option<UiaElement>>

// 不使用持久 element_id——UIA 元素引用跨调用不可靠
// 每次通过 hwnd + query 重新查找元素
#[napi]
fn get_element_value(hwnd: i64, query: ElementQuery) -> Result<String>

#[napi]
fn set_element_value(hwnd: i64, query: ElementQuery, value: String) -> Result<()>

#[napi]
fn invoke_element(hwnd: i64, query: ElementQuery) -> Result<()>
```

ElementQuery 匹配方式：`automationId / controlType / name / className` 的组合。阶段 1 再考虑元素缓存和失效检测。

```typescript
interface ElementQuery {
  automationId?: string;
  name?: string;
  controlType?: string;
  className?: string;
  nameMatch?: 'exact' | 'contains' | 'regex';  // 默认 exact
  maxDepth?: number;    // 默认 8
  maxNodes?: number;    // 默认 1000
  index?: number;
  includeOffscreen?: boolean;  // 默认 false
}
```

#### UIA 线程模型与超时

UIA 基于 COM，调用可能因目标应用无响应而阻塞。设计要求：

- UIA 在独立 worker 线程中运行，不阻塞 Electron 主进程或 Node 主线程。
- 每次 UIA 调用必须有 timeout，Phase 0 默认 2 秒。
- 超时返回结构化错误（`UIA_TIMEOUT`），不挂死调用方。
- `getUiTree` 同时受 `maxDepth` 和 `maxNodes` 双限制。
- 遍历时记录 `isOffscreen` 节点数量。
- Phase 0 验收必须包含"目标应用无响应时 UIA 不挂死"的测试。

#### COM timeout 恢复边界

线程级 timeout 不一定能真正取消底层 COM 调用（COM 可能在内核等待）。Phase 0 的策略：

- 优先保证 UIA 卡死不阻塞 Electron 主进程（worker 线程隔离已保证）。
- 如果 worker 超时后无法恢复（COM 调用仍然阻塞），记录为需要进程级隔离的风险项。
- 若同一 worker 连续超时 3 次，重启 worker 线程或标记 UIA backend 为不可靠（`UIA_BACKEND_UNRELIABLE`）。
- 不要误以为 timeout 一定能中断 COM 调用——这是阶段 1 进程隔离设计的输入。

```typescript
interface UiaOptions {
  timeoutMs?: number;      // 默认 2000
  maxDepth?: number;       // 默认 8
  maxNodes?: number;       // 默认 1000
  includeOffscreen?: boolean;  // 默认 false
}
```

Phase 0 最小 Pattern 验证：

| Pattern | 验证内容 |
|---|---|
| `ValuePattern` | 读取和设置记事本编辑区文本 |
| `InvokePattern` | 点击按钮 |
| `SelectionPattern` | 读取选中项（能做则做） |

验收标准：找到记事本编辑区 → 读取文本 → 通过 UIA 设置文本，如无法设置则降级到键盘输入。

UiaNode 结构：

```typescript
interface UiaNode {
  name: string;
  controlType: string;       // "Button" | "Edit" | "Text" | ...
  automationId: string;
  className: string;
  boundingRect: { x: number; y: number; w: number; h: number };
  isEnabled: boolean;
  isOffscreen: boolean;
  value?: string;
  children: UiaNode[];
}
```

### 录屏模块 (recorder.rs)

```rust
// 基于 windows-capture (WGC) 和 win_desktop_duplication (DXGI)
// 使用 sessionId + 内部 map 管理 recorder，避免跨 napi/Node 传递 Rust handle
#[napi]
fn start_recording_wgc(config: RecordConfig) -> Result<String>  // 返回 sessionId

#[napi]
fn start_recording_dxgi(config: RecordConfig) -> Result<String>  // 返回 sessionId

#[napi]
fn stop_recording(session_id: String) -> Result<RecordResult>

#[napi]
fn get_recording_status(session_id: String) -> Result<RecordingStatus>

#[napi]
fn force_stop_all_recordings() -> Result<()>
```

---

## 6. Core 工具层 API

### 坐标类型约定

桌面自动化中最常见的事故是坐标空间混用。Phase 0 定义统一坐标类型，所有 API 文档标注坐标空间：

```typescript
type CoordinateSpace =
  | 'screen-logical'     // Windows 逻辑坐标（DPI 缩放后）
  | 'screen-physical'    // 物理像素坐标
  | 'window-logical'     // 窗口客户区逻辑坐标
  | 'image-pixel';       // 截图图片像素坐标

interface Point {
  x: number;
  y: number;
  space: CoordinateSpace;
}

interface Rect {
  x: number; y: number; width: number; height: number;
  space: CoordinateSpace;
}
```

API 坐标空间约定：

| API | 坐标空间 |
|---|---|
| `click(x, y)`（内部） | `screen-physical` |
| `clickPoint(point)` | 由 `point.space` 显式指定 |
| `UiaNode.boundingRect` | `screen-logical`（UIA 返回逻辑坐标） |
| `captureScreen` 像素坐标 | `image-pixel` |
| `toPhysicalCoords` 输入 | `screen-logical` |
| `toPhysicalCoords` 输出 | `screen-physical` |

Phase 0 不要求所有 API 参数都换成 `Point` 类型，但必须在每个 API 文档中标注坐标空间，避免阶段 1 坐标混用。

### screenshot.ts

```typescript
export async function captureScreen(monitorIndex?: number): Promise<ScreenshotResult>
export async function captureWindow(hwnd: number): Promise<ScreenshotResult>
export async function getActiveWindow(): Promise<WindowInfo>
export async function listWindows(): Promise<WindowInfo[]>
export async function saveScreenshot(path: string, target?: 'screen' | number): Promise<string>
```

`captureWindow(hwnd)` 边界说明：

- `node-screenshots` 可能不支持按 hwnd 直接截取，需验证是否需要从全屏截图裁剪窗口区域。
- Phase 0 必须记录：窗口是否被遮挡、是否最小化、是否在负坐标屏幕、当前 DPI 缩放。
- 验收时区分"真实窗口捕获"和"屏幕裁剪窗口区域"。
- 以上边界问题 Phase 0 记录现象即可，不要求全部解决。

### uia.ts

```typescript
export async function getUiTree(hwnd: number, options?: UiaOptions): Promise<UiaNode>
export async function findElement(hwnd: number, query: ElementQuery, options?: UiaOptions): Promise<UiaElement | null>
export async function getElementValue(hwnd: number, query: ElementQuery): Promise<string>
export async function setElementValue(hwnd: number, query: ElementQuery, value: string): Promise<void>
export async function invokeElement(hwnd: number, query: ElementQuery): Promise<void>
export async function dumpUiTree(hwnd: number, options?: UiaOptions): Promise<string>
```

### input.ts

```typescript
// 基于 @nut-tree/nut-js 封装
// click(x, y) 仅作为内部封装，使用 screen-physical 坐标
// 暴露给 Agent 工具层的入口为 clickPoint，强制携带坐标空间信息
export async function ensureActiveWindow(hwnd: number): Promise<boolean>
export async function clickPoint(point: Point, options?: ClickOptions): Promise<void>
export async function click(x: number, y: number, options?: ClickOptions): Promise<void>  // 内部使用，screen-physical
export async function moveMouse(x: number, y: number): Promise<void>
export async function scroll(x: number, y: number, delta: number): Promise<void>
export async function typeText(text: string): Promise<void>
export async function pressKeys(keys: string[]): Promise<void>
export async function clickAndType(target: Point, text: string): Promise<void>
```

每次输入操作前自动检查活动窗口是否为预期目标，避免文本输入到错误窗口。

### browser.ts

```typescript
// 基于 Playwright 封装——托管浏览器策略
export async function launchManagedBrowser(options?: {
  headless?: boolean;
  channel?: 'chrome' | 'msedge' | 'chromium';
  userDataDir?: string;       // 默认临时目录
  cleanupOnClose?: boolean;   // 默认 true
}): Promise<BrowserSession>
export async function navigateTo(page: Page, url: string): Promise<void>
export async function clickElement(page: Page, selector: string): Promise<void>
export async function fillInput(page: Page, selector: string, value: string): Promise<void>
export async function getPageText(page: Page): Promise<string>
```

`BrowserSession` 返回值包含：

```typescript
interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  userDataDir: string;
  isManaged: true;
  cleanupOnClose: boolean;
  serverUrl: string;  // 本地测试页地址，如 http://127.0.0.1:<port>
}
```

Phase 0 需提供本地 HTML 测试页（`tests/fixtures/test-form.html`），包含：label/input、button、select、checkbox、textarea、动态加载区域、提交成功消息。用于稳定验证 Playwright role/label/text 定位、动态等待和状态验证，不依赖外网。

Playwright 托管浏览器策略：

- 默认使用 Playwright 托管的独立浏览器上下文，不连接用户主浏览器。
- 使用临时 user data dir，测试结束后清理。
- 本地测试页通过本地 HTTP server（`http://127.0.0.1:<port>/test-form.html`）提供，不使用 `file://` 协议（避免绕过浏览器安全行为）。
- Phase 0 不处理用户登录态复用，阶段 1 再设计。

### recorder.ts

```typescript
export type RecorderBackend = 'dxgi' | 'wgc';

export async function startRecording(config: {
  backend: RecorderBackend;
  targetHwnd?: number;
  fps?: number;            // 默认 5
  outputDir: string;
}): Promise<{ sessionId: string }>

export async function stopRecording(sessionId: string): Promise<RecordResult>
export async function getRecordingStatus(sessionId: string): Promise<RecordingStatus>
export async function forceStopAllRecordings(): Promise<void>
```

### dpi.ts

```typescript
export async function getScaleFactor(monitorIndex?: number): Promise<number>
export function logicalToPhysical(x: number, y: number, scale: number): { x: number; y: number }
export function physicalToLogical(x: number, y: number, scale: number): { x: number; y: number }
export async function toPhysicalCoords(logicalX: number, logicalY: number): Promise<{ x: number; y: number }>
```

---

## 7. 验证脚本

每个脚本独立可运行，输出结果到 `tests/output/`。

| 脚本 | 验证内容 | 核心步骤 |
|---|---|---|
| `poc-screenshot.ts` | 截屏 | captureScreen → 保存 PNG；getActiveWindow → 打印标题；captureWindow → 保存窗口截图 |
| `poc-uia.ts` | UIA 控件读写 | 启动记事本 → getUiTree → 打印控件树 → findElement 找到 Edit 控件 → ValuePattern 读写文本；对 Chrome 重复窗口级识别 |
| `poc-input.ts` | 键鼠执行 | 启动记事本 → ensureActiveWindow → typeText → UIA 验证文本正确（不测试 Ctrl+S 保存，避免保存对话框卡住） |
| `poc-playwright.ts` | 浏览器 | launchBrowser → 打开本地测试页 → fillInput × 3 → clickElement 提交 → 验证成功消息 |
| `poc-dpi.ts` | DPI 映射 | getScaleFactor → 坐标互转验证 → click 验证落点 |
| `poc-recorder.ts` | 录屏对比 | 分两阶段验证（见下方） |

录屏验证分两层，便于定位失败原因：

1. **帧捕获验证**：WGC / DXGI 各捕获 5 秒，不编码视频，输出抽样 PNG 帧，记录帧数/间隔/丢帧/CPU/内存。
2. **编码验证**：使用已捕获帧编码为 MP4，比较 FFmpeg CLI 和 `ffmpeg-next` crate 的复杂度。编码失败不影响捕获路线判断。

录屏对比维度：

| 维度 | 说明 |
|---|---|
| 窗口级捕获 | 能否只录目标窗口 |
| 窗口遮挡 | 目标窗口被遮挡时结果如何 |
| 最小化窗口 | 最小化后是否可捕获 |
| 多屏 | 副屏、负坐标是否正常 |
| DPI | 125% / 150% 缩放是否正常 |
| 性能 | CPU / GPU 占用 |
| 文件大小 | 同等时长输出大小 |
| 权限体验 | 是否需要额外权限或弹窗 |
| 自身浮窗排除 | 是否能排除录制控制条 |

录屏资源释放硬验收：

- 连续 start / stop 5 次，每次 stop 后文件句柄释放、session map 清空。
- `forceStopAllRecordings()` 可清理异常残留。
- 录屏失败不导致 Electron 进程退出。

运行方式：

```bash
npx tsx tests/poc-env.ts              # 环境探测（必须先运行）
npx tsx tests/poc-screenshot.ts       # 只读 PoC，可直接运行
pnpm poc:readonly                     # 运行所有只读 PoC
pnpm poc:interactive -- --i-understand-this-controls-my-desktop   # 包含键鼠操作的 PoC
pnpm poc:all -- --i-understand-this-controls-my-desktop           # 全部
pnpm poc:clean                        # 清理历史产物
```

`poc-runner.ts` 统一 runner 职责：

- 先运行 `poc-env.ts`，根据环境决定哪些 PoC 跳过（如无 150% DPI 显示器）。
- 统一创建 timestamp 输出目录。
- 汇总所有结果到 `poc-report.json`。
- 支持 `skipped` 状态：`{ "status": "skipped", "reason": "No 150% DPI monitor available" }`。
- 执行后清理测试启动的应用（按 PID 清理，不按进程名粗暴关闭）。

每个 PoC 脚本必须有 cleanup：关闭由测试启动的记事本（PID）、关闭 Playwright 浏览器、停止所有录屏 session、清理临时文件。不关闭用户原本打开的同名应用。

安全保护：

- 不带 `--i-understand-this-controls-my-desktop` 参数时，只允许运行只读 PoC（截图、UIA 读取）。
- 运行前倒计时 3 秒，显示即将控制桌面。
- 显示当前活动窗口标题，避免误操作。
- 输出紧急停止说明（`Ctrl+Alt+Space`）。

紧急停止硬验收（`poc-input.ts` 必须通过）：

1. 全局紧急停止热键在交互 PoC 中真实注册并可用。
2. 热键监听不依赖被阻塞的 renderer，在独立线程或进程中监听。
3. 每个交互动作之间检查 abort signal，abort 后停止后续动作。
4. 失败或中断后尽量恢复鼠标键盘状态（释放被按住的键）。
5. 报告中记录 `aborted: true`、停止时间和已完成的动作数。

---

## 8. Electron 最小壳

阶段 0 的 Electron 做两件事：

1. 验证 native addon 在 Electron 环境中正常加载
2. 提供验证结果面板

### UI

一个面板，6 行，每行：验证项名称 + 「运行」按钮 + 状态（待运行/运行中/通过/失败）+ 截图预览。纯功能验证，不做复杂样式。

按钮安全分级：

| 验证项 | UI 行为 |
|---|---|
| 环境探测 / 截图 / UIA 读取 | 直接运行 |
| Playwright | 直接运行，提示会启动浏览器 |
| 键鼠输入 | 二次确认 + 倒计时 + 紧急停止说明 |
| 录屏 | 二次确认 + 录制范围说明 + 倒计时 |

### IPC 设计

```typescript
// preload.ts
contextBridge.exposeInMainWorld('agivar', {
  screenshot: {
    captureScreen: () => ipcRenderer.invoke('screenshot:captureScreen'),
    captureWindow: (hwnd: number) => ipcRenderer.invoke('screenshot:captureWindow', hwnd),
    getActiveWindow: () => ipcRenderer.invoke('screenshot:getActiveWindow'),
  },
  uia: {
    getUiTree: (hwnd: number) => ipcRenderer.invoke('uia:getUiTree', hwnd),
    findElement: (hwnd: number, query: any) => ipcRenderer.invoke('uia:findElement', hwnd, query),
  },
  input: {
    click: (x: number, y: number) => ipcRenderer.invoke('input:click', x, y),
    typeText: (text: string) => ipcRenderer.invoke('input:typeText', text),
    pressKeys: (keys: string[]) => ipcRenderer.invoke('input:pressKeys', keys),
  },
  browser: { /* ... */ },
  recorder: { /* ... */ },
  dpi: { /* ... */ },
});
```

main process 的 ipc.ts 注册对应 handler，转发给 core 层。

### IPC 统一响应格式

所有 IPC handler 返回统一结构：

```typescript
type ToolResult<T> =
  | { ok: true; data: T; durationMs: number }
  | { ok: false; error: { code: string; message: string; details?: unknown }; durationMs: number };
```

### poc-report.json 格式

所有 PoC 统一输出到 `tests/output/<timestamp>/poc-report.json`：

```json
{
  "startedAt": "2026-06-21T09:30:00+08:00",
  "environment": {
    "os": "Windows 11",
    "node": "20.x",
    "electron": "33.x",
    "rust": "1.80.x",
    "dpiScale": 1.25,
    "monitors": 2
  },
  "results": [
    {
      "name": "poc-screenshot",
      "kind": "readonly",
      "status": "passed",
      "durationMs": 320,
      "metrics": {
        "successRate": 1.0,
        "avgCaptureMs": 42,
        "runs": 30
      },
      "artifacts": ["tests/output/screen.png"],
      "notes": []
    }
  ]
}
```

每条 `PocResult` 的 `kind` 字段标记为 `'readonly'`（截图、UIA 读取等无桌面操作）或 `'interactive'`（键鼠输入、录屏等真实桌面操作），便于在报告中一眼区分是否有真实桌面控制。

### 产物管理

- `tests/output/` 必须加入 `.gitignore`。
- 每次运行在 `tests/output/` 下创建 timestamp 子目录（如 `tests/output/20260621-093000/`）。
- `tests/output/latest.json` 指向最近一次运行的 timestamp 目录和报告摘要。
- 报告中只保留相对路径。
- 提供 `pnpm poc:clean` 清理历史产物。
- 默认不上传、不同步、不提交截图和录屏文件。

### 环境探测增强项

`poc-env.ts` 除版本和工具检测外，还应覆盖：

- 当前进程是否管理员权限（非管理员无法控制管理员权限窗口）。
- 是否远程桌面环境（可能影响截屏和录屏）。
- 是否能注册全局热键（紧急停止依赖此能力）。
- 当前显示器 DPI awareness 级别。
- 多显示器布局和负坐标情况。

环境探测结果分为三个等级：

| 等级 | 含义 | 示例 |
|---|---|---|
| `pass` | 满足要求 | Node >= 20、native addon 加载成功 |
| `warn` | 不阻塞但影响部分 PoC | 无 150% DPI 显示器、单显示器 |
| `fail` | 阻塞，无法继续 | native addon 无法加载、Rust 未安装 |

### 统一错误码

所有工具层错误使用统一错误码，便于阶段 1 执行日志复用：

```typescript
type ToolErrorCode =
  | 'NATIVE_LOAD_FAILED'
  | 'NATIVE_ABI_MISMATCH'
  | 'NATIVE_MODULE_PATH_INVALID'
  | 'NATIVE_PACKAGED_LOAD_FAILED'
  | 'WINDOW_NOT_FOUND'
  | 'WINDOW_OCCLUDED'
  | 'WINDOW_MINIMIZED'
  | 'UIA_TIMEOUT'
  | 'UIA_PATTERN_UNSUPPORTED'
  | 'UIA_BACKEND_UNRELIABLE'
  | 'INPUT_ABORTED'
  | 'INPUT_FOCUS_MISMATCH'
  | 'BROWSER_LAUNCH_FAILED'
  | 'RECORDER_BACKEND_UNAVAILABLE'
  | 'RECORDER_RESOURCE_LEAK'
  | 'DPI_MAPPING_FAILED';
```

`ToolResult<T>` 的 `error.code` 字段使用此枚举。

---

## 9. 构建配置

### pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "*.node"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "persistent": true
    },
    "test:poc": {
      "dependsOn": ["build"]
    },
    "poc:readonly": {
      "dependsOn": ["build"]
    },
    "poc:interactive": {
      "dependsOn": ["build"]
    },
    "poc:all": {
      "dependsOn": ["build"]
    },
    "poc:clean": {
      "cache": false
    }
  }
}
```

根 `package.json` 中须声明对应 scripts：

```json
{
  "scripts": {
    "poc:readonly": "tsx tests/poc-runner.ts --mode readonly",
    "poc:interactive": "tsx tests/poc-runner.ts --mode interactive",
    "poc:all": "tsx tests/poc-runner.ts --mode all",
    "poc:clean": "tsx tests/poc-runner.ts --clean"
  }
}
```

构建顺序自动解析：native build → core build → desktop build。

### 包依赖

```
@agivar/native   — 无 workspace 依赖，Rust 独立编译
@agivar/core     — 依赖 @agivar/native (workspace:*)、playwright、@nut-tree/nut-js、node-screenshots
@agivar/desktop  — 依赖 @agivar/core (workspace:*)
```

---

## 10. 时间线（2-3 周）

```
Week 1
├── Day 1-2: Monorepo 搭建 + Rust napi-rs 脚手架 + Electron 最小壳
│            验证 native addon 在 Electron 中加载成功
├── Day 3:   截屏 (node-screenshots) + nut.js 集成 + poc-screenshot 通过
├── Day 4:   键鼠 (nut.js) + poc-input 通过（记事本输入 + UIA 验证文本）
└── Day 5:   Playwright 浏览器 + poc-playwright 通过

Week 2
├── Day 1-3: Rust UIA 模块 (uiautomation crate + napi-rs 绑定)
│            + poc-uia 通过（记事本 + Chrome 控件树）
├── Day 4:   DPI 映射 + poc-dpi 通过
└── Day 5:   缓冲 / UIA 调试

Week 3
├── Day 1-3: Rust 录屏模块 (windows-capture WGC + win_desktop_duplication DXGI)
│            + poc-recorder 通过 + 对比报告
├── Day 4:   Electron 面板集成，所有验证项可从 UI 触发
└── Day 5:   整体回归 + 验收文档
```

---

## 11. 关键库降级方案

| 能力 | 首选 | Plan B | 切换条件 |
|---|---|---|---|
| 截图 | `node-screenshots` | Electron `desktopCapturer` / WGC | 窗口级截图不可用或性能不达标 |
| 键鼠 | `@nut-tree/nut-js` | 自研 Windows `SendInput` native binding | 杀毒拦截或 DPI 处理不足 |
| UIA | Rust `uiautomation` crate | terminator（Rust UIA+CDP）/ pywinauto 本地 worker | COM 初始化失败或 Pattern 支持不全 |
| 录屏 | WGC + DXGI 对比 | FFmpeg `gdigrab` | 两种方案均不稳定 |
| 浏览器 | Playwright | Chrome DevTools Protocol 直连 | Playwright 与 Electron Node 版本冲突 |

Phase 0 不要求实现所有 Plan B，但必须在验证报告中记录首选方案遇到的问题，以便判断是否需要切换。

---

## 12. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| Rust `uiautomation` crate COM 初始化复杂 | UIA 模块阻塞 | 预留 3 天；降级方案：只实现遍历 + 按 name 查找的最小子集 |
| napi-rs 在 Electron 中加载失败 | native addon 不可用 | Day 1 就验证加载链路；必要时用 electron-rebuild |
| DXGI Desktop Duplication 需要特殊权限 | 截屏返回空 | WGC 作为备选；两个都做正是为了对冲 |
| SendInput 被杀毒软件拦截 | nut.js 键鼠操作不生效 | 测试时加白名单；长期靠代码签名 |
| Playwright 与 Electron Node 版本冲突 | 浏览器模块不可用 | Playwright 独立安装浏览器，不依赖 Electron 内置 Chromium |
| nut.js DPI 处理不完善 | 高缩放率下点击偏移 | Rust native 模块补充 Windows DPI API |

---

## 13. Go / No-Go 决策表

阶段 0 结束时根据此表判断是否进入阶段 1：

| 能力 | Go 条件 | No-Go 条件 | 可带风险进入阶段 1 |
|---|---|---|---|
| Native addon | Electron 主进程中稳定加载 | Electron 主进程无法加载 | 不可——必须解决 |
| 截图 | 主屏截图成功率 ≥ 95% | 主屏截图不可用 | 窗口截图不可用但主屏可用 |
| UIA | 记事本可读写，Chrome 窗口可识别 | UIA 初始化失败 | Pattern 不完整但读树可用 |
| 输入 | 成功率 ≥ 90%，紧急停止有效 | 无法可靠停止 | DPI 有偏差但可修正 |
| Playwright | 本地表单成功率 ≥ 95% | 浏览器无法启动 | 仅某 channel 失败 |
| 录屏 | WGC 或 DXGI 至少一条可捕获帧 | 两条均不可用 | 编码未完成但捕获可用 |

---

## 14. 产出物清单

1. 可构建的 monorepo 项目（`pnpm build` 通过）
2. `@agivar/native` 编译产出 `.node` 文件，Node + Electron 双环境加载通过
3. 6 个 PoC 验证脚本全部通过，结果保存在 `tests/output/`
4. `tests/output/poc-report.json` 机器可读验证报告（含 skipped 状态）
5. 录屏方案对比报告（DXGI vs WGC，捕获与编码分层）
6. Electron 最小壳可运行，面板可触发 6 个验证项（含安全分级）
7. `poc-env.ts` 环境探测脚本通过（含权限和安全上下文）
8. `poc-runner.ts` 统一 runner + PID 清理
9. `tests/fixtures/test-form.html` 本地 Playwright 测试页
10. Go / No-Go 决策表填写完成
11. 验收文档：每个验证项的通过截图 + 关键指标

---

## 15. 参考项目

| 项目 | 地址 | 参考价值 |
|---|---|---|
| UI-TARS-Desktop | https://github.com/bytedance/UI-TARS-desktop | Electron + nut.js + screenshot-desktop 架构参考 |
| OmniParser | https://github.com/microsoft/OmniParser | UI 截图解析（后期集成） |
| Screenpipe | https://github.com/mediar-ai/screenpipe | Rust 录屏架构参考 |
| terminator | https://github.com/mediar-ai/terminator | Rust UIA + CDP 封装，AI agent 场景 |
| uiautomation-rs | https://github.com/leexgone/uiautomation-rs | Rust UIA crate，native 模块核心依赖 |
| windows-capture | https://github.com/NiiightmareXD/windows-capture | WGC 录屏 crate |
| node-screenshots | https://github.com/nashaofu/node-screenshots | napi-rs 截屏绑定（screenshot-desktop 备选） |
