use rusqlite::{Connection, params};
use crate::models::Settings;

// Default settings are inlined in get_settings

pub fn get_settings(conn: &Connection, profile_id: &str) -> Settings {
    match conn.query_row(
        "SELECT profile_id, view_mode, sort_by, theme_mode, accent_color,
                bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity,
                draw_count, card_opacity, card_blur, sidebar_font, random_interval,
                thumbnail_size, toolbar_height, toolbar_blur, toolbar_opacity,
                select_overlay_opacity, reverse_search_enabled, home_title, list_columns,
                accent_mode, accent_color_dark, accent_color_light, accent_presets
         FROM settings WHERE profile_id = ?1",
        params![profile_id],
        |row| Ok(Settings {
            profile_id: row.get(0)?, view_mode: row.get(1)?, sort_by: row.get(2)?,
            theme_mode: row.get(3)?, accent_color: row.get(4)?, bg_image: row.get(5)?,
            bg_blur: row.get(6)?, bg_opacity: row.get(7)?,
            sidebar_width: row.get(8)?, sidebar_opacity: row.get(9)?,
            draw_count: row.get(10)?,
            card_opacity: row.get(11)?, card_blur: row.get(12)?,
            sidebar_font: row.get(13)?,
            random_interval: row.get(14).unwrap_or(3),
            thumbnail_size: row.get(15).unwrap_or(400),
            toolbar_height: row.get(16).unwrap_or(56),
            toolbar_blur: row.get(17).unwrap_or(16),
            toolbar_opacity: row.get(18).unwrap_or(0.7),
            select_overlay_opacity: row.get(19).unwrap_or(0.2),
            reverse_search_enabled: row.get(20).unwrap_or(1),
            home_title: row.get(21).ok().flatten(),
            list_columns: row.get(22).unwrap_or(3),
            accent_mode: row.get(23).unwrap_or_else(|_| "custom".to_string()),
            accent_color_dark: row.get(24).unwrap_or_else(|_| "#4A9EFF".to_string()),
            accent_color_light: row.get(25).unwrap_or_else(|_| "#003D7A".to_string()),
            accent_presets: row.get(26).ok().flatten(),
        }),
    ) {
        Ok(s) => s,
        Err(_) => {
            conn.execute(
                "INSERT INTO settings (profile_id, view_mode, sort_by, theme_mode, accent_color,
                 bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity, draw_count,
                 card_opacity, card_blur, sidebar_font, random_interval, thumbnail_size,
                 toolbar_height, toolbar_blur, toolbar_opacity,
                 select_overlay_opacity, reverse_search_enabled, home_title, list_columns,
                 accent_mode, accent_color_dark, accent_color_light, accent_presets)
                 VALUES (?1, 'grid', 'name-asc', 'dark', '#6D79F6',
                 NULL, 0, 1.0, 150, 0.7, 10, 0.7, 16, 20, 3, 400,
                 56, 16, 0.7, 0.2, 1, NULL, 3,
                 'custom', '#4A9EFF', '#003D7A', NULL)",
                params![profile_id],
            ).ok();
            Settings {
                profile_id: profile_id.to_string(),
                view_mode: "grid".to_string(), sort_by: "name-asc".to_string(),
                theme_mode: "dark".to_string(), accent_color: "#6D79F6".to_string(),
                bg_image: None, bg_blur: 0, bg_opacity: 1.0,
                sidebar_width: 150, sidebar_opacity: 0.7,
                draw_count: 10, card_opacity: 0.7, card_blur: 16,
                sidebar_font: 20,
                random_interval: 3,
                thumbnail_size: 400,
                toolbar_height: 56,
                toolbar_blur: 16,
                toolbar_opacity: 0.7,
                select_overlay_opacity: 0.2,
                reverse_search_enabled: 1,
                home_title: None,
                list_columns: 3,
                accent_mode: "custom".to_string(),
                accent_color_dark: "#4A9EFF".to_string(),
                accent_color_light: "#003D7A".to_string(),
                accent_presets: None,
            }
        }
    }
}

