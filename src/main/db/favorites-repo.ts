import { getDatabase, saveToFile } from './connection';

export interface FavoritesRecord {
  profile_id: string;
  image_id: number;
  added_at: string;
  filename?: string;
  file_size?: number;
  file_date?: number;
  width?: number;
  height?: number;
  album_id?: number;
  folder_name?: string;
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

function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params);
  saveToFile();
}

export function toggleFavorite(profileId: string, imageId: number): boolean {
  const db = getDatabase();
  const stmt = db.prepare('SELECT 1 FROM favorites WHERE profile_id = ? AND image_id = ?');
  stmt.bind([profileId, imageId]);
  const exists = stmt.step();
  stmt.free();

  if (exists) {
    run('DELETE FROM favorites WHERE profile_id = ? AND image_id = ?', [profileId, imageId]);
    return false;
  } else {
    run("INSERT INTO favorites (profile_id, image_id, added_at) VALUES (?, ?, datetime('now'))", [profileId, imageId]);
    return true;
  }
}

export function listFavorites(profileId: string): FavoritesRecord[] {
  return queryAll(`
    SELECT f.*, i.filename, i.file_size, i.file_date, i.width, i.height, i.album_id, a.folder_name
    FROM favorites f
    JOIN images i ON f.image_id = i.id
    LEFT JOIN albums a ON i.album_id = a.id
    WHERE f.profile_id = ?
    ORDER BY f.added_at DESC
  `, [profileId]) as unknown as FavoritesRecord[];
}

export function isFavorite(profileId: string, imageId: number): boolean {
  const stmt = getDatabase().prepare('SELECT 1 FROM favorites WHERE profile_id = ? AND image_id = ?');
  stmt.bind([profileId, imageId]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

export function countFavorites(profileId: string): number {
  const rows = queryAll('SELECT COUNT(*) as count FROM favorites WHERE profile_id = ?', [profileId]);
  return Number(rows[0]?.count ?? 0);
}
