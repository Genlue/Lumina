import { getDatabase, saveToFile } from './connection';

export interface TrashRecord {
  id: number;
  profile_id: string;
  original_name: string;
  trash_name: string;
  original_folder: string | null;
  deleted_at: string;
}

function queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params);
  saveToFile();
}

export function addTrashEntry(profileId: string, originalName: string, trashName: string, originalFolder: string | null): void {
  run(
    "INSERT INTO trash (profile_id, original_name, trash_name, original_folder, deleted_at) VALUES (?, ?, ?, ?, datetime('now'))",
    [profileId, originalName, trashName, originalFolder]
  );
}

export function removeTrashEntry(profileId: string, trashName: string): void {
  run('DELETE FROM trash WHERE profile_id = ? AND trash_name = ?', [profileId, trashName]);
}

export function listTrash(profileId: string): TrashRecord[] {
  return queryAll('SELECT * FROM trash WHERE profile_id = ? ORDER BY deleted_at DESC', [profileId]) as unknown as TrashRecord[];
}

export function countTrash(profileId: string): number {
  const rows = queryAll('SELECT COUNT(*) as count FROM trash WHERE profile_id = ?', [profileId]);
  return Number(rows[0]?.count ?? 0);
}

export function emptyTrash(profileId: string): number {
  const db = getDatabase();
  const result = queryAll('SELECT COUNT(*) as count FROM trash WHERE profile_id = ?', [profileId]);
  const count = Number(result[0]?.count ?? 0);
  db.run('DELETE FROM trash WHERE profile_id = ?', [profileId]);
  saveToFile();
  return count;
}

export function getTrashEntry(profileId: string, trashName: string): TrashRecord | null {
  return queryOne('SELECT * FROM trash WHERE profile_id = ? AND trash_name = ?', [profileId, trashName]) as unknown as TrashRecord | null;
}
