// ============================================================
// Lumina · 发现
// 一个页面三种形态：瀑布流 / 随机抽卡 / 幻灯片。
// 数据源就是全部照片，只是换一种看法。
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;
use wasm_bindgen::JsCast;

use crate::grid::open_lightbox;
use crate::models::*;
use crate::state::{App, DiscoverTab};

#[component]
pub fn DiscoverPage() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        {move || {
            let tab = app.route.get().tab;
            match tab {
                DiscoverTab::Waterfall => view! { <Waterfall /> }.into_any(),
                DiscoverTab::Draw => view! { <Draw /> }.into_any(),
                DiscoverTab::Slideshow => view! { <Slideshow /> }.into_any(),
            }
        }}
    }
}

/* ==========================================================================
   缩略图小工具：任何形态都用同一条批量通道
   ========================================================================== */

#[component]
fn Thumb(
    #[prop(into)] img: Image,
    #[prop(optional)] class: &'static str,
    /// 请求的缩略图边长。抽卡 / 幻灯片要铺满一屏，用比瀑布流更大的档。
    #[prop(optional)] px: Option<u32>,
) -> impl IntoView {
    let app = App::use_ctx();
    let size = px.unwrap_or_else(|| {
        app.settings
            .with(|s| ((s.thumbnail_size as f64 * 1.25).round() as u32).max(240))
    });
    let t = app.thumbs;
    let key = crate::state::Thumbs::key(img.folder.as_deref(), &img.name, size);
    let url = RwSignal::new(t.get(&key));
    if url.get_untracked().is_none() {
        t.request(key.clone(), img.name.clone(), img.folder.clone(), size);
        let watch = key.clone();
        Effect::new(move |_| {
            if let Some(v) = t.map.with(|m| m.get(&watch).cloned()) {
                url.set(Some(v));
            }
        });
    }
    let alt = img.name.clone();
    let open = img.clone();

    view! {
        <img
            class=class
            src=move || url.get().unwrap_or_default()
            loading="lazy"
            alt=alt
            on:click=move |_| open_lightbox(app, open.clone())
        />
    }
}

/* ==========================================================================
   瀑布流
   ========================================================================== */

#[component]
fn Waterfall() -> impl IntoView {
    let app = App::use_ctx();
    let seed = RwSignal::new(0u64);

    view! {
        <div class="lumina-page lumina-page--flush">
            {move || {
                let mut list = app.visible("all");
                if list.is_empty() {
                    return view! {
                        <div class="lumina-empty">
                            <Empty icon=IconName::IMAGE_OFF title="还没有照片" desc="先导入一个图库文件夹" />
                        </div>
                    }
                    .into_any();
                }
                // 换一批：用一个自增种子把顺序打散（不引随机库）
                let s = seed.get();
                if s > 0 {
                    let n = list.len();
                    list.rotate_left((s as usize * 977) % n.max(1));
                }
                list.truncate(240);

                view! {
                    <div style="display:flex;justify-content:flex-end;padding:0 24px 12px">
                        <Button
                            label="换一批"
                            icon=IconName::SHUFFLE
                            variant=ButtonVariant::Plain
                            size=Size::Sm
                            on_click=Callback::new(move |_| seed.update(|s| *s += 1))
                        />
                    </div>
                    <div class="lumina-waterfall">
                        {list.into_iter().map(|img| view! {
                            <div class="lumina-waterfall__item"><Thumb img=img /></div>
                        }).collect_view()}
                    </div>
                }
                .into_any()
            }}
        </div>
    }
}

/* ==========================================================================
   随机抽卡
   ========================================================================== */

