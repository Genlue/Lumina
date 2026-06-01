use rusqlite::{Connection, params};
use crate::models::Album;

pub fn ensure_albums_for_profile(conn: &Connection, profile_id: &str, folder_names: &[String]) {
    for name in folder_names {
        conn.execute(
            "INSERT OR IGNORE INTO albums (profile_id, folder_name, updated_at) VALUES (?1, ?2, datetime('now'))",
            params![profile_id, name],
        ).ok();
    }
}

pub fn list_albums(conn: &Connection, profile_id: &str) -> Vec<Album> {
    let mut stmt = conn.prepare(
        "SELECT id, profile_id, folder_name, cover_image, sort_order, created_at, updated_at FROM albums WHERE profile_id = ?1 ORDER BY folder_name"
    ).unwrap();
    let rows = stmt.query_map(params![profile_id], |row| {
        Ok(Album {
            id: row.get(0)?,
            profile_id: row.get(1)?,
            folder_name: row.get(2)?,
            cover_image: row.get(3)?,
            sort_order: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    }).unwrap();
    rows.filter_map(|r| r.ok()).collect()
}

pub fn get_album_by_folder(conn: &Connection, profile_id: &str, folder_name: &str) -> Option<Album> {
    conn.query_row(
        "SELECT id, profile_id, folder_name, cover_image, sort_order, created_at, updated_at FROM albums WHERE profile_id = ?1 AND folder_name = ?2",
        params![profile_id, folder_name],
        |row| Ok(Album {
            id: row.get(0)?, profile_id: row.get(1)?, folder_name: row.get(2)?,
            cover_image: row.get(3)?, sort_order: row.get(4)?,
            created_at: row.get(5)?, updated_at: row.get(6)?,
        }),
    ).ok()
}

pub fn set_album_cover(conn: &Connection, profile_id: &str, folder_name: &str, image_name: &str) {
    conn.execute(
        "UPDATE albums SET cover_image = ?1, updated_at = datetime('now') WHERE profile_id = ?2 AND folder_name = ?3",
        params![image_name, profile_id, folder_name],
    ).ok();
}

pub fn set_album_order(conn: &Connection, profile_id: &str, folder_name: &str, order_json: &str) {
    conn.execute(
        "UPDATE albums SET sort_order = ?1, updated_at = datetime('now') WHERE profile_id = ?2 AND folder_name = ?3",
        params![order_json, profile_id, folder_name],
    ).ok();
}

pub fn rename_album(conn: &Connection, profile_id: &str, old_name: &str, new_name: &str) {
    conn.execute(
        "UPDATE albums SET folder_name = ?1, updated_at = datetime('now') WHERE profile_id = ?2 AND folder_name = ?3",
        params![new_name, profile_id, old_name],
    ).ok();
}

pub fn delete_album(conn: &Connection, profile_id: &str, folder_name: &str) {
    conn.execute(
        "DELETE FROM albums WHERE profile_id = ?1 AND folder_name = ?2",
        params![profile_id, folder_name],
    ).ok();
}
