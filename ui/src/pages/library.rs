// ============================================================
// Lumina · 全部照片
// ============================================================

use leptos::prelude::*;

use crate::grid::PhotoView;
use crate::state::App;

#[component]
pub fn LibraryPage() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        <div class="lumina-page">
            <PhotoView
                items=Signal::derive(move || app.visible("all"))
                view="all".to_string()
            />
        </div>
    }
}
