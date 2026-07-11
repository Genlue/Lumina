use std::collections::HashMap;
use crate::models::ThemeColors;

/// Extract dominant accent color from an image file using proper image decoding.
/// Samples ~2500 pixels (50×50 grid), filters by vividness, returns top 5 by score.
pub fn extract_theme_colors(image_path: &str) -> ThemeColors {
    match image::open(image_path) {
        Ok(img) => {
            let rgba = img.to_rgba8();
            let colors = sample_pixels(&rgba);
            if !colors.is_empty() && colors[0] != "#000000" {
                ThemeColors {
                    dominant: colors[0].clone(),
                    palette: colors.into_iter().take(5).collect(),
                }
            } else {
                ThemeColors {
                    dominant: "#60CDFF".to_string(),
                    palette: vec!["#60CDFF".to_string()],
                }
            }
        }
        Err(e) => {
            eprintln!("[Theme] Failed to open {}: {}", image_path, e);
            ThemeColors {
                dominant: "#60CDFF".to_string(),
                palette: vec!["#60CDFF".to_string()],
            }
        }
    }
}

/// Sample pixels from decoded RGBA image on a 50×50 grid (~2,500 samples).
/// Filters by alpha, brightness, and saturation. Quantizes to buckets of 8.
/// Scores by saturation × count, returns top colours sorted by score.
fn sample_pixels(rgba: &image::RgbaImage) -> Vec<String> {
    let (w, h) = rgba.dimensions();
    if w == 0 || h == 0 {
        return vec![];
    }

    // Target ~50 samples per dimension → ~2,500 total
    let step_x = (w / 50).max(1) as usize;
    let step_y = (h / 50).max(1) as usize;

    let mut color_map: HashMap<(u8, u8, u8), u32> = HashMap::new();

    for y in (0..h as usize).step_by(step_y) {
        for x in (0..w as usize).step_by(step_x) {
            let p = rgba.get_pixel(x as u32, y as u32);
            let r = p[0];
            let g = p[1];
            let b = p[2];
            let a = p[3];

            if a < 128 {
                continue;
            }
            let max_c = r.max(g).max(b);
            let min_c = r.min(g).min(b);
            let bright = (r as u32 + g as u32 + b as u32) / 3;
            if bright < 25 || bright > 230 {
                continue;
            }
            let sat = if max_c == 0 {
                0.0
            } else {
                (max_c - min_c) as f64 / max_c as f64
            };
            if sat < 0.2 {
                continue;
            }

            // Quantize to buckets of 8
            let qr = (r / 8) * 8;
            let qg = (g / 8) * 8;
            let qb = (b / 8) * 8;
            *color_map.entry((qr, qg, qb)).or_insert(0) += 1;
        }
    }

    let mut scored: Vec<_> = color_map
        .into_iter()
        .map(|((r, g, b), count)| {
            let max_c = r.max(g).max(b);
            let min_c = r.min(g).min(b);
            let sat = if max_c == 0 {
                0.0
            } else {
                (max_c - min_c) as f64 / max_c as f64
            };
            (sat * count as f64, r, g, b)
        })
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    scored
        .into_iter()
        .take(5)
        .map(|(_, r, g, b)| rgb_to_hex(r, g, b))
        .collect()
}

fn rgb_to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{:02X}{:02X}{:02X}", r, g, b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a synthetic 200×200 PNG with a dominant red region and smaller blue/green regions.
    fn make_test_image(path: &str, color: [u8; 3]) {
        let mut buf = image::RgbaImage::new(200, 200);
        for (_, _, p) in buf.enumerate_pixels_mut() {
            p[0] = color[0];
            p[1] = color[1];
            p[2] = color[2];
            p[3] = 255;
        }
        buf.save(path).unwrap();
    }

    #[test]
    fn test_extract_different_colors_for_different_images() {
        let dir = std::env::temp_dir().join("lumina_theme_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let red_path = dir.join("red.png");
        let blue_path = dir.join("blue.png");
        make_test_image(&red_path.to_string_lossy(), [220, 60, 60]);
        make_test_image(&blue_path.to_string_lossy(), [60, 60, 220]);

        let red_result = extract_theme_colors(&red_path.to_string_lossy());
        let blue_result = extract_theme_colors(&blue_path.to_string_lossy());

        println!("Red image → dominant: {}", red_result.dominant);
        println!("Blue image → dominant: {}", blue_result.dominant);

        assert_ne!(
            red_result.dominant, blue_result.dominant,
            "Different images MUST produce different accent colors"
        );
        assert!(!red_result.palette.is_empty());
        assert!(!blue_result.palette.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_missing_file_returns_fallback() {
        let result = extract_theme_colors("nonexistent_file_xyz.jpg");
        assert_eq!(result.dominant, "#60CDFF");
    }
}
