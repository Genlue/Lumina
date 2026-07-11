use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use serde::Deserialize;
use serde::Serialize;

use crate::db;
use crate::db::DbState;
use crate::models::*;
use crate::models::FavCopyResult;
use crate::repos;
use crate::services;

// ============================================================
// 辅助函数
// ============================================================

/// 获取 profile 的 folder_path (锁中央 DB)
fn get_profile_folder(app: &AppHandle, profile_id: &str) -> Result<String, String> {
    let db = app.state::<DbState>();
    let conn = db.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
    let p = repos::profiles::get_profile_by_id(&conn, profile_id)
        .ok_or_else(|| format!("Profile {} not found", profile_id))?;
    Ok(p.folder_path)
}

/// 获取或打开 profile DB 连接，并返回其 Arc<Mutex<Connection>>
/// 先获取 folder_path，再通过 db::get_profile_conn 获取连接
fn get_profile_db(app: &AppHandle, profile_id: &str)
    -> Result<(std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>, String), String>
{
    let folder = get_profile_folder(app, profile_id)?;
    let state = app.state::<DbState>();
    let conn_arc = db::get_profile_conn(&state, profile_id, &folder)?;
    Ok((conn_arc, folder))
}

/// 在 profile DB 中执行同步逻辑（扫描 + 写入数据库）
fn sync_profile_to_db(
    p_conn: &rusqlite::Connection,
    profile_id: &str,
    folder_path: &str,
) -> Result<ScanResult, String> {
    let scan_result = services::scanner::scan_profile_folder(profile_id, folder_path);

    repos::images::sync_images(p_conn, profile_id, None, &scan_result.root_images);
    repos::albums::ensure_albums_for_profile(p_conn, profile_id, &scan_result.album_folders);

    // Clean up defunct albums: remove albums whose folders no longer exist on disk
    let db_albums = repos::albums::list_albums(p_conn, profile_id);
    for album in &db_albums {
        if !scan_result.album_folders.contains(&album.folder_name) {
            // Delete all images in this defunct album first
            p_conn.execute(
                "DELETE FROM images WHERE profile_id=?1 AND album_id=?2",
                rusqlite::params![profile_id, album.id],
            ).ok();
            repos::albums::delete_album(p_conn, profile_id, &album.folder_name);
        }
    }

    let albums = repos::albums::list_albums(p_conn, profile_id);
    for album in &albums {
        let imgs = scan_result
            .album_images
            .get(&album.folder_name)
            .cloned()
            .unwrap_or_default();
        repos::images::sync_images(p_conn, profile_id, Some(album.id), &imgs);
    }

    Ok(scan_result)
}

// ============================================================
// Profiles（使用中央 DB）
// ============================================================

#[tauri::command]
pub fn profiles_create(
    app: AppHandle,
    folder_path: String,
    name: Option<String>,
) -> Result<Profile, String> {
    // 1. 写入中央 DB（若相同 folder_path 的 profile 已存在则直接返回）
    let db = app.state::<DbState>();
    let conn = db.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
    let (profile, is_existing) = repos::profiles::create_profile(&conn, &folder_path, name.as_deref());

    if is_existing {
        // 重复引入：DB 已初始化，扫描由调用方 _doLoad 触发
        return Ok(profile);
    }

    // 2. 获取/创建 profile DB 连接
    // get_profile_conn 自动创建 .album 目录和 data.db、建表、处理 profile_id 迁移
    let p_conn_arc = db::get_profile_conn(&db, &profile.id, &folder_path)
        .map_err(|e| format!("Get profile DB: {}", e))?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;

    // 3. 插入默认 settings (INSERT OR IGNORE) — 当没有旧数据时兜底
    p_conn
        .execute(
            "INSERT OR IGNORE INTO settings (profile_id) VALUES (?1)",
            rusqlite::params![profile.id],
        )
        .ok();

    // 4. 扫描并同步
    sync_profile_to_db(&p_conn, &profile.id, &folder_path)?;

    Ok(profile)
}

#[tauri::command]
pub fn profiles_list(app: AppHandle) -> Result<Vec<Profile>, String> {
    let db = app.state::<DbState>();
    let conn = db.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
    Ok(repos::profiles::list_profiles(&conn))
}

#[tauri::command]
pub fn profiles_get_by_id(app: AppHandle, id: String) -> Result<Option<Profile>, String> {
    let db = app.state::<DbState>();
    let conn = db.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
    Ok(repos::profiles::get_profile_by_id(&conn, &id))
}

#[tauri::command]
pub fn profiles_remove(app: AppHandle, id: String) -> Result<(), String> {
    // 先关闭并移除 profile DB 连接缓存
    let db = app.state::<DbState>();
    db::close_profile_conn(&db, &id);

    // 再从中央 DB 删除记录
    let conn = db.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
    repos::profiles::remove_profile(&conn, &id);
    Ok(())
}

#[tauri::command]
pub fn profiles_touch(app: AppHandle, id: String) -> Result<(), String> {
    let db = app.state::<DbState>();
    let conn = db.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
    repos::profiles::touch_profile(&conn, &id);
    Ok(())
}

