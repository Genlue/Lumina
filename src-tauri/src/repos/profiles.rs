use rusqlite::{Connection, params};
use crate::models::Profile;
use uuid::Uuid;

pub fn create_profile(conn: &Connection, folder_path: &str, name: Option<&str>) -> (Profile, bool) {
    // If a profile for this folder already exists and is not marked unavailable, return it.
    if let Some(existing) = conn.query_row(
        "SELECT id, name, folder_path, last_access, unavailable FROM profiles WHERE folder_path = ?1 AND unavailable = 0",
        params![folder_path],
        |row| Ok(Profile {
            id: row.get(0)?,
            name: row.get(1)?,
            folder_path: row.get(2)?,
            last_access: row.get(3)?,
            unavailable: row.get(4)?,
        }),
    ).ok() {
        return (existing, true);
    }

    let id = Uuid::new_v4().to_string();
    let profile_name = name.unwrap_or(
        folder_path.split(&['/', '\\'][..]).last().unwrap_or("未命名")
    );

    conn.execute(
        "INSERT INTO profiles (id, name, folder_path, last_access) VALUES (?1, ?2, ?3, ?4)",
        params![id, profile_name, folder_path, chrono_now_ms()],
    ).unwrap();

    let profile = conn.query_row(
        "SELECT id, name, folder_path, last_access, unavailable FROM profiles WHERE id = ?1",
        params![id],
        |row| Ok(Profile {
            id: row.get(0)?,
            name: row.get(1)?,
            folder_path: row.get(2)?,
            last_access: row.get(3)?,
            unavailable: row.get(4)?,
        }),
    ).unwrap();

    (profile, false)
}

pub fn list_profiles(conn: &Connection) -> Vec<Profile> {
    let mut stmt = conn.prepare(
        "SELECT id, name, folder_path, last_access, unavailable FROM profiles ORDER BY last_access DESC"
    ).unwrap();
    let rows = stmt.query_map([], |row| {
        Ok(Profile {
            id: row.get(0)?,
            name: row.get(1)?,
            folder_path: row.get(2)?,
            last_access: row.get(3)?,
            unavailable: row.get(4)?,
        })
    }).unwrap();
    rows.filter_map(|r| r.ok()).collect()
}

pub fn get_profile_by_id(conn: &Connection, id: &str) -> Option<Profile> {
    conn.query_row(
        "SELECT id, name, folder_path, last_access, unavailable FROM profiles WHERE id = ?1",
        params![id],
        |row| Ok(Profile {
            id: row.get(0)?,
            name: row.get(1)?,
            folder_path: row.get(2)?,
            last_access: row.get(3)?,
            unavailable: row.get(4)?,
        }),
    ).ok()
}

pub fn touch_profile(conn: &Connection, id: &str) {
    conn.execute(
        "UPDATE profiles SET last_access = ?1, unavailable = 0 WHERE id = ?2",
        params![chrono_now_ms(), id],
    ).ok();
}

pub fn mark_profile_gone(conn: &Connection, id: &str) {
    conn.execute(
        "UPDATE profiles SET unavailable = 1 WHERE id = ?1",
        params![id],
    ).ok();
}

pub fn remove_profile(conn: &Connection, id: &str) {
    conn.execute("DELETE FROM profiles WHERE id = ?1", params![id]).ok();
}

