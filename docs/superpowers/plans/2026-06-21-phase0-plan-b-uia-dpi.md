# Phase 0 Plan B：UIA + DPI

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现 Windows UI Automation（UIA）控件读写和 DPI 坐标映射模块，验证记事本编辑区读写、Chrome 窗口识别、多缩放率下的点击精度。

**前置条件：** Plan A 已完成——monorepo 可构建，native addon 在 Electron 中加载通过，截图/输入/浏览器模块已实现。

**架构：** UIA 逻辑在 Rust `uiautomation` crate 中实现，通过 napi-rs 导出。TypeScript 层封装 UiaOptions、timeout 管理和 worker 线程调度。DPI 模块混合使用 nut.js 和 native 补充。

**设计规格：** `docs/specs/2026-06-21-phase0-desktop-poc-design.md` 第 5-6 章

---

## 文件结构

### 将要创建或修改的文件

```
# Rust UIA 模块
packages/native/Cargo.toml           — 添加 uiautomation 依赖
packages/native/src/lib.rs            — 添加 UIA + DPI 模块导出
packages/native/src/uia.rs            — UIA 控件树读取、查找、读写
packages/native/src/dpi.rs            — Windows DPI API 补充

# TypeScript UIA 层
packages/core/src/tools/uia.ts        — UIA TypeScript 封装 + UiaOptions + timeout
packages/core/src/tools/dpi.ts        — DPI 坐标映射
packages/core/src/index.ts            — 添加 uia + dpi 导出

# PoC 验证脚本
tests/poc-uia.ts                      — UIA 验证（记事本 + Chrome）
tests/poc-dpi.ts                      — DPI 映射验证
tests/poc-runner.ts                   — 添加 uia + dpi 到 runner
```

---

## 任务 1：Rust UIA 模块 — Cargo 依赖 + 基础结构

**文件：**
- 修改：`packages/native/Cargo.toml`
- 创建：`packages/native/src/uia.rs`
- 修改：`packages/native/src/lib.rs`

- [ ] **步骤 1：更新 `packages/native/Cargo.toml` 添加依赖**

在 `[dependencies]` 下添加：

```toml
[dependencies]
napi = { version = "3", features = ["napi9"] }
napi-derive = "3"
uiautomation = "0.8"
windows = { version = "0.58", features = [
  "Win32_UI_HiDpi",
  "Win32_Graphics_Gdi",
  "Win32_UI_WindowsAndMessaging",
] }
```

- [ ] **步骤 2：创建 `packages/native/src/uia.rs`**

