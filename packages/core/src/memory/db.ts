import { createRequire } from 'node:module';
import { runMigrations } from './schema.js';
import type { DatabaseLike } from './schema.js';

const require = createRequire(import.meta.url);

// better-sqlite3 uses module.exports, so require returns the constructor directly
const BetterSqlite3: new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number },
) => DatabaseLike = require('better-sqlite3');

let dbSingleton: DatabaseLike | null = null;

export function getDatabase(dbPath: string): DatabaseLike {
  if (dbSingleton) return dbSingleton;

  const db = new BetterSqlite3(dbPath, { timeout: 5000 });
  runMigrations(db);
  dbSingleton = db;
  return db;
}

export function getDatabaseForTest(dbPath?: string): DatabaseLike {
  const db = new BetterSqlite3(dbPath ?? ':memory:');
  runMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (dbSingleton) {
    (dbSingleton as DatabaseLike & { close(): void }).close();
    dbSingleton = null;
  }
}
