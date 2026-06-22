export interface Migration {
  version: number;
  name: string;
  up: string;
}

export interface DatabaseLike {
  pragma(pragma: string, options?: { simple?: boolean }): unknown;
  exec(sql: string): this;
  prepare(sql: string): StatementLike;
  transaction<F extends (...args: unknown[]) => unknown>(fn: F): F;
}

export interface StatementLike {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session_created
        ON messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS workflow_memories (
        id TEXT PRIMARY KEY,
        app_name TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('desktop', 'browser', 'hybrid')),
        topic TEXT NOT NULL,
        trigger_examples TEXT NOT NULL,
        summary TEXT NOT NULL,
        initial_state TEXT NOT NULL,
        inputs TEXT,
        steps TEXT NOT NULL,
        success_criteria TEXT,
        risk_level TEXT NOT NULL DEFAULT 'low',
        source_type TEXT NOT NULL DEFAULT 'manual',
        version INTEGER NOT NULL DEFAULT 1,
        search_text TEXT NOT NULL DEFAULT '',
        embedding_status TEXT NOT NULL DEFAULT 'not_indexed',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_memories_app_name
        ON workflow_memories(app_name);
      CREATE INDEX IF NOT EXISTS idx_workflow_memories_topic
        ON workflow_memories(topic);

      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_goal TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'workflow' CHECK (mode IN ('workflow', 'llm', 'hybrid')),
        matched_memory_id TEXT REFERENCES workflow_memories(id),
        selected_memory_ids TEXT,
        plan_json TEXT,
        run_config TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'success', 'failed', 'aborted')),
        summary TEXT,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS task_step_logs (
        id TEXT PRIMARY KEY,
        task_run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        intent TEXT NOT NULL,
        action TEXT NOT NULL,
        locator_strategy TEXT,
        before_screenshot TEXT,
        after_screenshot TEXT,
        uia_snapshot TEXT,
        expected_state TEXT,
        verification_result TEXT CHECK (verification_result IN ('pass', 'fail', 'skipped')),
        error_type TEXT,
        workflow_step_snapshot TEXT,
        target_snapshot TEXT,
        tool_result TEXT,
        failure_info TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_task_step_logs_run_step
        ON task_step_logs(task_run_id, step_index);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `,
  },
];

export function runMigrations(db: DatabaseLike): void {
  // Set PRAGMAs
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  // Ensure schema_migrations table exists (needed before we can check versions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  // Check which versions are already applied
  const applied = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as { version: number }[];
  const appliedVersions = new Set(applied.map((r) => r.version));

  // Find unapplied migrations
  const unapplied = MIGRATIONS.filter((m) => !appliedVersions.has(m.version));
  if (unapplied.length === 0) return;

  // Run unapplied migrations inside a transaction
  const migrate = db.transaction(() => {
    const insert = db.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );
    const now = new Date().toISOString();
    for (const migration of unapplied) {
      db.exec(migration.up);
      insert.run(migration.version, migration.name, now);
    }
  });
  migrate();
}
