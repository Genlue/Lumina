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
                bg_blur         INTEGER NOT NULL DEFAULT 0,
                bg_opacity      REAL NOT NULL DEFAULT 1.0,
                sidebar_width   INTEGER NOT NULL DEFAULT 150,
                sidebar_opacity REAL NOT NULL DEFAULT 0.7,
                draw_count      INTEGER NOT NULL DEFAULT 10,
                card_opacity    REAL NOT NULL DEFAULT 0.7,
                card_blur       INTEGER NOT NULL DEFAULT 16,
                sidebar_font    INTEGER NOT NULL DEFAULT 20,
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

    if version < 4 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN toolbar_height INTEGER NOT NULL DEFAULT 56;
             ALTER TABLE settings ADD COLUMN toolbar_blur INTEGER NOT NULL DEFAULT 16;
             ALTER TABLE settings ADD COLUMN toolbar_opacity REAL NOT NULL DEFAULT 0.7;"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (4)", [])?;
        println!("[DB] Profile DB migration V4 applied (toolbar settings)");
    }

    if version < 5 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN select_overlay_opacity REAL NOT NULL DEFAULT 0.2;"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (5)", [])?;
        println!("[DB] Profile DB migration V5 applied (select_overlay_opacity)");
    }

    if version < 6 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN reverse_search_enabled INTEGER NOT NULL DEFAULT 1;"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (6)", [])?;
        println!("[DB] Profile DB migration V6 applied (reverse_search_enabled)");
    }

    if version < 7 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN list_columns INTEGER NOT NULL DEFAULT 3;"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (7)", [])?;
        println!("[DB] Profile DB migration V7 applied (list_columns)");
    }

    if version < 8 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN home_title TEXT;"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (8)", [])?;
        println!("[DB] Profile DB migration V8 applied (home_title)");
    }

    if version < 9 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN accent_mode TEXT NOT NULL DEFAULT 'custom';
             ALTER TABLE settings ADD COLUMN accent_color_dark TEXT NOT NULL DEFAULT '#4A9EFF';
             ALTER TABLE settings ADD COLUMN accent_color_light TEXT NOT NULL DEFAULT '#003D7A';"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (9)", [])?;
        println!("[DB] Profile DB migration V9 applied (accent modes)");
    }

    if version < 10 {
        conn.execute_batch(
            "UPDATE settings SET toolbar_height=56 WHERE toolbar_height=48;
             UPDATE settings SET toolbar_opacity=0.7 WHERE toolbar_opacity=0.85;
             UPDATE settings SET reverse_search_enabled=1 WHERE reverse_search_enabled=0;
             UPDATE settings SET list_columns=3 WHERE list_columns=1;"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (10)", [])?;
        println!("[DB] Profile DB migration V10 applied (fix defaults)");
    }

    if version < 11 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN bg_transparent INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE settings ADD COLUMN sidebar_blur INTEGER NOT NULL DEFAULT 16;"
        )?;
        conn.execute("INSERT INTO _schema_version (version) VALUES (11)", [])?;
        println!("[DB] Profile DB migration V11 applied (bg_transparent, sidebar_blur)");
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
    // 1. Short-term lock: only check cache, reduce lock holding time
    {
        let cache = state.profile_conns.lock().map_err(|e| format!("Cache lock: {}", e))?;
        if let Some(conn) = cache.get(profile_id) {
            return Ok(conn.clone());
        }
    }

    let profile_db_path = Path::new(folder_path).join(".album").join("data.db");

    // 2. Ensure root folder exists
    if !Path::new(folder_path).exists() {
        return Err(format!("Folder not found: {}", folder_path));
    }

    // 3. Auto-create .album/data.db if missing
    if !profile_db_path.exists() {
        if let Some(parent) = profile_db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Create .album dir: {}", e))?;
        }
        // Create and initialize temporary connection
        let conn = Connection::open(&profile_db_path)
            .map_err(|e| format!("Create profile DB: {}", e))?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(|e| format!("Profile DB pragma: {}", e))?;
        init_profile_db_schema(&conn).map_err(|e| format!("Profile DB schema: {}", e))?;
        // conn dropped here
    }

    // 4. Open connection
    let conn = Connection::open(&profile_db_path)
        .map_err(|e| format!("Open profile DB: {}", e))?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|e| format!("Profile DB pragma: {}", e))?;

    // 5. Ensure schema is up to date
    init_profile_db_schema(&conn).map_err(|e| format!("Profile DB schema: {}", e))?;

    // 6. Check profile_id match in settings; if mismatch, perform safe migration
    let profile_matches: bool = conn.query_row(
        "SELECT 1 FROM settings WHERE profile_id = ?1",
        rusqlite::params![profile_id],
        |_| Ok(true),
    ).unwrap_or(false);

    if !profile_matches {
        eprintln!("[DB] Profile ID mismatch in data.db for {}, adopting data", profile_id);

        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Migration TX begin: {}", e))?;

        // Read old settings row (with a different profile_id)
        // NOTE: sidebar_blur was never added to the DB schema, so it's not included here
        struct OldSettings {
            view_mode: String, sort_by: String, theme_mode: String,
            accent_color: String, bg_image: Option<String>,
            bg_blur: i64, bg_opacity: f64,
            sidebar_width: i64, sidebar_opacity: f64,
            draw_count: i64, card_opacity: f64, card_blur: i64,
            sidebar_font: i64, random_interval: i64, thumbnail_size: i64,
            toolbar_height: i64, toolbar_blur: i64, toolbar_opacity: f64,
            select_overlay_opacity: f64,
            reverse_search_enabled: i64,
            list_columns: i64,
            home_title: Option<String>,
            accent_mode: String,
            accent_color_dark: String,
            accent_color_light: String,
            bg_transparent: i64,
            sidebar_blur: i64,
        }

        let old = conn.query_row(
            "SELECT view_mode, sort_by, theme_mode, accent_color,
                    bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity,
                    draw_count, card_opacity, card_blur, sidebar_font, random_interval,
                    thumbnail_size, toolbar_height, toolbar_blur, toolbar_opacity,
                    select_overlay_opacity, reverse_search_enabled, list_columns,
                    home_title, accent_mode, accent_color_dark,
                    accent_color_light, bg_transparent, sidebar_blur
             FROM settings WHERE profile_id != ?1 LIMIT 1",
            rusqlite::params![profile_id],
            |row| Ok(OldSettings {
                view_mode: row.get(0)?, sort_by: row.get(1)?, theme_mode: row.get(2)?,
                accent_color: row.get(3)?, bg_image: row.get(4)?,
                bg_blur: row.get(5)?, bg_opacity: row.get(6)?,
                sidebar_width: row.get(7)?, sidebar_opacity: row.get(8)?,
                draw_count: row.get(9)?, card_opacity: row.get(10)?, card_blur: row.get(11)?,
                sidebar_font: row.get(12)?, random_interval: row.get(13)?, thumbnail_size: row.get(14)?,
                toolbar_height: row.get(15)?, toolbar_blur: row.get(16)?,
                toolbar_opacity: row.get(17)?, select_overlay_opacity: row.get(18)?,
                reverse_search_enabled: row.get(19)?,
                list_columns: row.get(20)?,
                home_title: row.get(21).ok().flatten(),
                accent_mode: row.get(22).unwrap_or_else(|_| "custom".to_string()),
                accent_color_dark: row.get(23).unwrap_or_else(|_| "#4A9EFF".to_string()),
                accent_color_light: row.get(24).unwrap_or_else(|_| "#003D7A".to_string()),
                bg_transparent: row.get(25).unwrap_or(0),
                sidebar_blur: row.get(26).unwrap_or(16),
            }),
        ).ok();

        // Delete conflicting row with target profile_id
        conn.execute(
            "DELETE FROM settings WHERE profile_id = ?1",
            rusqlite::params![profile_id],
        ).ok();
        // Delete other old profile_id rows
        conn.execute(
            "DELETE FROM settings WHERE profile_id != ?1",
            rusqlite::params![profile_id],
        ).ok();

        // If old settings exist, re-insert with new profile_id
        if let Some(s) = old {
            conn.execute(
                "INSERT INTO settings (profile_id, view_mode, sort_by, theme_mode, accent_color,
                 bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity, draw_count,
                 card_opacity, card_blur, sidebar_font, random_interval, thumbnail_size,
                 toolbar_height, toolbar_blur, toolbar_opacity, select_overlay_opacity,
                 reverse_search_enabled, list_columns, home_title, accent_mode,
                 accent_color_dark, accent_color_light, bg_transparent, sidebar_blur)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28)",
                rusqlite::params![profile_id, s.view_mode, s.sort_by, s.theme_mode, s.accent_color,
                        s.bg_image, s.bg_blur, s.bg_opacity, s.sidebar_width, s.sidebar_opacity,
                        s.draw_count, s.card_opacity, s.card_blur, s.sidebar_font, s.random_interval,
                        s.thumbnail_size, s.toolbar_height, s.toolbar_blur, s.toolbar_opacity,
                        s.select_overlay_opacity, s.reverse_search_enabled, s.list_columns,
                        s.home_title, s.accent_mode, s.accent_color_dark,
                        s.accent_color_light, s.bg_transparent, s.sidebar_blur],
            ).map_err(|e| format!("Migration INSERT settings: {}", e))?;
        }

        // favorites: remove conflicts, then update profile_id
        conn.execute(
            "DELETE FROM favorites WHERE profile_id != ?1 AND image_id IN (
                 SELECT image_id FROM favorites WHERE profile_id = ?1
             )",
            rusqlite::params![profile_id, profile_id],
        ).ok();
        conn.execute(
            "UPDATE favorites SET profile_id = ?1 WHERE profile_id != ?1",
            rusqlite::params![profile_id],
        ).ok();

        // albums, images, trash: update profile_id
        for table in &["albums", "images", "trash"] {
            conn.execute(
                &format!("UPDATE {} SET profile_id = ?1 WHERE profile_id != ?1", table),
                rusqlite::params![profile_id],
            ).ok();
        }

        // Fallback: ensure at least one settings row for target profile_id
        let still_empty: bool = conn.query_row(
            "SELECT 1 FROM settings WHERE profile_id = ?1",
            rusqlite::params![profile_id],
            |_| Ok(true),
        ).unwrap_or(false);
        if !still_empty {
            conn.execute(
                "INSERT OR IGNORE INTO settings (profile_id) VALUES (?1)",
                rusqlite::params![profile_id],
            ).ok();
        }

        tx.commit().map_err(|e| format!("Migration TX commit: {}", e))?;
        eprintln!("[DB] Profile ID migration for {} completed", profile_id);
    }

    // 7. Cache connection (double-check pattern)
    let arc = Arc::new(Mutex::new(conn));
    let mut cache = state.profile_conns.lock().map_err(|e| format!("Cache lock: {}", e))?;
    if let Some(existing) = cache.get(profile_id) {
        return Ok(existing.clone());
    }
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

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::path::PathBuf;

    /// Create a temporary directory for test isolation
    fn temp_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("photo_album_test_{}_{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Create a minimal DbState for testing (central DB has profiles table)
    fn setup_state(central_dir: &std::path::Path) -> DbState {
        let central_path = central_dir.join("central.db");
        let conn = Connection::open(&central_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                folder_path TEXT NOT NULL,
                last_access INTEGER,
                unavailable INTEGER NOT NULL DEFAULT 0
            );"
        ).unwrap();
        DbState {
            conn: Mutex::new(conn),
            profile_conns: Mutex::new(HashMap::new()),
        }
    }

    fn count_settings_rows(conn: &Connection, profile_id: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM settings WHERE profile_id = ?1",
            rusqlite::params![profile_id],
            |row| row.get(0),
        ).unwrap_or(0)
    }

    // ============================================================
    // Test 1: Auto-create .album/data.db when it doesn't exist
    // ============================================================

    #[test]
    fn test_get_profile_conn_creates_db_automatically() {
        let dir = temp_test_dir("auto_create");
        let state = setup_state(&dir);
        let profile_id = "test-profile-1";
        let folder_path = dir.join("photos");
        std::fs::create_dir_all(&folder_path).unwrap();

        // Initial state: .album doesn't exist
        let album_dir = folder_path.join(".album");
        assert!(!album_dir.exists(), ".album should not exist before call");

        let result = get_profile_conn(&state, profile_id, folder_path.to_str().unwrap());
        assert!(result.is_ok(), "get_profile_conn should succeed: {:?}", result.err());

        // Verify .album/data.db was created
        assert!(album_dir.exists(), ".album directory should exist");
        let data_db = album_dir.join("data.db");
        assert!(data_db.exists(), "data.db should exist");

        // Verify schema was initialized (settings table exists with correct schema)
        let conn = Connection::open(&data_db).unwrap();
        let version: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_version", [], |r| r.get(0)
        ).unwrap();
        assert!(version >= 5, "Schema version should be at least 5, got {}", version);

        // Verify settings row was created for the profile_id
        let count = count_settings_rows(&conn, profile_id);
        assert_eq!(count, 1, "Should have exactly 1 settings row for profile_id");

        // Cleanup
        close_profile_conn(&state, profile_id);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ============================================================
    // Test 2: Open existing DB with matching profile_id
    // ============================================================

    #[test]
    fn test_get_profile_conn_matching_profile_id() {
        let dir = temp_test_dir("matching_id");
        let state = setup_state(&dir);
        let profile_id = "matching-profile";
        let folder_path = dir.join("photos");
        std::fs::create_dir_all(&folder_path).unwrap();

        // First call creates the DB
        let r1 = get_profile_conn(&state, profile_id, folder_path.to_str().unwrap());
        assert!(r1.is_ok());

        // Second call should succeed with matching profile_id
        let r2 = get_profile_conn(&state, profile_id, folder_path.to_str().unwrap());
        assert!(r2.is_ok(), "Second call with same profile_id should succeed");

        // Close and reopen should also work
        close_profile_conn(&state, profile_id);
        let r3 = get_profile_conn(&state, profile_id, folder_path.to_str().unwrap());
        assert!(r3.is_ok(), "Reopen after close should succeed");

        // Verify settings are preserved
        let conn_arc = r3.unwrap();
        let conn = conn_arc.lock().unwrap();
        let view_mode: String = conn.query_row(
            "SELECT view_mode FROM settings WHERE profile_id = ?1",
            rusqlite::params![profile_id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(view_mode, "grid", "Default view_mode should be 'grid'");

        // Cleanup
        close_profile_conn(&state, profile_id);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ============================================================
    // Test 3: Profile ID mismatch → migration
    // ============================================================

    #[test]
    fn test_get_profile_conn_migrates_mismatched_id() {
        let dir = temp_test_dir("mismatch");
        let state = setup_state(&dir);
        let old_id = "old-profile-id";
        let new_id = "new-profile-id";
        let folder_path = dir.join("photos");
        std::fs::create_dir_all(&folder_path).unwrap();

        // Step 1: Create DB with old_id
        let r1 = get_profile_conn(&state, old_id, folder_path.to_str().unwrap());
        assert!(r1.is_ok());
        close_profile_conn(&state, old_id);

        // Modify settings to non-default values so we can verify migration
        let data_db_path = folder_path.join(".album").join("data.db");
        let conn = Connection::open(&data_db_path).unwrap();
        conn.execute(
            "UPDATE settings SET view_mode='list', theme_mode='light', accent_color='#FF0000' WHERE profile_id=?1",
            rusqlite::params![old_id],
        ).unwrap();
        drop(conn);

        // Step 2: Open with new_id — should trigger migration
        let r2 = get_profile_conn(&state, new_id, folder_path.to_str().unwrap());
        assert!(r2.is_ok(), "Migration should succeed: {:?}", r2.err());

        // Verify settings were migrated to new_id
        let conn_arc = r2.unwrap();
        let conn = conn_arc.lock().unwrap();
        let old_count = count_settings_rows(&conn, old_id);
        assert_eq!(old_count, 0, "Old profile_id should have 0 settings rows");

        let new_count = count_settings_rows(&conn, new_id);
        assert_eq!(new_count, 1, "New profile_id should have 1 settings row");

        // Verify custom settings were preserved
        let view_mode: String = conn.query_row(
            "SELECT view_mode FROM settings WHERE profile_id = ?1",
            rusqlite::params![new_id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(view_mode, "list", "view_mode should be migrated from old settings");
        let theme: String = conn.query_row(
            "SELECT theme_mode FROM settings WHERE profile_id = ?1",
            rusqlite::params![new_id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(theme, "light", "theme_mode should be migrated from old settings");

        // Cleanup
        close_profile_conn(&state, new_id);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ============================================================
    // Test 4: Error when folder doesn't exist
    // ============================================================

    #[test]
    fn test_get_profile_conn_folder_not_found() {
        let dir = temp_test_dir("not_found");
        let state = setup_state(&dir);
        let profile_id = "ghost-profile";

        // Non-existent folder
        let bogus_path = dir.join("nonexistent_folder");
        let result = get_profile_conn(&state, profile_id, bogus_path.to_str().unwrap());
        assert!(result.is_err(), "Should return error for non-existent folder");
        let err_msg = result.err().unwrap();
        assert!(err_msg.contains("Folder not found"), "Error should mention 'Folder not found', got: {}", err_msg);

        let _ = std::fs::remove_dir_all(&dir);
    }

    // ============================================================
    // Test 5: Cache returns same connection for same profile_id
    // ============================================================

    #[test]
    fn test_get_profile_conn_cache_hit() {
        let dir = temp_test_dir("cache");
        let state = setup_state(&dir);
        let profile_id = "cache-test-profile";
        let folder_path = dir.join("photos");
        std::fs::create_dir_all(&folder_path).unwrap();

        let r1 = get_profile_conn(&state, profile_id, folder_path.to_str().unwrap());
        assert!(r1.is_ok());
        let arc1 = r1.unwrap();

        let r2 = get_profile_conn(&state, profile_id, folder_path.to_str().unwrap());
        assert!(r2.is_ok());
        let arc2 = r2.unwrap();

        // Both should point to the same Arc (same connection)
        assert!(Arc::ptr_eq(&arc1, &arc2), "Cache should return same Arc for same profile_id");

        close_profile_conn(&state, profile_id);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ============================================================
    // Test 6: Empty DB fallback (create → no settings rows → fallback insert)
    // ============================================================

    #[test]
    fn test_get_profile_conn_empty_db_fallback() {
        let dir = temp_test_dir("empty_db");
        let state = setup_state(&dir);
        let profile_id = "empty-fallback";
        let folder_path = dir.join("photos");
        std::fs::create_dir_all(&folder_path).unwrap();

        // Create a blank data.db with no settings rows
        let album_dir = folder_path.join(".album");
        std::fs::create_dir_all(&album_dir).unwrap();
        let data_db = album_dir.join("data.db");
        {
            let conn = Connection::open(&data_db).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").unwrap();
            // Schema without settings table — init_profile_db_schema will create it
            init_profile_db_schema(&conn).unwrap();
            // Don't insert any settings rows — simulate empty state
        }

        // Now open with profile_id — should trigger mismatch path and INSERT OR IGNORE fallback
        let result = get_profile_conn(&state, profile_id, folder_path.to_str().unwrap());
        assert!(result.is_ok(), "Should handle empty DB gracefully: {:?}", result.err());

        let conn_arc = result.unwrap();
        let conn = conn_arc.lock().unwrap();
        let count = count_settings_rows(&conn, profile_id);
        assert_eq!(count, 1, "Should have exactly 1 settings row after fallback");

        close_profile_conn(&state, profile_id);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ============================================================
    // Test 7: Multiple profiles with different folder_paths
    // ============================================================

    #[test]
    fn test_get_profile_conn_multiple_profiles() {
        let dir = temp_test_dir("multi");
        let state = setup_state(&dir);

        let profile_a = "profile-a";
        let profile_b = "profile-b";
        let folder_a = dir.join("folder_a");
        let folder_b = dir.join("folder_b");
        std::fs::create_dir_all(&folder_a).unwrap();
        std::fs::create_dir_all(&folder_b).unwrap();

        let r_a = get_profile_conn(&state, profile_a, folder_a.to_str().unwrap());
        assert!(r_a.is_ok());
        let r_b = get_profile_conn(&state, profile_b, folder_b.to_str().unwrap());
        assert!(r_b.is_ok());

        let conn_a = r_a.unwrap();
        let conn_b = r_b.unwrap();

        // Different profiles should have different connections
        assert!(!Arc::ptr_eq(&conn_a, &conn_b), "Different profiles should have different connections");

        // Each should have its own settings row
        {
            let ca = conn_a.lock().unwrap();
            let count_a = count_settings_rows(&ca, profile_a);
            assert_eq!(count_a, 1, "Profile A should have 1 settings row");
        }
        {
            let cb = conn_b.lock().unwrap();
            let count_b = count_settings_rows(&cb, profile_b);
            assert_eq!(count_b, 1, "Profile B should have 1 settings row");
        }

        close_profile_conn(&state, profile_a);
        close_profile_conn(&state, profile_b);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ============================================================
    // Test 8: Migration preserves data across tables
    // ============================================================

    #[test]
    fn test_get_profile_conn_migration_preserves_all_data() {
        let dir = temp_test_dir("migration_data");
        let state = setup_state(&dir);
        let old_id = "old-data-profile";
        let new_id = "new-data-profile";
        let folder_path = dir.join("photos");
        std::fs::create_dir_all(&folder_path).unwrap();

        // Create DB with old_id and add data to multiple tables
        let r1 = get_profile_conn(&state, old_id, folder_path.to_str().unwrap());
        assert!(r1.is_ok());
        close_profile_conn(&state, old_id);

        let data_db_path = folder_path.join(".album").join("data.db");
        let conn = Connection::open(&data_db_path).unwrap();

        // Add test data
        conn.execute(
            "UPDATE settings SET view_mode='list', accent_color='#123456' WHERE profile_id=?1",
            rusqlite::params![old_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO albums (profile_id, folder_name) VALUES (?1, 'test-album')",
            rusqlite::params![old_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO images (profile_id, album_id, filename) VALUES (?1, 1, 'test.jpg')",
            rusqlite::params![old_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO favorites (profile_id, image_id, filename) VALUES (?1, 1, 'test.jpg')",
            rusqlite::params![old_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO trash (profile_id, original_name, trash_name) VALUES (?1, 'test.jpg', 'test_del.jpg')",
            rusqlite::params![old_id],
        ).unwrap();
        drop(conn);

        // Trigger migration by opening with new_id
        let r2 = get_profile_conn(&state, new_id, folder_path.to_str().unwrap());
        assert!(r2.is_ok());

        let conn_arc = r2.unwrap();
        let conn = conn_arc.lock().unwrap();

        // Verify old_id has no data
        let old_settings = count_settings_rows(&conn, old_id);
        assert_eq!(old_settings, 0, "Old profile_id should have no settings");

        // Verify new_id has the settings
        let new_settings = count_settings_rows(&conn, new_id);
        assert_eq!(new_settings, 1, "New profile_id should have migrated settings");

        let accent: String = conn.query_row(
            "SELECT accent_color FROM settings WHERE profile_id=?1",
            rusqlite::params![new_id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(accent, "#123456", "Custom accent_color should be preserved");

        // Verify albums, images, trash, favorites migrated
        let album_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM albums WHERE profile_id=?1",
            rusqlite::params![new_id], |r| r.get(0),
        ).unwrap();
        assert_eq!(album_count, 1, "Albums should be migrated");

        let image_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM images WHERE profile_id=?1",
            rusqlite::params![new_id], |r| r.get(0),
        ).unwrap();
        assert_eq!(image_count, 1, "Images should be migrated");

        let fav_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM favorites WHERE profile_id=?1",
            rusqlite::params![new_id], |r| r.get(0),
        ).unwrap();
        assert_eq!(fav_count, 1, "Favorites should be migrated");

        let trash_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM trash WHERE profile_id=?1",
            rusqlite::params![new_id], |r| r.get(0),
        ).unwrap();
        assert_eq!(trash_count, 1, "Trash entries should be migrated");

        close_profile_conn(&state, new_id);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