#[tauri::command]
pub fn profiles_mark_gone(app: AppHandle, id: String) -> Result<(), String> {
    let db = app.state::<DbState>();
    let conn = db.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
    repos::profiles::mark_profile_gone(&conn, &id);
    Ok(())
}

#[tauri::command]
pub fn profiles_check_path(_app: AppHandle, folder_path: String) -> bool {
    Path::new(&folder_path).exists()
}

#[tauri::command]
pub fn profiles_relocate(app: AppHandle, id: String) -> Result<Option<Profile>, String> {
    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder();

    let new_path = match folder {
        Some(p) => p.to_string(),
        None => return Ok(None),
    };

    // 关闭旧 profile DB 连接（路径已变更）
    let state = app.state::<DbState>();
    db::close_profile_conn(&state, &id);

    // 更新中央 DB 中的路径
    let conn = state.conn.lock().map_err(|e| format!("DB lock: {}", e))?;
    repos::profiles::update_folder_path(&conn, &id, &new_path);

    // get_profile_conn 自动创建/打开 data.db 并处理 profile_id 迁移
    // 重新扫描并同步
    let p_conn_arc = db::get_profile_conn(&state, &id, &new_path)
        .map_err(|e| format!("Get profile DB: {}", e))?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    sync_profile_to_db(&p_conn, &id, &new_path)?;

    Ok(repos::profiles::get_profile_by_id(&conn, &id))
}

// ============================================================
// Scanner（使用 profile DB）
// ============================================================

#[tauri::command]
pub fn scanner_scan_all(app: AppHandle, profile_id: String) -> Result<ScanResult, String> {
    let (p_conn_arc, folder) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    sync_profile_to_db(&p_conn, &profile_id, &folder)
}

#[tauri::command]
pub fn scanner_scan_folder(
    app: AppHandle,
    profile_id: String,
    folder_path: String,
) -> Result<ScanResult, String> {
    let (p_conn_arc, root) = get_profile_db(&app, &profile_id)?;
    let full_path = Path::new(&root).join(&folder_path);
    let full_path_str = full_path.to_string_lossy().to_string();
    let scan_result = services::scanner::scan_profile_folder(&profile_id, &full_path_str);

    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    repos::images::sync_images(&p_conn, &profile_id, None, &scan_result.root_images);
    repos::albums::ensure_albums_for_profile(&p_conn, &profile_id, &scan_result.album_folders);
    let albums = repos::albums::list_albums(&p_conn, &profile_id);
    for album in &albums {
        let imgs = scan_result
            .album_images
            .get(&album.folder_name)
            .cloned()
            .unwrap_or_default();
        repos::images::sync_images(&p_conn, &profile_id, Some(album.id), &imgs);
    }

    Ok(scan_result)
}

#[tauri::command]
pub fn scanner_list_folders(app: AppHandle, profile_id: String) -> Result<Vec<String>, String> {
    let folder = get_profile_folder(&app, &profile_id)?;
    Ok(services::scanner::list_all_subfolders(&folder))
}

#[tauri::command]
pub fn scanner_list_subfolders(
    app: AppHandle,
    profile_id: String,
    parent_path: String,
) -> Result<Vec<String>, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let full_path = std::path::Path::new(&root).join(&parent_path);
    if !full_path.exists() || !full_path.is_dir() {
        return Ok(vec![]);
    }

    let mut subfolders = Vec::new();
    for entry in std::fs::read_dir(&full_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
            && !services::scanner::should_exclude(&name)
        {
            subfolders.push(if parent_path.is_empty() {
                name
            } else {
                format!("{}/{}", parent_path, name)
            });
        }
    }
    subfolders.sort();
    Ok(subfolders)
}

// ============================================================
// Files（使用 profile DB）
// ============================================================

#[tauri::command]
pub async fn files_get_thumbnail(
    app: AppHandle,
    profile_id: String,
    filename: String,
    folder: Option<String>,
    size: Option<u32>,
) -> Result<ThumbnailResult, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let file_path = match &folder {
        Some(sf) if !sf.is_empty() => Path::new(&root).join(sf).join(&filename),
        _ => Path::new(&root).join(&filename),
    };

    if !file_path.exists() {
        return Err(format!("File not found: {}", filename));
    }

    let max_dim = size.unwrap_or(0);

    // Full-size mode (lightbox / background): return original path with dimensions from DB
    if max_dim == 0 {
        let (width, height) = {
            let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
            let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
            let album_id = folder
                .as_deref()
                .and_then(|f| repos::albums::get_album_by_folder(&p_conn, &profile_id, f))
                .map(|a| a.id);
            repos::images::get_image_by_name(&p_conn, &profile_id, &filename, album_id)
                .map(|img| (img.width.unwrap_or(0) as u32, img.height.unwrap_or(0) as u32))
                .unwrap_or((0, 0))
        };
        return Ok(ThumbnailResult {
            data_url: file_path.to_string_lossy().to_string(),
            width,
            height,
        });
    }

    // Thumbnail mode: generate or retrieve cached thumbnail
    let cache_dir = Path::new(&root).join(".album").join("cache").join("thumbnails");

    // Cache key uses file-path hash only — zero DB queries, zero lock contention.
    // The thumbnail service (get_or_generate_thumbnail) already validates freshness
    // via mtime, so a file replaced at the same path gets a new thumbnail automatically.
    let cache_key = format!("{:x}_{}_v2", simple_hash(&file_path.to_string_lossy()), max_dim);

    let fp = file_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        services::thumbnails::get_or_generate_thumbnail(&fp, &cache_dir, &cache_key, max_dim, 75)
    })
    .await
    .map_err(|e| format!("Thumbnail generation error: {}", e))?;

    match result {
        Some(thumb_path) => {
            let (tw, th) = image::image_dimensions(&thumb_path).unwrap_or((max_dim, max_dim));
            Ok(ThumbnailResult {
                data_url: thumb_path.to_string_lossy().to_string(),
                width: tw,
                height: th,
            })
        }
        None => {
            // Fallback: return original path (SVG, corrupt, etc.)
            Ok(ThumbnailResult {
                data_url: file_path.to_string_lossy().to_string(),
                width: 0,
                height: 0,
            })
        }
    }
}