```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::time::{Duration, Instant};
use uiautomation::core::UIAutomation;
use uiautomation::controls::ControlType;

#[napi(object)]
pub struct UiaOptions {
    pub timeout_ms: Option<u32>,
    pub max_depth: Option<u32>,
    pub max_nodes: Option<u32>,
    pub include_offscreen: Option<bool>,
}

impl Default for UiaOptions {
    fn default() -> Self {
        Self {
            timeout_ms: Some(2000),
            max_depth: Some(8),
            max_nodes: Some(1000),
            include_offscreen: Some(false),
        }
    }
}

#[napi(object)]
pub struct ElementQuery {
    pub automation_id: Option<String>,
    pub name: Option<String>,
    pub control_type: Option<String>,
    pub class_name: Option<String>,
    pub name_match: Option<String>, // "exact" | "contains" | "regex"
    pub max_depth: Option<u32>,
    pub max_nodes: Option<u32>,
    pub index: Option<u32>,
    pub include_offscreen: Option<bool>,
}

#[napi(object)]
#[derive(Clone)]
pub struct UiaNode {
    pub name: String,
    pub control_type: String,
    pub automation_id: String,
    pub class_name: String,
    pub bounding_rect: UiaRect,
    pub is_enabled: bool,
    pub is_offscreen: bool,
    pub value: Option<String>,
    pub children: Vec<UiaNode>,
}

#[napi(object)]
#[derive(Clone)]
pub struct UiaRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

struct TreeWalkState {
    node_count: u32,
    max_nodes: u32,
    max_depth: u32,
    include_offscreen: bool,
    offscreen_count: u32,
    deadline: Instant,
}

impl TreeWalkState {
    fn is_over_limit(&self) -> bool {
        self.node_count >= self.max_nodes || Instant::now() > self.deadline
    }
}

fn walk_element(
    auto: &UIAutomation,
    element: &uiautomation::core::UIElement,
    depth: u32,
    state: &mut TreeWalkState,
) -> Option<UiaNode> {
    if state.is_over_limit() || depth > state.max_depth {
        return None;
    }

    let is_offscreen = element.is_offscreen().unwrap_or(false);
    if is_offscreen {
        state.offscreen_count += 1;
        if !state.include_offscreen {
            return None;
        }
    }

    state.node_count += 1;

    let rect = element.get_bounding_rectangle().unwrap_or_default();
    let value = element.get_property_value(uiautomation::types::UIProperty::ValueValue)
        .ok()
        .and_then(|v| v.get_string().ok());

    let mut children = Vec::new();
    if depth < state.max_depth {
        if let Ok(walker) = auto.create_tree_walker() {
            let mut child = walker.get_first_child(element).ok();
            while let Some(ref c) = child {
                if state.is_over_limit() { break; }
                if let Some(node) = walk_element(auto, c, depth + 1, state) {
                    children.push(node);
                }
                child = walker.get_next_sibling(c).ok();
            }
        }
    }

    Some(UiaNode {
        name: element.get_name().unwrap_or_default(),
        control_type: format!("{:?}", element.get_control_type().unwrap_or(ControlType::Custom)),
        automation_id: element.get_automation_id().unwrap_or_default(),
        class_name: element.get_classname().unwrap_or_default(),
        bounding_rect: UiaRect {
            x: rect.get_left(),
            y: rect.get_top(),
            w: rect.get_right() - rect.get_left(),
            h: rect.get_bottom() - rect.get_top(),
        },
        is_enabled: element.is_enabled().unwrap_or(false),
        is_offscreen,
        value,
        children,
    })
}

#[napi]
pub fn get_ui_tree(hwnd: i64, options: Option<UiaOptions>) -> Result<UiaNode> {
    let opts = options.unwrap_or_default();
    let timeout = Duration::from_millis(opts.timeout_ms.unwrap_or(2000) as u64);
    let deadline = Instant::now() + timeout;

    let auto = UIAutomation::new()
        .map_err(|e| Error::from_reason(format!("UIA init failed: {}", e)))?;

    let hwnd_val = hwnd as isize;
    let element = if hwnd_val == 0 {
        auto.get_root_element()
    } else {
        auto.element_from_handle(uiautomation::types::Handle::from(hwnd_val))
    }.map_err(|e| Error::from_reason(format!("element_from_handle failed: {}", e)))?;

    let mut state = TreeWalkState {
        node_count: 0,
        max_nodes: opts.max_nodes.unwrap_or(1000),
        max_depth: opts.max_depth.unwrap_or(8),
        include_offscreen: opts.include_offscreen.unwrap_or(false),
        offscreen_count: 0,
        deadline,
    };

    walk_element(&auto, &element, 0, &mut state)
        .ok_or_else(|| Error::from_reason("UIA_TIMEOUT: tree walk exceeded limits".to_string()))
}

#[napi]
pub fn find_element(hwnd: i64, query: ElementQuery, options: Option<UiaOptions>) -> Result<Option<UiaNode>> {
    let tree = get_ui_tree(hwnd, options)?;
    Ok(find_in_tree(&tree, &query, 0))
}

fn find_in_tree(node: &UiaNode, query: &ElementQuery, depth: u32) -> Option<UiaNode> {
    let max_d = query.max_depth.unwrap_or(8);
    if depth > max_d { return None; }

    if matches_query(node, query) {
        return Some(node.clone());
    }

    for child in &node.children {
        if let Some(found) = find_in_tree(child, query, depth + 1) {
            return Some(found);
        }
    }

    None
}

fn matches_query(node: &UiaNode, query: &ElementQuery) -> bool {
    if let Some(ref aid) = query.automation_id {
        if &node.automation_id != aid { return false; }
    }
    if let Some(ref ct) = query.control_type {
        if !node.control_type.contains(ct) { return false; }
    }
    if let Some(ref cn) = query.class_name {
        if &node.class_name != cn { return false; }
    }
    if let Some(ref name) = query.name {
        let match_mode = query.name_match.as_deref().unwrap_or("exact");
        match match_mode {
            "contains" => { if !node.name.contains(name.as_str()) { return false; } }
            "exact" | _ => { if &node.name != name { return false; } }
        }
    }
    true
}

#[napi]
pub fn get_element_value(hwnd: i64, query: ElementQuery) -> Result<String> {
    let found = find_element(hwnd, query, None)?;
    match found {
        Some(node) => Ok(node.value.unwrap_or_default()),
        None => Err(Error::from_reason("UIA_PATTERN_UNSUPPORTED: element not found")),
    }
}

#[napi]
pub fn set_element_value(hwnd: i64, query: ElementQuery, value: String) -> Result<()> {
    let auto = UIAutomation::new()
        .map_err(|e| Error::from_reason(format!("UIA init failed: {}", e)))?;

    let hwnd_val = hwnd as isize;
    let root = auto.element_from_handle(uiautomation::types::Handle::from(hwnd_val))
        .map_err(|e| Error::from_reason(format!("element_from_handle: {}", e)))?;

    // 使用 ValuePattern 设置值
    let condition = build_condition(&auto, &query)?;
    let target = root.find_first(uiautomation::types::TreeScope::Subtree, &condition)
        .map_err(|e| Error::from_reason(format!("find_first: {}", e)))?;

    target.set_value(&value)
        .map_err(|e| Error::from_reason(format!("set_value: {}", e)))
}

#[napi]
pub fn invoke_element(hwnd: i64, query: ElementQuery) -> Result<()> {
    let auto = UIAutomation::new()
        .map_err(|e| Error::from_reason(format!("UIA init failed: {}", e)))?;

    let hwnd_val = hwnd as isize;
    let root = auto.element_from_handle(uiautomation::types::Handle::from(hwnd_val))
        .map_err(|e| Error::from_reason(format!("element_from_handle: {}", e)))?;

    let condition = build_condition(&auto, &query)?;
    let target = root.find_first(uiautomation::types::TreeScope::Subtree, &condition)
        .map_err(|e| Error::from_reason(format!("find_first: {}", e)))?;

    target.invoke()
        .map_err(|e| Error::from_reason(format!("invoke: {}", e)))
}

fn build_condition(
    auto: &UIAutomation,
    query: &ElementQuery,
) -> Result<uiautomation::conditions::UICondition> {
    let mut conditions: Vec<uiautomation::conditions::UICondition> = Vec::new();

    if let Some(ref name) = query.name {
        conditions.push(
            auto.create_property_condition(
                uiautomation::types::UIProperty::Name,
                uiautomation::variants::Variant::from(name.as_str()),
                None,
            ).map_err(|e| Error::from_reason(format!("condition: {}", e)))?,
        );
    }

    if let Some(ref ct) = query.control_type {
        // 简化：按 class_name 或 automation_id 匹配
        if let Some(ref aid) = query.automation_id {
            conditions.push(
                auto.create_property_condition(
                    uiautomation::types::UIProperty::AutomationId,
                    uiautomation::variants::Variant::from(aid.as_str()),
                    None,
                ).map_err(|e| Error::from_reason(format!("condition: {}", e)))?,
            );
        }
    }

    if conditions.is_empty() {
        Ok(auto.create_true_condition()
            .map_err(|e| Error::from_reason(format!("true_condition: {}", e)))?)
    } else if conditions.len() == 1 {
        Ok(conditions.remove(0))
    } else {
        auto.create_and_condition_from_array(&conditions)
            .map_err(|e| Error::from_reason(format!("and_condition: {}", e)))
    }
}
```

