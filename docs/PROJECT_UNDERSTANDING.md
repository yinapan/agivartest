# CoAct-1 项目深度理解

## 项目定位

CoAct-1 是论文「CoAct-1: Computer-using Agents with Coding as Actions」的官方实现。它面向桌面自动化评测任务，让智能体在真实或虚拟桌面中完成自然语言指令，例如修改 Office 文档、操作 Chrome、编辑图片、配置系统设置、处理 VS Code 项目等。

项目的核心思想不是只让一个 GUI Agent 逐步点击屏幕，而是让主控智能体根据任务类型在两类能力之间调度：

- **Coding as Actions：** 通过 Python 或 Bash 直接读写文件、调用系统命令、批量处理数据。
- **Computer Use / GUI Actions：** 通过截图驱动的 GUI Agent 执行点击、输入、滚动、快捷键等操作。

这种混合模式适合 OSWorld 这类桌面任务：文件型任务往往用代码更稳定，界面确认、应用内状态切换和最终视觉验证则需要 GUI 能力。

## 顶层目录

| 路径 | 职责 |
| --- | --- |
| `run_coact.py` | 主运行入口。读取评测任务，创建环境和 Agent，多进程并行执行任务，保存结果。 |
| `mm_agents/coact/` | 当前主线 CoAct Agent 实现，包含主控 Agent、Coding Agent、CUA/GUI Agent 后端和提示词。 |
| `desktop_env/` | 桌面环境抽象，负责启动 VM/容器、控制远端桌面、初始化任务、采集状态、执行评测。 |
| `evaluation_examples/` | OSWorld 风格任务集，按应用域存放 JSON 任务配置和测试集合。 |
| `coact/` | 早期或兼容实现，结构与 `mm_agents/coact` 相近，但当前 `run_coact.py` 不直接引用。 |
| `assets/` | README 展示资源。 |
| `utils/` | 辅助脚本，目前只有少量工具代码。 |
| `requirements.txt` | Python 依赖清单，覆盖 Agent、桌面控制、评测、云 Provider 和多模态模型调用。 |
| `OAI_CONFIG_LIST` | AG2/Autogen 风格的模型配置模板。 |

## 一句话运行链路

`run_coact.py` 读取任务 JSON -> 创建 `OrchestratorAgent` 与 `OrchestratorUserProxyAgent` -> `DesktopEnv` 启动并重置 VM/容器 -> 主控 Agent 根据截图和任务说明调用 `call_programmer` 或 `call_gui_operator` -> 环境执行代码或 GUI 动作 -> 保存轨迹、截图、日志 -> 调用 evaluator 计算分数。

## 运行入口：`run_coact.py`

`run_coact.py` 是项目最重要的入口文件，主要分成 3 层：

### 1. 参数配置

`config()` 定义了运行所需参数：

- 环境参数：`--provider_name`、`--path_to_vm`、`--screen_width`、`--screen_height`、`--region`、`--remote_ip_port`。
- Agent 参数：`--mode`、`--orchestrator_model`、`--coding_model`、`--summarizer_model`、`--cua_model`。
- 步数预算：`--orchestrator_max_steps`、`--coding_max_steps`、`--cua_max_steps`、`--cut_off_steps`。
- 任务集合：`--test_all_meta_path`、`--test_config_base_dir`、`--domain`。
- 结果输出：`--result_dir`、`--num_envs`、`--log_level`。

### 2. 单任务执行

`process_task()` 负责执行一个 `(domain, ex_id, cfg)` 任务：

1. 从 `OAI_CONFIG_LIST` 加载 orchestrator 模型配置。
2. 根据 `mode` 创建不同系统提示词的 `OrchestratorAgent`。
3. 创建 `OrchestratorUserProxyAgent`，它内部会初始化 `DesktopEnv`。
4. 调用 `orchestrator_proxy.reset(task_config=task_config)` 重置环境。
5. 获取初始截图，并把截图和任务指令一起发给主控 Agent。
6. 主控 Agent 通过工具调用执行子任务。
7. 保存 `chat_history.json`、初始截图、子 Agent 输出、最终 `result.txt`。
8. 若总步数超过 `cut_off_steps`，直接记 0 分；否则调用 `env.evaluate()`。

### 3. 批量执行

