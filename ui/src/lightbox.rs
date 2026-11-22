// ============================================================
// Lumina · 灯箱
// 覆盖层，不是页面。背景 = 当前图放大 + 模糊 + 暗化
// （用 filter 作用在一张副本上，不用 backdrop-filter）。
//
// 原图 URL 存在 Lightbox 自己身上，不在渲染闭包里建信号：
// 渲染闭包每次重跑都会 new 一个 RwSignal，值刚写进去就被丢掉，
// 表现是「永远转圈」。
//
// 缩放 / 平移不进 Lightbox 结构体：拖拽每帧都要改，走响应式会把
// 整个覆盖层（含工具条与浮层栈）重跑一遍。这里用 StoredValue 存视图状态 +
// 直接写 `style.transform`，结构体只管「打开的是哪张、转了多少度」。
// ============================================================

use glass_design::prelude::*;
use leptos::html;
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

/* ---------------- 缩放 / 平移 ---------------- */

/// 灯箱里的视图变换：`scale` 是相对「适合窗口」的倍数，`tx`/`ty` 是屏幕像素平移。
#[derive(Clone, Copy)]
struct ZoomView {
    scale: f64,
    tx: f64,
    ty: f64,
}

impl Default for ZoomView {
    fn default() -> Self {
        Self {
            scale: 1.0,
            tx: 0.0,
            ty: 0.0,
        }
    }
}

const ZOOM_MIN: f64 = 1.0;
const ZOOM_MAX: f64 = 8.0;

/// 把变换写回 DOM。只有这里碰 `style.transform`：
/// 拖拽每帧调它，不走响应式，覆盖层不会被重算。
fn apply_zoom(
    el: Option<&web_sys::HtmlImageElement>,
    view: StoredValue<ZoomView>,
    rotation: i32,
    pct: RwSignal<u32>,
) {
    let v = view.get_value();
    if let Some(el) = el {
        let _ = el.set_attribute(
            "style",
            &format!(
                "transform:translate({:.2}px, {:.2}px) rotate({rotation}deg) scale({:.4})",
                v.tx, v.ty, v.scale
            ),
        );
        let zoomed = v.scale > ZOOM_MIN + 0.001;
        let _ = el.set_attribute("data-zoomed", if zoomed { "true" } else { "false" });
    }
    let p = (v.scale * 100.0).round() as u32;
    if pct.get_untracked() != p {
        pct.set(p);
    }
}

