use rusqlite::{Connection, params};
use crate::models::Settings;

const DEFAULT_SETTINGS: Settings = Settings {
    profile_id: String::new(),
    view_mode: String::new(), sort_by: String::new(), theme_mode: String::new(),
    accent_color: String::new(), bg_image: None,
    bg_blur: 20, bg_opacity: 0.0,
    sidebar_width: 270, sidebar_opacity: 0.82,
    draw_count: 3,
    card_opacity: 1.0, card_blur: 0,
    sidebar_font: 14,
    random_interval: 3,
};

pub fn get_settings(conn: &Connection, profile_id: &str) -> Settings {
    match conn.query_row(
        "SELECT profile_id, view_mode, sort_by, theme_mode, accent_color,
                bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity,
                draw_count, card_opacity, card_blur, sidebar_font, random_interval
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
        }),
    ) {
        Ok(s) => s,
        Err(_) => {
            conn.execute(
                "INSERT INTO settings (profile_id, view_mode, sort_by, theme_mode, accent_color,
                 bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity, draw_count,
                 card_opacity, card_blur, sidebar_font, random_interval)
                 VALUES (?1, 'grid', 'name-asc', 'dark', '#6D79F6',
                 NULL, 20, 0, 270, 0.82, 3, 1, 0, 14, 3)",
                params![profile_id],
            ).ok();
            Settings {
                profile_id: profile_id.to_string(),
                view_mode: "grid".to_string(), sort_by: "name-asc".to_string(),
                theme_mode: "dark".to_string(), accent_color: "#6D79F6".to_string(),
                bg_image: None, bg_blur: 20, bg_opacity: 0.0,
                sidebar_width: 270, sidebar_opacity: 0.82,
                draw_count: 3, card_opacity: 1.0, card_blur: 0,
                sidebar_font: 14,
                random_interval: 3,
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

    conn.execute(
        "UPDATE settings SET view_mode=?1, sort_by=?2, theme_mode=?3, accent_color=?4,
         bg_image=?5, bg_blur=?6, bg_opacity=?7, sidebar_width=?8, sidebar_opacity=?9,
         draw_count=?10, card_opacity=?11, card_blur=?12, sidebar_font=?13, random_interval=?14
         WHERE profile_id=?15",
        params![view_mode, sort_by, theme_mode, accent_color,
                bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity,
                draw_count, card_opacity, card_blur, sidebar_font, random_interval,
                profile_id],
    ).ok();
}
