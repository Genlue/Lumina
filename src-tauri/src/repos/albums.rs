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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
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
            );"
        ).unwrap();
        conn
    }

    #[test]
    fn test_ensure_albums_creates_new() {
        let conn = setup();
        let folders = vec!["vacation".to_string(), "work".to_string()];
        ensure_albums_for_profile(&conn, "p1", &folders);
        let albums = list_albums(&conn, "p1");
        assert_eq!(albums.len(), 2);
        assert_eq!(albums[0].folder_name, "vacation"); // sorted by name ASC
        assert_eq!(albums[1].folder_name, "work");
    }

    #[test]
    fn test_ensure_albums_ignores_existing() {
        let conn = setup();
        ensure_albums_for_profile(&conn, "p1", &["existing".to_string()]);
        ensure_albums_for_profile(&conn, "p1", &["existing".to_string(), "new".to_string()]);
        let albums = list_albums(&conn, "p1");
        assert_eq!(albums.len(), 2);
    }

    #[test]
    fn test_ensure_albums_scoped_by_profile() {
        let conn = setup();
        ensure_albums_for_profile(&conn, "p1", &["a".to_string()]);
        ensure_albums_for_profile(&conn, "p2", &["a".to_string()]);
        assert_eq!(list_albums(&conn, "p1").len(), 1);
        assert_eq!(list_albums(&conn, "p2").len(), 1);
    }

    #[test]
    fn test_get_album_by_folder() {
        let conn = setup();
        ensure_albums_for_profile(&conn, "p1", &["target".to_string()]);
        let found = get_album_by_folder(&conn, "p1", "target");
        assert!(found.is_some());
        assert_eq!(found.unwrap().folder_name, "target");
        let not_found = get_album_by_folder(&conn, "p1", "nonexistent");
        assert!(not_found.is_none());
        // Wrong profile
        let wrong = get_album_by_folder(&conn, "p2", "target");
        assert!(wrong.is_none());
    }

    #[test]
    fn test_set_album_cover() {
        let conn = setup();
        ensure_albums_for_profile(&conn, "p1", &["album1".to_string()]);
        set_album_cover(&conn, "p1", "album1", "cover.jpg");
        let album = get_album_by_folder(&conn, "p1", "album1").unwrap();
        assert_eq!(album.cover_image, Some("cover.jpg".to_string()));
    }

    #[test]
    fn test_set_album_order() {
        let conn = setup();
        ensure_albums_for_profile(&conn, "p1", &["ordered".to_string()]);
        let order = r#"["a.jpg","b.jpg"]"#;
        set_album_order(&conn, "p1", "ordered", order);
        let album = get_album_by_folder(&conn, "p1", "ordered").unwrap();
        assert_eq!(album.sort_order, Some(order.to_string()));
    }

    #[test]
    fn test_rename_album() {
        let conn = setup();
        ensure_albums_for_profile(&conn, "p1", &["old_name".to_string()]);
        assert!(get_album_by_folder(&conn, "p1", "old_name").is_some());
        rename_album(&conn, "p1", "old_name", "new_name");
        assert!(get_album_by_folder(&conn, "p1", "old_name").is_none());
        assert!(get_album_by_folder(&conn, "p1", "new_name").is_some());
    }

    #[test]
    fn test_delete_album() {
        let conn = setup();
        ensure_albums_for_profile(&conn, "p1", &["delete_me".to_string()]);
        assert_eq!(list_albums(&conn, "p1").len(), 1);
        delete_album(&conn, "p1", "delete_me");
        assert_eq!(list_albums(&conn, "p1").len(), 0);
    }

    #[test]
    fn test_delete_album_scoped() {
        let conn = setup();
        ensure_albums_for_profile(&conn, "p1", &["shared".to_string()]);
        ensure_albums_for_profile(&conn, "p2", &["shared".to_string()]);
        delete_album(&conn, "p1", "shared");
        assert_eq!(list_albums(&conn, "p1").len(), 0);
        assert_eq!(list_albums(&conn, "p2").len(), 1, "p2 album should survive");
    }
}
