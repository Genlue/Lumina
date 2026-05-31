import { getDatabase, saveToFile } from './connection';

export interface Album {
  id: number;
  profile_id: string;
  folder_name: string;
  cover_image: string | null;
  sort_order: string | null;
  created_at: string;
  updated_at: string;
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

export function ensureAlbumsForProfile(profileId: string, folderNames: string[]): void {
  const db = getDatabase();
  for (const name of folderNames) {
    db.run(
      "INSERT OR IGNORE INTO albums (profile_id, folder_name, updated_at) VALUES (?, ?, datetime('now'))",
      [profileId, name]
    );
  }
  saveToFile();
}

export function listAlbums(profileId: string): Album[] {
  return queryAll('SELECT * FROM albums WHERE profile_id = ? ORDER BY folder_name', [profileId]) as unknown as Album[];
}

export function getAlbumByFolder(profileId: string, folderName: string): Album | null {
  return queryOne('SELECT * FROM albums WHERE profile_id = ? AND folder_name = ?', [profileId, folderName]) as unknown as Album | null;
}

export function setAlbumCover(profileId: string, folderName: string, imageName: string): void {
  run("UPDATE albums SET cover_image = ?, updated_at = datetime('now') WHERE profile_id = ? AND folder_name = ?",
    [imageName, profileId, folderName]);
}

export function setAlbumOrder(profileId: string, folderName: string, order: string[]): void {
  run("UPDATE albums SET sort_order = ?, updated_at = datetime('now') WHERE profile_id = ? AND folder_name = ?",
    [JSON.stringify(order), profileId, folderName]);
}

export function renameAlbum(profileId: string, oldFolderName: string, newFolderName: string): void {
  run("UPDATE albums SET folder_name = ?, updated_at = datetime('now') WHERE profile_id = ? AND folder_name = ?",
    [newFolderName, profileId, oldFolderName]);
}

export function deleteAlbum(profileId: string, folderName: string): void {
  run('DELETE FROM albums WHERE profile_id = ? AND folder_name = ?', [profileId, folderName]);
}
