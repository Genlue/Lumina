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