主函数读取 `test_all_meta_path`，把未完成任务放入任务列表，再用 `multiprocessing.Pool` 按 `num_envs` 并行执行。结果目录默认是：

```text
results_coact/coact_<mode>/<domain>/<example_id>/
```

每个任务目录通常会包含：

- `initial_screenshot_orchestrator.png`
- `chat_history.json`
- `result.txt`
- `err_reason.txt`（异常时）
- `cua_output_*`
- `coding_output_*`

## Agent 架构

当前主线代码位于 `mm_agents/coact/`。

### `OrchestratorAgent`

`mm_agents/coact/orchestrator_agent.py` 中的 `OrchestratorAgent` 是主控智能体。它继承 AG2/Autogen 的 `MultimodalConversableAgent`，负责看截图、理解用户指令、制定计划，并选择调用工具。

它暴露的核心工具有两个：

| 工具 | 含义 | 适用场景 |
| --- | --- | --- |
| `call_programmer` | 调用 Coding Agent，通过 Python/Bash 与系统交互。 | 文件操作、表格/文档批量修改、脚本化验证、系统命令。 |
| `call_gui_operator` | 调用 GUI Agent，通过截图和动作循环操作桌面。 | 点击菜单、应用内设置、视觉确认、无法稳定脚本化的流程。 |

`mode` 会决定启用哪些工具：

| mode | 工具能力 |
| --- | --- |
| `hybrid` | 同时启用 Coding Agent 和 GUI Operator。 |
| `coact_cua_only` | 只启用 GUI Operator。 |
| `coact_coding_only` | 只启用 Coding Agent。 |
| `coact_opensource_sft` | 用于开源 SFT 风格实验，提示词和返回行为略有不同。 |
| `human` | 参数中保留，但当前主流程仍围绕自动 Agent。 |

### `OrchestratorUserProxyAgent`

同文件中的 `OrchestratorUserProxyAgent` 是工具执行者和环境持有者。它不是真人用户，而是代理主控 Agent 与环境交互的桥：

- 初始化 `DesktopEnv`。
- 注册 `call_gui_operator` 与 `call_programmer` 的函数实现。
- 保存子任务轨迹到 `history_save_dir`。
- 在每次子 Agent 完成后，把结果摘要和截图返回给主控 Agent。

如果指定 `remote_ip_port`，它会走 `docker_remote_fc_v1` 远程容器 Provider；否则按 `provider_name` 和 `path_to_vm` 创建本地或云端环境。

### Coding Agent

`mm_agents/coact/coding_agent.py` 定义了 Coding Agent 的系统提示词和终端代理。

关键角色：

- `CODER_SYSTEM_MESSAGE`：要求模型只输出一个 `bash` 或 `python` fenced code block，执行后检查结果，完成时回复 `TERMINATE`。
- `TerminalProxyAgent`：覆写 `run_code()`，把代码交给 `env_step(env, code, "coding")`，最终通过 VM 内 Flask 服务执行。
- `CONVERSATION_REVIEW_PROMPT`：Coding Agent 完成后，summarizer 会把程序员和终端的对话总结成证据导向的报告，供 Orchestrator 判断下一步。

Coding Agent 不在宿主机直接执行任务代码，而是在目标桌面环境里执行：

- Bash 走 `PythonController.run_bash_script()`。
- Python 走 `PythonController.run_python_script()`。

这点很重要，因为被修改的文件、应用配置和桌面状态都在 VM/容器内部。

### GUI / CUA Agent

`mm_agents/coact/cua_agent/` 下封装了多个 GUI Agent 后端：

| 文件 | 后端 |
| --- | --- |
| `openai_cua_agent.py` | OpenAI `computer-use-preview`。 |
| `claude_cua_agent.py` | Claude Computer Use API。 |
| `claude_cua_agent_bedrock.py` | Bedrock 上的 Claude Computer Use。 |
| `uitars_cua_agent.py` | UI-TARS。 |
| `opencua_cua_agent/` | OpenCUA。 |

`OrchestratorUserProxyAgent._call_gui_operator()` 根据 `cua_model` 选择运行函数：

- `computer-use-preview` -> `run_openai_cua`
- 包含 `claude` -> `run_claude_cua`
- 包含 `anthropic` -> `run_claude_cua_bedrock`
- 包含 `UI-TARS-1.5` -> `run_uitars_cua`
- 包含 `OpenCUA` -> `run_opencua_cua`

