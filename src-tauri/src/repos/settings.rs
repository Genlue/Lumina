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
                accent_mode, accent_color_dark, accent_color_light,
                bg_transparent, sidebar_blur, bg_effect_type,
                bg_image_accent_mode, bg_image_accent_color_dark, bg_image_accent_color_light,
                transparent_accent_color_dark, transparent_accent_color_light,
                extract_color_dark, extract_color_light
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
            bg_transparent: row.get(26).unwrap_or(0) != 0,
            sidebar_blur: row.get(27).unwrap_or(16),
            bg_effect_type: row.get(28).unwrap_or_else(|_| "acrylic".to_string()),
            bg_image_accent_mode: row.get(29).unwrap_or_else(|_| "custom".to_string()),
            bg_image_accent_color_dark: row.get(30).unwrap_or_else(|_| "#4A9EFF".to_string()),
            bg_image_accent_color_light: row.get(31).unwrap_or_else(|_| "#003D7A".to_string()),
            transparent_accent_color_dark: row.get(32).unwrap_or_else(|_| "#4A9EFF".to_string()),
            transparent_accent_color_light: row.get(33).unwrap_or_else(|_| "#003D7A".to_string()),
            extract_color_dark: row.get(34).unwrap_or_else(|_| "#4A9EFF".to_string()),
            extract_color_light: row.get(35).unwrap_or_else(|_| "#003D7A".to_string()),
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
                 accent_mode, accent_color_dark, accent_color_light,
                 bg_transparent, sidebar_blur, bg_effect_type,
                 bg_image_accent_mode, bg_image_accent_color_dark, bg_image_accent_color_light,
                 transparent_accent_color_dark, transparent_accent_color_light,
                 extract_color_dark, extract_color_light)
                 VALUES (?1, 'grid', 'name-asc', 'dark', '#6D79F6',
                 NULL, 0, 1.0, 150, 0.7, 10, 0.7, 16, 20, 3, 400,
                 56, 16, 0.7, 0.2, 1, NULL, 3,
                 'custom', '#4A9EFF', '#003D7A',
                 0, 16, 'acrylic',
                 'custom', '#4A9EFF', '#003D7A',
                 '#4A9EFF', '#003D7A',
                 '#4A9EFF', '#003D7A')",
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
                bg_transparent: false,
                bg_effect_type: "acrylic".to_string(),
                sidebar_blur: 16,
                bg_image_accent_mode: "custom".to_string(),
                bg_image_accent_color_dark: "#4A9EFF".to_string(),
                bg_image_accent_color_light: "#003D7A".to_string(),
                transparent_accent_color_dark: "#4A9EFF".to_string(),
                transparent_accent_color_light: "#003D7A".to_string(),
                extract_color_dark: "#4A9EFF".to_string(),
                extract_color_light: "#003D7A".to_string(),
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

    let bg_transparent = updates["bg_transparent"].as_bool().unwrap_or(current.bg_transparent);
    let sidebar_blur = updates["sidebar_blur"].as_i64().unwrap_or(current.sidebar_blur);
    let bg_effect_type = updates["bg_effect_type"].as_str().map(|s| s.to_string()).unwrap_or(current.bg_effect_type);

    let bg_image_accent_mode = updates["bg_image_accent_mode"].as_str().map(|s| s.to_string()).unwrap_or(current.bg_image_accent_mode);
    let bg_image_accent_color_dark = updates["bg_image_accent_color_dark"].as_str().map(|s| s.to_string()).unwrap_or(current.bg_image_accent_color_dark);
    let bg_image_accent_color_light = updates["bg_image_accent_color_light"].as_str().map(|s| s.to_string()).unwrap_or(current.bg_image_accent_color_light);
    let transparent_accent_color_dark = updates["transparent_accent_color_dark"].as_str().map(|s| s.to_string()).unwrap_or(current.transparent_accent_color_dark);
    let transparent_accent_color_light = updates["transparent_accent_color_light"].as_str().map(|s| s.to_string()).unwrap_or(current.transparent_accent_color_light);
    let extract_color_dark = updates["extract_color_dark"].as_str().map(|s| s.to_string()).unwrap_or(current.extract_color_dark);
    let extract_color_light = updates["extract_color_light"].as_str().map(|s| s.to_string()).unwrap_or(current.extract_color_light);

    conn.execute(
        "UPDATE settings SET view_mode=?1, sort_by=?2, theme_mode=?3, accent_color=?4,
         bg_image=?5, bg_blur=?6, bg_opacity=?7, sidebar_width=?8, sidebar_opacity=?9,
         draw_count=?10, card_opacity=?11, card_blur=?12, sidebar_font=?13, random_interval=?14,
         thumbnail_size=?15, toolbar_height=?16, toolbar_blur=?17, toolbar_opacity=?18,
         select_overlay_opacity=?19, reverse_search_enabled=?20, home_title=?21, list_columns=?22,
         accent_mode=?23, accent_color_dark=?24, accent_color_light=?25,
         bg_transparent=?26, sidebar_blur=?27, bg_effect_type=?28,
         bg_image_accent_mode=?29, bg_image_accent_color_dark=?30, bg_image_accent_color_light=?31,
         transparent_accent_color_dark=?32, transparent_accent_color_light=?33,
         extract_color_dark=?34, extract_color_light=?35
         WHERE profile_id=?36",
        params![view_mode, sort_by, theme_mode, accent_color,
                bg_image, bg_blur, bg_opacity, sidebar_width, sidebar_opacity,
                draw_count, card_opacity, card_blur, sidebar_font, random_interval,
                thumbnail_size, toolbar_height, toolbar_blur, toolbar_opacity,
                select_overlay_opacity, reverse_search_enabled, home_title, list_columns,
                accent_mode, accent_color_dark, accent_color_light,
                bg_transparent, sidebar_blur, bg_effect_type,
                bg_image_accent_mode, bg_image_accent_color_dark, bg_image_accent_color_light,
                transparent_accent_color_dark, transparent_accent_color_light,
                extract_color_dark, extract_color_light, profile_id],
    ).ok();
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (
                profile_id      TEXT PRIMARY KEY,
                view_mode       TEXT NOT NULL DEFAULT 'grid',
                sort_by         TEXT NOT NULL DEFAULT 'name-asc',
                theme_mode      TEXT NOT NULL DEFAULT 'dark',
                accent_color    TEXT NOT NULL DEFAULT '#6D79F6',
                bg_image        TEXT,
                bg_blur         INTEGER NOT NULL DEFAULT 0,
                bg_opacity      REAL NOT NULL DEFAULT 1.0,
                sidebar_width   INTEGER NOT NULL DEFAULT 150,
                sidebar_opacity REAL NOT NULL DEFAULT 0.7,
                draw_count      INTEGER NOT NULL DEFAULT 10,
                card_opacity    REAL NOT NULL DEFAULT 0.7,
                card_blur       INTEGER NOT NULL DEFAULT 16,
                sidebar_font    INTEGER NOT NULL DEFAULT 20,
                random_interval INTEGER NOT NULL DEFAULT 3,
                thumbnail_size  INTEGER NOT NULL DEFAULT 400,
                toolbar_height  INTEGER NOT NULL DEFAULT 56,
                toolbar_blur    INTEGER NOT NULL DEFAULT 16,
                toolbar_opacity REAL NOT NULL DEFAULT 0.7,
                select_overlay_opacity REAL NOT NULL DEFAULT 0.2,
                reverse_search_enabled INTEGER NOT NULL DEFAULT 1,
                home_title      TEXT,
                list_columns    INTEGER NOT NULL DEFAULT 3,
                accent_mode     TEXT NOT NULL DEFAULT 'custom',
                accent_color_dark TEXT NOT NULL DEFAULT '#4A9EFF',
                accent_color_light TEXT NOT NULL DEFAULT '#003D7A',
                bg_transparent  INTEGER NOT NULL DEFAULT 0,
                sidebar_blur    INTEGER NOT NULL DEFAULT 16,
                bg_effect_type  TEXT NOT NULL DEFAULT 'acrylic',
                bg_image_accent_mode TEXT NOT NULL DEFAULT 'custom',
                bg_image_accent_color_dark TEXT NOT NULL DEFAULT '#4A9EFF',
                bg_image_accent_color_light TEXT NOT NULL DEFAULT '#003D7A',
                transparent_accent_color_dark TEXT NOT NULL DEFAULT '#4A9EFF',
                transparent_accent_color_light TEXT NOT NULL DEFAULT '#003D7A',
                extract_color_dark TEXT NOT NULL DEFAULT '#4A9EFF',
                extract_color_light TEXT NOT NULL DEFAULT '#003D7A'
            );"
        ).unwrap();
        conn
    }

    #[test]
    fn test_get_settings_auto_creates_row() {
        let conn = setup();
        let s = get_settings(&conn, "new-profile");
        assert_eq!(s.profile_id, "new-profile");
        assert_eq!(s.view_mode, "grid");
        assert_eq!(s.sort_by, "name-asc");
        assert_eq!(s.theme_mode, "dark");
        assert_eq!(s.accent_color, "#6D79F6");
        assert_eq!(s.bg_opacity, 1.0);
        assert_eq!(s.sidebar_width, 150);
        assert_eq!(s.bg_transparent, false);
        assert_eq!(s.bg_effect_type, "acrylic");
        assert_eq!(s.accent_mode, "custom");
        assert_eq!(s.home_title, None);
    }

    #[test]
    fn test_get_settings_after_save() {
        let conn = setup();
        let mut json = serde_json::Map::new();
        json.insert("view_mode".to_string(), serde_json::Value::String("list".to_string()));
        json.insert("theme_mode".to_string(), serde_json::Value::String("light".to_string()));
        json.insert("accent_color".to_string(), serde_json::Value::String("#FF0000".to_string()));
        json.insert("draw_count".to_string(), serde_json::Value::Number(serde_json::Number::from(20)));
        json.insert("bg_transparent".to_string(), serde_json::Value::Bool(true));
        json.insert("home_title".to_string(), serde_json::Value::String("My Album".to_string()));

        save_settings(&conn, "p1", serde_json::Value::Object(json));

        let s = get_settings(&conn, "p1");
        assert_eq!(s.view_mode, "list");
        assert_eq!(s.theme_mode, "light");
        assert_eq!(s.accent_color, "#FF0000");
        assert_eq!(s.draw_count, 20);
        assert_eq!(s.bg_transparent, true);
        assert_eq!(s.home_title, Some("My Album".to_string()));
        assert_eq!(s.sort_by, "name-asc");
        assert_eq!(s.bg_opacity, 1.0);
        assert_eq!(s.sidebar_width, 150);
    }

    #[test]
    fn test_save_settings_partial_update() {
        let conn = setup();
        let mut init = serde_json::Map::new();
        init.insert("view_mode".to_string(), serde_json::Value::String("list".to_string()));
        init.insert("draw_count".to_string(), serde_json::Value::Number(serde_json::Number::from(42)));
        save_settings(&conn, "p1", serde_json::Value::Object(init));

        let mut partial = serde_json::Map::new();
        partial.insert("view_mode".to_string(), serde_json::Value::String("grid".to_string()));
        save_settings(&conn, "p1", serde_json::Value::Object(partial));

        let s = get_settings(&conn, "p1");
        assert_eq!(s.view_mode, "grid");
        assert_eq!(s.draw_count, 42, "Unchanged field should keep previous value");
    }

    #[test]
    fn test_save_settings_boolean_fields() {
        let conn = setup();
        let mut json = serde_json::Map::new();
        json.insert("reverse_search_enabled".to_string(), serde_json::Value::Bool(false));
        json.insert("list_columns".to_string(), serde_json::Value::Number(serde_json::Number::from(5)));
        save_settings(&conn, "p1", serde_json::Value::Object(json));

        let s = get_settings(&conn, "p1");
        assert_eq!(s.reverse_search_enabled, 0);
        assert_eq!(s.list_columns, 5);
    }

    #[test]
    fn test_settings_scoped_by_profile() {
        let conn = setup();
        let s1 = get_settings(&conn, "p1");
        let s2 = get_settings(&conn, "p2");
        assert_eq!(s1.profile_id, "p1");
        assert_eq!(s2.profile_id, "p2");

        let mut json = serde_json::Map::new();
        json.insert("view_mode".to_string(), serde_json::Value::String("masonry".to_string()));
        save_settings(&conn, "p1", serde_json::Value::Object(json));

        let updated = get_settings(&conn, "p1");
        assert_eq!(updated.view_mode, "masonry");
        let unchanged = get_settings(&conn, "p2");
        assert_eq!(unchanged.view_mode, "grid");
    }

    #[test]
    fn test_save_accent_color_fields() {
        let conn = setup();
        let mut json = serde_json::Map::new();
        json.insert("accent_mode".to_string(), serde_json::Value::String("extract".to_string()));
        json.insert("accent_color_dark".to_string(), serde_json::Value::String("#111111".to_string()));
        json.insert("accent_color_light".to_string(), serde_json::Value::String("#222222".to_string()));
        json.insert("bg_effect_type".to_string(), serde_json::Value::String("blur".to_string()));
        json.insert("sidebar_blur".to_string(), serde_json::Value::Number(serde_json::Number::from(32)));
        save_settings(&conn, "p1", serde_json::Value::Object(json));

        let s = get_settings(&conn, "p1");
        assert_eq!(s.accent_mode, "extract");
        assert_eq!(s.accent_color_dark, "#111111");
        assert_eq!(s.accent_color_light, "#222222");
        assert_eq!(s.bg_effect_type, "blur");
        assert_eq!(s.sidebar_blur, 32);
    }
}