/// 以屏幕点 `(cx, cy)` 为锚点缩放到 `target`：锚点下的那块图不动。
///
/// 推导很短：变换是 `T + k·q`（q 是图片内坐标），要让 P 处的 q 不变，
/// 只有 `t' = t + (1 - k)·(P − rect.center)`；`rect` 取当前变换后的包围盒，
/// 旋转 90° 时它的中心仍是图片中心。
///
/// 平移**不设边界**：照片查看器里「拖到哪算哪」比「永远盖满窗口」更好用，
/// 想回原位双击或缩回 1× 即可（两者都会把位移清零）。
fn zoom_to(view: &mut ZoomView, el: &web_sys::HtmlImageElement, target: f64, cx: f64, cy: f64) {
    let target = target.clamp(ZOOM_MIN, ZOOM_MAX);
    let k = target / view.scale;
    if (k - 1.0).abs() < 1e-4 {
        return;
    }
    let rect = el.get_bounding_client_rect();
    let dx = cx - (rect.left() + rect.width() / 2.0);
    let dy = cy - (rect.top() + rect.height() / 2.0);
    view.tx += (1.0 - k) * dx;
    view.ty += (1.0 - k) * dy;
    view.scale = target;
    // 回到「适合窗口」时归中，不把上一次的位移留在原地
    if view.scale <= ZOOM_MIN + 0.001 {
        view.tx = 0.0;
        view.ty = 0.0;
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

    // 缩放 / 平移是命令式状态：拖拽每帧只写 style，不触发覆盖层重渲染。
    let img_ref: NodeRef<html::Img> = NodeRef::new();
    let view: StoredValue<ZoomView> = StoredValue::new(ZoomView::default());
    let drag_from: StoredValue<Option<(f64, f64, f64, f64)>> = StoredValue::new(None);
    let dragged: StoredValue<bool> = StoredValue::new(false);
    let zoom_pct = RwSignal::new(100_u32);
    // 换图时把缩放归零。用 URL 判断：翻页、重进灯箱都覆盖得到。
    let shown_url: StoredValue<String> = StoredValue::new(String::new());

    // 打开 / 翻页后拉原图
    Effect::new(move |_| {
        let Some(lb) = app.lightbox.get() else {
            return;
        };
        if lb.url.is_none() {
            load_current(app);
        }
    });

    // 换图 → 归零；旋转 → 保留缩放，只换角度。两者都靠这个 Effect 重写 transform。
    {
        let img_ref = img_ref.clone();
        Effect::new(move |_| {
            let Some(lb) = app.lightbox.get() else {
                shown_url.set_value(String::new());
                return;
            };
            let url = lb.url.clone().unwrap_or_default();
            if shown_url.get_value() != url {
                shown_url.set_value(url);
                view.set_value(ZoomView::default());
            }
            let el = img_ref.get();
            apply_zoom(el.as_ref(), view, lb.rotation, zoom_pct);
        });
    }

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

            // NodeRef 每个处理器各要一份；StoredValue 本身是 Copy，直接共用。
            let img_effect = img_ref;
            let img_wheel = img_ref.clone();
            let img_down = img_ref.clone();
            let img_move = img_ref.clone();
            let img_up = img_ref.clone();
            let img_cancel = img_ref.clone();
            let img_zoom = img_ref.clone();

            view! {
                <div
                    class="lumina-lightbox"
                    on:click=move |ev: web_sys::MouseEvent| {
                        // 拖完浏览器还会补一个 click，别当成「点了空白」
                        let was_drag = dragged.get_value();
                        dragged.set_value(false);
                        if was_drag {
                            return;
                        }
                        // 图片与底部工具条之外的地方才退出
                        let on_chrome = ev
                            .target()
                            .and_then(|t| t.dyn_into::<web_sys::Element>().ok())
                            .and_then(|el| {
                                el.closest(".lumina-lightbox__img, .lumina-lightbox__bar")
                                    .ok()
                                    .flatten()
                            })
                            .is_some();
                        if !on_chrome {
                            close();
                        }
                    }
                    on:wheel=move |ev: web_sys::WheelEvent| {
                        // 滚轮＝缩放（锚在光标上），翻页交给 ←/→ 与底部按钮
                        ev.prevent_default();
                        let Some(el) = img_wheel.get() else { return };
                        let step = (-ev.delta_y() * 0.0015).exp();
                        {
                            let mut v = view.get_value();
                            let target = v.scale * step;
                            zoom_to(&mut v, &el, target, ev.client_x() as f64, ev.client_y() as f64);
                            view.set_value(v);
                        }
                        apply_zoom(Some(&el), view, rotation, zoom_pct);
                    }
                >
                    {bg.map(|src| view! {
                        <div class="lumina-lightbox__bg" style=format!("background-image:url(\"{src}\")")></div>
                    })}
                    <div class="lumina-lightbox__stage">
                        {match url {
                            Some(src) => view! {
                                <img
                                    node_ref=img_effect
                                    class="lumina-lightbox__img"
                                    src=src
                                    alt=""
                                    draggable="false"
                                    on:pointerdown=move |ev: web_sys::PointerEvent| {
                                        if ev.button() != 0 {
                                            return;
                                        }
                                        let Some(el) = img_down.get() else { return };
                                        let _ = el.set_pointer_capture(ev.pointer_id());
                                        {
                                            let v = view.get_value();
                                            drag_from.set_value(Some((
                                                ev.client_x() as f64,
                                                ev.client_y() as f64,
                                                v.tx,
                                                v.ty,
                                            )));
                                        }
                                        dragged.set_value(false);
                                        let _ = el.set_attribute("data-dragging", "true");
                                        ev.prevent_default();
                                    }
                                    on:pointermove=move |ev: web_sys::PointerEvent| {
                                        let Some((sx, sy, tx0, ty0)) = drag_from.get_value() else {
                                            return;
                                        };
                                        let dx = ev.client_x() as f64 - sx;
                                        let dy = ev.client_y() as f64 - sy;
                                        if dx.abs() > 3.0 || dy.abs() > 3.0 {
                                            dragged.set_value(true);
                                        }
                                        let Some(el) = img_move.get() else { return };
                                        {
                                            // 自由平移：不钳制，拖到窗口外也随你
                                            let mut v = view.get_value();
                                            v.tx = tx0 + dx;
                                            v.ty = ty0 + dy;
                                            view.set_value(v);
                                        }
                                        apply_zoom(Some(&el), view, rotation, zoom_pct);
                                    }
                                    on:pointerup=move |ev: web_sys::PointerEvent| {
                                        end_pan(img_up.get().as_ref(), drag_from, ev.pointer_id());
                                    }
                                    on:pointercancel=move |ev: web_sys::PointerEvent| {
                                        end_pan(img_cancel.get().as_ref(), drag_from, ev.pointer_id());
                                    }
                                    on:dblclick=move |ev: web_sys::MouseEvent| {
                                        // 双击：动过（放大或拖开）就一键归位；
                                        // 原本居中 1× 时才放大到 2.5×（锚在光标上）
                                        let Some(el) = img_zoom.get() else { return };
                                        {
                                            let mut v = view.get_value();
                                            let moved = v.tx.abs() > 0.5 || v.ty.abs() > 0.5;
                                            if v.scale > ZOOM_MIN + 0.001 || moved {
                                                v = ZoomView::default();
                                            } else {
                                                zoom_to(
                                                    &mut v,
                                                    &el,
                                                    2.5,
                                                    ev.client_x() as f64,
                                                    ev.client_y() as f64,
                                                );
                                            }
                                            view.set_value(v);
                                        }
                                        apply_zoom(Some(&el), view, rotation, zoom_pct);
                                    }
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
                            {move || (zoom_pct.get() > 100).then(|| view! {
                                <span class="lumina-lightbox__zoom">{format!("{}%", zoom_pct.get())}</span>
                            })}
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

/// 结束一次拖拽：解开指针捕获、复原光标、清掉起点。
fn end_pan(
    el: Option<&web_sys::HtmlImageElement>,
    drag: StoredValue<Option<(f64, f64, f64, f64)>>,
    pointer_id: i32,
) {
    if let Some(el) = el {
        let _ = el.release_pointer_capture(pointer_id);
        let _ = el.remove_attribute("data-dragging");
    }
    drag.set_value(None);
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