#[component]
fn Draw() -> impl IntoView {
    let app = App::use_ctx();
    let pool = RwSignal::new(Vec::<Image>::new());
    let idx = RwSignal::new(0usize);
    let timer = RwSignal::new(None::<i32>);

    // 抽一批
    let refill = move || {
        let mut all = app.visible("all");
        if all.is_empty() {
            pool.set(Vec::new());
            return;
        }
        let want = app.settings.with(|s| s.draw_count.max(1) as usize).min(all.len());
        // 均匀抽：从全长里按固定步长取，比 rand 更好复现
        let step = (all.len() / want).max(1);
        let mut out = Vec::with_capacity(want);
        let mut i = (idx.get_untracked() * 31) % all.len();
        while out.len() < want {
            out.push(all[i % all.len()].clone());
            i += step;
        }
        all.clear();
        pool.set(out);
        idx.set(0);
    };

    Effect::new(move |_| refill());

    let stop_timer = move || {
        if let Some(id) = timer.get_untracked() {
            if let Some(w) = web_sys::window() {
                w.clear_interval_with_handle(id);
            }
            timer.set(None);
        }
    };

    let start_timer = move || {
        stop_timer();
        let secs = app.settings.with(|s| s.random_interval.max(1)) as i32;
        if let Some(w) = web_sys::window() {
            let cb = wasm_bindgen::closure::Closure::<dyn FnMut()>::new(move || {
                let n = pool.with(|p| p.len());
                if n > 0 {
                    idx.update(|i| *i = (*i + 1) % n);
                }
            });
            if let Ok(id) = w.set_interval_with_callback_and_timeout_and_arguments_0(
                cb.as_ref().unchecked_ref(),
                secs as i32 * 1000,
            ) {
                timer.set(Some(id));
            }
            cb.forget();
        }
    };

    on_cleanup(move || stop_timer());

    view! {
        <div class="lumina-page lumina-page--flush">
            {move || {
                let list = pool.get();
                if list.is_empty() {
                    return view! {
                        <div class="lumina-empty">
                            <Empty icon=IconName::SPARKLES title="没有可抽的照片" desc="先导入一个图库文件夹" />
                        </div>
                    }
                    .into_any();
                }
                let cur = list[idx.get().min(list.len() - 1)].clone();
                view! {
                    <div class="lumina-draw">
                        <div class="lumina-draw__frame">
                            <Thumb img=cur px=1200 />
                        </div>
                        <Cluster>
                            <Button
                                label="再来一张"
                                icon=IconName::SHUFFLE
                                variant=ButtonVariant::Primary
                                size=Size::Lg
                                on_click=Callback::new(move |_| {
                                    let n = pool.with(|p| p.len());
                                    if n > 0 {
                                        idx.update(|i| *i = (*i + 1) % n);
                                    }
                                })
                            />
                            <Button
                                label="重新抽一批"
                                icon=IconName::REFRESH_CW
                                variant=ButtonVariant::Plain
                                on_click=Callback::new(move |_| refill())
                            />
                            <Switch
                                label="自动切换"
                                checked=Signal::derive(move || timer.get().is_some())
                                on_change=Callback::new(move |on: bool| {
                                    if on {
                                        start_timer();
                                    } else {
                                        stop_timer();
                                    }
                                })
                            />
                        </Cluster>
                        <span class="c-subtitle">
                            {move || {
                                let n = pool.with(|p| p.len());
                                format!("第 {} / {n} 张 · 共 {} 张照片", idx.get() + 1, app.total_count())
                            }}
                        </span>
                    </div>
                }
                .into_any()
            }}
        </div>
    }
}

/* ==========================================================================
   幻灯片
   ========================================================================== */

#[component]
fn Slideshow() -> impl IntoView {
    let app = App::use_ctx();
    let playing = RwSignal::new(true);
    let idx = RwSignal::new(0usize);
    let list = RwSignal::new(Vec::<Image>::new());

    Effect::new(move |_| list.set(app.visible("all")));

    let secs = app.settings.with(|s| s.random_interval.max(1));

    Effect::new(move |_| {
        let cb = wasm_bindgen::closure::Closure::<dyn FnMut()>::new(move || {
            if !playing.get_untracked() {
                return;
            }
            let n = list.with(|l| l.len());
            if n > 0 {
                idx.update(|i| *i = (*i + 1) % n);
            }
        });
        let id = web_sys::window().and_then(|w| {
            w.set_interval_with_callback_and_timeout_and_arguments_0(
                cb.as_ref().unchecked_ref(),
                secs as i32 * 1000,
            )
            .ok()
        });
        cb.forget();
        on_cleanup(move || {
            if let (Some(w), Some(id)) = (web_sys::window(), id) {
                w.clear_interval_with_handle(id);
            }
        });
    });

    view! {
        <div class="lumina-slideshow">
            {move || {
                let l = list.get();
                if l.is_empty() {
                    return view! {
                        <Empty icon=IconName::PLAY title="没有可播放的照片" desc="先导入一个图库文件夹" />
                    }
                    .into_any();
                }
                let cur = l[idx.get().min(l.len() - 1)].clone();
                view! {
                    <Thumb img=cur px=1600 />
                    <div class="lumina-lightbox__bar">
                        <Capsule size=CapsuleSize::Auto>
                            <IconButton
                                icon=if playing.get() { IconName::PAUSE } else { IconName::PLAY }
                                label=if playing.get() { "暂停" } else { "继续" }
                                on_click=Callback::new(move |_| playing.update(|p| *p = !*p))
                            />
                            <IconButton
                                icon=IconName::CHEVRON_LEFT
                                label="上一张"
                                on_click=Callback::new(move |_| {
                                    let n = list.with(|l| l.len());
                                    if n > 0 {
                                        idx.update(|i| *i = (*i + n - 1) % n);
                                    }
                                })
                            />
                            <IconButton
                                icon=IconName::CHEVRON_RIGHT
                                label="下一张"
                                on_click=Callback::new(move |_| {
                                    let n = list.with(|l| l.len());
                                    if n > 0 {
                                        idx.update(|i| *i = (*i + 1) % n);
                                    }
                                })
                            />
                            <span class="lumina-lightbox__count">
                                {move || format!("{} / {}", idx.get() + 1, list.with(|l| l.len()))}
                            </span>
                        </Capsule>
                    </div>
                }
                .into_any()
            }}
        </div>
    }
}

/// 发现页的图片不做缓存清理，切走时由 Thumbs 全局缓存统一管理。
#[allow(dead_code)]
fn noop() {
    spawn_local(async {});
}