不同后端的输出格式不同，但最终都会转成 `pyautogui` 代码或特殊动作：

- `WAIT`
- `DONE`
- `FAIL`

然后交给 `DesktopEnv.step()` 执行。

## 桌面环境层

`desktop_env/desktop_env.py` 定义 `DesktopEnv`，它是对 OSWorld 桌面环境的核心封装。

### 环境启动

`DesktopEnv.__init__()` 根据 `provider_name` 调用 `create_vm_manager_and_provider()`，支持：

- `vmware`
- `virtualbox`
- `docker`
- `docker_remote_fc`
- `docker_remote_fc_v1`
- `aws`
- `gcp`
- `azure`
- `aliyun`
- `volcengine`

环境启动后会创建两个控制器：

- `PythonController`：通过 HTTP 调用 VM 内的 Flask 服务，执行截图、命令、脚本、文件、窗口等操作。
- `SetupController`：根据任务 JSON 中的 `config` 初始化环境，例如下载文件、上传文件、启动应用、打开浏览器标签、设置代理。

### 环境重置

`reset()` 会完成几件事：

1. 根据 Provider 决定是否恢复快照或重启容器。
2. 设置屏幕分辨率。
3. 读取任务的 `instruction`、`config`、`evaluator`。
4. 执行 `SetupController.setup()`。
5. 返回初始 observation。

Observation 包含：

```python
{
    "screenshot": bytes,
    "accessibility_tree": str | None,
    "terminal": str | None,
    "instruction": str,
}
```

### 动作执行

`DesktopEnv.step(action)` 是所有 GUI 动作的落点：

- `WAIT`：等待。
- `FAIL`：标记任务失败或不可行。
- `DONE`：标记任务完成。
- `computer_13` 动作空间：走结构化动作。
- `pyautogui` / `claude_computer_use` / `autoglm_computer_use`：执行 pyautogui Python 命令。

代码里还特别修复了 PyAutoGUI 输入 `<` 时可能变成 `>` 的问题，说明桌面自动化中存在很多细小但会影响评测的环境差异。

## VM 内服务

`desktop_env/server/main.py` 是运行在目标机器里的 Flask 服务。Host 侧的 `PythonController` 和 `SetupController` 都通过它控制桌面。

常用接口包括：

| 接口 | 功能 |
| --- | --- |
| `/screenshot` | 截屏，并尽量附带鼠标光标。 |
| `/accessibility` | 获取可访问性树。 |
| `/terminal` | 获取当前终端文本。 |
| `/execute` | 执行命令。 |
| `/run_python_script` | 执行 Python 脚本并返回 stdout/stderr/returncode。 |
| `/run_bash_script` | 执行 Bash 脚本并返回 stdout/stderr/returncode。 |
| `/setup/launch` | 启动应用。 |
| `/setup/upload` | 上传文件到 VM。 |
| `/setup/open_file` | 打开文件并等待窗口出现。 |
| `/set_screen_resolution` | 设置屏幕分辨率。 |
| `/start_recording`、`/end_recording` | 录屏。 |

该服务假设 VM 中有固定用户和依赖环境。README 与 `desktop_env/server/README.md` 都强调默认账号是：

```text
user / password
```

## 评测体系

评测任务位于 `evaluation_examples/`。任务 JSON 大致包含：

- `id`：任务唯一 ID。
- `snapshot`：初始快照类型。
- `instruction`：自然语言任务。
- `config`：环境初始化步骤。
- `related_apps`：相关应用。
- `evaluator`：评测配置。
- `proxy`：是否需要代理。

`DesktopEnv._set_evaluator_info()` 会把 evaluator 配置解析成：

- `metric`：来自 `desktop_env/evaluators/metrics` 的打分函数。
- `result_getter`：来自 `desktop_env/evaluators/getters` 的实际结果读取函数。
- `expected_getter`：期望结果读取函数。
- `metric_options`：metric 参数。

`DesktopEnv.evaluate()` 的基本流程是：

1. 执行 evaluator 的 `postconfig`，让应用状态稳定或重启。
2. 如果任务是 `infeasible`，检查最后动作是否为 `FAIL`。
3. 调用 result getter 从 VM 或缓存中拿实际结果。
4. 调用 expected getter 或规则配置拿期望结果。
5. 调用 metric 计算 0 到 1 的分数。
6. 多 metric 时按 `and` 或 `or` 聚合。

