# 阶段 0 桌面控制 PoC 设计评审建议

## 1. 评审对象

- 原文档：[2026-06-21-phase0-desktop-poc-design.md](./2026-06-21-phase0-desktop-poc-design.md)
- 主题：阶段 0 桌面控制 PoC 技术设计
- 评审目标：检查该设计是否足以证明后续阶段可落地，而不只是跑通几个 demo。

## 2. 总体判断

这份 Phase 0 设计已经很接近可执行工程方案。它的优点是：

- 范围明确，聚焦 Windows 桌面控制链路。
- 采用 Electron-first，阶段 0 代码可直接成为阶段 1 骨架。
- 截屏、UIA、键鼠、Playwright、DPI、录屏 6 条验证线拆分清楚。
- native addon 在 Electron 中加载被提前纳入验收。
- WGC 和 DXGI 双路线对比放进阶段 0，能提前降低录屏选型风险。

当前主要不足是：验收标准偏“能跑”，还不够“可量化、可复现、可支撑阶段 1”。建议补强量化指标、窗口和元素生命周期边界、底层库 Plan B、执行安全边界。

## 3. 必须修改

### 3.1 把验收标准量化

当前验收多是“能识别”“能截取”“能填写表单”。这不足以判断方案稳定性。

建议每个 PoC 增加量化指标：

| PoC | 建议指标 |
| --- | --- |
| 截图 | 连续 30 次成功率、平均耗时、图片尺寸是否正确 |
| 活动窗口 | 标题识别准确率、窗口句柄是否稳定 |
| UIA | 节点数量、目标控件命中率、遍历耗时 |
| 输入 | 连续 10 次输入和保存成功率 |
| Playwright | 表单填写成功率、平均耗时、失败原因 |
| DPI | 点击偏差像素值，不只写“准确” |
| 录屏 | 帧率、丢帧率、CPU/GPU 占用、输出文件大小 |

建议所有结果写入 `tests/output/poc-report.json`，便于后续回归。

### 3.2 明确统一测试目标应用

文档里分散出现记事本、Chrome、httpbin。建议定义 Phase 0 固定目标应用清单，避免每个脚本临时选择目标，导致结果不可比。

建议目标：

| 应用 | 用途 |
| --- | --- |
| 记事本 | UIA、输入、文本验证 |
| Chrome 或 Edge | 浏览器窗口识别、Playwright 表单 |
| 文件资源管理器 | 活动窗口识别、基础 UIA 遍历 |
| 本地 HTML 测试页 | 稳定验证 Playwright 定位 |

不建议 Phase 0 依赖外网页面作为唯一浏览器验证目标。

### 3.3 提前处理 `captureWindow(hwnd)` 的实现边界

`node-screenshots` 未必支持按 hwnd 直接截取指定窗口。很多截图库只支持屏幕或显示器级截图。

建议在设计中明确：

- 如果无法原生窗口截图，则使用窗口 rect 从全屏截图裁剪。
- 验收要区分“真实窗口捕获”和“屏幕裁剪窗口区域”。
- 必须记录窗口是否被遮挡。
- 必须处理最小化窗口。
- 必须处理多屏负坐标。
- 必须处理 DPI 缩放。

否则 `captureWindow(hwnd)` 可能在 demo 中可用，但后续阶段无法稳定支撑活动窗口观察。

### 3.4 调整 UIA `element_id` 设计

当前 API 中有：

```typescript
getElementValue(elementId: string): Promise<string>
```

这暗含 UIA 元素引用可以跨调用持久化。但在实际环境中，UIA 元素可能随窗口刷新、控件重建、跨 IPC 调用而失效。

建议 Phase 0 不做持久 `element_id`，改为：

- 每次通过 `hwnd + query` 重新查找元素。
- 或返回 `runtimeId / automationId / controlType / name / path` 的组合定位信息。
- 阶段 1 再考虑元素缓存和失效检测。

建议 API：

```typescript
export async function getElementValue(hwnd: number, query: ElementQuery): Promise<string>
export async function invokeElement(hwnd: number, query: ElementQuery): Promise<void>
export async function setElementValue(hwnd: number, query: ElementQuery, value: string): Promise<void>
```

