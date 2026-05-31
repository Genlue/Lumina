import { getDatabase, saveToFile } from './connection';

export interface ImageRecord {
  id: number;
  profile_id: string;
  album_id: number | null;
  filename: string;
  file_size: number | null;
  file_date: number | null;
  width: number | null;
  height: number | null;
  thumbnail: Uint8Array | null;
}

export interface FileInfo {
  name: string;
  handle: never;
  size: number;
  lastModified: number;
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

export function syncImages(profileId: string, albumId: number | null, files: FileInfo[]): void {
  const db = getDatabase();

  for (const f of files) {
    db.run(
      'INSERT OR REPLACE INTO images (profile_id, album_id, filename, file_size, file_date) VALUES (?, ?, ?, ?, ?)',
      [profileId, albumId, f.name, f.size, f.lastModified]
    );
  }

  // Remove stale records
  if (files.length > 0) {
    const placeholders = files.map(() => '?').join(',');
    const params: unknown[] = [profileId, albumId, albumId, ...files.map(f => f.name)];
    db.run(
      `DELETE FROM images WHERE profile_id = ? AND (album_id IS ? OR album_id = ?) AND filename NOT IN (${placeholders})`,
      params
    );
  }

  saveToFile();
}

export function listImages(profileId: string, albumId?: number | null): ImageRecord[] {
  if (albumId === undefined) {
    return queryAll('SELECT * FROM images WHERE profile_id = ? ORDER BY filename', [profileId]) as unknown as ImageRecord[];
  }
  if (albumId === null) {
    return queryAll('SELECT * FROM images WHERE profile_id = ? AND album_id IS NULL ORDER BY filename', [profileId]) as unknown as ImageRecord[];
  }
  return queryAll('SELECT * FROM images WHERE profile_id = ? AND album_id = ? ORDER BY filename', [profileId, albumId]) as unknown as ImageRecord[];
}

export function getImageById(id: number): ImageRecord | null {
  return queryOne('SELECT * FROM images WHERE id = ?', [id]) as unknown as ImageRecord | null;
}

export function getImageByName(profileId: string, filename: string, albumId?: number | null): ImageRecord | null {
  if (albumId === undefined || albumId === null) {
    return queryOne('SELECT * FROM images WHERE profile_id = ? AND filename = ? AND album_id IS NULL', [profileId, filename]) as unknown as ImageRecord | null;
  }
  return queryOne('SELECT * FROM images WHERE profile_id = ? AND filename = ? AND album_id = ?', [profileId, filename, albumId]) as unknown as ImageRecord | null;
}

export function updateImageMeta(id: number, data: { width?: number; height?: number; thumbnail?: Uint8Array }): void {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (data.width !== undefined) { sets.push('width = ?'); vals.push(data.width); }
  if (data.height !== undefined) { sets.push('height = ?'); vals.push(data.height); }
  if (data.thumbnail) { sets.push('thumbnail = ?'); vals.push(data.thumbnail); }

  if (sets.length === 0) return;
  vals.push(id);
  run(`UPDATE images SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export function updateImageAlbum(imageId: number, newAlbumId: number | null): void {
  run('UPDATE images SET album_id = ? WHERE id = ?', [newAlbumId, imageId]);
}

export function deleteImage(id: number): void {
  run('DELETE FROM images WHERE id = ?', [id]);
}

export function deleteAllImagesForProfile(profileId: string): void {
  run('DELETE FROM images WHERE profile_id = ?', [profileId]);
}
