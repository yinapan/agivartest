# 阶段 0 桌面控制 PoC 超高强度评审建议

## 1. 评审对象

- 原文档：[2026-06-21-phase0-desktop-poc-design.md](./2026-06-21-phase0-desktop-poc-design.md)
- 评审轮次：开工前高强度复审
- 评审目标：判断当前设计是否足以交给工程团队直接实施，并明确哪些问题会影响阶段 0 到阶段 1 的交接。

## 2. 总体判断

当前设计已经具备开工基础，但还不应直接视为“工程可执行规格”。它已经覆盖了截图、UIA、键鼠、Playwright、DPI、录屏、报告、Plan B 和安全开关，但仍有几类深层风险没有完全收口：

- Electron 与 napi-rs native addon 的 ABI 和构建兼容性没有形成硬门槛。
- UIA 的 COM 线程模型、超时和取消机制没有设计清楚。
- 坐标系统没有建立强类型边界，后续很容易发生逻辑坐标、物理坐标、窗口坐标混用。
- 交互 PoC 的安全停止机制仍偏“提示层”，缺少真正能中断失控输入的设计。
- 录屏验证仍把编码、捕获、资源释放混在一起，容易定位困难。
- 阶段 0 的 Go / No-Go 门槛还不够明确，无法直接判断是否进入阶段 1。

建议在开工前补一版“实施级修订”，不需要大改架构，但要把下面的阻塞项补进设计文档。

## 3. 阻塞级问题

### 3.1 Native addon ABI 兼容性必须成为 Day 1 硬门槛

当前文档写到“Electron 环境中加载 native addon 成功”，这是正确方向，但还不够。Electron 的 Node ABI 与普通 Node.js 不完全等价，napi-rs 模块在 Node CLI 中能加载，不代表在 Electron 主进程中也能加载。

建议补充 Day 1 验收：

- `@agivar/native` 在普通 Node.js 中加载成功。
- `@agivar/native` 在 Electron 主进程中加载成功。
- `@agivar/native` 在 packaged 或模拟 packaged 环境中加载路径正确。
- 失败时能输出 ABI、platform、arch、module path、Electron 版本。

建议新增脚本：

```bash
pnpm native:doctor
pnpm desktop:doctor-native
```

建议报告字段：

```json
{
  "native": {
    "nodeAbi": "node-v...",
    "electronVersion": "33.x",
    "platform": "win32",
    "arch": "x64",
    "modulePath": "packages/native/...",
    "loadedInNode": true,
    "loadedInElectron": true
  }
}
```

没有这个门槛，后续 UIA 和录屏模块写完后才发现 Electron 加载失败，会非常伤。

### 3.2 UIA 线程模型、超时和取消必须明确

UI Automation 不是普通同步函数调用。COM 初始化、线程模型、窗口响应慢、目标应用卡死，都可能导致 UIA 调用阻塞。

当前设计只写了 `uiautomation` crate 和 API，没有说明：

- 使用 STA 还是 MTA。
- UIA 调用运行在哪个线程。
- 是否有独立 worker。
- 单次调用最大耗时。
- 超时后如何取消。
- 目标窗口无响应时如何返回错误。

建议设计为：

- UIA 在独立 worker 线程或独立进程中运行。
- 每次 UIA 调用必须有 timeout，Phase 0 默认 2 秒。
- 超时返回结构化错误，不阻塞 Electron 主进程。
- `getUiTree` 必须支持 `maxDepth` 和 `maxNodes` 双限制。
- 遍历时跳过 `isOffscreen` 或至少记录数量。

建议 API 增加：

```typescript
interface UiaOptions {
  timeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
  includeOffscreen?: boolean;
}
```

阶段 0 的 UIA 验收不应只看“是否能读树”，还要验证“目标应用无响应或查询失败时不会挂死主进程”。

### 3.3 坐标系统必须强类型化

当前设计里 `click(x, y)`、`logicalToPhysical`、`captureWindow(hwnd)`、`boundingRect` 都会涉及坐标，但没有统一坐标契约。

桌面自动化里最常见的事故就是坐标混用：

- 逻辑坐标。
- 物理坐标。
- 屏幕坐标。
- 窗口坐标。
- 客户区坐标。
- 截图像素坐标。
- 多屏负坐标。

建议在 Phase 0 就定义坐标类型：

```typescript
type CoordinateSpace =
  | 'screen-logical'
  | 'screen-physical'
  | 'window-logical'
  | 'window-physical'
  | 'image-pixel';

interface Point {
  x: number;
  y: number;
  space: CoordinateSpace;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  space: CoordinateSpace;
}
```

建议把输入 API 改成：

```typescript
export async function clickPoint(point: Point): Promise<void>
```

如果保留 `click(x, y)`，至少明确它只接受 `screen-physical` 坐标。否则 DPI PoC 通过了，阶段 1 仍可能因为坐标来源混乱而误点。

### 3.4 真实键鼠安全机制不能只靠参数和提示

当前设计有 CLI 安全参数、倒计时、紧急停止说明。方向正确，但仍缺少真正能中断失控输入的实现门槛。