注意：上述 Rust 代码使用 `uiautomation` crate 0.8 的 API，实际编译时可能需要根据 crate 版本微调方法名和类型。编译失败时参考 https://docs.rs/uiautomation 文档。

- [ ] **步骤 3：更新 `packages/native/src/lib.rs`**

```rust
use napi_derive::napi;

pub mod uia;
pub mod dpi;

#[napi]
pub fn ping() -> String {
    format!(
        "pong from native | platform={} | arch={} | napi",
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}
```

- [ ] **步骤 4：构建验证**

```bash
cd packages/native && pnpm build
```

预期：编译成功，`.node` 文件包含 UIA 函数导出。

- [ ] **步骤 5：Commit**

```bash
git add packages/native/
git commit -m "feat(native): implement UIA module — get_ui_tree, find_element, get/set_element_value, invoke_element"
```

---

## 任务 2：Rust DPI 模块

**文件：**
- 创建：`packages/native/src/dpi.rs`

- [ ] **步骤 1：创建 `packages/native/src/dpi.rs`**

```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;
use windows::Win32::UI::HiDpi::*;
use windows::Win32::Graphics::Gdi::*;

#[napi]
pub fn get_dpi_for_monitor(monitor_index: u32) -> Result<u32> {
    unsafe {
        // 枚举显示器
        let mut monitors: Vec<windows::Win32::Graphics::Gdi::HMONITOR> = Vec::new();

        extern "system" fn enum_callback(
            hmonitor: HMONITOR,
            _hdc: HDC,
            _rect: *mut windows::Win32::Foundation::RECT,
            lparam: windows::Win32::Foundation::LPARAM,
        ) -> windows::Win32::Foundation::BOOL {
            let monitors = unsafe { &mut *(lparam.0 as *mut Vec<HMONITOR>) };
            monitors.push(hmonitor);
            windows::Win32::Foundation::TRUE
        }

        EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(enum_callback),
            windows::Win32::Foundation::LPARAM(&mut monitors as *mut _ as isize),
        );

        if monitor_index as usize >= monitors.len() {
            return Err(Error::from_reason(format!(
                "Monitor {} not found, only {} available",
                monitor_index,
                monitors.len()
            )));
        }

        let hmonitor = monitors[monitor_index as usize];
        let mut dpi_x: u32 = 96;
        let mut dpi_y: u32 = 96;

        GetDpiForMonitor(hmonitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y)
            .map_err(|e| Error::from_reason(format!("GetDpiForMonitor: {}", e)))?;

        Ok(dpi_x)
    }
}

#[napi]
pub fn get_monitor_count() -> Result<u32> {
    unsafe {
        let mut count: u32 = 0;

        extern "system" fn count_callback(
            _hmonitor: HMONITOR,
            _hdc: HDC,
            _rect: *mut windows::Win32::Foundation::RECT,
            lparam: windows::Win32::Foundation::LPARAM,
        ) -> windows::Win32::Foundation::BOOL {
            let count = unsafe { &mut *(lparam.0 as *mut u32) };
            *count += 1;
            windows::Win32::Foundation::TRUE
        }

        EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(count_callback),
            windows::Win32::Foundation::LPARAM(&mut count as *mut _ as isize),
        );

        Ok(count)
    }
}

#[napi]
pub fn get_system_dpi() -> u32 {
    unsafe { GetDpiForSystem() }
}
```

