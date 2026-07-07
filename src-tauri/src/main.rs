#![windows_subsystem = "windows"]

mod db;
mod models;
mod repos;
mod services;
mod commands;

use std::path::PathBuf;
use tauri::Manager;


fn db_path() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    exe_dir.join("data").join("photo-album.db")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = db_path();
            println!("[DB] Central DB path: {}", path.display());
            let db_state = db::init_central_database(&path)
                .expect("Failed to initialize central database");
            app.manage(db_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::profiles_create,
            commands::profiles_list,
            commands::profiles_get_by_id,
            commands::profiles_remove,
            commands::profiles_touch,
            commands::profiles_mark_gone,
            commands::profiles_check_path,
            commands::profiles_relocate,
            commands::scanner_scan_all,
            commands::scanner_scan_folder,
            commands::scanner_list_folders,
            commands::scanner_list_subfolders,
            commands::files_get_thumbnail,
            commands::files_get_thumbnails_batch,
            commands::files_rename,
            commands::files_move_to_trash,
            commands::files_permanent_delete,
            commands::files_move_to_folder,
            commands::files_move_between_folders,
            commands::files_move_to_root,
            commands::folders_create,
            commands::folders_delete,
            commands::folders_rename,
            commands::albums_set_cover,
            commands::albums_set_order,
            commands::albums_list,
            commands::favorites_toggle,
            commands::favorites_list,
            commands::favorites_is_favorite,
            commands::favorites_count,
            commands::trash_list,
            commands::trash_restore,
            commands::trash_count,
            commands::trash_empty,
            commands::settings_get,
            commands::settings_save,
            commands::theme_extract_colors,
            commands::bg_import,
            commands::bg_open_folder,
            commands::open_in_explorer,
            commands::bg_delete,
            commands::dialog_open_folder,
            commands::cache_get_info,
            commands::cache_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