pub fn save_settings(conn: &Connection, profile_id: &str, updates: serde_json::Value) {
    let current = get_settings(conn, profile_id);

    let view_mode = updates["view_mode"].as_str().unwrap_or(&current.view_mode).to_string();
    let sort_by = updates["sort_by"].as_str().unwrap_or(&current.sort_by).to_string();
    let theme_mode = updates["theme_mode"].as_str().unwrap_or(&current.theme_mode).to_string();
    let accent_color = updates["accent_color"].as_str().unwrap_or(&current.accent_color).to_string();
    let bg_image = updates["bg_image"].as_str().map(|s| s.to_string()).or(current.bg_image);
    let bg_blur = updates["bg_blur"].as_i64().unwrap_or(current.bg_blur);
    let bg_opacity = updates["bg_opacity"].as_f64().unwrap_or(current.bg_opacity);
    let sidebar_width = updates["sidebar_width"].as_i64().unwrap_or(current.sidebar_width);
    let sidebar_opacity = updates["sidebar_opacity"].as_f64().unwrap_or(current.sidebar_opacity);
    let draw_count = updates["draw_count"].as_i64().unwrap_or(current.draw_count);
    let card_opacity = updates["card_opacity"].as_f64().unwrap_or(current.card_opacity);
    let card_blur = updates["card_blur"].as_i64().unwrap_or(current.card_blur);
    let sidebar_font = updates["sidebar_font"].as_i64().unwrap_or(current.sidebar_font);
    let random_interval = updates["random_interval"].as_i64().unwrap_or(current.random_interval);
    let thumbnail_size = updates["thumbnail_size"].as_i64().unwrap_or(current.thumbnail_size);
    let toolbar_height = updates["toolbar_height"].as_i64().unwrap_or(current.toolbar_height);
    let toolbar_blur = updates["toolbar_blur"].as_i64().unwrap_or(current.toolbar_blur);
    let toolbar_opacity = updates["toolbar_opacity"].as_f64().unwrap_or(current.toolbar_opacity);
    let select_overlay_opacity = updates["select_overlay_opacity"].as_f64().unwrap_or(current.select_overlay_opacity);
    let reverse_search_enabled = updates["reverse_search_enabled"]
        .as_bool().map(|b| b as i64)
        .or_else(|| updates["reverse_search_enabled"].as_i64())
        .unwrap_or(current.reverse_search_enabled);

    let list_columns = updates["list_columns"]
        .as_bool().map(|b| b as i64)
        .or_else(|| updates["list_columns"].as_i64())
        .unwrap_or(current.list_columns);

    let home_title = updates["home_title"].as_str().map(|s| s.to_string()).or(current.home_title.clone());

    let accent_mode = updates["accent_mode"].as_str().map(|s| s.to_string()).unwrap_or(current.accent_mode);
    let accent_color_dark = updates["accent_color_dark"].as_str().map(|s| s.to_string()).unwrap_or(current.accent_color_dark);
    let accent_color_light = updates["accent_color_light"].as_str().map(|s| s.to_string()).unwrap_or(current.accent_color_light);
    let accent_presets = updates["accent_presets"].as_str().map(|s| s.to_string()).or(current.accent_presets.clone());

    conn.execute(
        "UPDATE settings SET view_mode=?1, sort_by=?2, theme_mode=?3, accent_color=?4,
         bg_image=?5, bg_blur=?6, bg_opacity=?7, sidebar_width=?8, sidebar_opacity=?9,
         draw_count=?10, card_opacity=?11, card_blur=?12, sidebar_font=?13, random_interval=?14,
         thumbnail_size=?15, toolbar_height=?16, toolbar_blur=?17, toolbar_opacity=?18,
         select_overlay_opacity=?19, reverse_search_enabled=?20, home_title=?21, list_columns=?22,
         accent_mode=?23, accent_color_dark=?24, accent_color_light=?25, accent_presets=?26
         WHERE profile_id=?27",
        params![view_mode, sort_by, theme_mode, accent_color,
                bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity,
                draw_count, card_opacity, card_blur, sidebar_font, random_interval,
                thumbnail_size, toolbar_height, toolbar_blur, toolbar_opacity,
                select_overlay_opacity, reverse_search_enabled, home_title, list_columns,
                accent_mode, accent_color_dark, accent_color_light, accent_presets,
                profile_id],
    ).ok();
}