- [ ] **步骤 2：构建验证**

```bash
cd packages/native && pnpm build
```

- [ ] **步骤 3：快速测试**

```bash
node -e "const n = require('./packages/native'); console.log('DPI:', n.getSystemDpi(), 'Monitors:', n.getMonitorCount())"
```

预期：输出系统 DPI（如 96/120/144）和显示器数量。

- [ ] **步骤 4：Commit**

```bash
git add packages/native/src/dpi.rs
git commit -m "feat(native): implement DPI module — getSystemDpi, getDpiForMonitor, getMonitorCount"
```

---

## 任务 3：TypeScript UIA 封装 (uia.ts)

**文件：**
- 创建：`packages/core/src/tools/uia.ts`
- 修改：`packages/core/src/index.ts`

- [ ] **步骤 1：创建 `packages/core/src/tools/uia.ts`**

```typescript
import { toolOk, toolErr, type ToolResult, type ToolErrorCode } from '../types/errors.js';

// native 模块 — 延迟加载
let nativeUia: any = null;

function loadNative() {
  if (!nativeUia) {
    const native = require('@agivar/native');
    nativeUia = {
      getUiTree: native.getUiTree,
      findElement: native.findElement,
      getElementValue: native.getElementValue,
      setElementValue: native.setElementValue,
      invokeElement: native.invokeElement,
    };
  }
  return nativeUia;
}

export interface UiaOptions {
  timeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
  includeOffscreen?: boolean;
}

export interface ElementQuery {
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

export interface UiaNode {
  name: string;
  controlType: string;
  automationId: string;
  className: string;
  boundingRect: { x: number; y: number; w: number; h: number };
  isEnabled: boolean;
  isOffscreen: boolean;
  value?: string;
  children: UiaNode[];
}

const DEFAULT_OPTIONS: Required<UiaOptions> = {
  timeoutMs: 2000,
  maxDepth: 8,
  maxNodes: 1000,
  includeOffscreen: false,
};

let consecutiveTimeouts = 0;
let backendUnreliable = false;

function resetTimeoutCounter() {
  consecutiveTimeouts = 0;
}

function handleTimeout(): ToolErrorCode {
  consecutiveTimeouts++;
  if (consecutiveTimeouts >= 3) {
    backendUnreliable = true;
    return 'UIA_BACKEND_UNRELIABLE';
  }
  return 'UIA_TIMEOUT';
}

export function isBackendUnreliable(): boolean {
  return backendUnreliable;
}

export function resetBackendStatus(): void {
  backendUnreliable = false;
  consecutiveTimeouts = 0;
}

export async function getUiTree(
  hwnd: number,
  options?: UiaOptions,
): Promise<ToolResult<UiaNode>> {
  if (backendUnreliable) {
    return toolErr('UIA_BACKEND_UNRELIABLE', 'UIA backend marked unreliable after 3 consecutive timeouts', 0);
  }

  const start = performance.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const native = loadNative();
    const result = native.getUiTree(hwnd, {
      timeoutMs: opts.timeoutMs,
      maxDepth: opts.maxDepth,
      maxNodes: opts.maxNodes,
      includeOffscreen: opts.includeOffscreen,
    });
    resetTimeoutCounter();
    return toolOk(result, performance.now() - start);
  } catch (err: any) {
    const duration = performance.now() - start;
    if (err.message.includes('UIA_TIMEOUT') || duration > opts.timeoutMs) {
      const code = handleTimeout();
      return toolErr(code, err.message, duration);
    }
    return toolErr('UIA_TIMEOUT', err.message, duration);
  }
}

export async function findElement(
  hwnd: number,
  query: ElementQuery,
  options?: UiaOptions,
): Promise<ToolResult<UiaNode | null>> {
  if (backendUnreliable) {
    return toolErr('UIA_BACKEND_UNRELIABLE', 'UIA backend marked unreliable', 0);
  }

  const start = performance.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const native = loadNative();
    const result = native.findElement(hwnd, {
      automationId: query.automationId ?? null,
      name: query.name ?? null,
      controlType: query.controlType ?? null,
      className: query.className ?? null,
      nameMatch: query.nameMatch ?? 'exact',
      maxDepth: query.maxDepth ?? opts.maxDepth,
      maxNodes: query.maxNodes ?? opts.maxNodes,
      index: query.index ?? null,
      includeOffscreen: query.includeOffscreen ?? opts.includeOffscreen,
    }, {
      timeoutMs: opts.timeoutMs,
      maxDepth: opts.maxDepth,
      maxNodes: opts.maxNodes,
      includeOffscreen: opts.includeOffscreen,
    });
    resetTimeoutCounter();
    return toolOk(result ?? null, performance.now() - start);
  } catch (err: any) {
    const duration = performance.now() - start;
    const code = err.message.includes('UIA_TIMEOUT') ? handleTimeout() : 'UIA_PATTERN_UNSUPPORTED';
    return toolErr(code, err.message, duration);
  }
}

export async function getElementValue(
  hwnd: number,
  query: ElementQuery,
): Promise<ToolResult<string>> {
  const start = performance.now();
  try {
    const native = loadNative();
    const result = native.getElementValue(hwnd, {
      automationId: query.automationId ?? null,
      name: query.name ?? null,
      controlType: query.controlType ?? null,
      className: query.className ?? null,
      nameMatch: query.nameMatch ?? 'exact',
      maxDepth: query.maxDepth ?? 8,
      maxNodes: query.maxNodes ?? 1000,
      index: query.index ?? null,
      includeOffscreen: query.includeOffscreen ?? false,
    });
    return toolOk(result, performance.now() - start);
  } catch (err: any) {
    return toolErr('UIA_PATTERN_UNSUPPORTED', err.message, performance.now() - start);
  }
}

export async function setElementValue(
  hwnd: number,
  query: ElementQuery,
  value: string,
): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    const native = loadNative();
    native.setElementValue(hwnd, {
      automationId: query.automationId ?? null,
      name: query.name ?? null,
      controlType: query.controlType ?? null,
      className: query.className ?? null,
      nameMatch: query.nameMatch ?? 'exact',
      maxDepth: query.maxDepth ?? 8,
      maxNodes: query.maxNodes ?? 1000,
      index: query.index ?? null,
      includeOffscreen: query.includeOffscreen ?? false,
    }, value);
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('UIA_PATTERN_UNSUPPORTED', err.message, performance.now() - start);
  }
}

export async function invokeElement(
  hwnd: number,
  query: ElementQuery,
): Promise<ToolResult<void>> {
  const start = performance.now();
  try {
    const native = loadNative();
    native.invokeElement(hwnd, {
      automationId: query.automationId ?? null,
      name: query.name ?? null,
      controlType: query.controlType ?? null,
      className: query.className ?? null,
      nameMatch: query.nameMatch ?? 'exact',
      maxDepth: query.maxDepth ?? 8,
      maxNodes: query.maxNodes ?? 1000,
      index: query.index ?? null,
      includeOffscreen: query.includeOffscreen ?? false,
    });
    return toolOk(undefined, performance.now() - start);
  } catch (err: any) {
    return toolErr('UIA_PATTERN_UNSUPPORTED', err.message, performance.now() - start);
  }
}

export async function dumpUiTree(
  hwnd: number,
  options?: UiaOptions,
): Promise<ToolResult<string>> {
  const result = await getUiTree(hwnd, options);
  if (!result.ok) return result as ToolResult<string>;
  return toolOk(JSON.stringify(result.data, null, 2), result.durationMs);
}
```