评测覆盖的领域很多：

- Chrome：标签页、设置、书签、Cookie、历史记录、PDF、网页内容。
- LibreOffice Writer/Calc/Impress：文档、表格、演示文稿内容和格式。
- GIMP：图像结构、亮度、饱和度、尺寸、导出文件。
- VLC：播放状态、配置、音视频对比。
- Thunderbird：配置、过滤器、文件夹。
- VS Code：设置、插件、文件内容、测试套件。
- OS：桌面快捷方式、收藏应用、时区、文件移动等。

## 数据与控制流

### 混合模式的典型流程

1. Orchestrator 看到初始截图和用户任务。
2. 如果任务涉及文件或结构化数据，优先调用 `call_programmer`。
3. Coding Agent 在 VM 内执行脚本，修改文件或系统状态。
4. Summarizer 归纳 Coding Agent 的命令、输出、副作用和验证结果。
5. Orchestrator 根据摘要决定是否继续。
6. 如果需要界面确认或应用内操作，调用 `call_gui_operator`。
7. GUI Agent 基于截图迭代执行 `pyautogui` 动作。
8. Orchestrator 收到最终截图和 GUI 摘要后决定 `TERMINATE` 或继续修正。
9. `run_coact.py` 调用 evaluator 打分。

### 结果保存

项目保存了足够多的中间产物，方便复盘：

- Orchestrator 对话历史。
- CUA 每一步截图。
- CUA 输入历史。
- Coding Agent 对话历史。
- Coding 子任务说明。
- 系统提示词。
- 最终分数。
- 异常栈。

这些文件对调试非常关键，因为桌面自动化失败常常不是单一代码错误，而是模型决策、环境状态、应用弹窗、文件格式、延迟等因素叠加。

## 依赖与运行环境

项目是 Python 项目。README 要求 Python >= 3.9，`.mise.toml` 则声明 Python 3.12 并自动创建 `.venv`。

依赖大致分成几类：

- Agent 框架：`ag2`、`openai`、`google-generativeai`、`groq`、`dashscope`。
- 多模态与模型运行：`torch`、`transformers`、`accelerate`。
- 桌面控制：`pyautogui`、`pynput`、`playwright`、`PyGetWindow`。
- 文档/表格/媒体评测：`openpyxl`、`python-docx`、`python-pptx`、`pypdf`、`pdfplumber`、`librosa`、`opencv-python`、`ImageHash`、`scikit-image`。
- Provider：`docker`、`boto3`、`azure-identity`、`azure-mgmt-compute`、`azure-mgmt-network`。
- 服务端：`flask`、`requests-toolbelt`。

运行前通常需要：

1. 准备 VM 或 Docker 桌面环境。
2. 确保 VM 内运行 `desktop_env/server/main.py` 对应服务。
3. 配好 `OAI_CONFIG_LIST`。
4. 导出 OpenAI 或其他模型所需的 API Key。
5. 根据任务需要配置 Chrome、LibreOffice、VLC、GIMP、VS Code 等软件。

## 与 OSWorld 的关系

这个项目明显基于 OSWorld 的接口和评测数据组织方式做扩展：

- `desktop_env` 延续了 OSWorld 环境抽象。
- `evaluation_examples` 是 OSWorld 风格的 benchmark 样例。
- README 中安装说明也写着「From OSWorld」。
- `mm_agents/coact` 在此基础上加入 CoAct 主控、Coding Agent 和多种 CUA 后端。

可以把该项目理解为：

> OSWorld 桌面环境 + AG2/Autogen 多 Agent 编排 + Coding Agent + 多种 CUA 后端 + CoAct 论文实验入口。

## 主要扩展点

### 添加新任务

新增任务通常需要：

1. 在 `evaluation_examples/examples/<domain>/` 下新增任务 JSON。
2. 在 `config` 中描述初始环境，例如下载文件、启动应用、打开 URL。
3. 在 `evaluator` 中选择 getter 和 metric。
4. 如现有 getter/metric 不够，在 `desktop_env/evaluators/getters` 或 `desktop_env/evaluators/metrics` 中新增函数。
5. 把任务 ID 加入对应的 `test_*.json` 集合。

