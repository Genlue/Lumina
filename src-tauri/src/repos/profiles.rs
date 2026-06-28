use rusqlite::{Connection, params};
use crate::models::Profile;
use uuid::Uuid;

pub fn create_profile(conn: &Connection, folder_path: &str, name: Option<&str>) -> Profile {
    let id = Uuid::new_v4().to_string();
    let profile_name = name.unwrap_or(
        folder_path.split(&['/', '\\'][..]).last().unwrap_or("未命名")
    );

    conn.execute(
        "INSERT INTO profiles (id, name, folder_path, last_access) VALUES (?1, ?2, ?3, ?4)",
        params![id, profile_name, folder_path, chrono_now_ms()],
    ).unwrap();

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
    ).unwrap()
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
