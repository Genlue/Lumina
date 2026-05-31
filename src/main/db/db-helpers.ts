/**
 * Shared DB helpers — import this in each repo file instead of redefining.
 * Usage: import { queryAll, queryOne, run } from '../db-helpers';
 */

import { getDatabase, saveToFile } from './connection';

export function queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params);
  saveToFile();
}
