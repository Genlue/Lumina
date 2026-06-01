use rusqlite::{Connection, params};
use crate::models::TrashRecord;

pub fn add_trash_entry(conn: &Connection, profile_id: &str, original_name: &str, trash_name: &str, original_folder: Option<&str>) {
    conn.execute(
        "INSERT INTO trash (profile_id, original_name, trash_name, original_folder, deleted_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))",
        params![profile_id, original_name, trash_name, original_folder],
    ).ok();
}

pub fn remove_trash_entry(conn: &Connection, profile_id: &str, trash_name: &str) {
    conn.execute(
        "DELETE FROM trash WHERE profile_id = ?1 AND trash_name = ?2",
        params![profile_id, trash_name],
    ).ok();
}

pub fn list_trash(conn: &Connection, profile_id: &str) -> Vec<TrashRecord> {
    let mut stmt = conn.prepare(
        "SELECT id, profile_id, original_name, trash_name, original_folder, deleted_at FROM trash WHERE profile_id = ?1 ORDER BY deleted_at DESC"
    ).unwrap();
    let rows = stmt.query_map(params![profile_id], |row| {
        Ok(TrashRecord {
            id: row.get(0)?,
            profile_id: row.get(1)?,
            original_name: row.get(2)?,
            trash_name: row.get(3)?,
            original_folder: row.get(4)?,
            deleted_at: row.get(5)?,
        })
    }).unwrap();
    rows.filter_map(|r| r.ok()).collect()
}

pub fn count_trash(conn: &Connection, profile_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM trash WHERE profile_id = ?1",
        params![profile_id],
        |row| row.get(0),
    ).unwrap_or(0)
}

pub fn empty_trash(conn: &Connection, profile_id: &str) -> i64 {
    let count = count_trash(conn, profile_id);
    conn.execute("DELETE FROM trash WHERE profile_id = ?1", params![profile_id]).ok();
    count
}

pub fn get_trash_entry(conn: &Connection, profile_id: &str, trash_name: &str) -> Option<TrashRecord> {
    conn.query_row(
        "SELECT id, profile_id, original_name, trash_name, original_folder, deleted_at FROM trash WHERE profile_id = ?1 AND trash_name = ?2",
        params![profile_id, trash_name],
        |row| Ok(TrashRecord {
            id: row.get(0)?, profile_id: row.get(1)?, original_name: row.get(2)?,
            trash_name: row.get(3)?, original_folder: row.get(4)?, deleted_at: row.get(5)?,
        }),
    ).ok()
}
