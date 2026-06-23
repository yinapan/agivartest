# Task 7 Report: ToolRouter Adapter

## Status: Complete

## Files Created

1. `packages/core/src/agent/tool-router.ts` — ToolRouter class and ToolAdapters interface
2. `packages/core/tests/tool-router.test.ts` — 10 unit tests

## What was built

The `ToolRouter` adapter layer that bridges `StepAction` discriminated unions (9 variants from Task 1) to Phase 0 tool functions (browser, UIA, input, screenshot). Key design decisions:

- **Dependency inversion**: `ToolRouter` depends on the `ToolAdapters` interface, not on real tool implementations. This enables mock-based testing and future swappable backends.
- **AbortSignal strategy**: `withAbort()` uses `Promise.race` with three entries — the tool promise, an abort listener promise, and a timeout promise (15s). Phase 0 tools are NOT modified.
- **`TakeoverRequest` for human-in-the-loop**: The `human` click strategy and the `takeover` action both throw `TakeoverRequest` (extends Error), which the execution engine catches upstream.
- **`captureState` for observe**: Gathers a screenshot (width/height) and active window info (title/hwnd) into a single observation snapshot.

## Test results

All 10 tests pass:
1. click/playwright → `browser.clickElement` called with page + selector
2. click/uia → `uia.invokeElement` called with hwnd + query
3. click/coordinate → `input.clickPoint` called with point
4. click/human → throws `TakeoverRequest`
5. type → `input.typeText` called with correct text
6. navigate → `browser.navigateTo` called with page + url
7. navigate without browserSession → returns error (`ok=false`)
8. already-aborted signal before dispatch → returns `TASK_ABORTED`
9. observe → calls `captureScreen` and `getActiveWindow`
10. done → returns `{ done: true, summary }`

## Commit

`448e935` — `feat(core): add ToolRouter adapter bridging StepAction to Phase 0 tools`