### 3.5 UIA 验证不能只读树，还要验证 Pattern

只读控件树只能证明“看得到”，不能证明“能操作”。

建议 Phase 0 增加最小 Pattern 验证：

- `ValuePattern`：读取和设置文本框内容。
- `InvokePattern`：点击按钮。
- `SelectionPattern`：读取选中项，能做则做。

验收标准应包含：

- 找到记事本编辑区。
- 能读取编辑区文本。
- 能通过 UIA 设置文本或确认无法设置后降级到键盘输入。

### 3.6 输入操作必须增加焦点校验

当前 `input.ts` 设计里直接提供 `click`、`typeText`、`pressKeys`。桌面自动化中，错误焦点会导致文本输入到错误窗口，这是高风险问题。

建议增加：

```typescript
export async function ensureActiveWindow(hwnd: number): Promise<boolean>
export async function getFocusedElement(): Promise<FocusedElementInfo>
export async function clickAndType(target: TargetRef, text: string): Promise<InputResult>
```

每次输入前后应记录：

- before active window
- after active window
- focused element
- 输入内容摘要
- 截图

### 3.7 Playwright PoC 不要只依赖 httpbin

`httpbin` 表单过于简单，而且依赖外网。

建议增加一个本地 HTML 测试页，包含：

- label/input
- button
- select
- checkbox
- textarea
- dynamic loading
- success message

这样可以稳定验证：

- role 定位。
- label 定位。
- text 定位。
- 动态等待。
- 提交后的状态验证。

### 3.8 调整录屏 `RecordingHandle` 生命周期设计

当前 Rust API 设计：

```rust
fn start_recording_wgc(config: RecordConfig) -> Result<RecordingHandle>
fn stop_recording(handle: RecordingHandle) -> Result<RecordResult>
```

跨 napi / Node / Electron 管理 Rust handle 生命周期容易踩坑。

建议改为：

- TypeScript 层生成或接收 `sessionId`。
- Rust 内部用 map 管理 recorder。
- `startRecording` 返回 `{ sessionId }`。
- `stopRecording(sessionId)` 返回结果。
- 提供 `forceStopAllRecordings()`，避免异常退出后残留。

推荐 API：

```typescript
export async function startRecording(config: RecordConfig): Promise<{ sessionId: string }>
export async function stopRecording(sessionId: string): Promise<RecordResult>
export async function getRecordingStatus(sessionId: string): Promise<RecordingStatus>
export async function forceStopAllRecordings(): Promise<void>
```

## 4. 建议补充

### 4.1 录屏对比维度需要扩展

当前录屏对比写的是帧数、大小、丢帧。建议扩展为：

| 维度 | 说明 |
| --- | --- |
| 窗口级捕获 | 能否只录目标窗口 |
| 窗口遮挡 | 目标窗口被遮挡时结果如何 |
| 最小化窗口 | 最小化后是否可捕获 |
| 多屏 | 副屏、负坐标是否正常 |
| DPI | 125% / 150% 缩放是否正常 |
| HDR | 色彩是否异常 |
| 自身浮窗排除 | 是否能排除录制控制条 |
| 性能 | CPU / GPU 占用 |
| 文件大小 | 同等时长输出大小 |
| 权限体验 | 是否需要额外权限或弹窗 |

这些维度比单纯帧数更能决定后续录屏教学路线。

### 4.2 为关键库补 Plan B

当前选型押了多个库，但风险表没有覆盖“库不可用或维护不足”的降级路线。

建议增加：

| 能力 | 首选 | Plan B |
| --- | --- | --- |
| 截图 | `node-screenshots` | Electron `desktopCapturer` / Windows Graphics Capture |
| 键鼠 | `@nut-tree/nut-js` | 自研 Windows `SendInput` native binding |
| UIA | Rust `uiautomation` crate | pywinauto 本地 worker / terminator |
| 录屏 | WGC + DXGI 对比 | FFmpeg `gdigrab` |
| 浏览器 | Playwright | Chrome DevTools Protocol 直连 |