建议 Phase 0 必须实现：

- 全局紧急停止热键在交互 PoC 中真实可用。
- 紧急停止监听不能依赖被阻塞的 renderer。
- 每个交互动作之间检查 abort signal。
- PoC runner 能在 abort 后停止后续动作。
- 失败或中断后尽量恢复鼠标键盘状态。

建议在 `poc-input.ts` 增加验收：

1. 开始输入前倒计时。
2. 用户按下紧急停止热键。
3. 后续输入动作不再执行。
4. 报告中记录 `aborted: true` 和停止时间。

如果紧急停止只在文档里存在，阶段 0 的交互测试风险仍然偏高。

### 3.5 Playwright 应明确“托管浏览器”策略

当前 `launchBrowser` 支持 `channel: 'chrome' | 'msedge' | 'chromium'`，但没有明确是连接用户主浏览器，还是启动独立托管浏览器。

建议 Phase 0 明确：

- 默认使用 Playwright 托管的独立浏览器上下文。
- 不连接用户主浏览器。
- 使用临时 user data dir。
- 测试结束后清理上下文。
- 本地测试页通过本地 HTTP server 提供，而不是直接 `file://`。

建议新增：

```typescript
export async function launchManagedBrowser(options?: {
  channel?: 'chrome' | 'msedge' | 'chromium';
  userDataDir?: string;
  cleanupOnClose?: boolean;
}): Promise<BrowserSession>
```

本地 HTML 用 `file://` 可能绕过部分浏览器行为，建议用 `http://127.0.0.1:<port>/test-form.html`，这样更接近真实后台页面。

### 3.6 录屏验证应先分离“捕获”和“编码”

当前设计把 `windows-capture`、DXGI、FFmpeg 编码放在一个 PoC 里。这样如果录屏失败，很难判断是捕获失败、帧处理失败、编码失败，还是文件写入失败。

建议阶段 0 拆成两层：

1. **Frame capture PoC**
   - 捕获 5 秒。
   - 不编码视频。
   - 输出原始帧或抽样 PNG。
   - 记录帧数、间隔、丢帧、内存和 CPU。

2. **Encoding PoC**
   - 使用已捕获帧编码为 MP4。
   - 比较 FFmpeg CLI 和 `ffmpeg-next` 的复杂度。
   - 编码失败不影响捕获路线判断。

这样能更快判断 WGC / DXGI 哪条捕获路线可用。

### 3.7 阶段 0 需要明确 Go / No-Go 决策表

当前有量化指标，但没有说明失败后是否还能进入阶段 1。

建议新增：

| 能力 | Go 条件 | No-Go 条件 | 可带风险进入阶段 1 的条件 |
| --- | --- | --- | --- |
| native addon | Electron 中稳定加载 | Electron 主进程无法加载 | 只能在 Node 中加载则不进入阶段 1 |
| 截图 | 主屏截图成功率 ≥ 95% | 主屏截图不可用 | 窗口截图不可用但主屏可用，可进入 |
| UIA | 记事本可读写，Chrome 窗口可识别 | UIA 初始化失败 | Pattern 不完整但读树可用，可进入 |
| 输入 | 输入成功率 ≥ 90%，紧急停止有效 | 无法可靠停止 | DPI 有偏差但可修正，可进入 |
| Playwright | 本地表单成功率 ≥ 95% | 浏览器无法启动 | 仅某 channel 失败，可进入 |
| 录屏 | WGC 或 DXGI 至少一条可捕获帧 | 两条都不可用 | 编码未完成但捕获可用，可进入 |

这个表能让阶段 0 结束时做工程决策，而不是只交一组 demo。

## 4. 强建议问题

### 4.1 版本不要写 `latest`

当前技术栈中 Turborepo、Zustand 等写了 `latest`。PoC 阶段更需要可复现，建议锁定具体版本范围。

建议：

- 使用 `pnpm-lock.yaml` 固定依赖。
- 文档中写主版本范围，不写 `latest`。
- native 相关依赖锁具体 minor。
- 记录 `pnpm env` 或 `corepack` 使用方式。

### 4.2 Electron 面板的安全确认应写进 UI 规格

当前文档只说 Electron 面板有运行按钮。建议明确按钮分级：

| 验证项 | UI 行为 |
| --- | --- |
| 环境探测 | 直接运行 |
| 截图 | 直接运行 |
| UIA 读取 | 直接运行 |
| Playwright | 直接运行，但提示会启动浏览器 |
| 键鼠输入 | 二次确认 + 倒计时 + 紧急停止说明 |
| 录屏 | 二次确认 + 录制范围说明 + 倒计时 |

这样前端实现不会把所有按钮都做成普通按钮。

### 4.3 产物目录要避免污染 Git

PoC 会产生截图、录屏、UIA 树、报告，可能包含敏感信息。

建议明确：

- `tests/output/` 必须加入 `.gitignore`。
- 每次运行创建独立 timestamp 目录。
- 报告中只保留相对路径。
- 提供 `pnpm poc:clean` 清理产物。
- 默认不上传、不同步、不提交截图和录屏。

