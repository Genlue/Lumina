// ============================================================
// Lumina · 灯箱
// 覆盖层，不是页面。背景 = 当前图放大 + 模糊 + 暗化
// （用 filter 作用在一张副本上，不用 backdrop-filter）。
//
// 原图 URL 存在 Lightbox 自己身上，不在渲染闭包里建信号：
// 渲染闭包每次重跑都会 new 一个 RwSignal，值刚写进去就被丢掉，
// 表现是「永远转圈」。
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;
use wasm_bindgen::JsCast;

use crate::api;
use crate::models::*;
use crate::state::App;
use crate::ui::toast;

#[derive(Debug, Clone, PartialEq)]
pub struct Lightbox {
    pub list: Vec<Image>,
    pub index: usize,
    pub rotation: i32,
    pub from_view: String,
    /// 当前图的原图 URL；`None` = 正在加载
    pub url: Option<String>,
    /// 背景层用的同一张（CSS 里再模糊）
    pub bg: Option<String>,
    /// 正在加载的图片键，用来丢弃过期响应
    pub loading: String,
}

impl Lightbox {
    pub fn new(list: Vec<Image>, index: usize, from_view: String) -> Self {
        Self {
            list,
            index,
            rotation: 0,
            from_view,
            url: None,
            bg: None,
            loading: String::new(),
        }
    }

    pub fn current(&self) -> Option<&Image> {
        self.list.get(self.index)
    }

    pub fn next(&mut self) {
        if self.list.is_empty() {
            return;
        }
        self.index = (self.index + 1) % self.list.len();
        // 翻页必须重置旋转，否则上一张的 90° 会带到下一张
        self.rotation = 0;
        self.url = None;
        self.bg = None;
    }

    pub fn prev(&mut self) {
        if self.list.is_empty() {
            return;
        }
        self.index = (self.index + self.list.len() - 1) % self.list.len();
        self.rotation = 0;
        self.url = None;
        self.bg = None;
    }
}

/// 把当前图的原图拉回来。切页 / 翻页后都要调一次。
pub fn load_current(app: App) {
    let Some(lb) = app.lightbox.get_untracked() else {
        return;
    };
    let Some(img) = lb.current().cloned() else {
        return;
    };
    // 已经在飞了就别再发一次：这个函数被 Effect 调用，
    // 而它自己会写 lightbox，不挡住就是一个无限请求循环。
    if lb.loading == img.key {
        return;
    }
    let key = img.key.clone();
    app.lightbox.update(|l| {
        if let Some(x) = l {
            x.loading = key.clone();
        }
    });

    let profile = app.profile_id.get_untracked();
    spawn_local(async move {
        match api::get_thumbnail(&profile, &img.name, img.folder.as_deref(), 0).await {
            Ok(res) => {
                let src = api::file_src(&res.data_url);
                app.lightbox.update(|l| {
                    if let Some(x) = l {
                        if x.current().map(|i| i.key == key).unwrap_or(false) {
                            x.url = Some(src.clone());
                            x.bg = Some(src);
                        }
                    }
                });
            }
            Err(e) => {
                api::log_err(&format!("原图加载失败：{e}"));
                toast(format!("打不开这张图：{e}"));
                app.lightbox.set(None);
            }
        }
    });
}