#[derive(Deserialize)]
pub struct ThumbReq {
    filename: String,
    folder: Option<String>,
}

#[derive(Serialize)]
pub struct ThumbBatchResult {
    filename: String,
    folder: Option<String>,
    data_url: Option<String>,
}

#[tauri::command]
pub async fn files_get_thumbnails_batch(
    app: AppHandle,
    profile_id: String,
    requests: Vec<ThumbReq>,
    size: Option<u32>,
) -> Result<Vec<ThumbBatchResult>, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let cache_dir = Path::new(&root).join(".album").join("cache").join("thumbnails");
    let max_dim = size.unwrap_or(400);

    // Use spawn_blocking to avoid blocking the async runtime
    let root_c = root.clone();
    let cache_dir_c = cache_dir.clone();
    let results = tauri::async_runtime::spawn_blocking(move || {
        requests.into_iter().map(|req| {
            let fp = match &req.folder {
                Some(sf) if !sf.is_empty() => Path::new(&root_c).join(sf).join(&req.filename),
                _ => Path::new(&root_c).join(&req.filename),
            };
            let cache_key = format!("{:x}_{}_v2", simple_hash(&fp.to_string_lossy()), max_dim);
            let data_url = services::thumbnails::get_or_generate_thumbnail(
                &fp, &cache_dir_c, &cache_key, max_dim, 75
            ).map(|p| p.to_string_lossy().to_string());
            ThumbBatchResult {
                filename: req.filename,
                folder: req.folder,
                data_url,
            }
        }).collect::<Vec<_>>()
    }).await.map_err(|e| format!("Batch thumbnail error: {}", e))?;

    Ok(results)
}

/// Simple non-cryptographic hash for cache key fallback when image not in DB.
fn simple_hash(s: &str) -> u64 {
    let mut h: u64 = 5381;
    for b in s.bytes() {
        h = h.wrapping_mul(33).wrapping_add(b as u64);
    }
    h
}

#[tauri::command]
pub fn files_rename(
    app: AppHandle,
    profile_id: String,
    old_name: String,
    new_name: String,
    folder: Option<String>,
) -> Result<String, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let old_path = match &folder {
        Some(f) if !f.is_empty() => Path::new(&root).join(f).join(&old_name),
        _ => Path::new(&root).join(&old_name),
    };
    let new_path = match &folder {
        Some(f) if !f.is_empty() => Path::new(&root).join(f).join(&new_name),
        _ => Path::new(&root).join(&new_name),
    };

    if !old_path.exists() {
        return Err(format!("File not found: {}", old_name));
    }
    if new_path.exists() {
        return Err(format!("Target already exists: {}", new_name));
    }

    fs::rename(&old_path, &new_path).map_err(|e| format!("Rename error: {}", e))?;
    Ok(new_name)
}

#[tauri::command]
pub fn files_move_to_trash(
    app: AppHandle,
    profile_id: String,
    filename: String,
    folder: Option<String>,
) -> Result<String, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let trash_dir = Path::new(&root).join(".album").join("trash");
    fs::create_dir_all(&trash_dir).map_err(|e| format!("Create trash dir: {}", e))?;

    let old_path = match &folder {
        Some(f) if !f.is_empty() => Path::new(&root).join(f).join(&filename),
        _ => Path::new(&root).join(&filename),
    };

    if !old_path.exists() {
        return Err(format!("File not found: {}", filename));
    }

    let ext = old_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let base = old_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&filename);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let trash_name = format!("{}_{}.{}", base, ts, ext);
    let new_path = trash_dir.join(&trash_name);

    fs::rename(&old_path, &new_path).map_err(|e| format!("Move error: {}", e))?;

    // 记录到 profile DB
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;

    // 取消收藏（如果已收藏）
    let img_fav = repos::images::get_image_by_name(&p_conn, &profile_id, &filename,
        folder.as_deref().and_then(|f| repos::albums::get_album_by_folder(&p_conn, &profile_id, f)).map(|a| a.id));
    if let Some(img) = img_fav {
        repos::favorites::remove_by_image_id(&p_conn, &profile_id, img.id);
    }

    repos::trash::add_trash_entry(&p_conn, &profile_id, &filename, &trash_name, folder.as_deref());

    Ok(trash_name)
}

