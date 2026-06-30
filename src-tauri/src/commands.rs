use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::db;
use crate::db::DbState;
use crate::models::*;
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

    // Look up image DB id for cache key
    let cache_key = {
        let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
        let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
        let album_id = folder
            .as_deref()
            .and_then(|f| repos::albums::get_album_by_folder(&p_conn, &profile_id, f))
            .map(|a| a.id);
        repos::images::get_image_by_name(&p_conn, &profile_id, &filename, album_id)
            .map(|img| format!("{}_{}", img.id, max_dim))
            .unwrap_or_else(|| {
                // Fallback: hash the canonical path for images not yet in DB
                format!("{:x}_{}", simple_hash(&file_path.to_string_lossy()), max_dim)
            })
    };

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
        if let Ok(entries) = fs::read_dir(&full_path) {
            for entry in entries.flatten() {
                let dest = Path::new(&root).join(entry.file_name());
                fs::rename(entry.path(), &dest).ok();
            }
        }
    }

    fs::remove_dir_all(&full_path).map_err(|e| format!("Delete error: {}", e))?;

    let (p_conn_arc, _) = get_profile_db(&app, &profile_id)?;
    let p_conn = p_conn_arc.lock().map_err(|e| format!("Profile DB lock: {}", e))?;
    // Delete this album and all sub-albums (cascade)
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

    let img = repos::images::get_image_by_name(&p_conn, &profile_id, &filename, album_id)
        .ok_or_else(|| format!("Image not found: {}", filename))?;

    Ok(repos::favorites::toggle_favorite(&p_conn, &profile_id, img.id, &img.filename, img.album_id))
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
