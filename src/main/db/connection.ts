import initSqlJs, { Database as SqlJsDb } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

let db: SqlJsDb | null = null;
let dbPath: string | null = null;

export function getDatabase(): SqlJsDb {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export async function initDatabase(path_: string): Promise<void> {
  dbPath = path_;
  const dir = path.dirname(path_);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Load existing or create new
  if (fs.existsSync(path_)) {
    const buffer = fs.readFileSync(path_);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL-like settings
  db.run('PRAGMA foreign_keys = ON;');
  db.run('PRAGMA journal_mode = WAL;');

  runMigrations();
  saveToFile();

  console.log('[DB] Initialized at', path_);
}

export function closeDatabase(): void {
  if (db) {
    saveToFile();
    db.close();
    db = null;
    console.log('[DB] Closed');
  }
}

export function saveToFile(): void {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

function runMigrations(): void {
  if (!db) return;

  db.run(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const result = db.exec('SELECT MAX(version) as version FROM _schema_version');
  let version = 0;
  if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0] !== null) {
    version = Number(result[0].values[0][0]);
  }

  if (version < 1) {
    db.run(`
      CREATE TABLE profiles (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        last_access INTEGER,
        unavailable INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE albums (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        folder_name TEXT NOT NULL,
        cover_image TEXT,
        sort_order TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(profile_id, folder_name)
      );

      CREATE TABLE images (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        album_id   INTEGER REFERENCES albums(id) ON DELETE CASCADE,
        filename   TEXT NOT NULL,
        file_size  INTEGER,
        file_date  INTEGER,
        width      INTEGER,
        height     INTEGER,
        thumbnail  BLOB,
        UNIQUE(profile_id, album_id, filename)
      );

      CREATE TABLE favorites (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        image_id   INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        added_at   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(profile_id, image_id)
      );

      CREATE TABLE trash (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        trash_name    TEXT NOT NULL,
        original_folder TEXT,
        deleted_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE settings (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        view_mode       TEXT NOT NULL DEFAULT 'grid',
        sort_by          TEXT NOT NULL DEFAULT 'name-asc',
        theme_mode       TEXT NOT NULL DEFAULT 'dark',
        accent_color     TEXT NOT NULL DEFAULT '#6D79F6',
        bg_image         TEXT,
        bg_blur          INTEGER NOT NULL DEFAULT 20,
        bg_opacity       REAL NOT NULL DEFAULT 0,
        sidebar_width    INTEGER NOT NULL DEFAULT 270,
        sidebar_opacity   REAL NOT NULL DEFAULT 0.82,
        draw_count       INTEGER NOT NULL DEFAULT 3
      );

      CREATE INDEX idx_albums_profile ON albums(profile_id);
      CREATE INDEX idx_images_profile ON images(profile_id);
      CREATE INDEX idx_images_album ON images(album_id);
      CREATE INDEX idx_favorites_profile ON favorites(profile_id);
      CREATE INDEX idx_trash_profile ON trash(profile_id);
    `);

    db.run('INSERT INTO _schema_version (version) VALUES (1);');
    console.log('[DB] Migration V1 applied');
  }

  if (version < 2) {
    db.run('ALTER TABLE settings ADD COLUMN card_opacity REAL NOT NULL DEFAULT 1');
    db.run('ALTER TABLE settings ADD COLUMN card_blur INTEGER NOT NULL DEFAULT 0');
    db.run('INSERT INTO _schema_version (version) VALUES (2);');
    console.log('[DB] Migration V2 applied: card settings');
  }

  if (version < 3) {
    db.run('ALTER TABLE settings ADD COLUMN sidebar_font INTEGER NOT NULL DEFAULT 14');
    db.run('INSERT INTO _schema_version (version) VALUES (3);');
    console.log('[DB] Migration V3 applied: sidebar font');
  }

  saveToFile();
}
