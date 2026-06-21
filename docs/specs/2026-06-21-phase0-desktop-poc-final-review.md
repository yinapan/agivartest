# 阶段 0 桌面控制 PoC 最终复核建议

## 1. 评审对象

- 原文档：[2026-06-21-phase0-desktop-poc-design.md](./2026-06-21-phase0-desktop-poc-design.md)
- 评审轮次：xhigh 后最终复核
- 评审目标：检查最新版设计在吸收高强度评审后，是否还存在前后不一致、接口未对齐或实施前需要小修的问题。

## 2. 总体判断

最新版设计已经吸收了高强度评审中的大部分阻塞项：

- 增加了 native addon ABI 验收门槛。
- 增加了 UIA 线程模型、timeout 和复杂度限制。
- 增加了坐标类型约定。
- 增加了 Playwright 托管浏览器策略。
- 录屏验证拆成帧捕获和编码两层。
- 增加了紧急停止硬验收。
- 增加了产物管理、环境探测、统一错误码。
- 增加了 Go / No-Go 决策表。

当前设计已经可以进入实现准备。剩余问题主要是文档内部同步和接口细节对齐，不需要再做大结构调整。

## 3. 必须小修

### 3.1 同步时间线中的旧描述

当前时间线 Week 1 Day 4 仍写：

> 键鼠 (nut.js) + poc-input 通过（记事本输入+保存）

但前文已经明确 `poc-input.ts` 不测试 `Ctrl+S` 保存，避免保存对话框卡住。

建议改为：

> 键鼠 (nut.js) + poc-input 通过（记事本输入 + UIA 验证文本）

### 3.2 修正 UIA 顶部验收指标

顶部验收表仍写：

> 能识别记事本 / Chrome 的按钮和输入框，目标控件命中率 100%

这个指标对记事本合理，但对 Chrome 不准确。Chrome 页面内部元素应该由 Playwright 验证，UIA 只做窗口级识别。

建议改为：

- 记事本编辑区命中率 100%。
- Chrome / Edge 顶层窗口识别成功率 100%。
- Chrome 页面内部 DOM 不通过 UIA 验证。

### 3.3 将 `UiaOptions` 落到 API 签名

文档已经定义：

```typescript
interface UiaOptions {
  timeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
  includeOffscreen?: boolean;
}
```

但 API 仍是：

```typescript
getUiTree(hwnd: number, maxDepth?: number): Promise<UiaNode>
```

建议统一为：

```typescript
export async function getUiTree(hwnd: number, options?: UiaOptions): Promise<UiaNode>
export async function findElement(hwnd: number, query: ElementQuery, options?: UiaOptions): Promise<UiaElement | null>
export async function dumpUiTree(hwnd: number, options?: UiaOptions): Promise<string>
```

Rust 侧也应同步支持 `timeoutMs / maxDepth / maxNodes / includeOffscreen`，否则 timeout 和复杂度限制容易在实现时被绕过。

### 3.4 明确 COM timeout 的恢复边界

当前设计写“UIA 在 worker 线程中运行，调用必须有 timeout”。但如果底层 COM 调用卡死，线程级 timeout 不一定能真正取消调用。

建议补充：

- Phase 0 先保证 UIA 卡死不阻塞 Electron 主进程。
- 如果 worker 超时后无法恢复，记录为需要进程级隔离的风险。
- 若同一 worker 连续超时，重启 worker 或标记 UIA backend 不可靠。

这样团队不会误以为 timeout 一定能中断 COM 调用。

### 3.5 输入 API 命名应体现坐标空间

文档已经定义坐标类型，并说明 `click(x, y)` 使用 `screen-physical`。但裸 `click(x, y)` 仍容易在阶段 1 被误用。

建议二选一：

```typescript
export async function clickScreenPhysical(x: number, y: number, options?: ClickOptions): Promise<void>
```

或：

```typescript
export async function clickPoint(point: Point, options?: ClickOptions): Promise<void>
```

如果保留 `click(x, y)`，建议只作为内部封装，不暴露给 Agent 工具层。

### 3.6 Playwright API 名称与策略对齐

文档新增了“Playwright 托管浏览器策略”，但 API 仍叫 `launchBrowser`。

建议改成：

