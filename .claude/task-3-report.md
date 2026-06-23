# Task 3 Report: input.scroll() and input.releaseAllKeys()

## Status: DONE

## Commits

- `d25114b` feat(core): add scroll() and releaseAllKeys() to input module

## Changes

### New functions in `packages/core/src/tools/input.ts`

1. `scroll(direction, amount)` -- Scrolls the mouse wheel up or down by `amount` ticks (3 per iteration). Uses existing `ensureNut()` / `nutMouse` pattern. Returns `ToolResult<void>`.

2. `releaseAllKeys()` -- Releases all modifier keys (Shift, Ctrl, Alt, Super) using best-effort individual try/catch per key. Uses existing `ensureNut()` / `nutKeyboard` pattern. Returns `ToolResult<void>`.

Both follow the same lazy-load pattern, same error handling (INPUT_ABORTED), same `toolOk`/`toolErr` return conventions as all other functions in the module.

### New test file `packages/core/tests/input-extensions.test.ts`

4 tests across 2 describe blocks:
- scroll: scrolls down, scrolls up, error-on-failure
- releaseAllKeys: releases modifier keys without error

All `@nut-tree-fork/nut-js` calls are mocked via `vi.mock` at the module level.

## Test Results

```
All 24 tests pass across 3 test files:
  packages/core/tests/input-extensions.test.ts  (4 tests) -- PASS
  packages/core/tests/types.test.ts              (15 tests) -- PASS
  packages/core/tests/schema.test.ts             (5 tests) -- PASS
```

Red-green cycle: tests failed before implementation (4 failures: "not a function"), passed after.

## Concerns

None. The implementation is straightforward and follows all existing patterns in the file.