#[tauri::command]
pub fn files_permanent_delete(
    app: AppHandle,
    profile_id: String,
    filename: String,
    folder: Option<String>,
) -> Result<(), String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let file_path = match &folder {
        Some(f) if !f.is_empty() => Path::new(&root).join(f).join(&filename),
        _ => Path::new(&root).join(&filename),
    };
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| format!("Delete error: {}", e))?;
    }
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    repos::trash::remove_trash_entry(&p_conn, &profile_id, &filename);
    Ok(())
}

#[tauri::command]
pub fn files_move_to_folder(
    app: AppHandle,
    profile_id: String,
    filename: String,
    target_folder: String,
) -> Result<String, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let old_path = Path::new(&root).join(&filename);
    let target_dir = Path::new(&root).join(&target_folder);
    let new_path = target_dir.join(&filename);

    if !old_path.exists() {
        return Err(format!("File not found: {}", filename));
    }
    fs::create_dir_all(&target_dir).map_err(|e| format!("Create dir: {}", e))?;
    fs::rename(&old_path, &new_path).map_err(|e| format!("Move error: {}", e))?;
    // Update DB: move image record to new album
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;

    let new_aid = repos::albums::get_album_by_folder(&p_conn, &profile_id, &target_folder).map(|a| a.id);

    p_conn.execute(
        "UPDATE images SET album_id = ?1 WHERE profile_id = ?2 AND album_id IS NULL AND filename = ?3",
        rusqlite::params![new_aid, profile_id, filename],
    ).ok();
    Ok(target_folder)
}

#[tauri::command]
pub fn files_move_between_folders(
    app: AppHandle,
    profile_id: String,
    filename: String,
    from_folder: String,
    to_folder: String,
) -> Result<String, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let old_path = Path::new(&root).join(&from_folder).join(&filename);
    let target_dir = Path::new(&root).join(&to_folder);
    let new_path = target_dir.join(&filename);

    if !old_path.exists() {
        return Err(format!("File not found: {}", filename));
    }
    fs::create_dir_all(&target_dir).map_err(|e| format!("Create dir: {}", e))?;
    fs::rename(&old_path, &new_path).map_err(|e| format!("Move error: {}", e))?;
    // Update DB: move image record to new album
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;

    let old_aid = repos::albums::get_album_by_folder(&p_conn, &profile_id, &from_folder).map(|a| a.id);
    let new_aid = repos::albums::get_album_by_folder(&p_conn, &profile_id, &to_folder).map(|a| a.id);

    p_conn.execute(
        "UPDATE images SET album_id = ?1 WHERE profile_id = ?2 AND album_id IS ?3 AND filename = ?4",
        rusqlite::params![new_aid, profile_id, old_aid, filename],
    ).ok();
    Ok(to_folder)
}

#[tauri::command]
pub fn files_move_to_root(
    app: AppHandle,
    profile_id: String,
    filename: String,
    from_folder: String,
) -> Result<(), String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let old_path = Path::new(&root).join(&from_folder).join(&filename);
    let new_path = Path::new(&root).join(&filename);

    if !old_path.exists() {
        return Err(format!("File not found: {}", filename));
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("Move error: {}", e))?;
    // Update DB: move image record to root (album_id = NULL)
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;

    let old_aid = repos::albums::get_album_by_folder(&p_conn, &profile_id, &from_folder).map(|a| a.id);

    p_conn.execute(
        "UPDATE images SET album_id = NULL WHERE profile_id = ?1 AND album_id = ?2 AND filename = ?3",
        rusqlite::params![profile_id, old_aid, filename],
    ).ok();
    Ok(())
}

// ============================================================
// Folders（使用 profile DB 更新 albums 表）
// ============================================================

#[tauri::command]
pub fn folders_create(
    app: AppHandle,
    profile_id: String,
    name: String,
    parent: Option<String>,
) -> Result<String, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let dir = match &parent {
        Some(p) if !p.is_empty() => Path::new(&root).join(p).join(&name),
        _ => Path::new(&root).join(&name),
    };
    if dir.exists() {
        return Err(format!("Folder already exists: {}", dir.display()));
    }
    fs::create_dir(&dir).map_err(|e| format!("Create error: {}", e))?;
    Ok(name)
}

