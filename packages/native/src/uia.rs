use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::time::{Duration, Instant};
use uiautomation::core::{UIAutomation, UICondition};
use uiautomation::controls::ControlType;
use uiautomation::patterns::{UIInvokePattern, UIValuePattern};
use uiautomation::types::{Handle, Rect, TreeScope, UIProperty};
use uiautomation::variants::Variant;

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

    let rect = element.get_bounding_rectangle()
        .unwrap_or_else(|_| Rect::new(0, 0, 0, 0));
    let value = element.get_property_value(UIProperty::ValueValue)
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
        auto.element_from_handle(Handle::from(hwnd_val))
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
    let root = auto.element_from_handle(Handle::from(hwnd_val))
        .map_err(|e| Error::from_reason(format!("element_from_handle: {}", e)))?;

    // Use ValuePattern to set value
    let condition = build_condition(&auto, &query)?;
    let target = root.find_first(TreeScope::Subtree, &condition)
        .map_err(|e| Error::from_reason(format!("find_first: {}", e)))?;

    let pattern: UIValuePattern = target.get_pattern()
        .map_err(|e| Error::from_reason(format!("ValuePattern not supported: {}", e)))?;
    pattern.set_value(&value)
        .map_err(|e| Error::from_reason(format!("set_value: {}", e)))
}

#[napi]
pub fn invoke_element(hwnd: i64, query: ElementQuery) -> Result<()> {
    let auto = UIAutomation::new()
        .map_err(|e| Error::from_reason(format!("UIA init failed: {}", e)))?;

    let hwnd_val = hwnd as isize;
    let root = auto.element_from_handle(Handle::from(hwnd_val))
        .map_err(|e| Error::from_reason(format!("element_from_handle: {}", e)))?;

    let condition = build_condition(&auto, &query)?;
    let target = root.find_first(TreeScope::Subtree, &condition)
        .map_err(|e| Error::from_reason(format!("find_first: {}", e)))?;

    let pattern: UIInvokePattern = target.get_pattern()
        .map_err(|e| Error::from_reason(format!("InvokePattern not supported: {}", e)))?;
    pattern.invoke()
        .map_err(|e| Error::from_reason(format!("invoke: {}", e)))
}

fn build_condition(
    auto: &UIAutomation,
    query: &ElementQuery,
) -> Result<UICondition> {
    let mut conditions: Vec<UICondition> = Vec::new();

    if let Some(ref name) = query.name {
        conditions.push(
            auto.create_property_condition(
                UIProperty::Name,
                Variant::from(name.as_str()),
                None,
            ).map_err(|e| Error::from_reason(format!("condition: {}", e)))?,
        );
    }

    if let Some(ref aid) = query.automation_id {
        conditions.push(
            auto.create_property_condition(
                UIProperty::AutomationId,
                Variant::from(aid.as_str()),
                None,
            ).map_err(|e| Error::from_reason(format!("condition: {}", e)))?,
        );
    }

    if conditions.is_empty() {
        Ok(auto.create_true_condition()
            .map_err(|e| Error::from_reason(format!("true_condition: {}", e)))?)
    } else if conditions.len() == 1 {
        Ok(conditions.remove(0))
    } else {
        // Chain conditions pairwise using create_and_condition
        let mut combined = conditions.remove(0);
        for c in conditions {
            combined = auto.create_and_condition(combined, c)
                .map_err(|e| Error::from_reason(format!("and_condition: {}", e)))?;
        }
        Ok(combined)
    }
}