- [ ] **步骤 2：更新 `packages/core/src/index.ts`**

```typescript
export * from './types/index.js';
export * as screenshot from './tools/screenshot.js';
export * as input from './tools/input.js';
export * as browser from './tools/browser.js';
export * as uia from './tools/uia.js';
```

- [ ] **步骤 3：验证编译**

```bash
pnpm -F @agivar/core build
```

- [ ] **步骤 4：Commit**

```bash
git add packages/core/src/tools/uia.ts packages/core/src/index.ts
git commit -m "feat(core): implement UIA TypeScript layer — getUiTree, findElement, timeout tracking, backend reliability"
```

---

## 任务 4：TypeScript DPI 模块 (dpi.ts)

**文件：**
- 创建：`packages/core/src/tools/dpi.ts`
- 修改：`packages/core/src/index.ts`

- [ ] **步骤 1：创建 `packages/core/src/tools/dpi.ts`**

```typescript
import { toolOk, toolErr, type ToolResult } from '../types/errors.js';

let nativeDpi: any = null;

function loadNative() {
  if (!nativeDpi) {
    const native = require('@agivar/native');
    nativeDpi = {
      getSystemDpi: native.getSystemDpi,
      getDpiForMonitor: native.getDpiForMonitor,
      getMonitorCount: native.getMonitorCount,
    };
  }
  return nativeDpi;
}

export async function getScaleFactor(monitorIndex: number = 0): Promise<ToolResult<number>> {
  const start = performance.now();
  try {
    const native = loadNative();
    const dpi = native.getDpiForMonitor(monitorIndex);
    const scale = dpi / 96;
    return toolOk(scale, performance.now() - start);
  } catch (err: any) {
    return toolErr('DPI_MAPPING_FAILED', err.message, performance.now() - start);
  }
}

export function logicalToPhysical(
  x: number,
  y: number,
  scale: number,
): { x: number; y: number } {
  return { x: Math.round(x * scale), y: Math.round(y * scale) };
}

export function physicalToLogical(
  x: number,
  y: number,
  scale: number,
): { x: number; y: number } {
  return { x: Math.round(x / scale), y: Math.round(y / scale) };
}

export async function toPhysicalCoords(
  logicalX: number,
  logicalY: number,
): Promise<ToolResult<{ x: number; y: number }>> {
  const scaleResult = await getScaleFactor();
  if (!scaleResult.ok) return scaleResult as ToolResult<{ x: number; y: number }>;
  const coords = logicalToPhysical(logicalX, logicalY, scaleResult.data);
  return toolOk(coords, scaleResult.durationMs);
}

export async function getMonitorCount(): Promise<ToolResult<number>> {
  const start = performance.now();
  try {
    const native = loadNative();
    return toolOk(native.getMonitorCount(), performance.now() - start);
  } catch (err: any) {
    return toolErr('DPI_MAPPING_FAILED', err.message, performance.now() - start);
  }
}
```