#[tauri::command]
pub fn folders_delete(
    app: AppHandle,
    profile_id: String,
    folder_path: String,
    move_up: bool,
) -> Result<(), String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let full_path = Path::new(&root).join(&folder_path);

    if !full_path.exists() {
        return Err(format!("Folder not found: {}", folder_path));
    }

    if move_up {
        // 挪至根目录：保留原逻辑，把内容上移
        if let Ok(entries) = fs::read_dir(&full_path) {
            for entry in entries.flatten() {
                let dest = Path::new(&root).join(entry.file_name());
                fs::rename(entry.path(), &dest).ok();
            }
        }
        fs::remove_dir_all(&full_path).ok();
    } else {
        // 一并删除：先递归处理所有图片到回收站，再删空文件夹
        let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
        let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;

        // 递归收集所有图片文件
        let trash_dir = Path::new(&root).join(".album").join("trash");
        fs::create_dir_all(&trash_dir).ok();

        let all_images = collect_images_recursive(&full_path, Path::new(&root));
        for (rel_path, filename) in &all_images {
            let old_path = Path::new(&root).join(rel_path);
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis();
            let ext = old_path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let base = old_path.file_stem().and_then(|s| s.to_str()).unwrap_or(filename);
            let trash_name = format!("{}_{}.{}", base, ts, ext);
            let new_path = trash_dir.join(&trash_name);

            fs::rename(&old_path, &new_path).ok();
            repos::trash::add_trash_entry(&p_conn, &profile_id, filename, &trash_name,
                Path::new(rel_path).parent().and_then(|p| p.to_str()));

            // 取消收藏
            let folder_part = Path::new(rel_path).parent().and_then(|p| p.to_str());
            let album_for = folder_part.and_then(|f| repos::albums::get_album_by_folder(&p_conn, &profile_id, f));
            let aid = album_for.map(|a| a.id);
            let img = repos::images::get_image_by_name(&p_conn, &profile_id, filename, aid);
            if let Some(im) = img {
                repos::favorites::remove_by_image_id(&p_conn, &profile_id, im.id);
            }
        }

        // 删除空文件夹
        fs::remove_dir_all(&full_path).ok();
    }

    // 清理DB记录（两种模式都需要）
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    repos::albums::delete_album(&p_conn, &profile_id, &folder_path);
    let prefix = format!("{}/", folder_path);
    p_conn
        .execute(
            "DELETE FROM albums WHERE profile_id=?1 AND folder_name LIKE ?2",
            rusqlite::params![profile_id, format!("{}%", prefix)],
        )
        .ok();
    Ok(())
}

/// 递归收集文件夹中所有图片的相对路径
fn collect_images_recursive(dir: &Path, root: &Path) -> Vec<(String, String)> {
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // 跳过 .album 目录
                if path.file_name().and_then(|n| n.to_str()) == Some(".album") {
                    continue;
                }
                result.extend(collect_images_recursive(&path, root));
            } else if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    if matches!(ext_lower.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "bmp") {
                        if let Ok(rel) = path.strip_prefix(root) {
                            if let Some(rel_str) = rel.to_str() {
                                if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                                    result.push((rel_str.to_string(), fname.to_string()));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    result
}

#[tauri::command]
pub fn folders_rename(
    app: AppHandle,
    profile_id: String,
    folder_path: String,
    new_name: String,
) -> Result<String, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let old_full = Path::new(&root).join(&folder_path);
    if !old_full.exists() {
        return Err(format!("Folder not found: {}", folder_path));
    }

    // Extract parent path for constructing new relative path
    let parent = Path::new(&folder_path)
        .parent()
        .and_then(|p| p.to_str())
        .filter(|p| !p.is_empty())
        .unwrap_or("");
    let new_rel_path = if parent.is_empty() {
        new_name.clone()
    } else {
        format!("{}/{}", parent, new_name)
    };
    let new_full = Path::new(&root).join(&new_rel_path);

    if new_full.exists() {
        return Err(format!("Target already exists: {}", new_rel_path));
    }

    fs::rename(&old_full, &new_full).map_err(|e| format!("Rename error: {}", e))?;

    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;

    // Rename the album itself
    repos::albums::rename_album(&p_conn, &profile_id, &folder_path, &new_rel_path);

    // Rename all sub-albums (update paths via SQL)
    let prefix = format!("{}/", folder_path);
    let new_prefix = format!("{}/", new_rel_path);
    p_conn
        .execute(
            "UPDATE albums SET folder_name = REPLACE(folder_name, ?1, ?2) WHERE profile_id=?3 AND folder_name LIKE ?4",
            rusqlite::params![prefix, new_prefix, profile_id, format!("{}%", prefix)],
        )
        .ok();

    Ok(new_rel_path)
}

// ============================================================
// Albums（使用 profile DB）
// ============================================================

#[tauri::command]
pub fn albums_set_cover(
    app: AppHandle,
    profile_id: String,
    folder_name: String,
    image_name: String,
) -> Result<(), String> {
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    repos::albums::set_album_cover(&p_conn, &profile_id, &folder_name, &image_name);
    Ok(())
}

#[tauri::command]
pub fn albums_set_order(
    app: AppHandle,
    profile_id: String,
    folder_name: String,
    order: Vec<String>,
) -> Result<(), String> {
    let json = serde_json::to_string(&order).map_err(|e| e.to_string())?;
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    repos::albums::set_album_order(&p_conn, &profile_id, &folder_name, &json);
    Ok(())
}

#[tauri::command]
pub fn albums_list(app: AppHandle, profile_id: String) -> Result<Vec<Album>, String> {
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    Ok(repos::albums::list_albums(&p_conn, &profile_id))
}

// ============================================================
// Favorites（使用 profile DB）
// ============================================================

#[tauri::command]
pub fn favorites_toggle(
    app: AppHandle,
    profile_id: String,
    filename: String,
    folder: Option<String>,
) -> Result<bool, String> {
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;

    let album = folder
        .as_deref()
        .and_then(|f| repos::albums::get_album_by_folder(&p_conn, &profile_id, f));
    let album_id = album.map(|a| a.id);

    // 先尝试通过图片名查找
    let img = repos::images::get_image_by_name(&p_conn, &profile_id, &filename, album_id);

    match img {
        Some(image) => {
            // 图片存在：正常切换收藏
            Ok(repos::favorites::toggle_favorite(&p_conn, &profile_id, image.id, &image.filename, image.album_id))
        }
        None => {
            // 图片不存在（可能已损坏/丢失），但仍然尝试删除收藏记录
            repos::favorites::remove_by_filename(&p_conn, &profile_id, &filename, album_id);
            Ok(false)
        }
    }
}

#[tauri::command]
pub fn favorites_list(app: AppHandle, profile_id: String) -> Result<Vec<FavoritesRecord>, String> {
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    Ok(repos::favorites::list_favorites(&p_conn, &profile_id))
}

#[tauri::command]
pub fn favorites_is_favorite(
    app: AppHandle,
    profile_id: String,
    filename: String,
    folder: Option<String>,
) -> Result<bool, String> {
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;

    let album = folder
        .as_deref()
        .and_then(|f| repos::albums::get_album_by_folder(&p_conn, &profile_id, f));
    let album_id = album.map(|a| a.id);

    match repos::images::get_image_by_name(&p_conn, &profile_id, &filename, album_id) {
        Some(img) => Ok(repos::favorites::is_favorite(&p_conn, &profile_id, img.id)),
        None => Ok(false),
    }
}

#[tauri::command]
pub fn favorites_count(app: AppHandle, profile_id: String) -> Result<i64, String> {
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    Ok(repos::favorites::count_favorites(&p_conn, &profile_id))
}

// ============================================================
// Trash（使用 profile DB）
// ============================================================

#[tauri::command]
pub fn trash_list(app: AppHandle, profile_id: String) -> Result<Vec<TrashRecord>, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    let records = repos::trash::list_trash(&p_conn, &profile_id);

    // Auto-clean ghost records + migrate files from old .album-trash/ path
    let new_trash_dir = Path::new(&root).join(".album").join("trash");
    let old_trash_dir = Path::new(&root).join(".album-trash");
    let mut valid = Vec::new();
    for rec in &records {
        let new_path = new_trash_dir.join(&rec.trash_name);
        if new_path.exists() {
            valid.push(rec.clone());
            continue;
        }
        // Try old path — migrate file if found
        let old_path = old_trash_dir.join(&rec.trash_name);
        if old_path.exists() {
            fs::create_dir_all(&new_trash_dir).ok();
            if fs::rename(&old_path, &new_path).is_ok() {
                valid.push(rec.clone());
                continue;
            }
        }
        // File missing entirely — remove ghost DB record
        repos::trash::remove_trash_entry(&p_conn, &profile_id, &rec.trash_name);
    }
    Ok(valid)
}

