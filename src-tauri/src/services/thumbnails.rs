use std::fs;
use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::ImageReader;

/// Generate or retrieve a cached thumbnail for the given source image.
///
/// * `source_path` - Absolute path to the original image file.
/// * `cache_dir`   - Directory to store cached thumbnails (e.g. `<profile>/.album/cache/thumbnails`).
/// * `cache_key`   - Unique key for this thumbnail variant, e.g. `"{image_id}_{size}"`.
/// * `max_dim`     - Maximum pixel dimension (larger side). Image is never upscaled.
/// * `quality`     - JPEG quality 1-100 (75-80 recommended).
///
/// Returns `Some(cache_file_path)` on success, or `None` if the source cannot be decoded.
pub fn get_or_generate_thumbnail(
    source_path: &Path,
    cache_dir: &Path,
    cache_key: &str,
    max_dim: u32,
    quality: u8,
) -> Option<PathBuf> {
    let cache_path = cache_dir.join(format!("{}.jpg", cache_key));

    // Check for valid cached version — source mtime must be <= cache mtime
    if cache_path.exists() {
        let cache_valid = match (source_mtime(source_path), source_mtime(&cache_path)) {
            (Some(src_mt), Some(cache_mt)) => src_mt <= cache_mt,
            (_, None) => true, // cache exists but can't read mtime — trust it
            _ => false,
        };
        if cache_valid {
            return Some(cache_path);
        }
        // Cache is stale — remove it
        let _ = fs::remove_file(&cache_path);
    }

    // (a) 超大尺寸安全门 (>65535 或 0 直接跳过)
    match image::image_dimensions(source_path) {
        Ok((w, h)) if w > 65535 || h > 65535 || w == 0 || h == 0 => return None,
        _ => {}
    }

    // (b) 解码为 DynamicImage (不是 RGB8，保持灵活性)
    let img = ImageReader::open(source_path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;

    let (orig_w, orig_h) = (img.width(), img.height());

    // (c) 计算目标尺寸 (与原来完全相同的逻辑)
    let target = if orig_w <= max_dim && orig_h <= max_dim {
        (orig_w, orig_h)
    } else if orig_w >= orig_h {
        let w = max_dim;
        let h = (orig_h as u64 * max_dim as u64 / orig_w as u64) as u32;
        (w, h.max(1))
    } else {
        let h = max_dim;
        let w = (orig_w as u64 * max_dim as u64 / orig_h as u64) as u32;
        (w.max(1), h)
    };

    // (d) 使用 Triangle 滤波 (比 Lanczos3 快 5x，对缩略图质量可接受)
    // 对于超大图(>4000px)，先进行一次 nearest-neighbor 步进缩小再 Triangle
    let resized = if orig_w > 4000 || orig_h > 4000 {
        // 第一阶段: nearest-neighbor 步进缩小到 ~1600px
        let factor = 4000.0 / orig_w.max(orig_h) as f64;
        let sw = (orig_w as f64 * factor).max(target.0 as f64) as u32;
        let sh = (orig_h as f64 * factor).max(target.1 as f64) as u32;
        let step = img.resize_exact(sw, sh, image::imageops::FilterType::Nearest);
        // 第二阶段: Triangle 精确缩放到目标尺寸
        step.resize_exact(target.0, target.1, image::imageops::FilterType::Triangle)
    } else {
        img.resize_exact(target.0, target.1, image::imageops::FilterType::Triangle)
    };
    let rgb = resized.to_rgb8();

    // (e) 原子写入防损坏 (先写 .tmp 再 rename)
    fs::create_dir_all(cache_dir).ok()?;
    let mut buf = Vec::new();
    {
        let mut encoder = JpegEncoder::new_with_quality(&mut buf, quality);
        let (w, h) = (rgb.width(), rgb.height());
        encoder.encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8).ok()?;
    }
    // 原子写入: .tmp + pid 防止多线程冲突
    let tmp = cache_dir.join(format!("{}.{}.tmp", cache_key, std::process::id()));
    fs::write(&tmp, &buf).ok()?;
    fs::rename(&tmp, &cache_path).ok()?;

    Some(cache_path)
}

