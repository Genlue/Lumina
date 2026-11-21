// ============================================================
// Lumina · 数据模型
// 与 src-tauri/src/models.rs 一一对应；JSON 键名严格照后端 serde 标注。
// 后端一个字节都不改，前端只做镜像。
// ============================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/* ---------------- 图库 ---------------- */

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub folder_path: String,
    pub last_access: Option<i64>,
    pub unavailable: i32,
}

impl Profile {
    pub fn available(&self) -> bool {
        self.unavailable == 0
    }
}

/* ---------------- 相册 ---------------- */

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Album {
    pub id: i64,
    pub profile_id: String,
    pub folder_name: String,
    pub cover_image: Option<String>,
    pub sort_order: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/* ---------------- 扫描 ---------------- */

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub size: u64,
    #[serde(rename = "lastModified")]
    pub last_modified: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ScanResult {
    #[serde(rename = "rootImages", default)]
    pub root_images: Vec<FileInfo>,
    #[serde(rename = "albumFolders", default)]
    pub album_folders: Vec<String>,
    #[serde(rename = "albumImages", default)]
    pub album_images: HashMap<String, Vec<FileInfo>>,
}

/* ---------------- 缩略图 ---------------- */

#[derive(Debug, Clone, Deserialize)]
pub struct ThumbnailResult {
    #[serde(rename = "dataUrl")]
    pub data_url: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ThumbBatchItem {
    pub filename: String,
    pub folder: Option<String>,
    #[serde(rename = "dataUrl")]
    pub data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThumbReq {
    pub filename: String,
    pub folder: Option<String>,
}

/* ---------------- 收藏 / 回收站 ---------------- */

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct FavoriteRecord {
    pub profile_id: String,
    pub image_id: i64,
    pub added_at: String,
    pub filename: Option<String>,
    pub file_size: Option<i64>,
    pub file_date: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub album_id: Option<i64>,
    pub folder_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct TrashRecord {
    pub id: i64,
    pub profile_id: String,
    pub original_name: String,
    pub trash_name: String,
    pub original_folder: Option<String>,
    pub deleted_at: String,
}

/* ---------------- 设置 ---------------- */

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Settings {
    pub profile_id: String,
    pub view_mode: String,
    pub sort_by: String,
    pub theme_mode: String,
    pub accent_color: String,
    pub bg_image: Option<String>,
    pub bg_blur: i64,
    pub bg_opacity: f64,
    pub sidebar_width: i64,
    pub sidebar_opacity: f64,
    pub draw_count: i64,
    pub card_opacity: f64,
    pub card_blur: i64,
    pub sidebar_font: i64,
    pub random_interval: i64,
    pub thumbnail_size: i64,
    pub toolbar_height: i64,
    pub toolbar_blur: i64,
    pub toolbar_opacity: f64,
    pub select_overlay_opacity: f64,
    pub reverse_search_enabled: i64,
    pub home_title: Option<String>,
    pub list_columns: i64,
    pub accent_mode: String,
    pub accent_color_dark: String,
    pub accent_color_light: String,
    pub bg_transparent: bool,
    pub bg_effect_type: String,
    pub sidebar_blur: i64,
    pub bg_image_accent_mode: String,
    pub bg_image_accent_color_dark: String,
    pub bg_image_accent_color_light: String,
    pub transparent_accent_color_dark: String,
    pub transparent_accent_color_light: String,
    pub extract_color_dark: String,
    pub extract_color_light: String,
    pub transparent_accent_mode: String,
    pub font_family: String,
    pub thumb_gen_concurrency: i64,
    pub panel_radius: i64,
}

impl Settings {
    /// 前端兜底值：后端取不到设置时用它，保证界面永远有可用状态。
    pub fn fallback() -> Self {
        Self {
            profile_id: String::new(),
            view_mode: "grid".into(),
            sort_by: "name-asc".into(),
            theme_mode: "system".into(),
            accent_color: crate::theme::DEFAULT_ACCENT.into(),
            bg_image: None,
            bg_blur: 24,
            bg_opacity: 0.5,
            sidebar_width: 236,
            sidebar_opacity: 0.72,
            draw_count: 10,
            card_opacity: 0.72,
            card_blur: 18,
            sidebar_font: 13,
            random_interval: 3,
            thumbnail_size: 400,
            toolbar_height: 52,
            toolbar_blur: 18,
            toolbar_opacity: 0.72,
            select_overlay_opacity: 0.5,
            reverse_search_enabled: 1,
            home_title: None,
            list_columns: 3,
            accent_mode: "custom".into(),
            accent_color_dark: "#4A9EFF".into(),
            accent_color_light: "#003D7A".into(),
            bg_transparent: false,
            bg_effect_type: "acrylic".into(),
            sidebar_blur: 16,
            bg_image_accent_mode: "custom".into(),
            bg_image_accent_color_dark: "#4A9EFF".into(),
            bg_image_accent_color_light: "#003D7A".into(),
            transparent_accent_color_dark: "#4A9EFF".into(),
            transparent_accent_color_light: "#003D7A".into(),
            extract_color_dark: String::new(),
            extract_color_light: String::new(),
            transparent_accent_mode: "custom".into(),
            font_family: String::new(),
            thumb_gen_concurrency: 10,
            panel_radius: 12,
        }
    }

    pub fn reverse_search(&self) -> bool {
        self.reverse_search_enabled != 0
    }
}

/* ---------------- 缓存 ---------------- */

#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
pub struct CacheInfo {
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub file_count: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
pub struct CacheGenStatus {
    #[serde(default)]
    pub running: bool,
    #[serde(default)]
    pub done: usize,
    #[serde(default)]
    pub total: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileReport {
    #[serde(default)]
    pub removed_count: u64,
    #[serde(default)]
    pub removed_bytes: u64,
    #[serde(default)]
    pub kept_count: u64,
}

/* ---------------- 主题 / 收藏导出 ---------------- */

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ThemeColors {
    #[serde(default)]
    pub dominant: String,
    #[serde(default)]
    pub palette: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct FavCopyResult {
    #[serde(default)]
    pub copied: i64,
    #[serde(default)]
    pub overwritten: i64,
    #[serde(default)]
    pub skipped: i64,
    #[serde(default)]
    pub duplicates: i64,
}

/* ==========================================================================
   应用内部结构：把 FileInfo / FavoriteRecord / TrashRecord 归一成一种
   ========================================================================== */

/// 一张照片。页面里不再区分来源，只认这一个结构。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    pub name: String,
    pub folder: Option<String>,
    pub key: String,
    pub size: i64,
    pub date: i64,
    pub width: i64,
    pub height: i64,
    /// 收藏列表里恒为 true；普通列表靠 `fav_set` 查
    pub fav: bool,
}

impl Image {
    pub fn from_file(fi: &FileInfo, folder: Option<&str>) -> Self {
        Self {
            name: fi.name.clone(),
            folder: folder.map(str::to_string),
            key: key_of(folder, &fi.name),
            size: fi.size as i64,
            date: fi.last_modified as i64,
            width: fi.width.unwrap_or(0) as i64,
            height: fi.height.unwrap_or(0) as i64,
            fav: false,
        }
    }

    pub fn from_favorite(f: &FavoriteRecord) -> Self {
        let name = f.filename.clone().unwrap_or_default();
        let folder = f.folder_name.clone();
        Self {
            key: key_of(folder.as_deref(), &name),
            name,
            folder,
            size: f.file_size.unwrap_or(0),
            date: f.file_date.unwrap_or(0),
            width: f.width.unwrap_or(0),
            height: f.height.unwrap_or(0),
            fav: true,
        }
    }

    /// 宽高比，用来给瀑布流占位
    pub fn aspect(&self) -> f64 {
        if self.width > 0 && self.height > 0 {
            self.width as f64 / self.height as f64
        } else {
            1.0
        }
    }
}

/// 回收站里的一条。照片本体在 `.album/trash` 下，文件名是 trash_name。
#[derive(Debug, Clone, PartialEq)]
pub struct TrashItem {
    pub record: TrashRecord,
    pub key: String,
    pub display_name: String,
    pub deleted_ms: i64,
}

impl TrashItem {
    pub fn from_record(t: &TrashRecord) -> Self {
        Self {
            key: key_of(Some(".album/trash"), &t.trash_name),
            display_name: t.original_name.clone(),
            deleted_ms: parse_iso_ms(&t.deleted_at),
            record: t.clone(),
        }
    }

    pub fn image(&self) -> Image {
        Image {
            name: self.record.trash_name.clone(),
            folder: Some(".album/trash".into()),
            key: self.key.clone(),
            size: 0,
            date: self.deleted_ms,
            width: 0,
            height: 0,
            fav: false,
        }
    }
}

/// 稳定键：文件夹 + 文件名。分隔符用 `\u{1}`，普通路径里不会出现。
pub fn key_of(folder: Option<&str>, name: &str) -> String {
    format!("{}\u{1}{}", folder.unwrap_or(""), name)
}

/// `"2026-11-17 12:00:00"` / RFC3339 → 毫秒。解析失败返回 0。
pub fn parse_iso_ms(s: &str) -> i64 {
    // 后端写入的是 SQLite 的 `datetime('now','localtime')`，格式 `YYYY-MM-DD HH:MM:SS`
    let bytes = s.as_bytes();
    if bytes.len() < 19 {
        return 0;
    }
    let num = |a: usize, b: usize| -> Option<i64> { s.get(a..b)?.parse::<i64>().ok() };
    let (Some(y), Some(mo), Some(d), Some(h), Some(mi), Some(se)) = (
        num(0, 4),
        num(5, 7),
        num(8, 10),
        num(11, 13),
        num(14, 16),
        num(17, 19),
    ) else {
        return 0;
    };
    // 不引 chrono：只需要「可排序 + 可格式化」的近似时间戳。
    days_from_civil(y, mo, d) * 86_400_000 + ((h * 3600 + mi * 60 + se) * 1000)
}

/// 公历 → 距 1970-01-01 的天数（Howard Hinnant 算法）。
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// 毫秒时间戳 → `YYYY-MM-DD HH:MM`（本地时区近似，用于回收站列表）。
pub fn format_ms(ms: i64) -> String {
    if ms <= 0 {
        return "—".into();
    }
    let total_days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(total_days);
    let h = rem / 3_600_000;
    let mi = (rem % 3_600_000) / 60_000;
    format!("{y:04}-{m:02}-{d:02} {h:02}:{mi:02}")
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 人类可读体积。
pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = bytes as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{bytes} B")
    } else if v >= 100.0 {
        format!("{v:.0} {}", UNITS[i])
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

/// 路径末段（相册名 / 图库名兜底）。
pub fn last_segment(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .find(|s| !s.is_empty())
        .unwrap_or(path)
        .to_string()
}