#[tauri::command]
pub fn trash_restore(
    app: AppHandle,
    profile_id: String,
    trash_name: String,
    original_name: String,
    original_folder: Option<String>,
) -> Result<String, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let trash_dir = Path::new(&root).join(".album").join("trash");
    let trash_path = trash_dir.join(&trash_name);

    let restore_path = match &original_folder {
        Some(f) if !f.is_empty() => Path::new(&root).join(f).join(&original_name),
        _ => Path::new(&root).join(&original_name),
    };

    if !trash_path.exists() {
        return Err(format!("Trash file not found: {}", trash_name));
    }

    if let Some(parent) = restore_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Create dir: {}", e))?;
    }

    // Avoid name collision
    let mut final_path = restore_path.clone();
    let ext = restore_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let base = restore_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&original_name);
    let mut counter = 2u32;
    while final_path.exists() {
        let new_name = if ext.is_empty() {
            format!("{} ({})", base, counter)
        } else {
            format!("{} ({}).{}", base, counter, ext)
        };
        final_path = match &original_folder {
            Some(f) if !f.is_empty() => Path::new(&root).join(f).join(&new_name),
            _ => Path::new(&root).join(&new_name),
        };
        counter += 1;
    }

    fs::rename(&trash_path, &final_path).map_err(|e| format!("Restore error: {}", e))?;

    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    repos::trash::remove_trash_entry(&p_conn, &profile_id, &trash_name);

    Ok(final_path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub fn trash_count(app: AppHandle, profile_id: String) -> Result<i64, String> {
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    Ok(repos::trash::count_trash(&p_conn, &profile_id))
}

#[tauri::command]
pub fn trash_empty(app: AppHandle, profile_id: String) -> Result<i64, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let trash_dir = Path::new(&root).join(".album").join("trash");
    if trash_dir.exists() {
        if let Ok(entries) = fs::read_dir(&trash_dir) {
            for entry in entries.flatten() {
                fs::remove_file(entry.path()).ok();
            }
        }
    }
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    Ok(repos::trash::empty_trash(&p_conn, &profile_id))
}

// ============================================================
// Settings（使用 profile DB）
// ============================================================