#[component]
pub fn LightboxView() -> impl IntoView {
    let app = App::use_ctx();

    // 打开 / 翻页后拉原图
    Effect::new(move |_| {
        let Some(lb) = app.lightbox.get() else {
            return;
        };
        if lb.url.is_none() {
            load_current(app);
        }
    });

    view! {
        {move || {
            let Some(lb) = app.lightbox.get() else {
                return ().into_any();
            };
            let Some(img) = lb.current().cloned() else {
                return ().into_any();
            };
            let total = lb.list.len();
            let index = lb.index;
            let rotation = lb.rotation;
            let fav = app.is_fav(&img.key);
            let url = lb.url.clone();
            let bg = lb.bg.clone();

            let close = move || app.lightbox.set(None);
            let prev = move || app.lightbox.update(|l| { if let Some(x) = l { x.prev() } });
            let next = move || app.lightbox.update(|l| { if let Some(x) = l { x.next() } });
            let rotate = move |delta: i32| {
                app.lightbox.update(|l| {
                    if let Some(x) = l {
                        x.rotation = (x.rotation + delta).rem_euclid(360);
                    }
                })
            };
            let toggle_fav = move || {
                let profile = app.profile_id.get_untracked();
                let img = img.clone();
                spawn_local(async move {
                    if api::favorite_toggle(&profile, &img.name, img.folder.as_deref())
                        .await
                        .is_ok()
                    {
                        app.reload_favorites();
                    }
                });
            };

            view! {
                <div
                    class="lumina-lightbox"
                    on:click=move |ev: web_sys::MouseEvent| {
                        // 点图片外面任意区域退出
                        if let Some(t) = ev.target() {
                            if let Some(el) = t.dyn_ref::<web_sys::HtmlElement>() {
                                if el.class_list().contains("lumina-lightbox__img") {
                                    return;
                                }
                            }
                        }
                        close();
                    }
                    on:wheel=move |ev: web_sys::WheelEvent| {
                        if ev.delta_y() > 0.0 { next(); } else { prev(); }
                    }
                >
                    {bg.map(|src| view! {
                        <div class="lumina-lightbox__bg" style=format!("background-image:url(\"{src}\")")></div>
                    })}
                    <div class="lumina-lightbox__stage">
                        {match url {
                            Some(src) => view! {
                                <img
                                    class="lumina-lightbox__img"
                                    src=src
                                    alt=""
                                    style=format!("transform:rotate({rotation}deg)")
                                />
                            }.into_any(),
                            None => view! { <Spinner label="载入中" /> }.into_any(),
                        }}
                    </div>

                    <div class="lumina-lightbox__bar">
                        <Capsule size=CapsuleSize::Auto>
                            <IconButton icon=IconName::CHEVRON_LEFT label="上一张" on_click=Callback::new(move |_| prev()) />
                            <IconButton icon=IconName::CHEVRON_RIGHT label="下一张" on_click=Callback::new(move |_| next()) />
                            <span class="lumina-lightbox__count">
                                {format!("{} / {total}", index + 1)}
                            </span>
                            <IconButton
                                icon=IconName::ROTATE_CCW
                                label="逆时针旋转"
                                on_click=Callback::new(move |_| rotate(-90))
                            />
                            <IconButton
                                icon=IconName::ROTATE_CW
                                label="顺时针旋转"
                                on_click=Callback::new(move |_| rotate(90))
                            />
                            <IconButton
                                icon=if fav { IconName::STAR_OFF } else { IconName::STAR }
                                label=if fav { "取消收藏" } else { "收藏" }
                                active=fav
                                on_click=Callback::new(move |_| toggle_fav())
                            />
                            <IconButton icon=IconName::X label="关闭" on_click=Callback::new(move |_| close()) />
                        </Capsule>
                    </div>
                </div>
            }
            .into_any()
        }}
    }
}

/// 灯箱键盘：←/→ 翻页、R 旋转、Esc 关闭、空格收藏。
pub fn wire_lightbox_keys(app: App) {
    Effect::new(move |_| {
        let Some(win) = web_sys::window() else { return };
        let cb = wasm_bindgen::closure::Closure::<dyn FnMut(web_sys::KeyboardEvent)>::new(
            move |ev: web_sys::KeyboardEvent| {
                if app.lightbox.with(|l| l.is_none()) {
                    return;
                }
                match ev.key().as_str() {
                    "ArrowLeft" => {
                        ev.prevent_default();
                        app.lightbox.update(|l| {
                            if let Some(x) = l {
                                x.prev()
                            }
                        });
                    }
                    "ArrowRight" => {
                        ev.prevent_default();
                        app.lightbox.update(|l| {
                            if let Some(x) = l {
                                x.next()
                            }
                        });
                    }
                    "r" | "R" => {
                        let delta = if ev.shift_key() { -90 } else { 90 };
                        app.lightbox.update(|l| {
                            if let Some(x) = l {
                                x.rotation = (x.rotation + delta).rem_euclid(360);
                            }
                        });
                    }
                    " " => {
                        ev.prevent_default();
                        let profile = app.profile_id.get_untracked();
                        let Some(img) = app.lightbox.with(|l| l.as_ref().and_then(|x| x.current().cloned()))
                        else {
                            return;
                        };
                        spawn_local(async move {
                            if api::favorite_toggle(&profile, &img.name, img.folder.as_deref())
                                .await
                                .is_ok()
                            {
                                app.reload_favorites();
                            }
                        });
                    }
                    "Escape" => app.lightbox.set(None),
                    _ => {}
                }
            },
        );
        let _ = win.add_event_listener_with_callback("keydown", cb.as_ref().unchecked_ref());
        cb.forget();
    });
}
