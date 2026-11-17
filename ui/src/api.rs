#![allow(dead_code)]
// 后端命令的完整镜像：有些命令暂时没有页面调用，保留是为了「契约完整」。
// ============================================================
// Lumina · API
// 与 Rust 后端唯一的接触面。命令名与参数严格照 src-tauri/src/commands.rs。
// 浏览器里（没有 __TAURI__）所有调用都返回 Err，页面自己兜住。
// ============================================================

use serde::de::DeserializeOwned;
use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use crate::models::*;

/* ==========================================================================
   基础设施
   ========================================================================== */

fn global() -> JsValue {
    js_sys::global().into()
}

fn get(obj: &JsValue, key: &str) -> Option<JsValue> {
    js_sys::Reflect::get(obj, &JsValue::from_str(key)).ok()
}

/// `window.__TAURI__`；非桌面端为 None。
pub fn tauri() -> Option<JsValue> {
    let v = get(&global(), "__TAURI__")?;
    (!v.is_undefined() && !v.is_null()).then_some(v)
}

pub fn is_desktop() -> bool {
    tauri().is_some()
}

/// 控制台日志。wasm 里 panic 与 JS 异常都不会自己冒到终端，
/// 出问题时 `node scripts/devtools.mjs errors` 是唯一能看到的通道。
pub fn log(msg: &str) {
    web_sys::console::log_1(&JsValue::from_str(&format!("[lumina] {msg}")));
}

pub fn log_err(msg: &str) {
    web_sys::console::error_1(&JsValue::from_str(&format!("[lumina] {msg}")));
}

/// JS 异常 → 一行可读文本。Tauri 的 Err(String) 会以字符串形式 reject。
pub fn js_err(v: &JsValue) -> String {
    if let Some(s) = v.as_string() {
        return s;
    }
    get(v, "message")
        .and_then(|m| m.as_string())
        .unwrap_or_else(|| format!("{v:?}"))
}

/// 取 `__TAURI__.<ns>.<fn>` 并调用。
///
/// 用 `call0/1/2` 而不是 `Function::apply` + `Array::from_iter`：
/// 后者在 WebView2 上会抛 `Cannot convert object to primitive value`，
/// 而且调用点数本来就只有 0..2 个，显式分派更清楚。
fn call_ns(ns: &str, fname: &str, args: &[JsValue]) -> Result<JsValue, String> {
    let t = tauri().ok_or_else(|| "需要在 Lumina 桌面端运行".to_string())?;
    let ns_obj = get(&t, ns).ok_or_else(|| format!("缺少 __TAURI__.{ns}"))?;
    let f = get(&ns_obj, fname).ok_or_else(|| format!("缺少 __TAURI__.{ns}.{fname}"))?;
    let f: js_sys::Function = f.dyn_into().map_err(|_| format!("{ns}.{fname} 不是函数"))?;
    if let Some(first) = args.first() {
        let _ = first;
    }
    let ret = match args.len() {
        0 => f.call0(&ns_obj),
        1 => f.call1(&ns_obj, &args[0]),
        2 => f.call2(&ns_obj, &args[0], &args[1]),
        _ => {
            let arr = js_sys::Array::new();
            for a in args {
                arr.push(a);
            }
            f.apply(&ns_obj, &arr)
        }
    };
    ret.map_err(|e| js_err(&e))
}

/// 调一条后端命令。
pub async fn invoke<T: DeserializeOwned>(cmd: &str, args: JsValue) -> Result<T, String> {
    let ret = call_ns("core", "invoke", &[JsValue::from_str(cmd), args])?;
    let promise: js_sys::Promise = ret.dyn_into().map_err(|_| "invoke 未返回 Promise".to_string())?;
    let value = wasm_bindgen_futures::JsFuture::from(promise).await.map_err(|e| {
        let m = js_err(&e);
        log_err(&format!("invoke {cmd} 被拒绝：{m}"));
        m
    })?;
    serde_wasm_bindgen::from_value(value).map_err(|e| {
        let m = format!("{cmd} 返回值解析失败：{e}");
        log_err(&m);
        m
    })
}

/// 无返回值的命令（Rust 侧返回 `()`）。
pub async fn invoke_void(cmd: &str, args: JsValue) -> Result<(), String> {
    let ret = call_ns("core", "invoke", &[JsValue::from_str(cmd), args])?;
    let promise: js_sys::Promise = ret.dyn_into().map_err(|_| "invoke 未返回 Promise".to_string())?;
    wasm_bindgen_futures::JsFuture::from(promise)
        .await
        .map(|_| ())
        .map_err(|e| js_err(&e))
}