#[tauri::command]
pub fn settings_get(app: AppHandle, profile_id: String) -> Result<Settings, String> {
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    Ok(repos::settings::get_settings(&p_conn, &profile_id))
}

#[tauri::command]
pub fn settings_save(
    app: AppHandle,
    profile_id: String,
    updates: serde_json::Value,
) -> Result<Settings, String> {
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    repos::settings::save_settings(&p_conn, &profile_id, updates);
    Ok(repos::settings::get_settings(&p_conn, &profile_id))
}

// ============================================================
// Theme（不变）
// ============================================================

#[tauri::command]
pub fn theme_extract_colors(
    app: AppHandle,
    profile_id: String,
    filename: String,
) -> Result<ThemeColors, String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let file_path = Path::new(&root)
        .join(".album")
        .join("backgrounds")
        .join(&filename);
    if !file_path.exists() {
        return Err(format!("Background file not found: {}", filename));
    }
    Ok(services::theme::extract_theme_colors(
        &file_path.to_string_lossy(),
    ))
}

// ============================================================
// Background（不变）
// ============================================================

#[tauri::command]
pub fn bg_import(app: AppHandle, profile_id: String) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("Images", &["jpg", "jpeg", "png", "bmp", "webp"])
        .blocking_pick_file();

    let src_path = match file {
        Some(p) => p,
        None => return Ok(None),
    };

    let src = src_path.as_path().ok_or("Invalid file path")?.to_path_buf();

    let root = get_profile_folder(&app, &profile_id)?;
    let bg_dir = Path::new(&root).join(".album").join("backgrounds");
    fs::create_dir_all(&bg_dir).map_err(|e| format!("Create bg dir: {}", e))?;

    let filename = src.file_name().unwrap().to_string_lossy().to_string();
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    let base = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&filename);

    let mut final_name = filename.clone();
    let mut final_path = bg_dir.join(&final_name);
    let mut counter = 2u32;
    while final_path.exists() {
        final_name = if ext.is_empty() {
            format!("{} ({})", base, counter)
        } else {
            format!("{} ({}).{}", base, counter, ext)
        };
        final_path = bg_dir.join(&final_name);
        counter += 1;
    }

    fs::copy(&src, &final_path).map_err(|e| format!("Copy error: {}", e))?;
    Ok(Some(final_name))
}

#[tauri::command]
pub fn bg_open_folder(app: AppHandle, profile_id: String) -> Result<(), String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let bg_path = Path::new(&root).join(".album").join("backgrounds");
    fs::create_dir_all(&bg_path).ok();
    // Open in system file explorer
    if let Err(e) = open::that(&bg_path) {
        eprintln!("Failed to open folder: {}", e);
    }
    Ok(())
}

#[tauri::command]
pub fn bg_delete(app: AppHandle, profile_id: String, filename: String) -> Result<(), String> {
    let root = get_profile_folder(&app, &profile_id)?;
    let file_path = Path::new(&root)
        .join(".album")
        .join("backgrounds")
        .join(&filename);
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}

// ============================================================
// Dialog
// ============================================================

#[tauri::command]
pub fn dialog_open_folder(app: AppHandle, title: Option<String>) -> Result<Option<String>, String> {
    let folder = app
        .dialog()
        .file()
        .set_title(title.unwrap_or_else(|| "选择图片文件夹".to_string()))
        .blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

// ============================================================
// Cache
// ============================================================

#[tauri::command]
pub fn cache_get_info(app: AppHandle, profile_id: String) -> Result<CacheInfo, String> {
    let folder = get_profile_folder(&app, &profile_id)?;
    let cache_dir = Path::new(&folder).join(".album").join("cache").join("thumbnails");
    if !cache_dir.exists() {
        return Ok(CacheInfo { size: 0, file_count: 0 });
    }
    let mut total_size: u64 = 0;
    let mut count: u64 = 0;
    if let Ok(entries) = fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                total_size += entry.metadata().map(|m| m.len()).unwrap_or(0);
                count += 1;
            }
        }
    }
    Ok(CacheInfo { size: total_size, file_count: count })
}

#[tauri::command]
pub fn cache_clear(app: AppHandle, profile_id: String) -> Result<u64, String> {
    let folder = get_profile_folder(&app, &profile_id)?;
    let cache_dir = Path::new(&folder).join(".album").join("cache").join("thumbnails");
    if !cache_dir.exists() { return Ok(0); }
    let mut count: u64 = 0;
    if let Ok(entries) = fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                fs::remove_file(entry.path()).ok();
                count += 1;
            }
        }
    }
    Ok(count)
}

// ============================================================
// System
// ============================================================

#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Open error: {}", e))
}

// ============================================================
// Window Effects
// ============================================================

