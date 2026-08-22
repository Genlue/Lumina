use std::collections::HashMap;
use std::fs;
use std::path::Path;
use crate::models::{FileInfo, ScanProgress, ScanResult};
use super::image_compat;

/// Safely extract image dimensions from a file header. Returns (None, None) on failure.
fn get_image_dimensions(path: &Path) -> (Option<u32>, Option<u32>) {
    match image::image_dimensions(path) {
        Ok((w, h)) => (Some(w), Some(h)),
        Err(_) => image_compat::dimensions(path)
            .map(|(w, h)| (Some(w), Some(h)))
            .unwrap_or((None, None)),
    }
}

fn get_scan_dimensions(path: &Path, file_size: u64) -> (Option<u32>, Option<u32>) {
    if file_size > 20_000_000 {
        // HEIF dimensions live in metadata, so probing remains cheap for large files.
        return image_compat::dimensions(path)
            .map(|(w, h)| (Some(w), Some(h)))
            .unwrap_or((None, None));
    }
    get_image_dimensions(path)
}

const IMG_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "heic", "heif", "avif",
];
const EXCLUDE_DIRS: &[&str] = &[
    ".album",
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

pub fn should_exclude(name: &str) -> bool {
    if name.starts_with('.') || name.ends_with(".html") || name.ends_with(".json") {
        return true;
    }
    EXCLUDE_DIRS.contains(&name) || name == "album.json" || name == "albums.json"
        || name == "albums.json.tmp" || name == "lumina.html"
}

/// Recursively scan a directory.
/// Returns (root_files, all_subfolder_rel_paths, album_images_by_rel_path).
fn scan_dir_recursive<F: Fn(ScanProgress)>(
    dir_path: &Path,
    relative_prefix: &str,
    progress: &F,
    total_files: &mut u32,
) -> (Vec<FileInfo>, Vec<String>, HashMap<String, Vec<FileInfo>>) {
    let mut root_files = Vec::new();
    let mut subfolders = Vec::new();
    let mut album_images = HashMap::new();

    let entries = match fs::read_dir(dir_path) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[Scanner] Cannot read {}: {}", dir_path.display(), e);
            return (root_files, subfolders, album_images);
        }
    };

    for entry in entries.flatten() {
        let entry_name = entry.file_name().to_string_lossy().to_string();
        let rel_path = if relative_prefix.is_empty() {
            entry_name.clone()
        } else {
            format!("{}/{}", relative_prefix, entry_name)
        };

        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if should_exclude(&entry_name) {
                continue;
            }
            // Record this directory as a subfolder
            subfolders.push(rel_path.clone());

            // 发射进度事件（节流：每5个目录）
            progress(ScanProgress {
                phase: "scanning".to_string(),
                current_dir: rel_path.clone(),
                files_found: *total_files,
            });

            // 1) Scan direct image files in this directory
            if let Ok(file_imgs) = scan_file_list(&entry.path()) {
                *total_files += file_imgs.len() as u32;
                if !file_imgs.is_empty() {
                    album_images.insert(rel_path.clone(), file_imgs);
                }
            }

            // 2) Recurse into child directories
            let (_child_root, child_subs, child_imgs) =
                scan_dir_recursive(&entry.path(), &rel_path, progress, total_files);
            subfolders.extend(child_subs);
            album_images.extend(child_imgs);

        } else if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if should_exclude(&entry_name) || !is_image_file(&entry_name) {
                continue;
            }
            if let Ok(meta) = fs::metadata(&entry.path()) {
                let file_size = meta.len();
                let (width, height) = get_scan_dimensions(&entry.path(), file_size);
                root_files.push(FileInfo {
                    name: entry_name,
                    size: file_size,
                    last_modified: meta.modified().ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as f64)
                        .unwrap_or(0.0),
                    width,
                    height,
                });
            }
        }
    }

    (root_files, subfolders, album_images)
}

pub fn scan_profile_folder<F: Fn(ScanProgress)>(
    _profile_id: &str,
    folder_path: &str,
    progress: &F,
) -> ScanResult {
    let path = Path::new(folder_path);
    if !path.exists() || !path.is_dir() {
        return ScanResult {
            root_images: vec![],
            album_folders: vec![],
            album_images: HashMap::new(),
        };
    }

    let mut total_files = 0u32;
    let (root_images, mut album_folders, mut album_images) =
        scan_dir_recursive(path, "", progress, &mut total_files);

    // Remove backgrounds from album_folders so it doesn't show as an album
    album_folders.retain(|f| f != ".album/backgrounds");

    // Scan backgrounds folder (retained in album_images for settings page)
    let bg_path = path.join(".album").join("backgrounds");
    if bg_path.exists() {
        if let Ok(bg_imgs) = scan_file_list(&bg_path) {
            if !bg_imgs.is_empty() {
                album_images.insert(".album/backgrounds".to_string(), bg_imgs);
            }
        }
    }

    progress(ScanProgress {
        phase: "syncing".to_string(),
        current_dir: "".to_string(),
        files_found: total_files,
    });

    ScanResult { root_images, album_folders, album_images }
}

