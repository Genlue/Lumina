use std::fs;
use std::path::{Path, PathBuf};

use std::io::BufReader;
use image::codecs::jpeg::JpegEncoder;
use image::ImageReader;
use image::DynamicImage;
// jpeg_decoder 用于超大 JPEG 的 IDCT 缩放解码
use jpeg_decoder as jd;

/// Generate or retrieve a cached thumbnail for the given source image.
///
/// * `source_path` - Absolute path to the original image file.
/// * `cache_dir`   - Directory to store cached thumbnails (e.g. `<profile>/.album/cache/thumbnails`).
/// * `cache_key`   - Unique key for this thumbnail variant, e.g. `"{file_hash}_{max_dim}"`.
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

    // 快速读取文件头获取尺寸
    let (orig_w, orig_h) = image::image_dimensions(source_path).ok()?;
    if orig_w > 65535 || orig_h > 65535 || orig_w == 0 || orig_h == 0 {
        return None;
    }

    // 计算目标尺寸（与原来相同）
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

    // 判断解码策略
    let pixel_count = (orig_w as u64) * (orig_h as u64);
    let is_jpeg = is_jpeg_file(source_path);

    // 解码为 DynamicImage
    let img = if pixel_count > 30_000_000 && is_jpeg {
        // ★ 超大 JPEG：使用 jpeg-decoder 的 IDCT 缩放解码，不解全图
        // 16000x12000 → 2000x1500 (1/8 IDCT scale)，内存从 576MB→9MB
        decode_jpeg_scaled(source_path, target.0, target.1)?
    } else if pixel_count > 30_000_000 {
        // ★ 超大非 JPEG（PNG 等）：无法缩放解码，跳过缩略图
        return None;
    } else {
        // 正常尺寸：用 image crate 全解码
        let reader = ImageReader::open(source_path)
            .ok()?
            .with_guessed_format()
            .ok()?;

        // 保留 v2.4.2 的两级缩放优化：>4000px 先 Nearest 缩小再 Triangle
        if orig_w > 4000 || orig_h > 4000 {
            let factor = 4000.0 / orig_w.max(orig_h) as f64;
            let sw = (orig_w as f64 * factor).max(target.0 as f64) as u32;
            let sh = (orig_h as f64 * factor).max(target.1 as f64) as u32;
            let step = reader.decode().ok()?
                .resize_exact(sw, sh, image::imageops::FilterType::Nearest);
            step.resize_exact(target.0, target.1, image::imageops::FilterType::Triangle)
        } else {
            let decoded = reader.decode().ok()?;
            if decoded.width() != target.0 || decoded.height() != target.1 {
                decoded.resize_exact(target.0, target.1, image::imageops::FilterType::Triangle)
            } else {
                decoded
            }
        }
    };

    // 转换为 RGB8 用于 JPEG 编码
    let rgb = img.to_rgb8();

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

/// Check if the file is a JPEG by extension.
fn is_jpeg_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_lowercase().as_str(), "jpg" | "jpeg"))
        .unwrap_or(false)
}

/// 使用 jpeg-decoder 的 IDCT 缩放解码超大 JPEG。
/// 不解全图，直接解码为接近缩略图尺寸的小图，内存和速度都大幅优化。
fn decode_jpeg_scaled(source_path: &Path, target_w: u32, target_h: u32) -> Option<DynamicImage> {
    let file = fs::File::open(source_path).ok()?;
    let mut decoder = jd::Decoder::new(BufReader::new(file));
    // 设置 IDCT 缩放目标尺寸（实际输出取最近的 1/n 因子）
    decoder.scale(target_w as u16, target_h as u16).ok()?;
    let pixels = decoder.decode().ok()?;
    let info = decoder.info()?;
    let (w, h) = (info.width as u32, info.height as u32);
    if pixels.len() < (w as usize).saturating_mul(h as usize).saturating_mul(3) {
        return None;
    }
    let buf = image::ImageBuffer::from_raw(w, h, pixels)?;
    Some(DynamicImage::ImageRgb8(buf))
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
