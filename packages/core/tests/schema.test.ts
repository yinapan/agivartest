import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { getDatabaseForTest } from '../src/memory/db.js';
import { runMigrations, MIGRATIONS } from '../src/memory/schema.js';
import type { DatabaseLike } from '../src/memory/schema.js';

const EXPECTED_TABLES = [
  'sessions',
  'messages',
  'workflow_memories',
  'workflow_memory_versions',
  'recording_sessions',
  'recording_events',
  'recording_keyframes',
  'recording_context_snapshots',
  'recording_draft_links',
  'task_runs',
  'task_step_logs',
  'app_settings',
  'schema_migrations',
];

function getTableNames(db: DatabaseLike): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

describe('Schema migrations', () => {
  let db: DatabaseLike;

  afterEach(() => {
    if (db) {
      (db as DatabaseLike & { close(): void }).close();
    }
  });

  it('creates all expected tables', () => {
    db = getDatabaseForTest();
    const tables = getTableNames(db);

    for (const expected of EXPECTED_TABLES) {
      expect(tables.has(expected), `table "${expected}" should exist`).toBe(true);
    }
  });

  it('records the migration version in schema_migrations', () => {
    db = getDatabaseForTest();
    const rows = db
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all() as { version: number; name: string }[];

    expect(rows).toHaveLength(MIGRATIONS.length);
    expect(rows[0].version).toBe(1);
    expect(rows[0].name).toBe('initial_schema');
  });

  it('is idempotent (running migrations twice does not throw)', () => {
    db = getDatabaseForTest();

    // First run already happened in getDatabaseForTest
    // Run again explicitly
    expect(() => runMigrations(db)).not.toThrow();

    // Should still have exactly the same number of migration records.
    const rows = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as { version: number }[];
    expect(rows).toHaveLength(MIGRATIONS.length);
  });

  it('enforces foreign keys (insert message with bad session_id throws)', () => {
    db = getDatabaseForTest();

    expect(() => {
      db.exec("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('m1', 'nonexistent', 'user', 'hello', '2025-01-01T00:00:00.000Z')");
    }).toThrow();
  });

  it('enables WAL journal mode on file-based databases', () => {
    const tmpPath = join(tmpdir(), `agivar-test-wal-${Date.now()}.db`);
    try {
      db = getDatabaseForTest(tmpPath);
      const mode = db.pragma('journal_mode', { simple: true });
      expect(mode).toBe('wal');
    } finally {
      if (db) {
        (db as DatabaseLike & { close(): void }).close();
      }
      try { unlinkSync(tmpPath); } catch { /* best effort */ }
      try { unlinkSync(tmpPath + '-wal'); } catch { /* best effort */ }
      try { unlinkSync(tmpPath + '-shm'); } catch { /* best effort */ }
    }
  });

  it('creates a unique index for workflow memory versions', () => {
    db = getDatabaseForTest();
    const rows = db
      .prepare("PRAGMA index_list('workflow_memory_versions')")
      .all() as { name: string; unique: number }[];

    expect(rows.some((row) => row.name === 'idx_workflow_memory_versions_unique' && row.unique === 1)).toBe(true);
  });

  it('upgrades existing v3 databases to allow recording-teach version sources', () => {
    db = getDatabaseForTest();
    db.exec("DELETE FROM schema_migrations WHERE version = 4");
    db.exec(`
      DROP INDEX IF EXISTS idx_workflow_memory_versions_memory_version;
      DROP INDEX IF EXISTS idx_workflow_memory_versions_unique;
      ALTER TABLE workflow_memory_versions RENAME TO workflow_memory_versions_newer;
      CREATE TABLE workflow_memory_versions (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL REFERENCES workflow_memories(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        change_note TEXT,
        source TEXT NOT NULL CHECK (source IN ('create', 'edit', 'rollback', 'import', 'text-teach')),
        created_at TEXT NOT NULL
      );
      INSERT INTO workflow_memory_versions
        SELECT * FROM workflow_memory_versions_newer;
      DROP TABLE workflow_memory_versions_newer;
      CREATE INDEX IF NOT EXISTS idx_workflow_memory_versions_memory_version
        ON workflow_memory_versions(memory_id, version DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_memory_versions_unique
        ON workflow_memory_versions(memory_id, version);
    `);

    runMigrations(db);

    db.exec(`
      INSERT INTO workflow_memories (
        id, app_name, platform, topic, trigger_examples, summary,
        initial_state, steps, success_criteria, risk_level, source_type,
        version, search_text, embedding_status, created_at, updated_at
      ) VALUES (
        'recording-source-upgrade', 'Notepad', 'desktop', 'Save note', '[]', 'summary',
        'initial', '[]', 'done', 'low', 'recording',
        1, 'Save note', 'not_indexed', '2026-06-24T00:00:00.000Z', '2026-06-24T00:00:00.000Z'
      );
      INSERT INTO workflow_memory_versions (
        id, memory_id, version, snapshot_json, source, created_at
      ) VALUES (
        'version-recording-source-upgrade',
        'recording-source-upgrade',
        1,
        '{}',
        'recording-teach',
        '2026-06-24T00:00:00.000Z'
      );
    `);

    const row = db
      .prepare("SELECT source FROM workflow_memory_versions WHERE id = 'version-recording-source-upgrade'")
      .get() as { source: string };
    expect(row.source).toBe('recording-teach');
  });
});