pub fn update_folder_path(conn: &Connection, id: &str, new_path: &str) {
    let folder_name = new_path.split(&['/', '\\'][..]).last().unwrap_or("未命名");
    conn.execute(
        "UPDATE profiles SET folder_path = ?1, name = ?2, unavailable = 0 WHERE id = ?3",
        params![new_path, folder_name, id],
    ).ok();
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE profiles (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                folder_path TEXT NOT NULL,
                last_access INTEGER,
                unavailable INTEGER NOT NULL DEFAULT 0
            );"
        ).unwrap();
        conn
    }

    #[test]
    fn test_create_profile() {
        let conn = setup();
        let (profile, existing) = create_profile(&conn, "/tmp/test_folder", Some("Test Profile"));
        assert!(!existing, "New profile should not be marked as existing");
        assert_eq!(profile.name, "Test Profile");
        assert_eq!(profile.folder_path, "/tmp/test_folder");
        assert_eq!(profile.unavailable, 0);
        assert!(profile.last_access.is_some());
    }

    #[test]
    fn test_create_profile_derives_name_from_path() {
        let conn = setup();
        let (profile, _) = create_profile(&conn, "/some/path/MyPictures", None);
        assert_eq!(profile.name, "MyPictures");
    }

    #[test]
    fn test_create_duplicate_profile_returns_existing() {
        let conn = setup();
        let (first, first_existing) = create_profile(&conn, "/tmp/dup", Some("First"));
        assert!(!first_existing);

        let (second, second_existing) = create_profile(&conn, "/tmp/dup", Some("Second"));
        assert!(second_existing, "Duplicate folder_path should return existing=true");
        assert_eq!(second.id, first.id, "Should return same profile id");
        assert_eq!(second.name, first.name, "Should preserve original name");
    }

    #[test]
    fn test_create_unavailable_profile_allows_duplicate() {
        let conn = setup();
        let (first, _) = create_profile(&conn, "/tmp/gone", Some("Gone"));
        mark_profile_gone(&conn, &first.id);
        // Now creating with same path should create a new one
        let (second, existing) = create_profile(&conn, "/tmp/gone", Some("New"));
        assert!(!existing, "Should create new profile when old is marked unavailable");
        assert_ne!(second.id, first.id);
    }

    #[test]
    fn test_list_profiles_ordered_by_access() {
        let conn = setup();
        let (p1, _) = create_profile(&conn, "/tmp/a", Some("A"));
        std::thread::sleep(std::time::Duration::from_millis(10));
        let (_p2, _) = create_profile(&conn, "/tmp/b", Some("B"));
        std::thread::sleep(std::time::Duration::from_millis(10));
        touch_profile(&conn, &p1.id); // bump p1 to top
        let profiles = list_profiles(&conn);
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0].id, p1.id, "Most recently touched should be first");
    }

    #[test]
    fn test_get_profile_by_id() {
        let conn = setup();
        let (profile, _) = create_profile(&conn, "/tmp/gettest", Some("GetTest"));
        let found = get_profile_by_id(&conn, &profile.id);
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "GetTest");
        let not_found = get_profile_by_id(&conn, "nonexistent-id");
        assert!(not_found.is_none());
    }

    #[test]
    fn test_touch_profile_updates_access_and_unavailable() {
        let conn = setup();
        let (profile, _) = create_profile(&conn, "/tmp/touchtest", Some("Touch"));
        mark_profile_gone(&conn, &profile.id);
        let after_gone = get_profile_by_id(&conn, &profile.id).unwrap();
        assert_eq!(after_gone.unavailable, 1);
        touch_profile(&conn, &profile.id);
        let after_touch = get_profile_by_id(&conn, &profile.id).unwrap();
        assert_eq!(after_touch.unavailable, 0, "Touch should set unavailable=0");
        assert!(
            after_touch.last_access.unwrap() >= profile.last_access.unwrap(),
            "last_access should be updated"
        );
    }

    #[test]
    fn test_remove_profile_deletes() {
        let conn = setup();
        let (profile, _) = create_profile(&conn, "/tmp/removetest", Some("RemoveMe"));
        remove_profile(&conn, &profile.id);
        let found = get_profile_by_id(&conn, &profile.id);
        assert!(found.is_none());
        assert_eq!(list_profiles(&conn).len(), 0);
    }

    #[test]
    fn test_update_folder_path() {
        let conn = setup();
        let (profile, _) = create_profile(&conn, "/tmp/old_path", Some("OldName"));
        update_folder_path(&conn, &profile.id, "/tmp/new_path/subdir");
        let updated = get_profile_by_id(&conn, &profile.id).unwrap();
        assert_eq!(updated.folder_path, "/tmp/new_path/subdir");
        assert_eq!(updated.name, "subdir");
        assert_eq!(updated.unavailable, 0);
    }
}