### 添加新 GUI Agent 后端

可参考 `openai_cua_agent.py`、`uitars_cua_agent.py`、`opencua_cua_agent/agent.py`：

1. 实现 `run_xxx_cua(env, instruction, max_steps, save_path, ...)`。
2. 每步读取截图。
3. 调用模型生成动作。
4. 把动作转成 `pyautogui` 或 `WAIT/DONE/FAIL`。
5. 调用 `env.step()`。
6. 返回 `(history_inputs, reasoning, total_cost)`。
7. 在 `mm_agents/coact/cua_agent/__init__.py` 和 `_call_gui_operator()` 中接入。

### 添加新 Provider

Provider 需要实现启动、停止、获取 IP、恢复快照等能力：

1. 在 `desktop_env/providers/<provider>/` 下添加 `manager.py` 和 `provider.py`。
2. 在 `desktop_env/providers/__init__.py` 的 `create_vm_manager_and_provider()` 中注册。
3. 确保 Provider 返回的地址能被 `PythonController` 访问。

### 修改 Coding Agent 行为

主要看：

- `mm_agents/coact/coding_agent.py`
- `mm_agents/coact/orchestrator_agent.py` 中 `_call_programmer()`

要注意 Coding Agent 的输出格式很严格：必须是单个带语言标记的 fenced code block。否则 AG2 的代码执行链路会识别失败。

## 风险点与注意事项

1. **当前主线是 `mm_agents/coact`，不是根目录 `coact`。** 两者结构相似，改错路径会导致运行入口不生效。
2. **VM 内服务是关键依赖。** Host 侧所有截图、脚本、文件和窗口操作都依赖 `desktop_env/server/main.py`。
3. **环境一致性会强烈影响分数。** 屏幕分辨率、Chrome remote debugging、LibreOffice 版本、字体、VLC HTTP 接口、Xorg/Wayland 都可能导致同一任务结果不同。
4. **任务失败未必是模型能力问题。** 常见原因包括文件下载失败、应用弹窗、窗口未激活、远程调试端口失效、评测 getter 路径硬编码、代理配置不可用。
5. **`OAI_CONFIG_LIST` 是模板，不能直接用于真实运行。** 需要替换 `api_key`，部分 CUA 后端还依赖环境变量或自定义 endpoint。
6. **`run_coact.py` 会跳过已有 `result.txt` 的任务。** 重新跑任务前需要清理对应结果目录。
7. **Docker 中断后可能残留容器。** README 建议异常中断后清理 Docker 容器。
8. **并行度需要谨慎。** `num_envs` 太高会受 CPU、内存、显存、VM 启动速度、API 限流影响。

## 推荐阅读顺序

如果要继续开发或调试，建议按这个顺序读代码：

1. `README.md`：了解运行方式和外部依赖。
2. `run_coact.py`：理解任务如何被调度。
3. `mm_agents/coact/orchestrator_agent.py`：理解主控和两个工具。
4. `mm_agents/coact/coding_agent.py`：理解代码执行子 Agent。
5. `mm_agents/coact/cua_agent/openai_cua_agent.py`：理解 GUI Agent 的标准循环。
6. `desktop_env/desktop_env.py`：理解环境生命周期和评测。
7. `desktop_env/controllers/python.py`：理解 Host 如何控制 VM。
8. `desktop_env/server/main.py`：理解 VM 内服务能力。
9. `evaluation_examples/examples/<domain>/*.json`：理解任务数据结构。
10. `desktop_env/evaluators/getters` 与 `desktop_env/evaluators/metrics`：理解最终分数怎么来。

## 心智模型

理解这个项目最有用的模型是「三层闭环」：

- **决策层：** Orchestrator 负责计划和调度。
- **执行层：** Coding Agent 和 GUI Agent 分别执行脚本化动作与界面动作。
- **环境层：** DesktopEnv 与 VM 内 Flask 服务提供状态、动作和评测。

CoAct-1 的价值就在于把「写代码」本身作为桌面智能体的一种动作。当任务涉及文件、表格、文档、配置或可程序化状态时，代码动作通常比纯 GUI 点击更高效、更可验证；当任务必须经过真实应用界面或需要视觉确认时，再交给 GUI Agent 补足闭环。