/// Get the modification time of a file as seconds since UNIX epoch.
/// Returns None if the file or metadata is inaccessible.
fn source_mtime(path: &Path) -> Option<f64> {
    let meta = fs::metadata(path).ok()?;
    let dur = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(dur.as_secs_f64())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    static TEST_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn make_test_image(w: u32, h: u32) -> (PathBuf, PathBuf) {
        let id = TEST_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("pa_test_thumb_{}_{}", std::process::id(), id));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.png");
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_fn(w, h, |x, y| {
            let r = (x * 255 / w.max(1)) as u8;
            let g = (y * 255 / h.max(1)) as u8;
            Rgb([r, g, 128u8])
        });
        img.save(&path).unwrap();
        (path, dir)
    }

    #[test]
    fn test_resize_larger_dimension() {
        let (src, dir) = make_test_image(1200, 800);
        let cache = dir.join("thumbnails");
        let result = get_or_generate_thumbnail(&src, &cache, "test_400", 400, 75);
        assert!(result.is_some());
        let cached = result.unwrap();
        assert!(cached.exists());
        let (w, h) = image::image_dimensions(&cached).unwrap();
        assert_eq!(w, 400);
        assert_eq!(h, 266); // 800 * 400/1200 ≈ 266
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_no_upscale() {
        let (src, dir) = make_test_image(200, 200);
        let cache = dir.join("thumbnails");
        let result = get_or_generate_thumbnail(&src, &cache, "test_noup", 400, 75);
        assert!(result.is_some());
        let (w, h) = image::image_dimensions(result.unwrap()).unwrap();
        assert_eq!(w, 200);
        assert_eq!(h, 200);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_cache_hit() {
        let (src, dir) = make_test_image(800, 600);
        let cache = dir.join("thumbnails");
        let first = get_or_generate_thumbnail(&src, &cache, "test_hit", 300, 75).unwrap();
        let first_bytes = fs::read(&first).unwrap();
        let second = get_or_generate_thumbnail(&src, &cache, "test_hit", 300, 75).unwrap();
        let second_bytes = fs::read(&second).unwrap();
        assert_eq!(first, second);
        assert_eq!(first_bytes, second_bytes);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_cache_invalidation() {
        let (src, dir) = make_test_image(800, 600);
        let cache = dir.join("thumbnails");
        let first = get_or_generate_thumbnail(&src, &cache, "test_inv", 300, 75).unwrap();
        let first_bytes = fs::read(&first).unwrap();
        // Overwrite source with different content
        let img2: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_fn(800, 600, |_, _| Rgb([0, 0, 255]));
        img2.save(&src).unwrap();
        let second = get_or_generate_thumbnail(&src, &cache, "test_inv", 300, 75).unwrap();
        let second_bytes = fs::read(&second).unwrap();
        assert_ne!(first_bytes, second_bytes, "Cache should be invalidated when source changes");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_svg_returns_none() {
        let dir = std::env::temp_dir().join(format!("pa_test_thumb_svg_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let svg_path = dir.join("test.svg");
        fs::write(&svg_path, "<svg></svg>").unwrap();
        let cache = dir.join("thumbnails");
        let result = get_or_generate_thumbnail(&svg_path, &cache, "svg_test", 400, 75);
        assert!(result.is_none(), "SVG should return None (fallback to original)");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_portrait_image() {
        let (src, dir) = make_test_image(600, 900);
        let cache = dir.join("thumbnails");
        let result = get_or_generate_thumbnail(&src, &cache, "test_port", 400, 75).unwrap();
        let (w, h) = image::image_dimensions(&result).unwrap();
        assert_eq!(h, 400);
        assert_eq!(w, 266); // 600 * 400/900 ≈ 266
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_concurrent_same_thumbnail() {
        use std::thread;

        let (src, dir) = make_test_image(1000, 1000);
        let cache = dir.join("thumbnails");

        let cache_clone = cache.clone();
        let src_clone = src.clone();
        let h1 = thread::spawn(move || {
            get_or_generate_thumbnail(&src_clone, &cache_clone, "test_conc", 300, 75)
        });

        let cache_clone2 = cache.clone();
        let src_clone2 = src.clone();
        let h2 = thread::spawn(move || {
            get_or_generate_thumbnail(&src_clone2, &cache_clone2, "test_conc", 300, 75)
        });

        let r1 = h1.join().unwrap();
        let r2 = h2.join().unwrap();
        assert!(r1.is_some());
        assert!(r2.is_some());
        assert!(r1.unwrap().exists());
        assert!(r2.unwrap().exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