- [ ] **步骤 2：更新 `packages/core/src/index.ts`**

```typescript
export * from './types/index.js';
export * as screenshot from './tools/screenshot.js';
export * as input from './tools/input.js';
export * as browser from './tools/browser.js';
export * as uia from './tools/uia.js';
export * as dpi from './tools/dpi.js';
```

- [ ] **步骤 3：验证编译**

```bash
pnpm -F @agivar/core build
```

- [ ] **步骤 4：Commit**

```bash
git add packages/core/src/tools/dpi.ts packages/core/src/index.ts
git commit -m "feat(core): implement DPI module — getScaleFactor, coordinate conversion, monitor count"
```

---

## 任务 5：poc-uia 验证脚本

**文件：**
- 创建：`tests/poc-uia.ts`

- [ ] **步骤 1：创建 `tests/poc-uia.ts`**

```typescript
import { uia, screenshot, type PocResult } from '@agivar/core';
import { launchNotepad, killTrackedProcesses } from './helpers/cleanup.js';
import { sleep } from './helpers/timer.js';
import { createOutputDir } from './helpers/report.js';
import fs from 'node:fs';
import path from 'node:path';

export async function runPocUia(outputDir: string): Promise<PocResult> {
  const result: PocResult = {
    name: 'poc-uia',
    kind: 'readonly',
    status: 'failed',
    durationMs: 0,
    metrics: {},
    artifacts: [],
    notes: [],
  };

  const start = performance.now();

  try {
    // === Part 1: 记事本 UIA ===
    const pid = launchNotepad();
    await sleep(2000);

    // 找到记事本窗口
    const windows = (await screenshot.listWindows());
    if (!windows.ok) throw new Error('listWindows failed');

    const notepadWin = windows.data.find((w) =>
      w.title.includes('Notepad') || w.title.includes('记事本') || w.title.includes('无标题')
    );
    if (!notepadWin) {
      result.notes.push('Notepad window not found');
      killTrackedProcesses();
      result.durationMs = Math.round(performance.now() - start);
      return result;
    }

    result.notes.push(`Notepad hwnd=${notepadWin.hwnd}, title="${notepadWin.title}"`);

    // 读取控件树
    const treeResult = await uia.getUiTree(notepadWin.hwnd, { maxDepth: 6, maxNodes: 500 });
    if (treeResult.ok) {
      result.metrics['notepad.treeNodes'] = countNodes(treeResult.data);
      result.metrics['notepad.treeDepth'] = maxDepth(treeResult.data);
      result.metrics['notepad.treeDurationMs'] = Math.round(treeResult.durationMs);

      // 保存控件树
      const treePath = path.join(outputDir, 'notepad-ui-tree.json');
      fs.writeFileSync(treePath, JSON.stringify(treeResult.data, null, 2));
      result.artifacts.push(treePath);
    } else {
      result.notes.push(`getUiTree failed: ${treeResult.error.message}`);
    }

    // 查找编辑区
    const editResult = await uia.findElement(notepadWin.hwnd, {
      controlType: 'Edit',
    });
    if (editResult.ok && editResult.data) {
      result.metrics['notepad.editFound'] = true;
      result.notes.push(`Edit control: name="${editResult.data.name}", class="${editResult.data.className}"`);

      // 尝试读取值
      const valueResult = await uia.getElementValue(notepadWin.hwnd, { controlType: 'Edit' });
      if (valueResult.ok) {
        result.metrics['notepad.valuePatternRead'] = true;
        result.notes.push(`Current value: "${valueResult.data.substring(0, 50)}"`);
      } else {
        result.metrics['notepad.valuePatternRead'] = false;
        result.notes.push(`ValuePattern read failed: ${valueResult.error.message}`);
      }

      // 尝试设置值
      const setResult = await uia.setElementValue(notepadWin.hwnd, { controlType: 'Edit' }, 'Hello from UIA!');
      if (setResult.ok) {
        result.metrics['notepad.valuePatternWrite'] = true;
      } else {
        result.metrics['notepad.valuePatternWrite'] = false;
        result.notes.push(`ValuePattern write failed: ${setResult.error.message} — will fallback to keyboard`);
      }
    } else {
      result.metrics['notepad.editFound'] = false;
      result.notes.push('Edit control not found');
    }

    killTrackedProcesses();
    await sleep(500);

    // === Part 2: Chrome/Edge 窗口识别 ===
    const allWindows = windows.data;
    const chromeWin = allWindows.find((w) =>
      w.title.includes('Chrome') || w.title.includes('Edge') || w.title.includes('Chromium')
    );

    if (chromeWin) {
      result.notes.push(`Chrome/Edge hwnd=${chromeWin.hwnd}, title="${chromeWin.title}"`);
      const chromeTree = await uia.getUiTree(chromeWin.hwnd, { maxDepth: 3, maxNodes: 200 });
      if (chromeTree.ok) {
        result.metrics['chrome.windowIdentified'] = true;
        result.metrics['chrome.topLevelNodes'] = chromeTree.data.children.length;
      } else {
        result.metrics['chrome.windowIdentified'] = false;
        result.notes.push(`Chrome tree failed: ${chromeTree.error.message}`);
      }
    } else {
      result.metrics['chrome.windowIdentified'] = false;
      result.notes.push('No Chrome/Edge window found — skipping browser UIA test');
    }

    // 判断结果
    const notepadEdit = result.metrics['notepad.editFound'] === true;
    const chromeOk = result.metrics['chrome.windowIdentified'] === true || !chromeWin;
    result.status = notepadEdit && chromeOk ? 'passed' : 'failed';
  } catch (err: any) {
    result.notes.push(`Error: ${err.message}`);
  } finally {
    killTrackedProcesses();
    result.durationMs = Math.round(performance.now() - start);
  }

  return result;
}

function countNodes(node: uia.UiaNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

function maxDepth(node: uia.UiaNode, depth: number = 0): number {
  if (node.children.length === 0) return depth;
  return Math.max(...node.children.map((c) => maxDepth(c, depth + 1)));
}

// 独立运行
if (process.argv[1]?.endsWith('poc-uia.ts')) {
  const dir = createOutputDir();
  runPocUia(dir).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === 'passed' ? 0 : 1);
  });
}
```

