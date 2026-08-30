use std::fs;
use std::path::{Path, PathBuf};

use std::io::BufReader;
use image::codecs::jpeg::JpegEncoder;
use image::ImageReader;
use image::DynamicImage;
// jpeg_decoder 用于超大 JPEG 的 IDCT 缩放解码
use jpeg_decoder as jd;
use super::image_compat;

// ============================================================
// 全局生成并发上限（限速）
// ============================================================
//
// 清空缓存后集中浏览会瞬间触发大量解码（每张图一个 spawn_blocking），
// CPU / 内存同时被打满，整机卡顿。这里用一个进程级信号量限制
// “实际生成”（解码 + 缩放 + 编码）的并发数：
//   - 所有路径共用同一个槽池：单张按需生成、批量生成、HEIF 兼容转换、预生成任务；
//   - 命中缓存的路径不占槽（在 acquire 之前已提前 return）；
//   - 超过上限的请求排队等待，而非无限并发。
// 上限取“逻辑核数的 3/4”，并保证至少留 2 个核给系统与其他任务，
// 同时封顶 8，避免高核数机器上内存峰值过大。

/// 生成并发上限：max(2, min(逻辑核数 * 3/4, 8))，即“较高的上限，超过就限速”。
pub fn generation_cap() -> usize {
    let n = std::thread::available_parallelism()
        .map(|v| v.get())
        .unwrap_or(4);
    ((n * 3) / 4).clamp(2, 8)
}

struct GenSlots {
    cap: usize,
    active: std::sync::Mutex<usize>,
    cv: std::sync::Condvar,
}

static GEN_SLOTS: std::sync::OnceLock<GenSlots> = std::sync::OnceLock::new();

fn gen_slots() -> &'static GenSlots {
    GEN_SLOTS.get_or_init(|| GenSlots {
        cap: generation_cap(),
        active: std::sync::Mutex::new(0),
        cv: std::sync::Condvar::new(),
    })
}

/// 持有生成槽的守卫；Drop 时自动归还并唤醒排队者。
pub struct GenerationGuard {
    _priv: (),
}

impl Drop for GenerationGuard {
    fn drop(&mut self) {
        let s = gen_slots();
        if let Ok(mut active) = s.active.lock() {
            *active = active.saturating_sub(1);
        }
        s.cv.notify_one();
    }
}

/// 申请一个生成槽；达到上限时阻塞排队，返回守卫即代表占用（Drop 释放）。
pub fn acquire_generation_slot() -> GenerationGuard {
    let s = gen_slots();
    let mut active = s.active.lock().unwrap_or_else(|e| e.into_inner());
    while *active >= s.cap {
        active = s.cv.wait(active).unwrap_or_else(|e| e.into_inner());
    }
    *active += 1;
    GenerationGuard { _priv: () }
}

// ============================================================
// 缓存键与清理工具（供 commands 层复用）
// ============================================================

/// 缓存键里源路径使用的非加密哈希（与历史键保持算法一致）。
pub fn simple_hash(s: &str) -> u64 {
    let mut h: u64 = 5381;
    for b in s.bytes() {
        h = h.wrapping_mul(33).wrapping_add(b as u64);
    }
    h
}

/// 从缓存文件名 `{hash}_{size}_v2.jpg` 中解析出源路径哈希。
/// 解析失败（命名不符合约定）返回 None，调用方应保守保留该文件。
pub fn parse_cache_source_hash(file_name: &str) -> Option<u64> {
    let (hash_part, rest) = file_name.split_once('_')?;
    if hash_part.is_empty() || hash_part.len() > 16 || rest.is_empty() {
        return None;
    }
    if !hash_part.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u64::from_str_radix(hash_part, 16).ok()
}

/// 删除某个源文件对应的全部缩略图缓存（所有尺寸变体 + 残留 .tmp）。
/// 返回删除数量。`source_path_str` 必须是与生成缓存键完全一致的路径字符串。
pub fn purge_cache_for_source(cache_dir: &Path, source_path_str: &str) -> u32 {
    let prefix = format!("{:x}_", simple_hash(source_path_str));
    let mut removed = 0u32;
    if let Ok(entries) = fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) {
                if fs::remove_file(entry.path()).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    removed
}

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

    // 真正需要解码生成了，才开始排队占全局生成槽（命中缓存不会走到这里）。
    // 守卫在函数结束时 Drop，自动归还槽位。
    let _slot = acquire_generation_slot();

    // Fast header read for native formats, followed by Windows WIC for HEIF/HEIC.
    let (orig_w, orig_h) = match image::image_dimensions(source_path) {
        Ok(dimensions) => dimensions,
        Err(_) => image_compat::dimensions(source_path)?,
    };
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

    let img = decode_thumbnail_with_fallback(source_path, orig_w, orig_h, target)?;

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

