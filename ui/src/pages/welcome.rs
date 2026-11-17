// ============================================================
// Lumina · 欢迎页（还没有图库）
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;

use crate::state::App;

#[component]
pub fn Welcome() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        <div class="lumina-welcome">
            <div class="lumina-welcome__inner">
                <Icon name=IconName::IMAGES size=44 />
                <div class="lumina-welcome__title">"把照片留在这台电脑上"</div>
                <p class="lumina-welcome__desc">
                    "Lumina 只做索引、缩略图和组织。选一个装照片的文件夹，它就会成为你的第一个图库 —— 文件不会被移动，也不会被上传。"
                </p>
                <Cluster>
                    <Button
                        label="选择文件夹"
                        icon=IconName::FOLDER_PLUS
                        variant=ButtonVariant::Primary
                        size=Size::Lg
                        on_click=Callback::new(move |_| app.add_profile())
                    />
                </Cluster>
                <span class="c-subtitle">
                    "也可以直接把文件夹拖进来（在「设置 → 数据」里随时能加更多图库）"
                </span>
            </div>
        </div>
    }
}