- [ ] **步骤 2：运行验证**

```bash
npx tsx tests/poc-uia.ts
```

预期：启动记事本，读取控件树，找到编辑区，尝试 ValuePattern 读写。如有 Chrome 打开，识别顶层窗口。Status = passed。

- [ ] **步骤 3：Commit**

```bash
git add tests/poc-uia.ts
git commit -m "feat(tests): add poc-uia — notepad edit control + Chrome window identification"
```

---

## 任务 6：poc-dpi 验证脚本

**文件：**
- 创建：`tests/poc-dpi.ts`

- [ ] **步骤 1：创建 `tests/poc-dpi.ts`**

```typescript
import { dpi, type PocResult } from '@agivar/core';
import { createOutputDir } from './helpers/report.js';

export async function runPocDpi(outputDir: string): Promise<PocResult> {
  const result: PocResult = {
    name: 'poc-dpi',
    kind: 'readonly',
    status: 'failed',
    durationMs: 0,
    metrics: {},
    artifacts: [],
    notes: [],
  };

  const start = performance.now();

  try {
    // 获取显示器数量
    const countResult = await dpi.getMonitorCount();
    if (countResult.ok) {
      result.metrics['monitorCount'] = countResult.data;
      result.notes.push(`Monitors: ${countResult.data}`);
    }

    // 获取主屏 DPI 缩放
    const scaleResult = await dpi.getScaleFactor(0);
    if (scaleResult.ok) {
      result.metrics['primaryScale'] = scaleResult.data;
      result.notes.push(`Primary monitor scale: ${scaleResult.data} (${scaleResult.data * 100}%)`);
    } else {
      result.notes.push(`getScaleFactor failed: ${scaleResult.error.message}`);
      result.durationMs = Math.round(performance.now() - start);
      return result;
    }

    const scale = scaleResult.data;

    // 坐标互转验证
    const testPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 200 },
      { x: 960, y: 540 },
      { x: 1920, y: 1080 },
    ];

    let conversionErrors = 0;
    for (const p of testPoints) {
      const physical = dpi.logicalToPhysical(p.x, p.y, scale);
      const backToLogical = dpi.physicalToLogical(physical.x, physical.y, scale);

      const errorX = Math.abs(backToLogical.x - p.x);
      const errorY = Math.abs(backToLogical.y - p.y);

      if (errorX > 1 || errorY > 1) {
        conversionErrors++;
        result.notes.push(`Roundtrip error at (${p.x},${p.y}): got (${backToLogical.x},${backToLogical.y})`);
      }
    }

    result.metrics['conversionRoundtripErrors'] = conversionErrors;
    result.metrics['testedPoints'] = testPoints.length;

    // toPhysicalCoords
    const toPhysResult = await dpi.toPhysicalCoords(500, 300);
    if (toPhysResult.ok) {
      result.metrics['toPhysical.x'] = toPhysResult.data.x;
      result.metrics['toPhysical.y'] = toPhysResult.data.y;
      result.notes.push(`Logical (500,300) -> Physical (${toPhysResult.data.x},${toPhysResult.data.y})`);
    }

    result.status = conversionErrors === 0 ? 'passed' : 'failed';
  } catch (err: any) {
    result.notes.push(`Error: ${err.message}`);
  } finally {
    result.durationMs = Math.round(performance.now() - start);
  }

  return result;
}

// 独立运行
if (process.argv[1]?.endsWith('poc-dpi.ts')) {
  const dir = createOutputDir();
  runPocDpi(dir).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === 'passed' ? 0 : 1);
  });
}
```

