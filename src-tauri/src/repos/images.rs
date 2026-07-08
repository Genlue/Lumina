use std::fs;
use std::path::Path;
use rusqlite::{Connection, params};
use crate::models::{ImageRecord, FileInfo};

pub fn sync_images(conn: &Connection, profile_id: &str, album_id: Option<i64>, files: &[FileInfo]) {
    for f in files {
        // Try UPDATE first — preserves image id so favorites FK (ON DELETE CASCADE) is not triggered
        let updated = conn.execute(
            "UPDATE images SET file_size = ?1, file_date = ?2, width = ?3, height = ?4
             WHERE profile_id = ?5 AND (album_id IS ?6 OR album_id = ?7) AND filename = ?8",
            params![
                f.size as i64,
                f.last_modified as i64,
                f.width.map(|w| w as i64),
                f.height.map(|h| h as i64),
                profile_id,
                album_id,
                album_id,
                f.name,
            ],
        ).unwrap_or(0);

        if updated == 0 {
            // No existing row — insert new one (new image or new profile)
            conn.execute(
                "INSERT INTO images (profile_id, album_id, filename, file_size, file_date, width, height)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![profile_id, album_id, f.name, f.size as i64, f.last_modified as i64, f.width.map(|w| w as i64), f.height.map(|h| h as i64)],
            ).ok();
        }
    }

    if files.is_empty() {
        // 空文件夹：无条件删除该album所有图片记录
        conn.execute(
            "DELETE FROM images WHERE profile_id = ?1 AND (album_id IS ?2 OR album_id = ?2)",
            params![profile_id, album_id],
        ).ok();
    } else {
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

/// Delete cached thumbnail files for an image (any size variant).
pub fn purge_thumbnails_for_image(cache_dir: &Path, image_id: i64) {
    let prefix = format!("{}_", image_id);
    if let Ok(entries) = fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) && name.ends_with(".jpg") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
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
            CREATE INDEX IF NOT EXISTS idx_images_profile ON images(profile_id);
            CREATE INDEX IF NOT EXISTS idx_images_album  ON images(album_id);"
        ).unwrap();
        conn
    }

    fn make_file(name: &str, size: u64) -> FileInfo {
        FileInfo {
            name: name.to_string(),
            size,
            last_modified: 1000.0,
            width: Some(1920),
            height: Some(1080),
        }
    }

    #[test]
    fn test_sync_images_inserts_new() {
        let conn = setup();
        let files = vec![make_file("test.jpg", 1024)];
        sync_images(&conn, "profile1", None, &files);
        let images = list_images(&conn, "profile1", Some(None));
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].filename, "test.jpg");
        assert_eq!(images[0].file_size, Some(1024));
        assert_eq!(images[0].width, Some(1920));
        assert_eq!(images[0].height, Some(1080));
    }

    #[test]
    fn test_sync_images_updates_existing() {
        let conn = setup();
        let files = vec![make_file("update.jpg", 512)];
        sync_images(&conn, "p1", None, &files);
        // Update with new size
        let files2 = vec![FileInfo {
            name: "update.jpg".to_string(),
            size: 2048,
            last_modified: 2000.0,
            width: Some(100),
            height: Some(200),
        }];
        sync_images(&conn, "p1", None, &files2);
        let images = list_images(&conn, "p1", Some(None));
        assert_eq!(images.len(), 1, "Should still be 1 image");
        assert_eq!(images[0].file_size, Some(2048), "Size should be updated");
        assert_eq!(images[0].width, Some(100), "Width should be updated");
    }

    #[test]
    fn test_sync_images_removes_missing() {
        let conn = setup();
        let files1 = vec![make_file("keep.jpg", 100), make_file("remove.jpg", 200)];
        sync_images(&conn, "p1", None, &files1);
        let files2 = vec![make_file("keep.jpg", 100)];
        sync_images(&conn, "p1", None, &files2);
        let images = list_images(&conn, "p1", Some(None));
        assert_eq!(images.len(), 1, "remove.jpg should be deleted");
        assert_eq!(images[0].filename, "keep.jpg");
    }

    #[test]
    fn test_sync_images_empty_deletes_all() {
        let conn = setup();
        let files = vec![make_file("a.jpg", 10), make_file("b.jpg", 20)];
        sync_images(&conn, "p1", None, &files);
        sync_images(&conn, "p1", None, &[]);
        let images = list_images(&conn, "p1", Some(None));
        assert!(images.is_empty(), "Empty sync should delete all images");
    }

    #[test]
    fn test_sync_images_scoped_by_profile() {
        let conn = setup();
        let files = vec![make_file("shared.jpg", 100)];
        sync_images(&conn, "p1", None, &files);
        sync_images(&conn, "p2", None, &files);
        assert_eq!(list_images(&conn, "p1", Some(None)).len(), 1);
        assert_eq!(list_images(&conn, "p2", Some(None)).len(), 1);
    }

    #[test]
    fn test_sync_images_with_album_id() {
        let conn = setup();
        let root_files = vec![make_file("root.jpg", 100)];
        let album_files = vec![make_file("album.jpg", 200)];
        sync_images(&conn, "p1", None, &root_files);
        sync_images(&conn, "p1", Some(1), &album_files);
        assert_eq!(list_images(&conn, "p1", Some(None)).len(), 1, "Root images");
        assert_eq!(list_images(&conn, "p1", Some(Some(1))).len(), 1, "Album images");
        assert_eq!(list_images(&conn, "p1", None).len(), 2, "All images");
    }

    #[test]
    fn test_get_image_by_id() {
        let conn = setup();
        let files = vec![make_file("findme.jpg", 100)];
        sync_images(&conn, "p1", None, &files);
        let images = list_images(&conn, "p1", Some(None));
        let found = get_image_by_id(&conn, images[0].id);
        assert!(found.is_some());
        assert_eq!(found.unwrap().filename, "findme.jpg");
        assert!(get_image_by_id(&conn, 99999).is_none());
    }

    #[test]
    fn test_get_image_by_name_with_null_album() {
        let conn = setup();
        sync_images(&conn, "p1", None, &[make_file("pic.jpg", 100)]);
        let found = get_image_by_name(&conn, "p1", "pic.jpg", None);
        assert!(found.is_some());
        let found2 = get_image_by_name(&conn, "p1", "pic.jpg", Some(1));
        assert!(found2.is_none(), "Should not find with wrong album_id");
    }

    #[test]
    fn test_get_image_by_name_with_exact_album() {
        let conn = setup();
        sync_images(&conn, "p1", Some(5), &[make_file("pic.jpg", 100)]);
        let found = get_image_by_name(&conn, "p1", "pic.jpg", Some(5));
        assert!(found.is_some());
        let not_found = get_image_by_name(&conn, "p1", "pic.jpg", None);
        assert!(not_found.is_none(), "Should not find root image when it's in an album");
    }

    #[test]
    fn test_update_image_meta() {
        let conn = setup();
        sync_images(&conn, "p1", None, &[make_file("meta.jpg", 100)]);
        let images = list_images(&conn, "p1", Some(None));
        let id = images[0].id;
        update_image_meta(&conn, id, Some(800), Some(600));
        let updated = get_image_by_id(&conn, id).unwrap();
        assert_eq!(updated.width, Some(800));
        assert_eq!(updated.height, Some(600));
    }

    #[test]
    fn test_list_images_with_no_album_filter() {
        let conn = setup();
        sync_images(&conn, "p1", None, &[make_file("root.jpg", 10)]);
        sync_images(&conn, "p1", Some(1), &[make_file("alb.jpg", 20)]);
        let all = list_images(&conn, "p1", None);
        assert_eq!(all.len(), 2);
    }
}
