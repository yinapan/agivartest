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

  it('creates all 7 expected tables', () => {
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

    // Should still have exactly one migration record
    const rows = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as { version: number }[];
    expect(rows).toHaveLength(1);
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
});