#[tauri::command]
pub fn window_set_effect(app: AppHandle, enabled: bool, effect_type: Option<String>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if enabled {
            let effect = effect_type.as_deref().unwrap_or("acrylic");
            #[cfg(target_os = "windows")]
            {
                if effect == "blur" {
                    let _ = window.set_effects(tauri::utils::config::WindowEffectsConfig {
                        effects: vec![tauri::window::Effect::Blur],
                        ..Default::default()
                    });
                } else {
                    let _ = window.set_effects(tauri::utils::config::WindowEffectsConfig {
                        effects: vec![tauri::window::Effect::Acrylic],
                        ..Default::default()
                    });
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = window.set_effects(tauri::utils::config::WindowEffectsConfig {
                    effects: vec![tauri::window::Effect::Blur],
                    ..Default::default()
                });
            }
        } else {
            let _: Result<_, _> = window.set_effects(None::<tauri::utils::config::WindowEffectsConfig>);
        }
    }
    Ok(())
}

// ============================================================
// Favorites Export/Import
// ============================================================

#[tauri::command]
pub fn favorites_export(app: AppHandle, profile_id: String) -> Result<String, String> {
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Lock: {}", e))?;
    let list = repos::favorites::list_favorites(&p_conn, &profile_id);
    let items: Vec<FavoritesExportItem> = list.iter().map(|f| FavoritesExportItem {
        filename: f.filename.clone().unwrap_or_default(),
        album_id: f.album_id,
        folder_name: f.folder_name.clone(),
        added_at: f.added_at.clone(),
        file_size: f.file_size,
        width: f.width,
        height: f.height,
    }).collect();
    serde_json::to_string_pretty(&items).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn favorites_import(app: AppHandle, profile_id: String, data: String, mode: String) -> Result<i64, String> {
    let items: Vec<FavoritesExportItem> = serde_json::from_str(&data).map_err(|e| format!("Parse JSON: {}", e))?;
    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Lock: {}", e))?;

    if mode == "overwrite" {
        p_conn.execute("DELETE FROM favorites WHERE profile_id=?1", rusqlite::params![profile_id]).map_err(|e| e.to_string())?;
    }

    let mut imported: i64 = 0;
    for item in &items {
        // Try to match image in DB
        let image_id: Option<i64> = p_conn.query_row(
            "SELECT id FROM images WHERE profile_id=?1 AND filename=?2 AND album_id IS ?3",
            rusqlite::params![profile_id, item.filename, item.album_id], |r| r.get(0)
        ).ok().or_else(|| {
            p_conn.query_row(
                "SELECT id FROM images WHERE profile_id=?1 AND filename=?2",
                rusqlite::params![profile_id, item.filename], |r| r.get(0)
            ).ok()
        });

        if let Some(img_id) = image_id {
            let _ = p_conn.execute(
                "INSERT OR IGNORE INTO favorites (profile_id, image_id, added_at, filename, album_id) VALUES (?1,?2,?3,?4,?5)",
                rusqlite::params![profile_id, img_id, item.added_at, item.filename, item.album_id]
            );
            imported += 1;
        }
    }
    Ok(imported)
}

// ============================================================
// File I/O helpers
// ============================================================

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Write file: {}", e))
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Read file: {}", e))
}

// ============================================================
// Favorites → Backgrounds
// ============================================================

#[tauri::command]
pub fn favorites_copy_to_backgrounds(
    app: AppHandle,
    profile_id: String,
    overwrite_existing: bool,
) -> Result<FavCopyResult, String> {
    let (p_conn_arc, folder) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Lock: {}", e))?;

    let bg_dir = std::path::Path::new(&folder).join(".album").join("backgrounds");
    std::fs::create_dir_all(&bg_dir).map_err(|e| format!("Create bg dir: {}", e))?;

    let favs = repos::favorites::list_favorites(&p_conn, &profile_id);
    let mut result = FavCopyResult {
        copied: 0, overwritten: 0, skipped: 0, duplicates: vec![]
    };

    for fav in &favs {
        let filename = match &fav.filename {
            Some(f) => f,
            None => continue,
        };
        let src = match &fav.folder_name {
            Some(f) => std::path::Path::new(&folder).join(f).join(filename),
            None => std::path::Path::new(&folder).join(filename),
        };
        if !src.exists() { continue; }

        let dest = bg_dir.join(filename);
        if dest.exists() {
            if overwrite_existing {
                if let Err(e) = std::fs::copy(&src, &dest) {
                    eprintln!("Overwrite failed: {} -> {}: {}", src.display(), dest.display(), e);
                    continue;
                }
                result.overwritten += 1;
            } else {
                result.skipped += 1;
                result.duplicates.push(filename.clone());
            }
            continue;
        }

        if let Err(e) = std::fs::copy(&src, &dest) {
            eprintln!("Copy failed: {} -> {}: {}", src.display(), dest.display(), e);
            continue;
        }
        result.copied += 1;
    }

    Ok(result)
}

#[tauri::command]
pub fn system_get_accent_color() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu.open_subkey(r"Software\Microsoft\Windows\DWM")
            .map_err(|e| format!("Cannot open registry: {}", e))?;
        let color: u32 = key.get_value("AccentColor")
            .map_err(|e| format!("Cannot read AccentColor: {}", e))?;
        let r = (color & 0xFF) as u8;
        let g = ((color >> 8) & 0xFF) as u8;
        let b = ((color >> 16) & 0xFF) as u8;
        Ok(format!("#{:02X}{:02X}{:02X}", r, g, b))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("System accent color is only supported on Windows".to_string())
    }
}
