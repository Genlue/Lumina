use rusqlite::{Connection, params};
use crate::models::FavoritesRecord;

pub fn toggle_favorite(conn: &Connection, profile_id: &str, image_id: i64, filename: &str, album_id: Option<i64>) -> bool {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM favorites WHERE profile_id = ?1 AND image_id = ?2",
            params![profile_id, image_id],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if exists {
        conn.execute(
            "DELETE FROM favorites WHERE profile_id = ?1 AND image_id = ?2",
            params![profile_id, image_id],
        ).unwrap();
        false
    } else {
        conn.execute(
            "INSERT INTO favorites (profile_id, image_id, added_at, filename, album_id) VALUES (?1, ?2, datetime('now'), ?3, ?4)",
            params![profile_id, image_id, filename, album_id],
        ).unwrap();
        true
    }
}

pub fn list_favorites(conn: &Connection, profile_id: &str) -> Vec<FavoritesRecord> {
    // ---------------------------------------------------------------
    // Step 1: Orphan reconciliation
    // Find favorites whose image_id no longer exists in the images
    // table. For each orphan, try to match by filename (and album_id if
    // available). If a match is found, UPDATE the image_id; otherwise
    // DELETE the orphan. This preserves favorites across file
    // reorganizations.
    // ---------------------------------------------------------------
    let mut orphan_stmt = conn.prepare(
        "SELECT f.profile_id, f.image_id, f.filename, f.album_id
         FROM favorites f
         WHERE f.profile_id = ?1
           AND NOT EXISTS (SELECT 1 FROM images WHERE id = f.image_id)"
    ).unwrap();

    let orphans: Vec<(String, i64, Option<String>, Option<i64>)> = orphan_stmt
        .query_map(params![profile_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    for (_, old_image_id, filename_opt, album_id_opt) in &orphans {
        if let Some(filename) = filename_opt {
            // Try to find a matching image — first by exact (filename, album_id),
            // then fall back to filename-only (the file may have moved albums).
            let match_result = match album_id_opt {
                Some(aid) => {
                    // Exact match: same filename and album
                    conn.query_row(
                        "SELECT id FROM images WHERE profile_id = ?1 AND filename = ?2 AND album_id = ?3",
                        params![profile_id, filename, aid],
                        |row| row.get::<_, i64>(0),
                    ).ok()
                    .or_else(|| {
                        // Fallback: image might have moved to a different album
                        conn.query_row(
                            "SELECT id FROM images WHERE profile_id = ?1 AND filename = ?2",
                            params![profile_id, filename],
                            |row| row.get::<_, i64>(0),
                        ).ok()
                    })
                }
                None => {
                    // Original had no album — first try album IS NULL
                    conn.query_row(
                        "SELECT id FROM images WHERE profile_id = ?1 AND filename = ?2 AND album_id IS NULL",
                        params![profile_id, filename],
                        |row| row.get::<_, i64>(0),
                    ).ok()
                    .or_else(|| {
                        // Fallback: the file may have been moved into an album
                        conn.query_row(
                            "SELECT id FROM images WHERE profile_id = ?1 AND filename = ?2",
                            params![profile_id, filename],
                            |row| row.get::<_, i64>(0),
                        ).ok()
                    })
                }
            };

            match match_result {
                Some(new_image_id) => {
                    // Re-point the favorite to the current image row
                    conn.execute(
                        "UPDATE favorites SET image_id = ?1 WHERE profile_id = ?2 AND image_id = ?3",
                        params![new_image_id, profile_id, old_image_id],
                    ).unwrap();
                }
                None => {
                    // No matching image exists — remove the stale favorite
                    conn.execute(
                        "DELETE FROM favorites WHERE profile_id = ?1 AND image_id = ?2",
                        params![profile_id, old_image_id],
                    ).unwrap();
                }
            }
        } else {
            // No filename stored (legacy row that predates the migration) —
            // cannot match, so delete the orphan.
            conn.execute(
                "DELETE FROM favorites WHERE profile_id = ?1 AND image_id = ?2",
                params![profile_id, old_image_id],
            ).unwrap();
        }
    }

    // ---------------------------------------------------------------
    // Step 2: Standard JOIN query (returns only non-orphaned favorites)
    // ---------------------------------------------------------------
    let mut stmt = conn.prepare(
        "SELECT f.profile_id, f.image_id, f.added_at, i.filename, i.file_size, i.file_date, i.width, i.height, i.album_id, a.folder_name
         FROM favorites f
         JOIN images i ON f.image_id = i.id
         LEFT JOIN albums a ON i.album_id = a.id
         WHERE f.profile_id = ?1
         ORDER BY f.added_at DESC"
    ).unwrap();
    let rows = stmt.query_map(params![profile_id], |row| {
        Ok(FavoritesRecord {
            profile_id: row.get(0)?,
            image_id: row.get(1)?,
            added_at: row.get(2)?,
            filename: row.get(3)?,
            file_size: row.get(4)?,
            file_date: row.get(5)?,
            width: row.get(6)?,
            height: row.get(7)?,
            album_id: row.get(8)?,
            folder_name: row.get(9)?,
        })
    }).unwrap();
    rows.filter_map(|r| r.ok()).collect()
}

pub fn is_favorite(conn: &Connection, profile_id: &str, image_id: i64) -> bool {
    conn.query_row(
        "SELECT 1 FROM favorites WHERE profile_id = ?1 AND image_id = ?2",
        params![profile_id, image_id],
        |_| Ok(true),
    ).unwrap_or(false)
}

pub fn count_favorites(conn: &Connection, profile_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM favorites WHERE profile_id = ?1",
        params![profile_id],
        |row| row.get(0),
    ).unwrap_or(0)
}

/// 通过 filename 和 profile_id 删除收藏（用于图片损坏/丢失时强制取消收藏）
pub fn remove_by_filename(conn: &Connection, profile_id: &str, filename: &str, album_id: Option<i64>) {
    conn.execute(
        "DELETE FROM favorites WHERE profile_id=?1 AND image_id IN (SELECT id FROM images WHERE profile_id=?1 AND filename=?2 AND album_id IS ?3)",
        params![profile_id, filename, album_id],
    ).ok();
}

/// 通过 image_id 删除收藏（用于删除文件时同步取消收藏）
pub fn remove_by_image_id(conn: &Connection, profile_id: &str, image_id: i64) {
    conn.execute(
        "DELETE FROM favorites WHERE profile_id=?1 AND image_id=?2",
        params![profile_id, image_id],
    ).ok();
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE images (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id TEXT NOT NULL,
                album_id   INTEGER,
                filename   TEXT NOT NULL,
                file_size  INTEGER,
                file_date  INTEGER,
                width      INTEGER,
                height     INTEGER
            );
            CREATE TABLE albums (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id  TEXT NOT NULL,
                folder_name TEXT NOT NULL
            );
            CREATE TABLE favorites (
                profile_id TEXT NOT NULL,
                image_id   INTEGER NOT NULL,
                added_at   TEXT NOT NULL DEFAULT (datetime('now')),
                filename   TEXT,
                album_id   INTEGER,
                PRIMARY KEY(profile_id, image_id)
            );"
        ).unwrap();
        conn
    }

    fn add_image(conn: &Connection, profile_id: &str, id: i64, filename: &str, album_id: Option<i64>) {
        conn.execute(
            "INSERT OR IGNORE INTO images (id, profile_id, album_id, filename) VALUES (?1, ?2, ?3, ?4)",
            params![id, profile_id, album_id, filename],
        ).ok();
    }

    #[test]
    fn test_toggle_favorite_add() {
        let conn = setup();
        add_image(&conn, "p1", 1, "test.jpg", None);
        let result = toggle_favorite(&conn, "p1", 1, "test.jpg", None);
        assert!(result, "toggle should add favorite, returning true");
        assert!(is_favorite(&conn, "p1", 1));
    }

    #[test]
    fn test_toggle_favorite_remove() {
        let conn = setup();
        add_image(&conn, "p1", 1, "test.jpg", None);
        toggle_favorite(&conn, "p1", 1, "test.jpg", None);
        let result = toggle_favorite(&conn, "p1", 1, "test.jpg", None);
        assert!(!result, "toggle should remove favorite, returning false");
        assert!(!is_favorite(&conn, "p1", 1));
    }

    #[test]
    fn test_count_favorites() {
        let conn = setup();
        add_image(&conn, "p1", 1, "a.jpg", None);
        add_image(&conn, "p1", 2, "b.jpg", None);
        add_image(&conn, "p2", 3, "c.jpg", None);
        assert_eq!(count_favorites(&conn, "p1"), 0);
        toggle_favorite(&conn, "p1", 1, "a.jpg", None);
        assert_eq!(count_favorites(&conn, "p1"), 1);
        toggle_favorite(&conn, "p1", 2, "b.jpg", None);
        assert_eq!(count_favorites(&conn, "p1"), 2);
        assert_eq!(count_favorites(&conn, "p2"), 0);
    }

    #[test]
    fn test_list_favorites_joins_with_images_and_albums() {
        let conn = setup();
        add_image(&conn, "p1", 1, "photo.jpg", Some(1));
        conn.execute("INSERT INTO albums (id, profile_id, folder_name) VALUES (1, 'p1', 'album1')", []).ok();
        toggle_favorite(&conn, "p1", 1, "photo.jpg", Some(1));
        let list = list_favorites(&conn, "p1");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].filename, Some("photo.jpg".to_string()));
        assert_eq!(list[0].folder_name, Some("album1".to_string()));
    }

    #[test]
    fn test_remove_by_filename() {
        let conn = setup();
        add_image(&conn, "p1", 1, "gone.jpg", None);
        toggle_favorite(&conn, "p1", 1, "gone.jpg", None);
        assert!(is_favorite(&conn, "p1", 1));
        remove_by_filename(&conn, "p1", "gone.jpg", None);
        assert!(!is_favorite(&conn, "p1", 1));
    }

    #[test]
    fn test_remove_by_image_id() {
        let conn = setup();
        add_image(&conn, "p1", 1, "del.jpg", None);
        toggle_favorite(&conn, "p1", 1, "del.jpg", None);
        assert!(is_favorite(&conn, "p1", 1));
        remove_by_image_id(&conn, "p1", 1);
        assert!(!is_favorite(&conn, "p1", 1));
    }

    #[test]
    fn test_list_favorites_handles_orphan_reconciliation() {
        let conn = setup();
        // Create image, favorite it, then delete the image record
        add_image(&conn, "p1", 10, "orphan.jpg", None);
        toggle_favorite(&conn, "p1", 10, "orphan.jpg", None);
        conn.execute("DELETE FROM images WHERE id=10", []).ok();
        // Create a new image with the same filename — orphan should reconcile
        add_image(&conn, "p1", 20, "orphan.jpg", None);
        let list = list_favorites(&conn, "p1");
        assert_eq!(list.len(), 1, "Orphan should reconcile to new image_id 20");
        assert_eq!(list[0].image_id, 20, "Should point to new image record");
    }

    #[test]
    fn test_list_favorites_removes_unresolvable_orphans() {
        let conn = setup();
        add_image(&conn, "p1", 1, "ghost.jpg", None);
        toggle_favorite(&conn, "p1", 1, "ghost.jpg", None);
        // Delete image without re-creating
        conn.execute("DELETE FROM images WHERE id=1", []).ok();
        let list = list_favorites(&conn, "p1");
        assert_eq!(list.len(), 0, "Unresolvable orphan should be removed");
    }

    #[test]
    fn test_favorites_scoped_by_profile() {
        let conn = setup();
        add_image(&conn, "p1", 1, "shared.jpg", None);
        add_image(&conn, "p2", 2, "shared.jpg", None);
        toggle_favorite(&conn, "p1", 1, "shared.jpg", None);
        toggle_favorite(&conn, "p2", 2, "shared.jpg", None);
        assert_eq!(list_favorites(&conn, "p1").len(), 1);
        assert_eq!(list_favorites(&conn, "p2").len(), 1);
        remove_by_image_id(&conn, "p1", 1);
        assert_eq!(list_favorites(&conn, "p1").len(), 0);
        assert_eq!(list_favorites(&conn, "p2").len(), 1, "p2 should be unaffected");
    }
}
