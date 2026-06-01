use std::collections::HashMap;
use std::fs;
use std::path::Path;
use crate::models::{FileInfo, ScanResult};

const IMG_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
const EXCLUDE_DIRS: &[&str] = &[
    ".album-trash", "_trash", "_config", "_data", "backgrounds",
    ".git", "node_modules", ".reasonix", ".vscode", ".idea",
    "__pycache__", ".cache", "AppData",
];

pub fn is_image_file(filename: &str) -> bool {
    if let Some(ext) = Path::new(filename).extension() {
        IMG_EXTS.contains(&ext.to_str().unwrap_or("").to_lowercase().as_str())
    } else {
        false
    }
}

fn should_exclude(name: &str) -> bool {
    if name.starts_with('.') || name.ends_with(".html") || name.ends_with(".json") {
        return true;
    }
    EXCLUDE_DIRS.contains(&name) || name == "album.json" || name == "albums.json"
        || name == "albums.json.tmp" || name == "photo-album.html"
}

pub fn scan_profile_folder(_profile_id: &str, folder_path: &str) -> ScanResult {
    let mut root_images: Vec<FileInfo> = vec![];
    let mut album_folders: Vec<String> = vec![];
    let mut album_images: HashMap<String, Vec<FileInfo>> = HashMap::new();

    let path = Path::new(folder_path);
    if !path.exists() || !path.is_dir() {
        return ScanResult { root_images, album_folders, album_images };
    }

    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[Scanner] Cannot read directory {}: {}", folder_path, e);
            return ScanResult { root_images, album_folders, album_images };
        }
    };

    let mut entry_count = 0u32;
    const MAX_ENTRIES: u32 = 2000;

    for entry in entries.flatten() {
        if entry_count > MAX_ENTRIES { break; }
        entry_count += 1;

        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path();

        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if should_exclude(&name) { continue; }
            album_folders.push(name.clone());
            if let Ok(imgs) = scan_file_list(&full_path) {
                if !imgs.is_empty() {
                    album_images.insert(name, imgs);
                }
            }
        } else if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if !should_exclude(&name) && is_image_file(&name) {
                if let Ok(meta) = fs::metadata(&full_path) {
                    root_images.push(FileInfo {
                        name,
                        size: meta.len(),
                        last_modified: meta.modified().ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as f64)
                            .unwrap_or(0.0),
                    });
                }
            }
        }
    }

    // Scan backgrounds folder (not shown as album)
    let bg_path = path.join("backgrounds");
    if bg_path.exists() {
        if let Ok(bg_imgs) = scan_file_list(&bg_path) {
            if !bg_imgs.is_empty() {
                album_images.insert("backgrounds".to_string(), bg_imgs);
            }
        }
    }

    ScanResult { root_images, album_folders, album_images }
}

fn scan_file_list(dir_path: &Path) -> Result<Vec<FileInfo>, std::io::Error> {
    let mut results: Vec<FileInfo> = vec![];
    if !dir_path.exists() { return Ok(results); }

    for entry in fs::read_dir(dir_path)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_exclude(&name) || !is_image_file(&name) { continue; }
        let meta = entry.metadata()?;
        results.push(FileInfo {
            name,
            size: meta.len(),
            last_modified: meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0),
        });
    }
    Ok(results)
}

pub fn list_all_subfolders(folder_path: &str) -> Vec<String> {
    let mut results: Vec<String> = vec![];
    let path = Path::new(folder_path);
    if !path.exists() { return results; }

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
            let name = entry.file_name().to_string_lossy().to_string();
            if should_exclude(&name) { continue; }

            results.push(name.clone());

            // Recursive one level deep
            if let Ok(sub_entries) = fs::read_dir(entry.path()) {
                for sub in sub_entries.flatten() {
                    if !sub.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
                    let sub_name = sub.file_name().to_string_lossy().to_string();
                    if should_exclude(&sub_name) { continue; }
                    results.push(format!("{}/{}", name, sub_name));
                }
            }
        }
    }
    results
}
