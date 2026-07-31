//! Compatibility helpers for image containers that `image` cannot decode.
//!
//! HEIF/HEIC files are decoded with the bundled libheif command on Windows and
//! converted to JPEG before being passed to the renderer.

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// Read dimensions from the container without decoding all image pixels.
pub fn dimensions(path: &Path) -> Option<(u32, u32)> {
    // Content sniffing handles files whose extension does not match their bytes.
    image::ImageReader::open(path)
        .ok()
        .and_then(|reader| reader.with_guessed_format().ok())
        .and_then(|reader| reader.into_dimensions().ok())
        .or_else(|| parse_heif_dimensions(path).ok())
}

fn parse_heif_dimensions(path: &Path) -> io::Result<(u32, u32)> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);

    let (ftyp_size, ftyp_type, ftyp_header) = read_box_header(&mut reader)?;
    if &ftyp_type != b"ftyp" {
        return Err(invalid_data("missing ftyp box"));
    }

    let ftyp_payload_len = ftyp_size
        .checked_sub(ftyp_header)
        .ok_or_else(|| invalid_data("invalid ftyp size"))?;
    if !has_heif_brand(&mut reader, ftyp_payload_len)? {
        return Err(invalid_data("unsupported ftyp brand"));
    }
    reader.seek(SeekFrom::Start(ftyp_size))?;

    let meta = find_box(&mut reader, b"meta", None)?;
    let meta_end = meta
        .0
        .checked_add(meta.1)
        .ok_or_else(|| invalid_data("meta box overflow"))?;

    // FullBox version and flags precede the child boxes inside `meta`.
    reader.seek(SeekFrom::Start(meta.0 + meta.2))?;
    let mut version_flags = [0u8; 4];
    reader.read_exact(&mut version_flags)?;
    let iprp = find_box(&mut reader, b"iprp", Some(meta_end))?;
    let iprp_end = iprp
        .0
        .checked_add(iprp.1)
        .ok_or_else(|| invalid_data("iprp box overflow"))?;

    reader.seek(SeekFrom::Start(iprp.0 + iprp.2))?;
    let ipco = find_box(&mut reader, b"ipco", Some(iprp_end))?;
    let ipco_end = ipco
        .0
        .checked_add(ipco.1)
        .ok_or_else(|| invalid_data("ipco box overflow"))?;

    reader.seek(SeekFrom::Start(ipco.0 + ipco.2))?;
    let mut width = 0u32;
    let mut height = 0u32;
    let mut rotation = 0u8;

    while reader.stream_position()? < ipco_end {
        let (box_size, box_type, box_header) = read_box_header(&mut reader)?;
        let box_start = reader.stream_position()?.saturating_sub(box_header);
        let box_end = box_start
            .checked_add(box_size)
            .ok_or_else(|| invalid_data("property box overflow"))?;
        if box_end > ipco_end || box_size < box_header {
            return Err(invalid_data("invalid property box"));
        }

        match &box_type {
            b"ispe" if box_size >= box_header + 12 => {
                let mut fields = [0u8; 12];
                reader.read_exact(&mut fields)?;
                let candidate_width = u32::from_be_bytes(fields[4..8].try_into().unwrap());
                let candidate_height = u32::from_be_bytes(fields[8..12].try_into().unwrap());
                if (candidate_width as u64) * (candidate_height as u64)
                    > (width as u64) * (height as u64)
                {
                    width = candidate_width;
                    height = candidate_height;
                }
            }
            b"irot" if box_size > box_header => {
                let mut value = [0u8; 1];
                reader.read_exact(&mut value)?;
                rotation = value[0];
            }
            _ => {}
        }

        reader.seek(SeekFrom::Start(box_end))?;
    }

    if width == 0 || height == 0 {
        return Err(invalid_data("missing image dimensions"));
    }
    if rotation == 1 || rotation == 3 {
        std::mem::swap(&mut width, &mut height);
    }
    Ok((width, height))
}

