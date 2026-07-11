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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE trash (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id      TEXT NOT NULL,
                original_name   TEXT NOT NULL,
                trash_name      TEXT NOT NULL,
                original_folder TEXT,
                deleted_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );"
        ).unwrap();
        conn
    }

    #[test]
    fn test_add_and_list_trash() {
        let conn = setup();
        add_trash_entry(&conn, "p1", "photo.jpg", "photo_12345.jpg", None);
        let list = list_trash(&conn, "p1");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].original_name, "photo.jpg");
        assert_eq!(list[0].trash_name, "photo_12345.jpg");
    }

    #[test]
    fn test_add_trash_with_folder() {
        let conn = setup();
        add_trash_entry(&conn, "p1", "nested.jpg", "nested_999.jpg", Some("album/sub"));
        let entry = get_trash_entry(&conn, "p1", "nested_999.jpg").unwrap();
        assert_eq!(entry.original_folder, Some("album/sub".to_string()));
    }

    #[test]
    fn test_list_trash_ordered_by_deleted_at() {
        let conn = setup();
        // Insert entries with explicit timestamps to ensure ordering
        conn.execute(
            "INSERT INTO trash (profile_id, original_name, trash_name, deleted_at) VALUES (?1, ?2, ?3, ?4)",
            params!["p1", "old.jpg", "old_1.jpg", "2024-01-01 00:00:00"],
        ).unwrap();
        conn.execute(
            "INSERT INTO trash (profile_id, original_name, trash_name, deleted_at) VALUES (?1, ?2, ?3, ?4)",
            params!["p1", "new.jpg", "new_2.jpg", "2024-06-01 00:00:00"],
        ).unwrap();
        let list = list_trash(&conn, "p1");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].original_name, "new.jpg", "Newest should be first (DESC)");
        assert_eq!(list[1].original_name, "old.jpg");
    }

    #[test]
    fn test_remove_trash_entry() {
        let conn = setup();
        add_trash_entry(&conn, "p1", "remove.jpg", "remove_1.jpg", None);
        assert_eq!(list_trash(&conn, "p1").len(), 1);
        remove_trash_entry(&conn, "p1", "remove_1.jpg");
        assert_eq!(list_trash(&conn, "p1").len(), 0);
    }

    #[test]
    fn test_count_trash() {
        let conn = setup();
        assert_eq!(count_trash(&conn, "p1"), 0);
        add_trash_entry(&conn, "p1", "a.jpg", "a_1.jpg", None);
        add_trash_entry(&conn, "p1", "b.jpg", "b_2.jpg", None);
        assert_eq!(count_trash(&conn, "p1"), 2);
        assert_eq!(count_trash(&conn, "p2"), 0);
    }

    #[test]
    fn test_empty_trash() {
        let conn = setup();
        add_trash_entry(&conn, "p1", "x.jpg", "x_1.jpg", None);
        add_trash_entry(&conn, "p1", "y.jpg", "y_2.jpg", None);
        add_trash_entry(&conn, "p2", "z.jpg", "z_3.jpg", None);
        let removed = empty_trash(&conn, "p1");
        assert_eq!(removed, 2, "Should return count of removed entries");
        assert_eq!(list_trash(&conn, "p1").len(), 0);
        assert_eq!(list_trash(&conn, "p2").len(), 1, "p2 trash should survive");
    }

    #[test]
    fn test_get_trash_entry_not_found() {
        let conn = setup();
        assert!(get_trash_entry(&conn, "p1", "nonexistent").is_none());
    }

    #[test]
    fn test_trash_scoped_by_profile() {
        let conn = setup();
        add_trash_entry(&conn, "p1", "only_p1.jpg", "p1_1.jpg", None);
        add_trash_entry(&conn, "p2", "only_p2.jpg", "p2_1.jpg", None);
        assert_eq!(list_trash(&conn, "p1").len(), 1);
        assert_eq!(list_trash(&conn, "p2").len(), 1);
        remove_trash_entry(&conn, "p1", "p1_1.jpg");
        assert_eq!(list_trash(&conn, "p1").len(), 0);
        assert_eq!(list_trash(&conn, "p2").len(), 1);
    }
}