/// 把 Rust 结构体序列化成 invoke 的参数对象。
fn args<T: Serialize>(v: &T) -> JsValue {
    serde_wasm_bindgen::to_value(v).unwrap_or(JsValue::NULL)
}

/// 本地文件路径 → webview 可加载的 asset URL。
pub fn file_src(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }
    if let Ok(v) = call_ns("core", "convertFileSrc", &[JsValue::from_str(path)]) {
        if let Some(s) = v.as_string() {
            return s;
        }
    }
    // 兜底：与 @tauri-apps/api 的 convertFileSrc 同构。
    let mut enc = String::with_capacity(path.len() + 16);
    for c in path.chars() {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '!' | '~' | '*' | '\'' | '('
            | ')' => enc.push(c),
            _ => {
                let mut buf = [0u8; 4];
                for b in c.encode_utf8(&mut buf).bytes() {
                    enc.push_str(&format!("%{b:02X}"));
                }
            }
        }
    }
    format!("http://asset.localhost/{enc}")
}

/// 订阅后端事件。返回解绑函数；非桌面端返回空闭包。
pub fn listen<F>(name: &'static str, cb: F) -> Box<dyn Fn()>
where
    F: Fn(JsValue) + 'static,
{
    let Some(t) = tauri() else {
        return Box::new(|| {});
    };
    let Some(ev) = get(&t, "event") else {
        return Box::new(|| {});
    };
    let Some(f) = get(&ev, "listen").and_then(|f| f.dyn_into::<js_sys::Function>().ok()) else {
        return Box::new(|| {});
    };

    let closure = Closure::<dyn FnMut(JsValue)>::new(move |e: JsValue| {
        if let Some(payload) = get(&e, "payload") {
            cb(payload);
        }
    });

    let ret = f.call2(&ev, &JsValue::from_str(name), closure.as_ref().unchecked_ref());
    // 回调活到进程结束：事件订阅本来就与页面同寿命
    closure.forget();

    match ret.ok().and_then(|p| p.dyn_into::<js_sys::Promise>().ok()) {
        Some(p) => {
            let un = std::rc::Rc::new(std::cell::RefCell::new(None::<js_sys::Function>));
            let un2 = un.clone();
            wasm_bindgen_futures::spawn_local(async move {
                if let Ok(v) = wasm_bindgen_futures::JsFuture::from(p).await {
                    *un2.borrow_mut() = v.dyn_into::<js_sys::Function>().ok();
                }
            });
            Box::new(move || {
                if let Some(f) = un.borrow().as_ref() {
                    let _ = f.call0(&JsValue::UNDEFINED);
                }
            })
        }
        None => Box::new(|| {}),
    }
}

/* ==========================================================================
   图库 profile
   ========================================================================== */

pub async fn profiles_list() -> Result<Vec<Profile>, String> {
    invoke("profiles_list", JsValue::NULL).await
}

pub async fn profile_create(folder_path: &str, name: &str) -> Result<Profile, String> {
    invoke(
        "profiles_create",
        args(&serde_json::json!({ "folderPath": folder_path, "name": name })),
    )
    .await
}

pub async fn profile_remove(id: &str) -> Result<(), String> {
    invoke_void("profiles_remove", args(&serde_json::json!({ "id": id }))).await
}

pub async fn profile_touch(id: &str) -> Result<(), String> {
    invoke_void("profiles_touch", args(&serde_json::json!({ "id": id }))).await
}

pub async fn profile_mark_gone(id: &str) -> Result<(), String> {
    invoke_void("profiles_mark_gone", args(&serde_json::json!({ "id": id }))).await
}

pub async fn profile_check_path(folder_path: &str) -> Result<bool, String> {
    invoke(
        "profiles_check_path",
        args(&serde_json::json!({ "folderPath": folder_path })),
    )
    .await
}

pub async fn profile_relocate(id: &str) -> Result<Option<Profile>, String> {
    invoke("profiles_relocate", args(&serde_json::json!({ "id": id }))).await
}

/* ==========================================================================
   扫描
   ========================================================================== */

pub async fn scan_all(profile_id: &str) -> Result<ScanResult, String> {
    invoke(
        "scanner_scan_all",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn scan_folder(profile_id: &str, folder_path: &str) -> Result<ScanResult, String> {
    invoke(
        "scanner_scan_folder",
        args(&serde_json::json!({ "profileId": profile_id, "folderPath": folder_path })),
    )
    .await
}

pub async fn scan_list_folders(profile_id: &str) -> Result<Vec<String>, String> {
    invoke(
        "scanner_list_folders",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn scan_list_subfolders(profile_id: &str, parent_path: &str) -> Result<Vec<String>, String> {
    invoke(
        "scanner_list_subfolders",
        args(&serde_json::json!({ "profileId": profile_id, "parentPath": parent_path })),
    )
    .await
}

/* ==========================================================================
   缩略图
   ========================================================================== */

/// 单张缩略图。`size = 0` 返回原图路径（灯箱 / 壁纸用）。
pub async fn get_thumbnail(
    profile_id: &str,
    name: &str,
    folder: Option<&str>,
    size: u32,
) -> Result<ThumbnailResult, String> {
    invoke(
        "files_get_thumbnail",
        args(&serde_json::json!({
            "profileId": profile_id,
            "filename": name,
            "folder": folder,
            "size": if size == 0 { None } else { Some(size) },
        })),
    )
    .await
}

/// 批量缩略图：一次 IPC 拿多张，返回与入参同序的结果。
pub async fn get_thumbnails_batch(
    profile_id: &str,
    items: &[(String, Option<String>)],
    size: u32,
) -> Result<Vec<ThumbBatchItem>, String> {
    let requests: Vec<ThumbReq> = items
        .iter()
        .map(|(name, folder)| ThumbReq {
            filename: name.clone(),
            folder: folder.clone(),
        })
        .collect();
    invoke(
        "files_get_thumbnails_batch",
        args(&serde_json::json!({
            "profileId": profile_id,
            "requests": requests,
            "size": size,
        })),
    )
    .await
}

/* ==========================================================================
   文件
   ========================================================================== */

pub async fn file_rename(
    profile_id: &str,
    old_name: &str,
    new_name: &str,
    folder: Option<&str>,
) -> Result<(), String> {
    invoke_void(
        "files_rename",
        args(&serde_json::json!({
            "profileId": profile_id, "oldName": old_name, "newName": new_name, "folder": folder,
        })),
    )
    .await
}

pub async fn file_to_trash(profile_id: &str, filename: &str, folder: Option<&str>) -> Result<(), String> {
    invoke_void(
        "files_move_to_trash",
        args(&serde_json::json!({
            "profileId": profile_id, "filename": filename, "folder": folder,
        })),
    )
    .await
}

pub async fn file_permanent_delete(
    profile_id: &str,
    filename: &str,
    folder: Option<&str>,
) -> Result<(), String> {
    invoke_void(
        "files_permanent_delete",
        args(&serde_json::json!({
            "profileId": profile_id, "filename": filename, "folder": folder,
        })),
    )
    .await
}

pub async fn file_to_folder(
    profile_id: &str,
    filename: &str,
    target_folder: &str,
) -> Result<(), String> {
    invoke_void(
        "files_move_to_folder",
        args(&serde_json::json!({
            "profileId": profile_id, "filename": filename, "targetFolder": target_folder,
        })),
    )
    .await
}

pub async fn file_between_folders(
    profile_id: &str,
    filename: &str,
    from_folder: Option<&str>,
    to_folder: &str,
) -> Result<(), String> {
    invoke_void(
        "files_move_between_folders",
        args(&serde_json::json!({
            "profileId": profile_id, "filename": filename,
            "fromFolder": from_folder, "toFolder": to_folder,
        })),
    )
    .await
}

pub async fn file_to_root(
    profile_id: &str,
    filename: &str,
    from_folder: Option<&str>,
) -> Result<(), String> {
    invoke_void(
        "files_move_to_root",
        args(&serde_json::json!({
            "profileId": profile_id, "filename": filename, "fromFolder": from_folder,
        })),
    )
    .await
}

/* ==========================================================================
   目录 / 相册
   ========================================================================== */

pub async fn folder_create(
    profile_id: &str,
    name: &str,
    parent: Option<&str>,
) -> Result<(), String> {
    invoke_void(
        "folders_create",
        args(&serde_json::json!({ "profileId": profile_id, "name": name, "parent": parent })),
    )
    .await
}

pub async fn folder_delete(profile_id: &str, folder_path: &str, move_up: bool) -> Result<(), String> {
    invoke_void(
        "folders_delete",
        args(&serde_json::json!({
            "profileId": profile_id, "folderPath": folder_path, "moveUp": move_up,
        })),
    )
    .await
}

pub async fn folder_rename(profile_id: &str, folder_path: &str, new_name: &str) -> Result<(), String> {
    invoke_void(
        "folders_rename",
        args(&serde_json::json!({
            "profileId": profile_id, "folderPath": folder_path, "newName": new_name,
        })),
    )
    .await
}

pub async fn albums_list(profile_id: &str) -> Result<Vec<Album>, String> {
    invoke(
        "albums_list",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn album_set_cover(
    profile_id: &str,
    folder_name: &str,
    image_name: &str,
) -> Result<(), String> {
    invoke_void(
        "albums_set_cover",
        args(&serde_json::json!({
            "profileId": profile_id, "folderName": folder_name, "imageName": image_name,
        })),
    )
    .await
}

pub async fn album_set_order(profile_id: &str, folder_name: &str, order: &str) -> Result<(), String> {
    invoke_void(
        "albums_set_order",
        args(&serde_json::json!({
            "profileId": profile_id, "folderName": folder_name, "order": order,
        })),
    )
    .await
}

/* ==========================================================================
   收藏 / 回收站
   ========================================================================== */

pub async fn favorites_list(profile_id: &str) -> Result<Vec<FavoriteRecord>, String> {
    invoke(
        "favorites_list",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn favorite_toggle(
    profile_id: &str,
    filename: &str,
    folder: Option<&str>,
) -> Result<bool, String> {
    invoke(
        "favorites_toggle",
        args(&serde_json::json!({
            "profileId": profile_id, "filename": filename, "folder": folder,
        })),
    )
    .await
}

pub async fn favorites_count(profile_id: &str) -> Result<i64, String> {
    invoke(
        "favorites_count",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn favorites_export(profile_id: &str) -> Result<String, String> {
    invoke(
        "favorites_export",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn favorites_import(profile_id: &str, data: &str, mode: &str) -> Result<i64, String> {
    invoke(
        "favorites_import",
        args(&serde_json::json!({ "profileId": profile_id, "data": data, "mode": mode })),
    )
    .await
}

pub async fn favorites_copy_to_backgrounds(profile_id: &str, filenames: Vec<String>) -> Result<FavCopyResult, String> {
    invoke(
        "favorites_copy_to_backgrounds",
        args(&serde_json::json!({ "profileId": profile_id, "filenames": filenames })),
    )
    .await
}

pub async fn trash_list(profile_id: &str) -> Result<Vec<TrashRecord>, String> {
    invoke(
        "trash_list",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn trash_restore(
    profile_id: &str,
    trash_name: &str,
    original_name: &str,
    original_folder: Option<&str>,
) -> Result<String, String> {
    invoke(
        "trash_restore",
        args(&serde_json::json!({
            "profileId": profile_id, "trashName": trash_name,
            "originalName": original_name, "originalFolder": original_folder,
        })),
    )
    .await
}

pub async fn trash_count(profile_id: &str) -> Result<i64, String> {
    invoke(
        "trash_count",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn trash_empty(profile_id: &str) -> Result<i64, String> {
    invoke(
        "trash_empty",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

/* ==========================================================================
   设置
   ========================================================================== */

pub async fn settings_get(profile_id: &str) -> Result<Settings, String> {
    invoke(
        "settings_get",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn settings_save(profile_id: &str, updates: serde_json::Value) -> Result<Settings, String> {
    invoke(
        "settings_save",
        args(&serde_json::json!({ "profileId": profile_id, "updates": updates })),
    )
    .await
}

pub async fn theme_extract_colors(profile_id: &str, filename: &str) -> Result<ThemeColors, String> {
    invoke(
        "theme_extract_colors",
        args(&serde_json::json!({ "profileId": profile_id, "filename": filename })),
    )
    .await
}

pub async fn system_get_accent_color() -> Result<String, String> {
    invoke("system_get_accent_color", JsValue::NULL).await
}

pub async fn system_list_fonts() -> Result<Vec<String>, String> {
    invoke("system_list_fonts", JsValue::NULL).await
}

/* ==========================================================================
   缓存
   ========================================================================== */

pub async fn cache_info(profile_id: &str) -> Result<CacheInfo, String> {
    invoke(
        "cache_get_info",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn cache_clear(profile_id: &str) -> Result<u64, String> {
    invoke(
        "cache_clear",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

pub async fn cache_generate(profile_id: &str, sizes: Vec<u32>) -> Result<usize, String> {
    invoke(
        "cache_generate",
        args(&serde_json::json!({ "profileId": profile_id, "sizes": sizes })),
    )
    .await
}

pub async fn cache_generate_cancel() -> Result<(), String> {
    invoke_void("cache_generate_cancel", JsValue::NULL).await
}

pub async fn cache_generate_status() -> Result<CacheGenStatus, String> {
    invoke("cache_generate_status", JsValue::NULL).await
}

pub async fn cache_reconcile(profile_id: &str) -> Result<ReconcileReport, String> {
    invoke(
        "cache_reconcile",
        args(&serde_json::json!({ "profileId": profile_id })),
    )
    .await
}

/* ==========================================================================
   系统 / 窗口
   ========================================================================== */

pub async fn open_in_explorer(path: &str) -> Result<(), String> {
    invoke_void("open_in_explorer", args(&serde_json::json!({ "path": path }))).await
}

pub async fn dialog_open_folder(title: Option<&str>) -> Result<Option<String>, String> {
    invoke(
        "dialog_open_folder",
        args(&serde_json::json!({ "title": title })),
    )
    .await
}

pub async fn read_text_file(path: &str) -> Result<String, String> {
    invoke("read_text_file", args(&serde_json::json!({ "path": path }))).await
}

pub async fn write_text_file(path: &str, content: &str) -> Result<(), String> {
    invoke_void(
        "write_text_file",
        args(&serde_json::json!({ "path": path, "content": content })),
    )
    .await
}

pub async fn window_set_effect(enabled: bool, effect_type: Option<&str>) -> Result<(), String> {
    invoke_void(
        "window_set_effect",
        args(&serde_json::json!({ "enabled": enabled, "effectType": effect_type })),
    )
    .await
}

pub async fn window_set_titlebar(mode: &str) -> Result<(), String> {
    invoke_void("window_set_titlebar", args(&serde_json::json!({ "mode": mode }))).await
}

/// 窗口按钮：关闭 / 最小化 / 最大化。走 `__TAURI__.window`，不额外引插件。
pub fn window_action(action: &str) {
    let Some(t) = tauri() else { return };
    let Some(win) = get(&t, "window") else { return };
    let Some(get_current) = get(&win, "getCurrentWindow").and_then(|f| f.dyn_into::<js_sys::Function>().ok()) else {
        return;
    };
    let Ok(w) = get_current.call0(&win) else { return };
    let Some(f) = get(&w, action).and_then(|f| f.dyn_into::<js_sys::Function>().ok()) else {
        return;
    };
    let Ok(ret) = f.call0(&w) else { return };
    if let Ok(p) = ret.dyn_into::<js_sys::Promise>() {
        wasm_bindgen_futures::spawn_local(async move {
            let _ = wasm_bindgen_futures::JsFuture::from(p).await;
        });
    }
}

/// 原生保存对话框（收藏导出）。返回用户选定的路径。
pub async fn dialog_save_json(default_name: &str) -> Result<Option<String>, String> {
    let Some(t) = tauri() else { return Ok(None) };
    let Some(d) = get(&t, "dialog") else { return Ok(None) };
    let Some(f) = get(&d, "save").and_then(|f| f.dyn_into::<js_sys::Function>().ok()) else {
        return Ok(None);
    };
    let opts = serde_wasm_bindgen::to_value(&serde_json::json!({
        "defaultPath": default_name,
        "filters": [{ "name": "收藏文件", "extensions": ["json"] }],
    }))
    .unwrap_or(JsValue::NULL);
    let ret = f.call1(&d, &opts).map_err(|e| js_err(&e))?;
    let p: js_sys::Promise = ret.dyn_into().map_err(|_| "save 未返回 Promise".to_string())?;
    let v = wasm_bindgen_futures::JsFuture::from(p).await.map_err(|e| js_err(&e))?;
    Ok(v.as_string())
}

/// 原生打开对话框（收藏导入）。
pub async fn dialog_open_json() -> Result<Option<String>, String> {
    let Some(t) = tauri() else { return Ok(None) };
    let Some(d) = get(&t, "dialog") else { return Ok(None) };
    let Some(f) = get(&d, "open").and_then(|f| f.dyn_into::<js_sys::Function>().ok()) else {
        return Ok(None);
    };
    let opts = serde_wasm_bindgen::to_value(&serde_json::json!({
        "multiple": false,
        "filters": [{ "name": "收藏文件", "extensions": ["json"] }],
    }))
    .unwrap_or(JsValue::NULL);
    let ret = f.call1(&d, &opts).map_err(|e| js_err(&e))?;
    let p: js_sys::Promise = ret.dyn_into().map_err(|_| "open 未返回 Promise".to_string())?;
    let v = wasm_bindgen_futures::JsFuture::from(p).await.map_err(|e| js_err(&e))?;
    // multiple:false 时返回 string | null
    Ok(v.as_string())
}
