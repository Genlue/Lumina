import { getDatabase, saveToFile } from './connection';
import { v4 as uuid } from 'uuid';

export interface Profile {
  id: string;
  name: string;
  folder_path: string;
  last_access: number | null;
  unavailable: number;
}

function queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql: string, params: unknown[] = []): void {
  const db = getDatabase();
  db.run(sql, params);
  saveToFile();
}

export function createProfile(folderPath: string, name?: string): Profile {
  const id = uuid();
  const profileName = name || folderPath.split(/[/\\]/).pop() || '未命名';

  run(
    'INSERT INTO profiles (id, name, folder_path, last_access) VALUES (?, ?, ?, ?)',
    [id, profileName, folderPath, Date.now()]
  );

  run('INSERT OR IGNORE INTO settings (profile_id) VALUES (?)', [id]);

  return queryOne('SELECT * FROM profiles WHERE id = ?', [id]) as unknown as Profile;
}

export function listProfiles(): Profile[] {
  return queryAll('SELECT * FROM profiles ORDER BY last_access DESC') as unknown as Profile[];
}

export function getProfileById(id: string): Profile | null {
  return queryOne('SELECT * FROM profiles WHERE id = ?', [id]) as unknown as Profile | null;
}

export function touchProfile(id: string): void {
  run('UPDATE profiles SET last_access = ?, unavailable = 0 WHERE id = ?', [Date.now(), id]);
}

export function markProfileGone(id: string): void {
  run('UPDATE profiles SET unavailable = 1 WHERE id = ?', [id]);
}

export function removeProfile(id: string): void {
  run('DELETE FROM profiles WHERE id = ?', [id]);
}

export function updateFolderPath(id: string, newPath: string): void {
  const folderName = newPath.split(/[/\\]/).pop() || '未命名';
  run('UPDATE profiles SET folder_path = ?, name = ?, unavailable = 0 WHERE id = ?', [newPath, folderName, id]);
}
