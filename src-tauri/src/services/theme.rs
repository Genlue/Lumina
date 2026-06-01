use std::collections::HashMap;
use std::fs;
use crate::models::ThemeColors;

pub fn extract_theme_colors(image_path: &str) -> ThemeColors {
    match fs::read(image_path) {
        Ok(buf) => {
            let colors = quick_sample(&buf);
            if !colors.is_empty() && colors[0] != "#000000" {
                ThemeColors { dominant: colors[0].clone(), palette: colors.into_iter().take(5).collect() }
            } else {
                ThemeColors { dominant: "#60CDFF".to_string(), palette: vec!["#60CDFF".to_string()] }
            }
        }
        Err(_) => ThemeColors { dominant: "#60CDFF".to_string(), palette: vec!["#60CDFF".to_string()] }
    }
}

fn quick_sample(buf: &[u8]) -> Vec<String> {
    let mut colors: HashMap<String, (u8, u8, u8, u32)> = HashMap::new();
    let sample_points = 500usize;
    let quarter = buf.len() / 4;
    let _half = buf.len() / 2;

    if buf.len() < quarter + 10 { return vec![]; }

    for p in 0..sample_points {
        let pos = quarter + (p * (buf.len() - quarter * 2) / sample_points);
        if pos + 2 >= buf.len() { continue; }
        let r = buf[pos];
        let g = buf[pos + 1];
        let b = buf[pos + 2];

        let brightness = (r as u32 + g as u32 + b as u32) / 3;
        if brightness < 20 || brightness > 235 { continue; }
        let max_c = r.max(g).max(b);
        let min_c = r.min(g).min(b);
        if max_c - min_c < 20 { continue; }

        let qr = (r / 16) * 16;
        let qg = (g / 16) * 16;
        let qb = (b / 16) * 16;
        let key = format!("{},{},{}", qr, qg, qb);

        let entry = colors.entry(key).or_insert((qr, qg, qb, 0));
        entry.3 += 1;
    }

    let mut scored: Vec<_> = colors.values().map(|&(r, g, b, count)| {
        let max_c = r.max(g).max(b);
        let min_c = r.min(g).min(b);
        let sat = if max_c == 0 { 0.0 } else { (max_c - min_c) as f64 / max_c as f64 };
        (sat * count as f64, r, g, b)
    }).collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    scored.into_iter().take(5).map(|(_, r, g, b)| rgb_to_hex(r, g, b)).collect()
}

fn rgb_to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{:02X}{:02X}{:02X}", r, g, b)
}
