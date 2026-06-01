use rusqlite::{Connection, params};
use crate::models::FavoritesRecord;

pub fn toggle_favorite(conn: &Connection, profile_id: &str, image_id: i64) -> bool {
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
            "INSERT INTO favorites (profile_id, image_id, added_at) VALUES (?1, ?2, datetime('now'))",
            params![profile_id, image_id],
        ).unwrap();
        true
    }
}

pub fn list_favorites(conn: &Connection, profile_id: &str) -> Vec<FavoritesRecord> {
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
