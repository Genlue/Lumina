// ============================================================
// Lumina · 主题
// GlassDesign 的 Theme 是唯一真源：这里只负责
//   ① 首帧之前从 localStorage 缓存恢复（避免闪一下系统主题）
//   ② SQLite 里的 Settings 变化时灌进 Theme
//   ③ 把最终值写回缓存，供下次启动用
// ============================================================

use glass_design::prelude::*;

use crate::models::Settings;

/// 强调色默认值（Settings.accent_color 的兜底）。
/// 深浅两档由 Theme::apply 按主题自动派生，不再单独存两份。
pub const DEFAULT_ACCENT: &str = "#0a84ff";

const K_MODE: &str = "lumina.theme.mode";
const K_ACCENT: &str = "lumina.theme.accent";

/* ---------------- localStorage（不走 web-sys 的 Storage 特性） ---------------- */

fn ls() -> Option<js_sys::Object> {
    let v = js_sys::Reflect::get(&js_sys::global(), &wasm_bindgen::JsValue::from_str("localStorage")).ok()?;
    if v.is_undefined() || v.is_null() {
        return None;
    }
    v.dyn_into::<js_sys::Object>().ok()
}

fn ls_get(key: &str) -> Option<String> {
    let store = ls()?;
    let f = js_sys::Reflect::get(&store, &"getItem".into())
        .ok()?
        .dyn_into::<js_sys::Function>()
        .ok()?;
    let v = f.call1(&store, &key.into()).ok()?;
    v.as_string()
}

fn ls_set(key: &str, value: &str) {
    let Some(store) = ls() else { return };
    let Ok(f) = js_sys::Reflect::get(&store, &"setItem".into())
        .and_then(|v| v.dyn_into::<js_sys::Function>().map_err(|_| wasm_bindgen::JsValue::NULL))
    else {
        return;
    };
    let _ = f.call2(&store, &key.into(), &value.into());
}

use wasm_bindgen::JsCast;

/* ---------------- 模式 ---------------- */

pub fn parse_mode(s: &str) -> ThemeMode {
    match s {
        "light" => ThemeMode::Light,
        "dark" => ThemeMode::Dark,
        _ => ThemeMode::System,
    }
}

pub fn mode_str(m: ThemeMode) -> &'static str {
    m.as_str()
}

/// 首帧之前可用的主题模式：先看缓存，没有就跟随系统。
pub fn cached_mode() -> ThemeMode {
    ls_get(K_MODE)
        .map(|s| parse_mode(&s))
        .unwrap_or(ThemeMode::System)
}

/// 首帧之前可用的强调色。返回 `&'static str`（Theme 的 accent 是静态字符串），
/// 一次启动泄漏几十字节，换来的是「首帧颜色正确」。
pub fn cached_accent() -> &'static str {
    match ls_get(K_ACCENT) {
        Some(hex) if is_hex(&hex) => Box::leak(hex.into_boxed_str()),
        _ => DEFAULT_ACCENT,
    }
}

fn is_hex(s: &str) -> bool {
    let h = s.trim().trim_start_matches('#');
    (h.len() == 3 || h.len() == 6) && h.chars().all(|c| c.is_ascii_hexdigit())
}

/* ---------------- 应用 ---------------- */

/// 真正会影响主题的四个字段。
///
/// 为什么要单独抽出来：`Settings` 里有三十多个字段，缩略图尺寸、抽卡张数、
/// 列表列数……都跟主题无关。如果直接对整份 `Settings` 起 Effect，
/// 拖一个滑块就会连带跑一遍主题（写 localStorage、重设十几个 CSS 变量），
/// 每帧几毫秒的同步 IO 足以把滑块拖成一卡一卡的。
#[derive(Debug, Clone, PartialEq)]
pub struct ThemeKey {
    pub mode: String,
    pub accent: String,
    pub font: String,
    pub nav_w: i64,
}

pub fn key_of(s: &Settings) -> ThemeKey {
    ThemeKey {
        mode: s.theme_mode.clone(),
        accent: s.accent_color.clone(),
        font: s.font_family.clone(),
        nav_w: s.sidebar_width,
    }
}

/// 把 ThemeKey 灌进 Theme，并写回缓存。
pub fn apply_key(theme: Theme, k: &ThemeKey) {
    let mode = parse_mode(&k.mode);
    theme.set_mode(mode);

    let accent = if is_hex(&k.accent) {
        k.accent.trim().to_string()
    } else {
        DEFAULT_ACCENT.to_string()
    };
    // Theme 的 accent 是 `RwSignal<&'static str>`：动态颜色只能泄漏一次。
    // 用户点色板的频率极低，每次 8 字节可以忽略。
    theme.set_accent(Box::leak(accent.clone().into_boxed_str()));

    // 界面字体：空字符串 = 跟随 tokens.css
    if k.font.trim().is_empty() {
        theme.remove_token("--font-ui");
    } else {
        theme.set_token("--font-ui", &k.font);
    }

    // 侧栏宽度：库里的唯一入口是 --nav-w
    theme.set_token("--nav-w", &format!("{}px", k.nav_w.clamp(190, 340)));

    ls_set(K_MODE, mode_str(mode));
    ls_set(K_ACCENT, &accent);
}

/// 只改模式（设置页的分段控件）。
pub fn set_mode(theme: Theme, mode: ThemeMode) {
    theme.set_mode(mode);
    ls_set(K_MODE, mode_str(mode));
}

/// 只改强调色（设置页的色板）。
pub fn set_accent(theme: Theme, hex: &str) {
    if !is_hex(hex) {
        return;
    }
    let hex = hex.trim().to_string();
    theme.set_accent(Box::leak(hex.clone().into_boxed_str()));
    ls_set(K_ACCENT, &hex);
}

/* ---------------- 色板 ---------------- */

/// 设置页的强调色候选。第一个是默认值。
pub const ACCENTS: [&str; 10] = [
    "#0a84ff", "#5e5ce6", "#bf5af2", "#ff375f", "#ff9f0a", "#30d158", "#64d2ff", "#ffd60a",
    "#8e8e93", "#ff6482",
];
