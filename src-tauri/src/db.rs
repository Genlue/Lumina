use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct DbState {
    pub conn: Mutex<Connection>,
}

pub fn init_database(path: &Path) -> rusqlite::Result<DbState> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    run_migrations(&conn)?;

    Ok(DbState { conn: Mutex::new(conn) })
}

fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );"
    )?;

    let version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE profiles (
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
            CREATE INDEX idx_trash_profile ON trash(profile_id);"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (1)", [])?;
        println!("[DB] Migration V1 applied");
    }

    if version < 2 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN card_opacity REAL NOT NULL DEFAULT 1;
             ALTER TABLE settings ADD COLUMN card_blur INTEGER NOT NULL DEFAULT 0;
             INSERT INTO _schema_version (version) VALUES (2);"
        )?;
        println!("[DB] Migration V2 applied: card settings");
    }

    if version < 3 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN sidebar_font INTEGER NOT NULL DEFAULT 14;
             INSERT INTO _schema_version (version) VALUES (3);"
        )?;
        println!("[DB] Migration V3 applied: sidebar font");
    }

    if version < 4 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN random_interval INTEGER NOT NULL DEFAULT 3;
             INSERT INTO _schema_version (version) VALUES (4);"
        )?;
        println!("[DB] Migration V4 applied: random interval");
    }

    Ok(())
}
