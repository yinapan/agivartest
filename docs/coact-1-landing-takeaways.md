# CoAct-1 对 Agivar 落地方案的借鉴建议

> 日期：2026-06-23  
> 相关文档：[PROJECT_UNDERSTANDING.md](./PROJECT_UNDERSTANDING.md)、[落地方案.md](../落地方案.md)  
> 参考项目：[SalesforceAIResearch/CoAct-1](https://github.com/SalesforceAIResearch/CoAct-1)、[CoAct-1 论文](https://arxiv.org/abs/2508.03923)

## 一句话结论

CoAct-1 最值得借鉴的不是「提前开放 Python/Bash 脚本」，而是它把桌面任务拆成两类动作：**程序化动作**和 **GUI 动作**，再由主控 Agent 根据任务状态选择最合适的执行方式。

对 Agivar 来说，第一版继续不开放任意脚本执行是正确的。但阶段 1 应提前引入「安全程序化动作层」：用白名单工具完成文件、表格、浏览器 DOM、状态校验等可程序化任务，把任意脚本执行继续后置到阶段 5。

## CoAct-1 的关键启发

### 1. 主控 Agent 不应只做 GUI 点击

CoAct-1 的核心架构是 `Orchestrator -> Coding Agent / GUI Operator -> DesktopEnv`。主控 Agent 负责观察任务、拆解目标、选择执行通道，而不是一直基于截图逐步点击。

Agivar 当前已有 `AgentService`、`TaskPlanner`、`ToolRouter`、`StepExecutor`，已经具备类似的演进基础。建议把执行模式显式化：

| 执行模式 | 适用场景 | 首版实现 |
|---|---|---|
| `browser` | 浏览器页面、表单、DOM 文本抽取 | Playwright |
| `uia` | Windows 原生控件 | UI Automation |
| `coordinate` | UIA/DOM 不可用的兜底点击 | 鼠标键盘 |
| `programmatic` | 文件、表格、结构化数据、状态校验 | 白名单工具 |
| `human` | 密码、验证码、高风险、不确定状态 | 人工接管 |

这比单纯增加一个「脚本工具」更稳，因为它保留了产品安全边界，也更符合当前 TypeScript / Electron / Rust 架构。

### 2. 提前做「程序化动作」，不要提前做任意脚本

CoAct-1 证明：文件、表格、文档、配置类任务如果只靠 GUI 操作，会慢且脆；用代码直接处理更稳定、更容易验证。

但 CoAct-1 面向 VM/评测环境，Agivar 面向用户真机。两者安全边界不同，所以不应照搬 Python/Bash 执行。

建议阶段 1 增加以下安全程序化工具：

| 工具能力 | 边界 | 用途 |
|---|---|---|
| 文件读取 | 仅限用户授权目录和应用数据目录 | 检查文件是否存在、读取文本 |
| 文件复制/移动 | 禁止覆盖，覆盖必须确认 | 导出、备份、整理文件 |
| CSV/Excel 读取 | 默认只读 | 批量任务输入、数据校验 |
| CSV/Excel 简单写入 | 限授权文件，写前生成备份 | 填充结果、生成报告 |
| DOM 文本抽取 | 仅托管浏览器会话 | 页面状态校验 |
| 结构化状态校验 | 无副作用 | 替代纯视觉判断 |

这些工具可以吃到 CoAct-1「Coding as Actions」的收益，但不会引入任意代码执行的风险。

### 3. 子任务摘要要证据导向

CoAct-1 的 Coding Agent 完成后，会把命令、输出、副作用和验证结果总结给 Orchestrator。这个设计对桌面自动化非常重要，因为失败往往来自多个因素叠加：窗口状态、弹窗、模型判断、文件格式、延迟、控件定位等。

Agivar 已经规划了 `TaskStepLog`，建议扩展为更适合复盘和教学生成的结构：

```text
TaskStepLog
├── execution_mode        // browser | uia | coordinate | programmatic | human
├── action                // 实际动作
├── before_state          // 执行前状态摘要
├── after_state           // 执行后状态摘要
├── artifacts[]           // 生成或读取的文件、截图、DOM 文本、UIA 快照
├── evidence_summary      // 本步骤成功/失败的证据
├── side_effects[]        // 文件变更、页面跳转、窗口变化等
├── verification_result   // pass | fail | skipped
└── failure_info          // 失败类型、诊断、下一步建议
```

这样后续可以同时服务 3 件事：失败复盘、用户信任、教学模式的流程记忆生成。

### 4. 评测集应从「演示流程」升级为「可打分任务」

当前落地方案已经要求阶段 1 建立 10-20 条真实桌面流程评测集，这一点和 CoAct-1 / OSWorld 的方向一致。建议进一步把评测数据结构化：

```yaml
id: browser-form-submit-001
instruction: "打开本地表单页，填写姓名和邮箱并提交"
setup:
  - open_url: "http://localhost:xxxx/form"
allowed_tools:
  - browser
  - screenshot
  - programmatic
expected_getter:
  type: dom_text
  selector: "#result"
metric:
  type: text_contains
  value: "提交成功"
risk_level: low
cleanup:
  - close_browser
```

阶段 1 不一定需要完整评测平台，但至少要让每条评测具备：

- 初始状态；
- 允许工具；
- 成功条件；
- 结果读取方式；
- 失败日志；
- 可重复执行的清理步骤。

这能避免模型和 Prompt 调整只靠主观演示判断。

### 5. GUI 后端要可插拔，但 MVP 不追求多模型

CoAct-1 支持 OpenAI Computer Use、Claude Computer Use、UI-TARS、OpenCUA 等多个 GUI 后端。Agivar 不需要在 MVP 同时接入多个后端，但应该保留抽象边界：

```text
TaskPlanner
  -> ToolRouter
    -> BrowserAdapter
    -> UiaAdapter
    -> InputAdapter
    -> ProgrammaticAdapter
    -> FutureVisionOperatorAdapter
```

短期仍以 Playwright、UIA、输入模拟为主。未来引入视觉 GUI Agent 时，只需要新增 Adapter，而不是重写执行主循环。

## 对落地方案的具体调整建议

### 阶段 1：增加安全程序化动作层

在「执行闭环 MVP」中新增一个 P0 模块：

| 模块 | 功能点 | 优先级 |
|---|---|---|
| 安全程序化动作层 | 文件、CSV/Excel、DOM 文本、结构化状态校验的白名单工具 | P0 |

同时把统一工具接口从纯桌面动作扩展为：

```text
Desktop Tool Interface
├── observe_screen()
├── observe_active_window()
├── get_ui_tree(window_id)
├── browser_click(selector)
├── browser_fill(selector, value)
├── read_file(path, scope)
├── copy_file(source, target, policy)
├── read_table(path, range)
├── write_table(path, patch, backup_policy)
├── click(target)
├── type_text(text)
├── press_hotkey(keys)
├── ask_user_takeover(reason)
└── verify_state(expected)
```

注意：这里的 `read_table`、`write_table` 是受限工具，不是让模型生成 Python 脚本。

### 阶段 2：流程编辑器显示执行模式和证据

流程编辑器不只显示「点击哪里、输入什么」，还应显示：

- 该步骤使用的执行模式；
- 定位策略；
- 预期状态；
- 风险等级；
- 执行证据；
- 失败时的降级策略。

这能让用户理解为什么某些步骤走 Playwright，某些步骤走 UIA，某些步骤必须人工接管。

### 阶段 5：任意脚本执行仍然后置

`Python 脚本引擎` 不建议提前。上线条件仍应保持严格：

- 用户每次显式批准；
- 运行前展示完整代码；
- 限制工作目录；
- 默认无网络；
- 默认禁止系统命令；
- 有超时、日志和中止机制；
- 高风险文件操作必须备份或确认。

阶段 1 的目标是引入「可程序化能力」，不是引入「任意代码执行」。

## 不建议照搬的部分

| CoAct-1 设计 | 不建议照搬原因 | Agivar 建议 |
|---|---|---|
| Python/Bash 任意执行 | CoAct-1 跑在 VM/评测环境，Agivar 跑在用户真机 | 首版只做白名单程序化工具 |
| AG2/Autogen 多 Agent 栈 | 当前项目已是 TypeScript / Electron / Rust 路线 | 保留现有 AgentService 架构 |
| VM 内 Flask 控制服务 | 适合 benchmark，不适合桌面产品主路径 | 用本地 native 模块和受控 Adapter |
| 大而全应用评测 | MVP 范围会失控 | 先限定浏览器、表格、少数 Windows 应用 |
| 多 GUI 模型同时接入 | 增加集成和成本复杂度 | 保留接口，后续按需接入 |

## 推荐落地顺序

1. 在 `StepAction` 中增加 `programmatic` 类型或专门的文件/表格动作类型。
2. 在 `ToolAdapters` 中新增 `programmatic` adapter。
3. 在 `ToolRouter` 中接入只读文件、CSV/Excel 读取、DOM 文本抽取等低风险工具。
4. 扩展 `TaskStepLog`，记录 `execution_mode`、`artifacts`、`evidence_summary` 和 `side_effects`。
5. 将阶段 1 评测集改造成 `setup + allowed_tools + getter + metric + cleanup` 结构。
6. 在风险分级中明确：程序化写入、覆盖、删除、网络访问均不能默认自动执行。

## 最终判断

CoAct-1 给 Agivar 的最大启发是：**桌面 Agent 的可靠性不来自更会点屏幕，而来自能在 GUI、结构化工具和人工接管之间正确切换。**

因此，Agivar 的落地方案应坚持「安全优先、固定工具优先、任意脚本后置」，同时尽早把程序化动作纳入执行闭环。这样既能提升稳定性和效率，也不会牺牲桌面产品最关键的用户信任。