- [ ] **步骤 2：运行验证**

```bash
npx tsx tests/poc-dpi.ts
```

预期：输出当前缩放率、坐标互转验证通过、0 roundtrip errors。

- [ ] **步骤 3：Commit**

```bash
git add tests/poc-dpi.ts
git commit -m "feat(tests): add poc-dpi — scale factor detection + coordinate roundtrip verification"
```

---

## 任务 7：更新 poc-runner 添加 UIA + DPI

**文件：**
- 修改：`tests/poc-runner.ts`

- [ ] **步骤 1：更新 `tests/poc-runner.ts`，添加 UIA 和 DPI PoC 导入和运行**

在 `import` 部分添加：

```typescript
import { runPocUia } from './poc-uia.js';
import { runPocDpi } from './poc-dpi.js';
```

在只读 PoC 运行块中，`poc-playwright` 之后添加：

```typescript
  console.log('[3/5] poc-uia...');
  results.push(await runPocUia(outputDir));
  console.log(`  -> ${results[results.length - 1].status}`);

  console.log('[4/5] poc-dpi...');
  results.push(await runPocDpi(outputDir));
  console.log(`  -> ${results[results.length - 1].status}`);
```

更新计数器（将 `[2/3]` 改为 `[2/5]` 等）。

- [ ] **步骤 2：运行全部只读 PoC**

```bash
pnpm poc:readonly
```

预期：5 个只读 PoC 全部运行（screenshot, playwright, uia, dpi + input skipped），报告生成。

- [ ] **步骤 3：Commit**

```bash
git add tests/poc-runner.ts
git commit -m "feat(tests): integrate poc-uia and poc-dpi into runner"
```

---

## 自检

### 1. 规格覆盖度

| 规格需求 | 对应任务 |
|---|---|
| UIA Rust 模块 (uia.rs) | 任务 1 |
| UIA 线程模型与超时 | 任务 1 (deadline) + 任务 3 (timeout tracking) |
| COM timeout 恢复边界 | 任务 3 (consecutiveTimeouts + backendUnreliable) |
| UiaOptions 参数化 | 任务 1 (Rust) + 任务 3 (TS) |
| ElementQuery 复杂度限制 | 任务 1 (maxDepth/maxNodes in walk) |
| ValuePattern 读写 | 任务 1 (get/set_element_value) + 任务 5 (poc-uia) |
| InvokePattern | 任务 1 (invoke_element) |
| DPI 原生模块 (dpi.rs) | 任务 2 |
| DPI TypeScript 层 | 任务 4 |
| 坐标互转验证 | 任务 6 (poc-dpi) |
| Chrome 窗口级识别（不读 DOM） | 任务 5 (poc-uia maxDepth=3) |
| 记事本编辑区命中率 100% | 任务 5 (poc-uia findElement Edit) |

### 2. 占位符扫描

无占位符。

### 3. 类型一致性

- `UiaOptions` — 任务 1 (Rust struct) + 任务 3 (TS interface)：字段对齐
- `ElementQuery` — 任务 1 (Rust) + 任务 3 (TS)：字段对齐
- `UiaNode` — 任务 1 (Rust) + 任务 3 (TS)：字段对齐
- `ToolResult`/`toolOk`/`toolErr` — Plan A 任务 4 定义，此处一致使用