pub fn scan_file_list(dir_path: &Path) -> Result<Vec<FileInfo>, std::io::Error> {
    let mut results: Vec<FileInfo> = vec![];
    if !dir_path.exists() { return Ok(results); }

    for entry in fs::read_dir(dir_path)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_exclude(&name) || !is_image_file(&name) { continue; }
        let meta = entry.metadata()?;
        let file_size = meta.len();
        let (width, height) = get_scan_dimensions(&entry.path(), file_size);
        results.push(FileInfo {
            name,
            size: file_size,
            last_modified: meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0),
            width,
            height,
        });
    }
    Ok(results)
}

pub fn list_all_subfolders(folder_path: &str) -> Vec<String> {
    let path = Path::new(folder_path);
    if !path.exists() {
        return vec![];
    }
    let mut total_files = 0u32;
    let (_root, folders, _images) = scan_dir_recursive(path, "", &|_: ScanProgress| {}, &mut total_files);
    folders
}

#[cfg(test)]
mod probe_tests {
    use super::*;
    use std::fs;

    /// 回归测试：确保 `.album/backgrounds` 被完整特殊处理：
    /// 1) 不出现在 album_folders（不会显示成相册）
    /// 2) 出现在 album_images（设置页可读）
    /// 3) 不混入 root_images
    /// 4) 用户自己名为 `backgrounds` 的普通文件夹应作为正常相册出现（不做全局排除）
    #[test]
    fn test_album_backgrounds_special_handling() {
        let dir = std::env::temp_dir().join(format!("lumina_scan_bg_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".album").join("backgrounds")).unwrap();
        fs::create_dir_all(dir.join("backgrounds")).unwrap();

        // `.album/backgrounds` 中的背景图
        fs::write(dir.join(".album").join("backgrounds").join("wallpaper.png"), "fake").unwrap();
        // 用户自定义的 `backgrounds` 相册（包含图片）
        fs::write(dir.join("backgrounds").join("user_album.jpg"), "fake").unwrap();

        let result = scan_profile_folder("test", &dir.to_string_lossy(), &|_| {});

        // .album/backgrounds：不是相册，但出现在 album_images（供设置页）
        assert!(
            !result.album_folders.iter().any(|f| f == ".album/backgrounds"),
            ".album/backgrounds must not appear as an album folder"
        );
        assert!(
            result.album_images.contains_key(".album/backgrounds"),
            ".album/backgrounds must be in album_images for the settings page"
        );
        assert!(result.root_images.is_empty(), "backgrounds must not leak into root_images");

        // 用户自己的 `backgrounds` 文件夹：是正常相册
        assert!(
            result.album_folders.iter().any(|f| f == "backgrounds"),
            "A user folder literally named 'backgrounds' must remain a normal album"
        );
        let bg_album = result.album_images.get("backgrounds");
        assert_eq!(bg_album.map(|v| v.len()).unwrap_or(0), 1);

        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_recursive_scan_detects_nested_images() {
        // Create a temporary test directory structure
        let dir = std::env::temp_dir().join("lumina_test_scan");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("folder1").join("sub1")).unwrap();
        fs::create_dir_all(dir.join("folder2")).unwrap();
        fs::create_dir_all(dir.join("backgrounds")).unwrap();

        // Create test image files
        fs::write(dir.join("root_img.jpg"), "fake").unwrap();
        fs::write(dir.join("folder1").join("img1.jpg"), "fake").unwrap();
        fs::write(dir.join("folder1").join("sub1").join("deep.jpg"), "fake").unwrap();
        fs::write(dir.join("folder2").join("img2.png"), "fake").unwrap();
        fs::write(dir.join("folder1").join("readme.txt"), "not image").unwrap();

        let result = scan_profile_folder("test", &dir.to_string_lossy(), &|_| {});
        println!("root_images: {:?}", result.root_images.iter().map(|f| &f.name).collect::<Vec<_>>());
        println!("album_folders: {:?}", result.album_folders);
        println!("album_images keys: {:?}", result.album_images.keys().collect::<Vec<_>>());

        // root should have root_img.jpg
        assert_eq!(result.root_images.len(), 1);
        assert_eq!(result.root_images[0].name, "root_img.jpg");

        // album_folders should contain nested paths
        assert!(result.album_folders.contains(&"folder1".to_string()), "Should contain folder1");
        assert!(result.album_folders.contains(&"folder1/sub1".to_string()), "Should contain folder1/sub1");
        assert!(result.album_folders.contains(&"folder2".to_string()), "Should contain folder2");

        // album_images should contain subfolder images
        assert!(result.album_images.contains_key("folder1"), "folder1 should have images");
        assert!(result.album_images.contains_key("folder1/sub1"), "folder1/sub1 should have images");
        assert!(result.album_images.contains_key("folder2"), "folder2 should have images");

        // Verify specific images
        let folder1_imgs = result.album_images.get("folder1").unwrap();
        assert_eq!(folder1_imgs.len(), 1);
        assert_eq!(folder1_imgs[0].name, "img1.jpg");

        let sub1_imgs = result.album_images.get("folder1/sub1").unwrap();
        assert_eq!(sub1_imgs.len(), 1);
        assert_eq!(sub1_imgs[0].name, "deep.jpg");

        // 用户自定义目录 `backgrounds` 是普通相册（仅 .album/backgrounds 是特殊目录）
        assert!(result.album_folders.contains(&"backgrounds".to_string()), "backgrounds should be a normal album folder");

        // Cleanup
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requires local dir"]
    fn test_scan_desktop_folder1() {
        let dir = r"C:\Users\Administrator\Desktop\1";
        println!("\n========== SCANNING DESKTOP FOLDER ==========");
        println!("Path: {}", dir);

        let result = scan_profile_folder("test", dir, &|_| {});

        println!("\n--- root_images ---");
        for img in &result.root_images {
            println!("  {}", img.name);
        }

        println!("\n--- album_folders ({} total) ---", result.album_folders.len());
        for f in &result.album_folders {
            let imgs = result.album_images.get(f).map(|v| v.len()).unwrap_or(0);
            println!("  [{}] {} ({} images)", if f.contains('/') { "sub" } else { "top" }, f, imgs);
        }

        println!("\n--- album_images detail ---");
        let mut keys: Vec<&String> = result.album_images.keys().collect();
        keys.sort();
        for k in &keys {
            let imgs = &result.album_images[*k];
            print!("  {}: [", k);
            for (i, img) in imgs.iter().enumerate() {
                if i > 0 { print!(", "); }
                print!("{}", img.name);
            }
            println!("]");
        }

        println!("\n========== STRUCTURE VALIDATION ==========");

        // Validate: every album_folder should either have images OR have sub-albums
        for f in &result.album_folders {
            let has_own_images = result.album_images.contains_key(f);
            let has_children = result.album_folders.iter()
                .any(|cf| cf.starts_with(&format!("{}/", f)));
            if !has_own_images && !has_children {
                println!("  ⚠️  Empty folder (no images, no children): {}", f);
            } else {
                let img_count = result.album_images.get(f).map(|v| v.len()).unwrap_or(0);
                println!("  ✅ {}: {} images, hasChildren={}", f, img_count, has_children);
            }
        }

        // Validate: nested path format consistency
        for f in &result.album_folders {
            assert!(!f.starts_with('/'), "folder should not start with /: {}", f);
            assert!(!f.ends_with('/'), "folder should not end with /: {}", f);
            assert!(!f.contains('\\'), "folder should use / not \\: {}", f);
        }

        // Verify we found the deep folders
        assert!(result.album_folders.contains(&"2/艾莉".to_string()), "Should find 2/艾莉");
        assert!(result.album_folders.contains(&"3/大昔涟".to_string()), "Should find 3/大昔涟");
        assert!(result.album_folders.contains(&"浮波柚叶".to_string()), "Should find 浮波柚叶");

        // Verify we found deep images
        let alil = result.album_images.get("2/艾莉");
        assert!(alil.is_some(), "2/艾莉 should have images");
        assert_eq!(alil.unwrap().len(), 1, "2/艾莉 should have 1 image");

        let daxilian = result.album_images.get("3/大昔涟");
        assert!(daxilian.is_some(), "3/大昔涟 should have images");
        assert_eq!(daxilian.unwrap().len(), 4, "3/大昔涟 should have 4 images");

        println!("\n✅ ALL VALIDATIONS PASSED");
    }

    #[test]
    fn test_get_child_albums_logic() {
        let folders = vec![
            "vacation".to_string(),
            "vacation/beach".to_string(),
            "vacation/beach/rocks".to_string(),
            "work".to_string(),
        ];

        // Simulate the frontend getChildAlbums logic
        let root: Vec<&String> = folders.iter().filter(|f| !f.contains('/')).collect();
        assert_eq!(root.len(), 2);
        assert!(root.contains(&&"vacation".to_string()));

        let prefix = "vacation/";
        let vacation_children: Vec<&String> = folders.iter()
            .filter(|f| f.starts_with(prefix) && f[prefix.len()..].find('/').is_none())
            .collect();
        assert_eq!(vacation_children.len(), 1);
        assert_eq!(vacation_children[0], "vacation/beach");
    }
}
