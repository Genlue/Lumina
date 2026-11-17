// 数据镜像与命令面按后端契约写全，个别字段当前没有页面消费，不当作死代码。
#![allow(dead_code)]

// ============================================================
// Lumina · 前端入口
// Leptos CSR + GlassDesign。产物是 wasm，由 ui/index.html 加载。
// ============================================================

mod api;
mod grid;
mod lightbox;
mod models;
mod pages;
mod prefs;
mod search;
mod shell;
mod state;
mod theme;
mod ui;

use glass_design::prelude::*;
use leptos::prelude::*;

use state::App;

#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn start() {
    // wasm 里 panic 只会变成一句 `unreachable`，堆栈全是 wasm 函数号。
    // 装个 hook 把真正的消息打到控制台，`devtools.mjs errors` 才读得到。
    std::panic::set_hook(Box::new(|info| {
        web_sys::console::error_1(&wasm_bindgen::JsValue::from_str(&format!(
            "[lumina panic] {info}"
        )));
    }));

    // 首帧之前先把缓存里的主题铺上，避免「先白一下再变深色」。
    bootstrap_with(
        Root,
        BootstrapOptions {
            theme: theme::cached_mode(),
            accent: theme::cached_accent(),
            ..Default::default()
        },
    );
}

#[component]
fn Root() -> impl IntoView {
    let app = App::provide();
    let th = use_context::<Theme>().expect("Theme 由 bootstrap 提供");

    // Settings → Theme：只在「真正影响主题的四个字段」变化时才跑。
    // 用 Memo 收窄依赖：拖缩略图尺寸滑块不该连带重设主题。
    let theme_key = Memo::new(move |_| theme::key_of(&app.settings.get()));
    Effect::new(move |_| {
        let k = theme_key.get();
        theme::apply_key(th, &k);
    });

    // 启动：只列图库，停在封面页
    Effect::new(move |_| app.boot());

    // —— 全局监听：只在根上注册一次 ——
    // 放到页面里注册会随切页反复叠加（Delete 会删两次），
    // 放到会销毁的组件里注册则会在切屏后写已释放的信号。
    shell::track_window_focus(app);
    grid::wire_shortcuts(app);
    lightbox::wire_lightbox_keys(app);

    view! {
        <shell::Shell />
        <lightbox::LightboxView />
        <pages::dialog::ModalHost />
    }
}
