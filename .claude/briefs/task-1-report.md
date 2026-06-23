# Task 1 Report: LLM Provider Abstraction Layer + OpenAIClient Adapter

## Status: DONE_WITH_CONCERNS

## Commits

- `242b61b` - feat(core): add LLM provider abstraction and OpenAI-compatible adapter

## Files Created

- `packages/core/src/llm/provider.ts` — LLMProvider interface, Message, ToolCall, ToolDefinition, GenerateTextParams, GenerateTextResult, StreamChunk types
- `packages/core/src/llm/openai-compatible.ts` — OpenAIClient class implementing LLMProvider via Vercel AI SDK (`ai` v6.0.208, `@ai-sdk/openai` v3.0.74)
- `packages/core/src/llm/prompts.ts` — buildSystemPrompt and formatStepHistory helper functions
- `packages/core/tests/llm-provider.test.ts` — 6 unit tests (3 for OpenAIClient construction, 3 for prompts)

## Dependencies Added

- `ai@^6.0.208`
- `@ai-sdk/openai@^3.0.74`

## Test Results

- 1 test file, 6 tests — all PASS (483ms)

## Concerns

The brief code was authored against an older version of the Vercel AI SDK (v4/v5 API). The installed packages (`ai` v6.0.208, `@ai-sdk/openai` v3.0.74) have several API differences that required adaptation:

1. **`maxTokens` → `maxOutputTokens`**: The `CallSettings` type in AI SDK v6 uses `maxOutputTokens` instead of `maxTokens`.
2. **`chunk.textDelta` → `chunk.text`**: The `TextStreamPart` type's `text-delta` chunk uses `text` instead of `textDelta`.
3. **`tc.args` → `tc.input`**: Tool call results use `input` instead of `args` for the arguments object.
4. **`result.usage.promptTokens` → `result.usage.inputTokens`**: The `LanguageModelUsage` type uses `inputTokens`/`outputTokens` instead of `promptTokens`/`completionTokens`.
5. **`parameters` → `inputSchema`**: The `tool()` function expects `inputSchema` instead of `parameters`.

All adaptations preserve the same behavior and the public interface remains unchanged. The `openai-compatible.ts` file was updated accordingly while `provider.ts` and `prompts.ts` matched the brief exactly.

---

## Fix Round 2: Review Findings (2026-06-22)

### Finding 1 (CRITICAL) — `finishReason` mapping drops `'length'`
- **File**: `packages/core/src/llm/openai-compatible.ts`
- **What**: The ternary `result.finishReason === 'tool-calls' ? 'tool_calls' : 'stop'` silently mapped the Vercel AI SDK's `'length'` finish reason to `'stop'`, losing information.
- **Fix**: Added explicit `result.finishReason === 'length' ? 'length'` branch.

### Finding 2 (IMPORTANT) — Non-standard `zod/v4` import
- **File**: `packages/core/src/llm/openai-compatible.ts`
- **What**: Imported from `'zod/v4'` which is a non-standard entry point and may not resolve correctly in all environments.
- **Fix**: Changed to standard `import { z } from 'zod'`.

### Test Results
- 1 test file, 6 tests — all PASS (447ms)

### Commit
- `7475018` — fix(core): preserve finishReason 'length' and use standard zod import

### Status
DONE