fn invalid_data(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn read_box_header<R: Read + Seek>(reader: &mut R) -> io::Result<(u64, [u8; 4], u64)> {
    let mut size_bytes = [0u8; 4];
    let mut box_type = [0u8; 4];
    reader.read_exact(&mut size_bytes)?;
    reader.read_exact(&mut box_type)?;

    let size = u32::from_be_bytes(size_bytes);
    if size == 1 {
        let mut extended_size = [0u8; 8];
        reader.read_exact(&mut extended_size)?;
        Ok((u64::from_be_bytes(extended_size), box_type, 16))
    } else if size == 0 {
        let start = reader.stream_position()?.saturating_sub(8);
        let end = reader.seek(SeekFrom::End(0))?;
        reader.seek(SeekFrom::Start(start + 8))?;
        Ok((end - start, box_type, 8))
    } else {
        Ok((size as u64, box_type, 8))
    }
}

fn has_heif_brand<R: Read + Seek>(reader: &mut R, payload_len: u64) -> io::Result<bool> {
    if payload_len < 8 {
        return Ok(false);
    }

    let mut payload = vec![0u8; payload_len.min(1024) as usize];
    reader.read_exact(&mut payload)?;
    let major_brand = &payload[0..4];
    let mut compatible_brands = payload[8..].chunks_exact(4);
    Ok(is_heif_brand(major_brand) || compatible_brands.any(is_heif_brand))
}

fn is_heif_brand(brand: &[u8]) -> bool {
    matches!(
        brand,
        b"heic"
            | b"heix"
            | b"heis"
            | b"hevs"
            | b"heim"
            | b"hevm"
            | b"hevc"
            | b"hevx"
            | b"mif1"
            | b"msf1"
            | b"mif2"
            | b"miaf"
            | b"avif"
            | b"avio"
            | b"avis"
            | b"MA1A"
            | b"MA1B"
    )
}

fn find_box<R: Read + Seek>(
    reader: &mut R,
    wanted: &[u8; 4],
    boundary: Option<u64>,
) -> io::Result<(u64, u64, u64)> {
    loop {
        let start = reader.stream_position()?;
        let (size, box_type, header) = read_box_header(reader)?;
        let end = start
            .checked_add(size)
            .ok_or_else(|| invalid_data("box overflow"))?;
        if size < header || boundary.map(|limit| end > limit).unwrap_or(false) {
            return Err(invalid_data("invalid box boundary"));
        }
        if &box_type == wanted {
            return Ok((start, size, header));
        }
        reader.seek(SeekFrom::Start(end))?;
    }
}

#[cfg(target_os = "windows")]
mod bundled_heif {
    use super::{dimensions, Path};
    use image::DynamicImage;
    use jpeg_decoder as jd;
    use std::fs;
    use std::io::BufReader;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::os::windows::process::CommandExt;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    fn helper_path() -> Option<PathBuf> {
        let mut candidates = Vec::new();

        if let Ok(custom) = std::env::var("LUMINA_HEIF_HELPER") {
            candidates.push(PathBuf::from(custom));
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                candidates.push(
                    parent
                        .join("resources")
                        .join("libheif")
                        .join("heif-convert.exe"),
                );
                candidates.push(parent.join("libheif").join("heif-convert.exe"));
            }
        }

        // This path is useful for local development before the Tauri bundle exists.
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("libheif")
                .join("heif-convert.exe"),
        );

        candidates.into_iter().find(|path| path.is_file())
    }

    fn decode_jpeg_scaled(
        path: &Path,
        target_width: u32,
        target_height: u32,
    ) -> Option<DynamicImage> {
        let file = fs::File::open(path).ok()?;
        let mut decoder = jd::Decoder::new(BufReader::new(file));
        decoder
            .scale(target_width as u16, target_height as u16)
            .ok()?;
        let pixels = decoder.decode().ok()?;
        let info = decoder.info()?;
        let width = info.width as u32;
        let height = info.height as u32;
        if pixels.len()
            < (width as usize)
                .checked_mul(height as usize)?
                .checked_mul(3)?
        {
            return None;
        }
        let buffer = image::ImageBuffer::from_raw(width, height, pixels)?;
        Some(DynamicImage::ImageRgb8(buffer))
    }

    fn convert_to_jpeg(source_path: &Path) -> Option<PathBuf> {
        let helper = helper_path()?;
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let output = std::env::temp_dir().join(format!(
            "lumina-heif-{}-{}.jpg",
            std::process::id(),
            counter
        ));

        let mut command = Command::new(&helper);
        command
            .arg("--quiet")
            .arg(source_path)
            .arg(&output)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // Keep the bundled console helper completely hidden during conversion.
        command.creation_flags(CREATE_NO_WINDOW);
        if let Some(parent) = helper.parent() {
            command.current_dir(parent);
        }

        let status = command.status().ok()?;
        if !status.success() || !output.is_file() {
            let _ = fs::remove_file(&output);
            return None;
        }
        Some(output)
    }

    pub fn decode_scaled(
        path: &Path,
        requested_width: u32,
        requested_height: u32,
    ) -> Option<DynamicImage> {
        let (source_width, source_height) = dimensions(path)?;
        let (target_width, target_height) = match (requested_width, requested_height) {
            (0, 0) => (source_width, source_height),
            (0, height) => {
                let width = (source_width as u64 * height as u64 / source_height as u64)
                    .max(1) as u32;
                (width.min(source_width), height.min(source_height).max(1))
            }
            (width, 0) => {
                let height = (source_height as u64 * width as u64 / source_width as u64)
                    .max(1) as u32;
                (width.min(source_width).max(1), height.min(source_height))
            }
            (width, height) => {
                let scale_x = width as f64 / source_width as f64;
                let scale_y = height as f64 / source_height as f64;
                let scale = scale_x.min(scale_y).min(1.0);
                (
                    (source_width as f64 * scale).round().max(1.0) as u32,
                    (source_height as f64 * scale).round().max(1.0) as u32,
                )
            }
        };

        let converted = convert_to_jpeg(path)?;
        let decoded = decode_jpeg_scaled(&converted, target_width, target_height)
            .or_else(|| image::open(&converted).ok())
            .map(|image| {
                if image.width() != target_width || image.height() != target_height {
                    image.resize_exact(
                        target_width,
                        target_height,
                        image::imageops::FilterType::Triangle,
                    )
                } else {
                    image
                }
            });
        let _ = std::fs::remove_file(converted);
        decoded
    }
}

#[cfg(target_os = "windows")]
pub use bundled_heif::decode_scaled;

#[cfg(not(target_os = "windows"))]
pub fn decode_scaled(
    _path: &Path,
    _requested_width: u32,
    _requested_height: u32,
) -> Option<image::DynamicImage> {
    None
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn test_bundled_decoder_reads_configured_image() {
        let Some(path) = std::env::var_os("LUMINA_HEIF_TEST_IMAGE") else {
            return;
        };
        let path = Path::new(&path);
        let (width, height) = dimensions(path).expect("HEIF header should contain dimensions");
        assert!(width > 0 && height > 0);

        let decoded = decode_scaled(path, 400, 400).expect("bundled decoder should decode HEIF");
        assert!(decoded.width() > 0 && decoded.height() > 0);
        assert!(decoded.width() <= 400 && decoded.height() <= 400);
    }

    #[test]
    fn test_dimensions_ignore_file_extension() {
        let Some(path) = std::env::var_os("LUMINA_DIMENSIONS_TEST_IMAGE") else {
            return;
        };
        let (width, height) = dimensions(Path::new(&path))
            .expect("content sniffing should read image dimensions");
        assert!(width > 0 && height > 0);
    }
}