Phase 0 的目标不是把所有 Plan B 都实现，而是明确什么时候切换。

### 4.3 增加真实桌面操作安全开关

`pnpm test:poc` 会触发真实鼠标键盘操作。建议必须加保护：

```bash
pnpm test:poc -- --i-understand-this-controls-my-desktop
```

没有该参数时，只允许运行只读 PoC，例如截图和 UIA 读取。

同时建议：

- 运行前倒计时 3 秒。
- 显示即将控制桌面。
- 提供紧急停止说明。
- 输出当前活动窗口标题，避免误操作。

### 4.4 增加 `poc-report.json`

建议所有 PoC 统一输出机器可读报告：

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
      "status": "passed",
      "durationMs": 320,
      "metrics": {
        "successRate": 1,
        "avgCaptureMs": 42
      },
      "artifacts": ["tests/output/screen.png"]
    }
  ]
}
```

这样阶段 1 可以把 Phase 0 的 PoC 变成回归测试基础。

### 4.5 增加环境探测脚本

建议增加：

```text
tests/poc-env.ts
```

检查：

- Windows 版本。
- Node / pnpm / Rust 版本。
- Visual Studio Build Tools。
- FFmpeg 是否存在。
- 显示器数量。
- DPI 缩放。
- 是否可加载 native addon。
- 是否能启动 Playwright 浏览器。

很多 Phase 0 问题会是环境问题，不是代码问题。

### 4.6 记事本保存流程要避免卡住

`poc-input.ts` 设计为启动记事本、输入文本、`Ctrl+S`、截图验证。`Ctrl+S` 会弹保存对话框，可能卡住自动化流程。

建议两种选择：

1. 不测试保存，只验证文本输入和 UIA 读取。
2. 明确写入临时路径，并自动处理保存对话框。

第一版建议选择 1，减少变量。

### 4.7 Chrome UIA 验证边界要写清楚

Chrome 内部页面元素不应依赖 UIA。Phase 0 对 Chrome 的 UIA 验证建议只做：

- 识别 Chrome 顶层窗口。
- 识别地址栏或基础窗口控件。
- 不要求读取网页 DOM。

网页内表单、按钮、文本应由 Playwright 验证。

### 4.8 Electron IPC 需要明确错误格式

建议所有 IPC handler 返回统一结构：

```typescript
type ToolResult<T> =
  | { ok: true; data: T; durationMs: number }
  | { ok: false; error: { code: string; message: string; details?: unknown }; durationMs: number };
```

这能让 Electron 面板展示失败原因，也方便后续任务日志复用。

## 5. 时间线建议

当前时间线偏紧，尤其是 Week 2 的 UIA 和 Week 3 的双录屏后端。

建议调整为：

| 时间 | 重点 |
| --- | --- |
| Day 1 | Electron + native addon 加载验证 |
| Day 2 | 环境探测 + 只读截图 |
| Day 3 | 键鼠控制 + 安全开关 |
| Day 4 | Playwright + 本地 HTML 测试页 |
| Day 5 | UIA 读树最小实现 |
| Week 2 Day 1-2 | UIA Pattern 验证 |
| Week 2 Day 3 | DPI 坐标映射 |
| Week 2 Day 4-5 | Electron 面板集成 + poc-report |
| Week 3 | WGC / DXGI 录屏对比 |

如果人手少，录屏可以不阻塞前 5 个 PoC，但必须产出对比报告。

## 6. 结论

这份设计可以作为 Phase 0 开工基础，但建议在开工前补上三类内容：

1. **量化验收**：每个 PoC 不只看是否能跑，还要产出成功率、耗时、偏差和资源占用。
2. **边界清晰**：窗口截图、UIA 元素生命周期、键盘焦点、录屏 handle 生命周期都要明确。
3. **可回退路线**：为截图、输入、UIA、录屏、浏览器控制分别写 Plan B。

这样 Phase 0 才能真正回答一个关键问题：

> 这条 Windows 桌面控制技术路线，能否支撑阶段 1 的手写流程执行闭环？
