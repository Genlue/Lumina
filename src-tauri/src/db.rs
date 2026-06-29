use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub struct DbState {
    /// 中央数据库连接 (profiles 表)
    pub conn: Mutex<Connection>,
    /// 缓存的 profile DB 连接 (profile_id → Connection)
    pub profile_conns: Mutex<HashMap<String, Arc<Mutex<Connection>>>>,
}

// ============================================================
// 中央数据库 (profiles 表)
// ============================================================

pub fn init_central_database(path: &Path) -> rusqlite::Result<DbState> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;

    // 检查是否存在旧表 (迁移前判断)
    let has_old_tables: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='albums'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    // 运行中央数据库迁移 (profiles 表)
    run_central_migrations(&conn)?;

    if has_old_tables {
        // 中央 DB 还存在旧表 → 执行数据迁移到 profile DB
        migrate_old_data_to_profile_dbs(&conn, path)?;

        // 删除中央 DB 中的旧表
        conn.execute_batch(
            "DROP TABLE IF EXISTS albums;
             DROP TABLE IF EXISTS images;
             DROP TABLE IF EXISTS favorites;
             DROP TABLE IF EXISTS trash;
             DROP TABLE IF EXISTS settings;
             DROP INDEX IF EXISTS idx_albums_profile;
             DROP INDEX IF EXISTS idx_images_profile;
             DROP INDEX IF EXISTS idx_images_album;
             DROP INDEX IF EXISTS idx_favorites_profile;
             DROP INDEX IF EXISTS idx_trash_profile;"
        )?;
        println!("[DB] Old tables dropped from central database");
    }

    Ok(DbState {
        conn: Mutex::new(conn),
        profile_conns: Mutex::new(HashMap::new()),
    })
}

fn run_central_migrations(conn: &Connection) -> rusqlite::Result<()> {
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
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                folder_path TEXT NOT NULL,
                last_access INTEGER,
                unavailable INTEGER NOT NULL DEFAULT 0
            );"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (1)", [])?;
        println!("[DB] Central migration V1 applied (profiles table)");
    }

    Ok(())
}

// ============================================================
// Profile 数据库 (albums, images, favorites, trash, settings)
// ============================================================

/// 初始化 profile 数据库 schema (无外键 REFERENCES profiles)
pub fn init_profile_database(path: &Path) -> rusqlite::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    init_profile_db_schema(&conn)?;
    Ok(())
}

fn init_profile_db_schema(conn: &Connection) -> rusqlite::Result<()> {
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
            "CREATE TABLE albums (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id  TEXT NOT NULL,
                folder_name TEXT NOT NULL,
                cover_image TEXT,
                sort_order  TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(profile_id, folder_name)
            );

            CREATE TABLE images (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id TEXT NOT NULL,
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
                profile_id TEXT NOT NULL,
                image_id   INTEGER NOT NULL REFERENCES images(id),
                added_at   TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY(profile_id, image_id)
            );

            CREATE TABLE trash (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id      TEXT NOT NULL,
                original_name   TEXT NOT NULL,
                trash_name      TEXT NOT NULL,
                original_folder TEXT,
                deleted_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE settings (
                profile_id      TEXT PRIMARY KEY,
                view_mode       TEXT NOT NULL DEFAULT 'grid',
                sort_by         TEXT NOT NULL DEFAULT 'name-asc',
                theme_mode      TEXT NOT NULL DEFAULT 'dark',
                accent_color    TEXT NOT NULL DEFAULT '#6D79F6',
                bg_image        TEXT,
                bg_blur         INTEGER NOT NULL DEFAULT 20,
                bg_opacity      REAL NOT NULL DEFAULT 0,
                sidebar_width   INTEGER NOT NULL DEFAULT 270,
                sidebar_opacity REAL NOT NULL DEFAULT 0.82,
                draw_count      INTEGER NOT NULL DEFAULT 3,
                card_opacity    REAL NOT NULL DEFAULT 1,
                card_blur       INTEGER NOT NULL DEFAULT 0,
                sidebar_font    INTEGER NOT NULL DEFAULT 14,
                random_interval INTEGER NOT NULL DEFAULT 3,
                thumbnail_size  INTEGER NOT NULL DEFAULT 400
            );

            CREATE INDEX IF NOT EXISTS idx_images_profile ON images(profile_id);
            CREATE INDEX IF NOT EXISTS idx_images_album  ON images(album_id);
            CREATE INDEX IF NOT EXISTS idx_trash_profile  ON trash(profile_id);"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (1)", [])?;
        println!("[DB] Profile DB migration V1 applied");
    }

    if version < 2 {
        conn.execute_batch(
            "ALTER TABLE favorites ADD COLUMN filename TEXT;
             ALTER TABLE favorites ADD COLUMN album_id INTEGER;"
        )?;
        // Backfill existing favorites with data from the images table
        conn.execute(
            "UPDATE favorites SET
                filename = (SELECT filename FROM images WHERE images.id = favorites.image_id),
                album_id = (SELECT album_id FROM images WHERE images.id = favorites.image_id)
             WHERE EXISTS (SELECT 1 FROM images WHERE images.id = favorites.image_id)",
            [],
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (2)", [])?;
        println!("[DB] Profile DB migration V2 applied (favorites filename/album_id)");
    }

    if version < 3 {
        conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_images_unique_all
             ON images(profile_id, COALESCE(album_id, -1), filename);

             DELETE FROM images WHERE rowid NOT IN (
                 SELECT MIN(rowid) FROM images
                 GROUP BY profile_id, COALESCE(album_id, -1), filename
             );

             DELETE FROM favorites WHERE image_id NOT IN (SELECT id FROM images);"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (3)", [])?;
        println!("[DB] Profile DB migration V3 applied (unique index for NULL album_id)");
    }

    Ok(())
}

