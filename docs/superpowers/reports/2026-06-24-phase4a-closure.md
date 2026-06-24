# Phase 4A 收口记录

日期：2026-06-24

## 当前提交

- `d3cabdb feat: add recording teaching UI`
- `40ac879 fix(桌面端): 稳定数据目录并补充工作流导入入口`

当前分支状态：`master...origin/master [ahead 2]`。

## 已完成内容

- Workflows 页面已接入录屏教学面板。
- 录屏教学 UI 支持 active-window / fullscreen 范围选择、summary / detailed 隐私模式、goal / notes 输入。
- detailed 模式启动前需要用户确认隐私提示。
- 停止录制后可加载 timeline 摘要，展示 keyframe、event、context、warning 数量。
- 用户可构建 provider manifest，并在确认后生成 draft。
- 生成的 recording draft 会回填到现有 workflow editor。
- recording 生成保存路径会使用 `recording-teach` 版本来源。
- main/core 层已加 active session 锁，避免 renderer 状态绕过单会话限制。
- provider manifest 在生成 draft 前会进行服务端校验，renderer 确认只作为 UI 信号。
- 桌面端数据目录已稳定化，开发模式固定到 workspace 根 `.agivar-dev`，打包模式使用 Electron `userData`。
- 启动时会尝试从旧 `appPath/.agivar-dev` 迁移数据，不覆盖已有 `agivar.db`。
- Workflows 页面新增 YAML / JSON 工作流导入入口。

## 自动化验证

已运行并通过：

```bash
pnpm vitest run packages/desktop/tests/data-dir.test.ts packages/desktop/tests/workflow-import-model.test.ts packages/desktop/tests/workflow-editor-model.test.ts packages/desktop/tests/workflow-ipc.test.ts packages/desktop/tests/recording-teach-model.test.ts packages/desktop/tests/recording-teach-ipc.test.ts
```

结果：6 个测试文件通过，47 个测试通过。

已运行并通过：

```bash
pnpm --filter @agivar/core build
pnpm --filter @agivar/desktop build
git diff --check
git status --short --branch
```

说明：`@agivar/desktop build` 仍会输出既有 Vite / Rollup external 与 eval 警告，构建退出码为 0。

已新增并通过 renderer 级别 smoke：

```bash
node packages/desktop/scripts/phase4a-recording-ui-smoke.mjs
pnpm vitest run packages/desktop/tests/phase4a-recording-ui-smoke.test.ts
```

覆盖范围：打开构建后的 renderer、通过 `Ctrl+Shift+W` 进入 Workflows、验证录屏教学面板和导入入口可见、验证 detailed 隐私确认门禁。

## 手工 smoke 状态

Phase 4A 计划要求真实 Electron 窗口手工 smoke：

- 打开 Workflows 页面。
- 验证 recording teaching panel 可见。
- 启动 active-window recording。
- 停止 recording。
- 验证 timeline counts 出现。
- 构建 manifest。
- 确认 manifest 并生成 draft。
- 验证 editor 字段被填充，且 `sourceType` 为 `recording`。
- 验证 detailed 模式未确认隐私提示前不能启动。
- 验证保存后的 recording-generated version 来源为 `recording-teach`。

当前记录：已补 renderer 级别自动 smoke，但未声明完成真实 Electron 主进程录屏手工 smoke。原因是真实 start / stop 仍依赖当前桌面窗口、active-window 捕获和本机权限状态。进入 Phase 4B 前建议补做一次人工确认，或在后续 hardening 中修复构建产物直接由 Electron CLI 启动时的 `require('electron')` 解析问题后，再升级为完整 Electron smoke。

## Phase 4A+ / Phase 4C Follow-up

以下事项不阻塞 Phase 4A 当前代码合入，但应进入后续计划：

- 增加轻量录制条窗口，由 main-process recording state event 驱动。
- 增加 `recordingTeach.onStateChanged(listener)` 事件订阅，供主窗口、录制条、历史页共用。
- 增加录屏历史：列表、重命名、删除、懒加载 keyframe 预览。
- 增加 discard、cancel-processing、retry、reprocess 控制。
- 增加 provider 生成过程的取消和恢复语义。
- 增加 artifact delete / exclude IPC 与 UI 控制。
- 增加 persisted note / annotation editing IPC，避免只保存在面板局部状态。
- 增加启动时 orphan `recording` / `stopping` session 清理。
- 增加 app quit 时 active teaching session 清理。
- 增加录屏 artifact 目录大小统计、清理提示和缺失文件治理。
- 增加权限 preflight、选定屏幕范围偏好、数据目录设置入口。
- 删除 artifact 后要隐藏或失效对应 evidence，避免 draft 使用不存在的素材。

## 下一步建议

1. 先推送当前 2 个本地提交，避免 Phase 4A 变更继续堆积在本地。
2. 执行或自动化 Phase 4A 真实 Electron 手工 smoke。
3. 进入 Phase 4B：real provider payload builder、manifest 确认边界、annotations、失败重试与 5 个代表录屏 benchmark。
