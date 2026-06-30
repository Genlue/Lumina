use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub folder_path: String,
    pub last_access: Option<i64>,
    pub unavailable: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Album {
    pub id: i64,
    pub profile_id: String,
    pub folder_name: String,
    pub cover_image: Option<String>,
    pub sort_order: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageRecord {
    pub id: i64,
    pub profile_id: String,
    pub album_id: Option<i64>,
    pub filename: String,
    pub file_size: Option<i64>,
    pub file_date: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoritesRecord {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashRecord {
    pub id: i64,
    pub profile_id: String,
    pub original_name: String,
    pub trash_name: String,
    pub original_folder: Option<String>,
    pub deleted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub reverse_search_enabled: i64,  // 0=关, 1=开
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub size: u64,
    #[serde(rename = "lastModified")]
    pub last_modified: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    #[serde(rename = "rootImages")]
    pub root_images: Vec<FileInfo>,
    #[serde(rename = "albumFolders")]
    pub album_folders: Vec<String>,
    #[serde(rename = "albumImages")]
    pub album_images: std::collections::HashMap<String, Vec<FileInfo>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheInfo {
    pub size: u64,
    pub file_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailResult {
    #[serde(rename = "dataUrl")]
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeColors {
    pub dominant: String,
    pub palette: Vec<String>,
}