/// Decode a thumbnail using the existing fast paths, then fall back to the
/// the bundled libheif helper for formats such as HEIF/HEIC.
fn decode_thumbnail_with_fallback(
    source_path: &Path,
    orig_w: u32,
    orig_h: u32,
    target: (u32, u32),
) -> Option<DynamicImage> {
    let pixel_count = (orig_w as u64) * (orig_h as u64);
    let is_jpeg = is_jpeg_file(source_path);

    let decoded = if pixel_count > 30_000_000 && is_jpeg {
        // Large JPEGs use decoder-level IDCT scaling to avoid full-resolution allocation.
        decode_jpeg_scaled(source_path, target.0, target.1)
    } else if pixel_count > 100_000_000 {
        // Keep the existing OOM guard for very large non-JPEG files.
        None
    } else {
        decode_with_image_crate(source_path, orig_w, orig_h, target)
    };

    decoded.or_else(|| image_compat::decode_scaled(source_path, target.0, target.1))
}

fn decode_with_image_crate(
    source_path: &Path,
    orig_w: u32,
    orig_h: u32,
    target: (u32, u32),
) -> Option<DynamicImage> {
    let reader = ImageReader::open(source_path)
        .ok()?
        .with_guessed_format()
        .ok()?;

    // Keep the two-stage resize optimization for large native images.
    if orig_w > 4000 || orig_h > 4000 {
        let factor = 4000.0 / orig_w.max(orig_h) as f64;
        let sw = (orig_w as f64 * factor).max(target.0 as f64) as u32;
        let sh = (orig_h as f64 * factor).max(target.1 as f64) as u32;
        let step = reader
            .decode()
            .ok()?
            .resize_exact(sw, sh, image::imageops::FilterType::Nearest);
        Some(step.resize_exact(
            target.0,
            target.1,
            image::imageops::FilterType::Triangle,
        ))
    } else {
        let decoded = reader.decode().ok()?;
        Some(if decoded.width() != target.0 || decoded.height() != target.1 {
            decoded.resize_exact(target.0, target.1, image::imageops::FilterType::Triangle)
        } else {
            decoded
        })
    }
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
    fn test_generation_cap_bounds() {
        let cap = generation_cap();
        assert!(cap >= 2, "cap 至少要允许 2 个并发");
        assert!(cap <= 8, "cap 必须封顶，防止内存峰值失控");
    }

    #[test]
    fn test_generation_slot_acquire_release() {
        // 连续申请 cap 个再释放，若 Drop 未归还槽位，后续申请会永久阻塞（测试超时即失败）
        let cap = generation_cap();
        let guards: Vec<GenerationGuard> = (0..cap).map(|_| acquire_generation_slot()).collect();
        assert!(guards.len() == cap);
        drop(guards);
        let g2 = acquire_generation_slot();
        drop(g2);
    }

    #[test]
    fn test_parse_cache_source_hash() {
        let h = simple_hash("C:\\pics\\a.jpg");
        let name = format!("{:x}_400_v2.jpg", h);
        assert_eq!(parse_cache_source_hash(&name), Some(h));
        assert_eq!(parse_cache_source_hash(&format!("{:x}_full_compat_v3.jpg", h)), Some(h));
        // 非法命名一律返回 None（调用方保守保留）
        assert_eq!(parse_cache_source_hash("notahex_400_v2.jpg"), None);
        assert_eq!(parse_cache_source_hash("abc.jpg"), None);
        assert_eq!(parse_cache_source_hash("_400_v2.jpg"), None);
    }

    #[test]
    fn test_purge_cache_for_source() {
        let dir = std::env::temp_dir().join(format!("pa_test_purge_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let src = "C:\\fake\\purge-me.jpg";
        let h = simple_hash(src);
        fs::write(dir.join(format!("{:x}_400_v2.jpg", h)), b"x").unwrap();
        fs::write(dir.join(format!("{:x}_500_v2.jpg", h)), b"x").unwrap();
        fs::write(dir.join(format!("{:x}_400_v2.1234.tmp", h)), b"x").unwrap();
        fs::write(dir.join("ffffffff_400_v2.jpg"), b"x").unwrap(); // 其他文件不受影响
        let removed = purge_cache_for_source(&dir, src);
        assert_eq!(removed, 3);
        assert!(dir.join("ffffffff_400_v2.jpg").exists());
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
