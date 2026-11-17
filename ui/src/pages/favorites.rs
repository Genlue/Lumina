// ============================================================
// Lumina · 收藏
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;

use crate::grid::PhotoView;
use crate::state::App;

#[component]
pub fn FavoritesPage() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        <div class="lumina-page">
            {move || {
                if app.favorites.with(|f| f.is_empty()) {
                    return view! {
                        <div class="lumina-empty">
                            <Empty
                                icon=IconName::STAR_OFF
                                title="还没有收藏"
                                desc="在照片上点右键，或者打开灯箱按空格"
                            />
                        </div>
                    }
                    .into_any();
                }
                view! {
                    <PhotoView
                        items=Signal::derive(move || {
                            let list = app.favorites.get();
                            app.sort_filter(list)
                        })
                        view="all".to_string()
                    />
                }
                .into_any()
            }}
        </div>
    }
}
