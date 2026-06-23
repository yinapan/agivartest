# Task 5 Report: MemoryStore

## Status
COMPLETED

## Commits
- `bf035f1` — feat(core): add MemoryStore with keyword search and threshold scoring

## Files Created
- `packages/core/src/memory/memory-store.ts` — MemoryStore class (insert, getById, list, delete, search)
- `packages/core/tests/memory-store.test.ts` — 25 tests covering CRUD, search, tokenization, and scoring

## Test Results
All 25 tests passed (vitest v3.2.6, duration 408ms).

## Implementation Details

### MemoryStore
- Constructor accepts `DatabaseLike` (consistent with existing `db.ts` and `schema.ts`).
- CRUD: `insert`, `getById`, `list(filter?)`, `delete(id)`.
- Search: `search(goal)` tokenizes the goal, scores every memory in the table, returns top 3 results sorted by score descending.
- Tokenizer handles Chinese text (character bigrams + unigram fallback for single chars), ASCII words (lowercased), mixed content, and deduplication.
- Scorer uses weighted fields: triggerExamples (3), topic (2), summary (2), appName (1), searchText (1). Formula: `min(1, fieldScore * 0.6 + coverageScore * 0.4)`.
- Column mapping: camelCase TypeScript fields to snake_case SQLite columns, with JSON serialization for `triggerExamples`, `inputs`, and `steps`.

### Tests Covered
- Insert/getById roundtrip for scalars, triggerExamples, steps, inputs, and null inputs
- getById returns null for non-existent id
- list (empty, all, filtered by appName, topic, both)
- delete (success, non-existent, idempotent)
- search: exact trigger match score >= 0.5, matchedFields populated, unrelated query empty, empty goal empty, max 3 results, score sort order
- search: partial Chinese token match
- Tokenization: ASCII-only, mixed Chinese/ASCII, punctuation stripping, deduplication

## Concerns
None. The implementation compiles cleanly and all tests pass.