### 4.4 环境探测要覆盖权限和安全上下文

当前 `poc-env.ts` 主要检查版本和工具。建议增加：

- 当前进程是否管理员权限。
- 目标应用是否管理员权限。
- 是否存在 UAC secure desktop。
- 当前显示器 DPI awareness。
- 是否远程桌面环境。
- 是否多显示器。
- 是否 HDR。
- 是否能注册全局热键。

尤其要明确：非管理员进程通常无法控制管理员权限窗口。Phase 0 应记录这个边界，不要把它误判为输入库失败。

### 4.5 错误分类需要在 Phase 0 建立

建议统一错误码，不要只返回 message：

```typescript
type ToolErrorCode =
  | 'NATIVE_LOAD_FAILED'
  | 'WINDOW_NOT_FOUND'
  | 'WINDOW_OCCLUDED'
  | 'WINDOW_MINIMIZED'
  | 'UIA_TIMEOUT'
  | 'UIA_PATTERN_UNSUPPORTED'
  | 'INPUT_ABORTED'
  | 'INPUT_FOCUS_MISMATCH'
  | 'BROWSER_LAUNCH_FAILED'
  | 'RECORDER_BACKEND_UNAVAILABLE'
  | 'RECORDER_RESOURCE_LEAK'
  | 'DPI_MAPPING_FAILED';
```

阶段 1 的执行日志会直接复用这些错误码。

### 4.6 UIA 查询需要限制复杂度

`findElement` 如果没有复杂度限制，后续很容易出现全树深度遍历过慢。

建议 `ElementQuery` 增加：

```typescript
interface ElementQuery {
  automationId?: string;
  name?: string;
  controlType?: string;
  className?: string;
  nameMatch?: 'exact' | 'contains' | 'regex';
  maxDepth?: number;
  maxNodes?: number;
  index?: number;
  includeOffscreen?: boolean;
}
```

默认：

- `maxDepth = 8`
- `maxNodes = 1000`
- `includeOffscreen = false`
- `nameMatch = 'exact'`

### 4.7 录屏资源释放要变成硬验收

上一轮已经提到内存和资源释放。这里建议提升为硬验收：

- 连续 start / stop 5 次。
- 每次 stop 后文件句柄释放。
- 每次 stop 后 session map 清空。
- `forceStopAllRecordings()` 可清理异常残留。
- 录屏失败不会导致 Electron 退出。

录屏一旦泄漏，后续教学模式会非常不稳定。

## 5. 可选但高价值补充

### 5.1 增加 `poc-runner.ts`

现在每个脚本独立运行，但建议增加统一 runner：

```bash
pnpm poc:readonly
pnpm poc:interactive -- --i-understand-this-controls-my-desktop
pnpm poc:all -- --i-understand-this-controls-my-desktop
```

runner 负责：

- 先运行 `poc-env.ts`。
- 统一创建输出目录。
- 汇总 `poc-report.json`。
- 根据环境决定 `skipped`。
- 执行后清理测试应用。

### 5.2 增加测试应用清理策略

PoC 会启动记事本、浏览器、录屏 session。建议每个脚本必须有 cleanup：

- 关闭由测试启动的记事本。
- 关闭 Playwright 浏览器。
- 停止所有录屏 session。
- 清理临时文件。
- 不关闭用户原本打开的同名应用。

需要用测试启动时记录的 PID 做清理，不要按进程名粗暴关闭。

### 5.3 增加“不可验证项”记录

有些环境可能没有 150% DPI、多显示器或 HDR。建议报告中支持：

```json
{
  "status": "skipped",
  "reason": "No 150% DPI monitor available"
}
```

这比把环境缺失标记为失败更准确。

## 6. 建议写入原设计的最小修改清单

建议直接在原设计中补以下章节或段落：

1. **Native ABI 验收门槛**：放在“额外验收”后。
2. **UIA 线程模型与超时**：放在 UIA 模块 API 下。
3. **坐标类型定义**：放在 Core API 前。
4. **交互 PoC 紧急停止硬验收**：放在安全保护下。
5. **Playwright 托管浏览器策略**：放在 browser.ts 下。
6. **录屏捕获与编码分层**：放在 recorder.ts 或验证脚本下。
7. **Go / No-Go 决策表**：放在产出物清单前。
8. **错误码枚举**：放在 IPC 统一响应格式后。
9. **产物 `.gitignore` 与清理策略**：放在 poc-report 章节后。

## 7. 最终结论

当前 Phase 0 设计已经不是“概念方案”，而是接近可执行规格。但如果按超高强度开工标准看，还差最后一层工程护栏：

- ABI 护栏。
- UIA 线程和超时护栏。
- 坐标类型护栏。
- 键鼠失控护栏。
- 录屏资源释放护栏。
- Go / No-Go 决策护栏。

这些护栏不补，Phase 0 仍然可能跑出漂亮 demo，但无法可靠回答“能否进入阶段 1”。

建议先补完本文件中的阻塞级问题，再开始实现。补完后，阶段 0 的实施风险会明显下降，产出也更容易被阶段 1 直接复用。