// ============================================================
// 数据迁移：从旧中央 DB 迁移到 profile DB
// ============================================================

fn migrate_old_data_to_profile_dbs(conn: &Connection, _central_path: &Path) -> rusqlite::Result<()> {
    // 获取所有 profile
    let profiles = get_all_profiles_simple(conn);

    if profiles.is_empty() {
        println!("[DB Migration] No profiles found, skipping data migration");
        return Ok(());
    }

    println!("[DB Migration] Migrating data for {} profile(s)...", profiles.len());

    for (id, folder_path) in &profiles {
        let profile_db_path = Path::new(folder_path).join(".album").join("data.db");

        // 创建/初始化 profile DB
        if let Some(parent) = profile_db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let p_conn = Connection::open(&profile_db_path)?;
        p_conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        init_profile_db_schema(&p_conn)?;

        // 迁移 albums
        let mut stmt = conn.prepare(
            "SELECT id, profile_id, folder_name, cover_image, sort_order, created_at, updated_at
             FROM albums WHERE profile_id = ?1"
        )?;
        let album_rows: Vec<(i64, String, String, Option<String>, Option<String>, String, String)> = stmt
            .query_map(rusqlite::params![id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Build old_id → new_id map for album references in images
        let mut album_id_map: HashMap<i64, i64> = HashMap::new();

        for (old_id, p_id, folder_name, cover_image, sort_order, created_at, updated_at) in &album_rows {
            p_conn.execute(
                "INSERT OR IGNORE INTO albums (profile_id, folder_name, cover_image, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![p_id, folder_name, cover_image, sort_order, created_at, updated_at],
            )?;
            // Get new id
            if let Ok(new_id) = p_conn.query_row(
                "SELECT id FROM albums WHERE profile_id = ?1 AND folder_name = ?2",
                rusqlite::params![p_id, folder_name],
                |row| row.get::<_, i64>(0),
            ) {
                album_id_map.insert(*old_id, new_id);
            }
        }

        // 迁移 images
        let mut img_stmt = conn.prepare(
            "SELECT id, profile_id, album_id, filename, file_size, file_date, width, height
             FROM images WHERE profile_id = ?1"
        )?;
        let image_rows: Vec<(i64, String, Option<i64>, String, Option<i64>, Option<i64>, Option<i64>, Option<i64>)> = img_stmt
            .query_map(rusqlite::params![id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let mut image_id_map: HashMap<i64, i64> = HashMap::new();
        for (old_id, p_id, album_id, filename, file_size, file_date, width, height) in &image_rows {
            let new_album_id = album_id.and_then(|aid| album_id_map.get(&aid)).copied();
            p_conn.execute(
                "INSERT OR IGNORE INTO images (profile_id, album_id, filename, file_size, file_date, width, height)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![p_id, new_album_id, filename, file_size, file_date, width, height],
            )?;
            if let Ok(new_id) = p_conn.query_row(
                "SELECT id FROM images WHERE profile_id = ?1 AND filename = ?2 AND album_id IS ?3",
                rusqlite::params![p_id, filename, new_album_id],
                |row| row.get::<_, i64>(0),
            ) {
                image_id_map.insert(*old_id, new_id);
            }
        }

        // 迁移 favorites
        let mut fav_stmt = conn.prepare(
            "SELECT profile_id, image_id, added_at FROM favorites WHERE profile_id = ?1"
        )?;
        let fav_rows: Vec<(String, i64, String)> = fav_stmt
            .query_map(rusqlite::params![id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        for (p_id, old_img_id, added_at) in &fav_rows {
            if let Some(new_img_id) = image_id_map.get(old_img_id) {
                p_conn.execute(
                    "INSERT OR IGNORE INTO favorites (profile_id, image_id, added_at) VALUES (?1, ?2, ?3)",
                    rusqlite::params![p_id, new_img_id, added_at],
                )?;
            }
        }

        // 迁移 trash
        let mut trash_stmt = conn.prepare(
            "SELECT id, profile_id, original_name, trash_name, original_folder, deleted_at
             FROM trash WHERE profile_id = ?1"
        )?;
        let trash_rows: Vec<(i64, String, String, String, Option<String>, String)> = trash_stmt
            .query_map(rusqlite::params![id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        for (_, p_id, original_name, trash_name, original_folder, deleted_at) in &trash_rows {
            p_conn.execute(
                "INSERT OR IGNORE INTO trash (profile_id, original_name, trash_name, original_folder, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![p_id, original_name, trash_name, original_folder, deleted_at],
            )?;
        }

        // 迁移 settings
        let mut set_stmt = conn.prepare(
            "SELECT profile_id, view_mode, sort_by, theme_mode, accent_color,
                    bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity,
                    draw_count, card_opacity, card_blur, sidebar_font, random_interval,
                    thumbnail_size
             FROM settings WHERE profile_id = ?1"
        )?;
        let settings_rows: Vec<(String, String, String, String, String, Option<String>, i64, f64, i64, f64, i64, f64, i64, i64, i64, i64)> = set_stmt
            .query_map(rusqlite::params![id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, f64>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, f64>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, f64>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, i64>(13)?,
                    row.get::<_, i64>(14)?,
                    row.get::<_, i64>(15)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        for (p_id, view_mode, sort_by, theme_mode, accent_color, bg_image,
             bg_blur, bg_opacity, sidebar_width, sidebar_opacity,
             draw_count, card_opacity, card_blur, sidebar_font, random_interval,
             thumbnail_size) in &settings_rows
        {
            p_conn.execute(
                "INSERT OR REPLACE INTO settings (profile_id, view_mode, sort_by, theme_mode, accent_color,
                 bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity,
                 draw_count, card_opacity, card_blur, sidebar_font, random_interval, thumbnail_size)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                rusqlite::params![p_id, view_mode, sort_by, theme_mode, accent_color,
                    bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity,
                    draw_count, card_opacity, card_blur, sidebar_font, random_interval,
                    thumbnail_size],
            )?;
        }

        println!("[DB Migration] Migrated profile {}: {} albums, {} images, {} favorites, {} trash entries",
            id, album_rows.len(), image_rows.len(), fav_rows.len(), trash_rows.len());
    }

    println!("[DB Migration] Complete");
    Ok(())
}

/// 简单的 profile 列表查询 (不依赖 repos 模块)
fn get_all_profiles_simple(conn: &Connection) -> Vec<(String, String)> {
    let mut stmt = conn
        .prepare("SELECT id, folder_path FROM profiles ORDER BY last_access DESC")
        .unwrap_or_else(|e| {
            eprintln!("[DB] Failed to list profiles for migration: {}", e);
            panic!("Failed to list profiles: {}", e);
        });
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .unwrap();
    rows.filter_map(|r| r.ok()).collect()
}

// ============================================================
// Profile DB 连接管理
// ============================================================

/// 获取或打开 profile 数据库连接
/// 先尝试从缓存获取，若未缓存则根据 folder_path 打开并缓存
pub fn get_profile_conn(
    state: &DbState,
    profile_id: &str,
    folder_path: &str,
) -> Result<Arc<Mutex<Connection>>, String> {
    let mut cache = state.profile_conns.lock().map_err(|e| format!("Cache lock: {}", e))?;

    if let Some(conn) = cache.get(profile_id) {
        return Ok(conn.clone());
    }

    let profile_db_path = Path::new(folder_path).join(".album").join("data.db");
    let conn = Connection::open(&profile_db_path)
        .map_err(|e| format!("Open profile DB: {}", e))?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|e| format!("Profile DB pragma: {}", e))?;

    // Ensure schema migrations run (handles new profiles and existing profiles that need V3+)
    init_profile_db_schema(&conn).map_err(|e| format!("Profile DB schema: {}", e))?;

    let arc = Arc::new(Mutex::new(conn));
    cache.insert(profile_id.to_string(), arc.clone());
    Ok(arc)
}

/// 关闭并移除缓存的 profile 数据库连接
pub fn close_profile_conn(state: &DbState, profile_id: &str) {
    if let Ok(mut cache) = state.profile_conns.lock() {
        cache.remove(profile_id);
        println!("[DB] Closed profile connection: {}", profile_id);
    }
}
