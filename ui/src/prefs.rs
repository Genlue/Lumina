// ============================================================
// Lumina · 界面偏好
// 只放「不属于 Settings 表」的纯显示参数（每行图片数、图片间距、导航栏开合）。
// 存在 localStorage：这些值跟着窗口走，不跟着图库走。
// ============================================================

use wasm_bindgen::JsCast;

const K: &str = "lumina.ui.prefs.v1";

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UiPrefs {
    /// 每行图片数；0 = 按缩略图尺寸自动铺满
    pub grid_columns: u32,
    /// 图片间距（px）
    pub grid_gap: u32,
    /// 导航栏是否收起
    pub nav_hidden: bool,
}

impl Default for UiPrefs {
    fn default() -> Self {
        Self {
            grid_columns: 0,
            grid_gap: 8,
            nav_hidden: false,
        }
    }
}

impl UiPrefs {
    fn encode(&self) -> String {
        format!(
            "{{\"gridColumns\":{},\"gridGap\":{},\"navHidden\":{}}}",
            self.grid_columns, self.grid_gap, self.nav_hidden
        )
    }
}

fn ls() -> Option<js_sys::Object> {
    let v = js_sys::Reflect::get(&js_sys::global(), &wasm_bindgen::JsValue::from_str("localStorage")).ok()?;
    if v.is_undefined() || v.is_null() {
        return None;
    }
    v.dyn_into::<js_sys::Object>().ok()
}

pub fn load() -> UiPrefs {
    let mut out = UiPrefs::default();
    let Some(store) = ls() else { return out };
    let Ok(get) = js_sys::Reflect::get(&store, &"getItem".into())
        .and_then(|v| v.dyn_into::<js_sys::Function>().map_err(|_| wasm_bindgen::JsValue::NULL))
    else {
        return out;
    };
    let Ok(raw) = get.call1(&store, &K.into()) else { return out };
    let Some(text) = raw.as_string() else { return out };
    let Ok(v) = js_sys::JSON::parse(&text) else { return out };

    let num = |name: &str| -> Option<f64> {
        js_sys::Reflect::get(&v, &name.into())
            .ok()
            .and_then(|x| x.as_f64())
    };
    if let Some(n) = num("gridColumns") {
        out.grid_columns = n.clamp(0.0, 12.0) as u32;
    }
    if let Some(n) = num("gridGap") {
        out.grid_gap = n.clamp(0.0, 24.0) as u32;
    }
    if let Ok(b) = js_sys::Reflect::get(&v, &"navHidden".into()) {
        out.nav_hidden = b.as_bool().unwrap_or(false);
    }
    out
}

pub fn save(p: UiPrefs) {
    let Some(store) = ls() else { return };
    let Ok(set) = js_sys::Reflect::get(&store, &"setItem".into())
        .and_then(|v| v.dyn_into::<js_sys::Function>().map_err(|_| wasm_bindgen::JsValue::NULL))
    else {
        return;
    };
    let _ = set.call2(&store, &K.into(), &p.encode().into());
}
