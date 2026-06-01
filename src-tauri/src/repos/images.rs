use rusqlite::{Connection, params};
use crate::models::{ImageRecord, FileInfo};

pub fn sync_images(conn: &Connection, profile_id: &str, album_id: Option<i64>, files: &[FileInfo]) {
    for f in files {
        conn.execute(
            "INSERT OR REPLACE INTO images (profile_id, album_id, filename, file_size, file_date)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![profile_id, album_id, f.name, f.size as i64, f.last_modified as i64],
        ).ok();
    }

    if !files.is_empty() {
        let placeholders: Vec<String> = files.iter().map(|_| "?".to_string()).collect();
        let pl = placeholders.join(",");
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
            Box::new(profile_id.to_string()),
            Box::new(album_id),
            Box::new(album_id),
        ];
        for f in files {
            params_vec.push(Box::new(f.name.clone()));
        }

        let sql = format!(
            "DELETE FROM images WHERE profile_id = ?1 AND (album_id IS ?2 OR album_id = ?3) AND filename NOT IN ({})",
            pl
        );
        conn.execute(&sql, rusqlite::params_from_iter(params_vec.iter().map(|p| p.as_ref()))).ok();
    }
}

pub fn list_images(conn: &Connection, profile_id: &str, album_id: Option<Option<i64>>) -> Vec<ImageRecord> {
    let sql;
    let params_vec: Vec<Box<dyn rusqlite::types::ToSql>>;
    match album_id {
        None => {
            sql = "SELECT id, profile_id, album_id, filename, file_size, file_date, width, height FROM images WHERE profile_id = ?1 ORDER BY filename";
            params_vec = vec![Box::new(profile_id.to_string()) as Box<dyn rusqlite::types::ToSql>];
        }
        Some(None) => {
            sql = "SELECT id, profile_id, album_id, filename, file_size, file_date, width, height FROM images WHERE profile_id = ?1 AND album_id IS NULL ORDER BY filename";
            params_vec = vec![Box::new(profile_id.to_string())];
        }
        Some(Some(aid)) => {
            sql = "SELECT id, profile_id, album_id, filename, file_size, file_date, width, height FROM images WHERE profile_id = ?1 AND album_id = ?2 ORDER BY filename";
            params_vec = vec![Box::new(profile_id.to_string()), Box::new(aid)];
        }
    };

    let mut stmt = conn.prepare(sql).unwrap();
    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec.iter().map(|p| p.as_ref())), |row| {
        Ok(ImageRecord {
            id: row.get(0)?,
            profile_id: row.get(1)?,
            album_id: row.get(2)?,
            filename: row.get(3)?,
            file_size: row.get(4)?,
            file_date: row.get(5)?,
            width: row.get(6)?,
            height: row.get(7)?,
        })
    }).unwrap();
    rows.filter_map(|r| r.ok()).collect()
}

pub fn get_image_by_id(conn: &Connection, id: i64) -> Option<ImageRecord> {
    conn.query_row(
        "SELECT id, profile_id, album_id, filename, file_size, file_date, width, height FROM images WHERE id = ?1",
        params![id],
        |row| Ok(ImageRecord {
            id: row.get(0)?, profile_id: row.get(1)?, album_id: row.get(2)?,
            filename: row.get(3)?, file_size: row.get(4)?, file_date: row.get(5)?,
            width: row.get(6)?, height: row.get(7)?,
        }),
    ).ok()
}

pub fn get_image_by_name(conn: &Connection, profile_id: &str, filename: &str, album_id: Option<i64>) -> Option<ImageRecord> {
    match album_id {
        None | Some(0) => {
            // album_id IS NULL
            conn.query_row(
                "SELECT id, profile_id, album_id, filename, file_size, file_date, width, height FROM images WHERE profile_id = ?1 AND filename = ?2 AND album_id IS NULL",
                params![profile_id, filename],
                |row| Ok(ImageRecord {
                    id: row.get(0)?, profile_id: row.get(1)?, album_id: row.get(2)?,
                    filename: row.get(3)?, file_size: row.get(4)?, file_date: row.get(5)?,
                    width: row.get(6)?, height: row.get(7)?,
                }),
            ).ok()
        }
        Some(aid) => {
            conn.query_row(
                "SELECT id, profile_id, album_id, filename, file_size, file_date, width, height FROM images WHERE profile_id = ?1 AND filename = ?2 AND album_id = ?3",
                params![profile_id, filename, aid],
                |row| Ok(ImageRecord {
                    id: row.get(0)?, profile_id: row.get(1)?, album_id: row.get(2)?,
                    filename: row.get(3)?, file_size: row.get(4)?, file_date: row.get(5)?,
                    width: row.get(6)?, height: row.get(7)?,
                }),
            ).ok()
        }
    }
}

pub fn update_image_meta(conn: &Connection, id: i64, width: Option<i64>, height: Option<i64>) {
    if let (Some(w), Some(h)) = (width, height) {
        conn.execute(
            "UPDATE images SET width = ?1, height = ?2 WHERE id = ?3",
            params![w, h, id],
        ).ok();
    }
}