```typescript
export async function launchManagedBrowser(options?: {
  headless?: boolean;
  channel?: 'chrome' | 'msedge' | 'chromium';
  userDataDir?: string;
  cleanupOnClose?: boolean;
}): Promise<BrowserSession>
```

并在返回的 `BrowserSession` 中记录：

- `userDataDir`
- `isManaged: true`
- `cleanupOnClose`
- `serverUrl`，即本地测试页地址

### 3.7 同步 pnpm scripts 与 turbo tasks

文档运行方式已经使用：

```bash
pnpm poc:readonly
pnpm poc:interactive -- --i-understand-this-controls-my-desktop
pnpm poc:all -- --i-understand-this-controls-my-desktop
pnpm poc:clean
```

但 `turbo.json` 中仍只有 `test:poc`。

建议增加：

```json
{
  "tasks": {
    "poc:readonly": { "dependsOn": ["build"] },
    "poc:interactive": { "dependsOn": ["build"] },
    "poc:all": { "dependsOn": ["build"] },
    "poc:clean": { "cache": false }
  }
}
```

同时在根 `package.json` 中声明对应 scripts。

### 3.8 将录屏资源释放写入顶部验收表

后文已经写了：

- 连续 start / stop 5 次。
- stop 后文件句柄释放。
- session map 清空。
- `forceStopAllRecordings()` 可清理异常残留。

但顶部录屏量化指标仍只写帧率、丢帧率、CPU 和文件大小。

建议补入顶部指标：

> 连续 start / stop 5 次无泄漏；stop 后 session map 清空；异常中断后 `forceStopAllRecordings()` 可清理。

### 3.9 明确 packaged native addon 验收方式

文档写“packaged 或模拟 packaged 环境中加载路径正确”，但没有说明怎么验证。

建议明确为：

```bash
pnpm desktop:package:dir
```

使用 `electron-builder --dir` 生成目录包，验证：

- `.node` 文件不被打进 `asar` 内。
- `.node` 位于 `asarUnpack` 或等效 unpack 路径。
- packaged 主进程能成功加载 native addon。
- 报告记录 packaged module path。

这个点很容易到打包阶段才暴雷，Phase 0 应提前压住。

### 3.10 统一报告输出路径

文档前面写：

> 所有验证结果统一写入 `tests/output/poc-report.json`

后面又写：

> 每次运行在 `tests/output/` 下创建 timestamp 子目录

建议统一为：

```text
tests/output/<timestamp>/poc-report.json
tests/output/latest -> <timestamp>
```

如果 Windows 上不使用 symlink，可以用：

```text
tests/output/latest.json
```

其中 `latest.json` 只保存最近一次报告摘要和实际 timestamp 目录。

## 4. 可选优化

### 4.1 把 `ToolErrorCode` 扩展到 native doctor

建议补充：

```typescript
| 'NATIVE_ABI_MISMATCH'
| 'NATIVE_MODULE_PATH_INVALID'
| 'NATIVE_PACKAGED_LOAD_FAILED'
```

这样 ABI 诊断能复用统一错误结构。

### 4.2 给 `poc-env.ts` 增加输出等级

建议环境探测结果分为：

- `pass`：满足要求。
- `warn`：不阻塞，但会影响部分 PoC，例如无 150% DPI 显示器。
- `fail`：阻塞，例如 native addon 无法加载。

### 4.3 将只读 PoC 与交互 PoC 标记到报告

建议 `PocResult` 增加：

```typescript
kind: 'readonly' | 'interactive'
```

这样报告里可以一眼看出是否有真实桌面操作。

## 5. 结论

当前设计已经可以进入实现准备。开工前建议只做一轮小修：

1. 时间线文字同步。
2. UIA 验收指标修正。
3. `UiaOptions` 落到 API 签名。
4. COM timeout 恢复边界说明。
5. 输入 API 坐标命名收口。
6. Playwright 托管浏览器 API 对齐。
7. pnpm scripts / turbo tasks 同步。
8. 录屏资源释放补入顶部验收。
9. packaged native addon 验收方式明确。
10. 报告输出路径统一。

这些都是小修，但能显著减少实现时的歧义。修完后，这份设计就可以作为阶段 0 的实施规格使用。
