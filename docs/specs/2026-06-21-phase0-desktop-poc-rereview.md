# 阶段 0 桌面控制 PoC 设计复审建议

## 1. 评审对象

- 原文档：[2026-06-21-phase0-desktop-poc-design.md](./2026-06-21-phase0-desktop-poc-design.md)
- 评审轮次：修改后复审
- 评审目标：确认上一轮关键建议是否已经吸收，并指出开工前仍值得修正的小问题。

## 2. 总体判断

新版设计已经吸收了上一轮大部分关键建议：

- 增加了量化验收指标。
- 增加了推荐测试目标应用。
- 增加了本地 HTML 测试页。
- 增加了 `poc-env.ts` 环境探测。
- 增加了 `poc-report.json` 机器可读报告。
- 增加了真实键鼠操作安全开关。
- 调整了 UIA API，不再依赖持久 `element_id`。
- 增加了 UIA Pattern 验证。
- 录屏 API 改成 `sessionId` 生命周期管理。
- 增加了关键库 Plan B。
- 明确了 `captureWindow(hwnd)` 的边界。

整体已经可以作为 Phase 0 开工设计。剩余问题主要是文字同步、接口定义精细度和安全约束补强。

## 3. 建议修正项

### 3.1 同步时间线中的旧描述

当前时间线 Week 1 Day 4 仍写：

> 键鼠 (nut.js) + poc-input 通过（记事本输入+保存）

但新版验证脚本已经明确：

> 不测试 Ctrl+S 保存，避免保存对话框卡住

建议改为：

> 键鼠 (nut.js) + poc-input 通过（记事本输入 + UIA 验证文本）

### 3.2 拆分只读 PoC 和交互 PoC 命令

当前命令说明里同时写：

```bash
pnpm test:poc
pnpm test:poc -- --i-understand-this-controls-my-desktop
```

但 `pnpm test:poc` 又被描述为“全部（需加安全开关）”，容易误解。

建议拆成两个明确命令：

```bash
pnpm test:poc:readonly
pnpm test:poc:interactive -- --i-understand-this-controls-my-desktop
```

约定：

- `test:poc:readonly` 只运行环境探测、截图、UIA 读取等只读测试。
- `test:poc:interactive` 运行键鼠、录屏、可能改变桌面状态的测试。

### 3.3 补充 `ElementQuery` TypeScript 定义

当前文档只说明 `ElementQuery` 支持 `automationId / controlType / name / className` 组合，但还缺少具体接口。

建议补充：

```typescript
interface ElementQuery {
  automationId?: string;
  name?: string;
  controlType?: string;
  className?: string;
  nameMatch?: 'exact' | 'contains' | 'regex';
  maxDepth?: number;
  index?: number;
}
```

同时明确默认匹配规则：

- `nameMatch` 默认 `exact`。
- 多字段之间为 AND。
- `index` 用于多个候选元素时选择第几个。
- Phase 0 不做复杂 path 查询，阶段 1 再补。

### 3.4 调整 UIA 命中率指标

当前量化指标写：

> 目标控件命中率 100%

这个指标对记事本合理，但对 Chrome UIA 不一定合理。Chrome 页面内部元素应由 Playwright 验证，UIA 只负责窗口级信息。

建议改为：

- 记事本编辑区命中率 100%。
- Chrome / Edge 顶层窗口识别成功率 100%。
- Chrome 页面内部 DOM 不通过 UIA 验证。

### 3.5 录屏指标增加内存和资源释放

当前录屏指标包括帧率、丢帧率、CPU 占用、文件大小，但缺少内存和资源释放验证。

建议增加：

- 峰值内存占用。
- 连续启动和停止 5 次是否成功。
- stop 后是否释放文件句柄。
- stop 后进程线程数是否恢复。
- 录屏异常中断后 `forceStopAllRecordings()` 是否能清理。

### 3.6 Electron UI 侧也要加安全确认

CLI 已经设计 `--i-understand-this-controls-my-desktop`，但 Electron 面板也能触发 6 个验证项。

建议 Electron UI 中：

- 只读 PoC 可直接运行。
- 键鼠和录屏 PoC 必须弹二次确认。
- 运行前倒计时 3 秒。
- 显示当前活动窗口标题。
- 展示紧急停止热键 `Ctrl+Alt+Space`。

### 3.7 Plan B 切换条件可以更硬

当前 Plan B 切换条件如“性能不达标”“Pattern 支持不全”仍偏泛。

建议写成可判断条件：

| 能力 | 建议切换阈值 |
| --- | --- |
| 截图 | 平均截图耗时 > 200ms，或窗口级截图不可用 |
| 键鼠 | 连续 10 次输入成功率 < 90%，或高 DPI 点击偏差 > 5px |
| UIA | 记事本编辑区无法稳定命中，或 `ValuePattern` 不可用 |
| 录屏 | 5fps 下丢帧率 > 10%，或 stop 后资源无法释放 |
| 浏览器 | 本地表单成功率 < 95%，或浏览器启动不稳定 |

这样 Phase 0 结束时能更清楚地决定是否切换方案。

## 4. 可选补充

### 4.1 增加 `poc-report.json` schema

当前文档给了报告示例，但没有 schema。建议补一个最小 JSON Schema 或 TypeScript 类型：

```typescript
interface PocReport {
  startedAt: string;
  environment: EnvironmentInfo;
  results: PocResult[];
}

interface PocResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  metrics: Record<string, number | string | boolean>;
  artifacts: string[];
  notes: string[];
}
```

### 4.2 明确 artifact 命名规范

建议统一：

```text
tests/output/<poc-name>/<timestamp>/
  report.json
  before.png
  after.png
  ui-tree.json
  recording.mp4
  metrics.json
```

这样不会让多个脚本的输出互相覆盖。

### 4.3 增加跳过条件

部分 PoC 在环境不满足时应标记为 `skipped`，而不是失败。

例如：

- 未安装 FFmpeg，录屏编码测试 skipped。
- 非 125% / 150% DPI 环境，相关 DPI 用例 skipped。
- 未安装 Chrome / Edge，浏览器 channel 测试 skipped。

## 5. 结论

这版设计已经不需要大改，可以进入实现。开工前建议只做轻量修正：

1. 同步 Week 1 Day 4 的旧描述。
2. 拆分只读和交互 PoC 命令。
3. 补 `ElementQuery` 接口。
4. 拆分记事本和 Chrome 的 UIA 指标。
5. 录屏增加内存和资源释放指标。
6. Electron UI 增加二次确认和倒计时。
7. 将 Plan B 切换条件改成可量化阈值。

完成这些修正后，Phase 0 设计可以作为实际开发依据。
