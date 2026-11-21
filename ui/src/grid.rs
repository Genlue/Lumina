// ============================================================
// Lumina · 照片浏览引擎
// 「全部照片 / 收藏 / 相册」三页共用：工具行、网格、列表、选择、右键菜单。
//
// 渲染策略：分块渲染（每块 300 张）+ 瓦片 content-visibility。
// 不追求「绝对窗口化」——那需要每帧量容器高度，量错一像素就会跳一下；
// 分块 + 浏览器跳过离屏绘制在 1 万张这个量级上已经够用，而且不会出现
// 「滚动时内容先空后补」的闪烁。
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;
use wasm_bindgen::JsCast;

use crate::api;
use crate::lightbox::Lightbox;
use crate::models::*;
use crate::search::SortBy;
use crate::state::App;
use crate::ui::{toast, toast_with};

const CHUNK: usize = 300;

/* ==========================================================================
   工具行
   ========================================================================== */

#[component]
pub fn PhotoToolbar() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        <div class="lumina-toolrow">
            <div class="lumina-toolrow__grow">
                <SearchField
                    value=Signal::derive(move || app.query.get().q)
                    placeholder="搜索文件名：空格 = 且、| = 或、- = 排除"
                    width=300
                    label="搜索"
                    on_input=Callback::new(move |v: String| {
                        app.query.update(|q| q.q = v);
                    })
                />
            </div>
            {move || {
                let on = app.settings.get().reverse_search();
                on.then(|| {
                    view! {
                        <SearchField
                            value=Signal::derive(move || app.query.get().ex)
                            placeholder="排除关键词"
                            width=180
                            label="排除搜索"
                            on_input=Callback::new(move |v: String| {
                                app.query.update(|q| q.ex = v);
                            })
                        />
                    }
                })
            }}
            <Select
                options=vec![
                    SelectOption::new("name-asc", "名称 A→Z"),
                    SelectOption::new("name-desc", "名称 Z→A"),
                    SelectOption::new("date-desc", "最新优先"),
                    SelectOption::new("date-asc", "最旧优先"),
                ]
                value=Signal::derive(move || {
                    SortBy::parse(&app.settings.get().sort_by).as_str().to_string()
                })
                width=132
                label="排序"
                on_change=Callback::new(move |v: String| {
                    app.patch(serde_json::json!({ "sort_by": v }));
                })
            />
            <Segmented
                options=vec![
                    SegmentedOption::new("grid", "网格"),
                    SegmentedOption::new("list", "列表"),
                ]
                value=Signal::derive(move || {
                    if app.settings.get().view_mode == "list" {
                        "list".to_string()
                    } else {
                        "grid".to_string()
                    }
                })
                on_change=Callback::new(move |v: String| {
                    app.patch(serde_json::json!({ "view_mode": v }));
                })
            />
        </div>
    }
}

/* ==========================================================================
   多选工具条
   ========================================================================== */

#[component]
pub fn MultiBar(view: String) -> impl IntoView {
    let app = App::use_ctx();

    let count = move || app.selection.with(|s| s.len());

    view! {
        {move || {
            let n = count();
            if n == 0 {
                return ().into_any();
            }
            let view = view.clone();
            view! {
                <div class="lumina-multibar">
                    <Capsule size=CapsuleSize::Auto>
                        <span class="c-subtitle lumina-multibar__count">{format!("已选 {n} 张")}</span>
                    </Capsule>
                    <Capsule size=CapsuleSize::Auto>
                        <Button
                            label="收藏"
                            icon=IconName::STAR
                            variant=ButtonVariant::Plain
                            size=Size::Sm
                            on_click=Callback::new(move |_| toggle_fav_selection(app))
                        />
                        <Button
                            label="移到回收站"
                            icon=IconName::TRASH
                            variant=ButtonVariant::Plain
                            size=Size::Sm
                            on_click=Callback::new(move |_| trash_selection(app, view.clone()))
                        />
                        <Button
                            label="取消选择"
                            icon=IconName::X
                            variant=ButtonVariant::Plain
                            size=Size::Sm
                            on_click=Callback::new(move |_| app.selection.update(|s| s.clear()))
                        />
                    </Capsule>
                </div>
            }
            .into_any()
        }}
    }
}

fn toggle_fav_selection(app: App) {
    let profile = app.profile_id.get_untracked();
    let keys: Vec<String> = app.selection.get_untracked().into_iter().collect();
    if keys.is_empty() || profile.is_empty() {
        return;
    }
    let all = app.all_images();
    let targets: Vec<Image> = keys
        .iter()
        .filter_map(|k| all.iter().find(|i| &i.key == k).cloned())
        .collect();
    spawn_local(async move {
        let mut changed = 0;
        for img in targets {
            if api::favorite_toggle(&profile, &img.name, img.folder.as_deref())
                .await
                .is_ok()
            {
                changed += 1;
            }
        }
        if changed > 0 {
            app.reload_favorites();
            toast(format!("已切换 {changed} 张的收藏状态"));
        }
    });
}

fn trash_selection(app: App, _view: String) {
    let profile = app.profile_id.get_untracked();
    let keys: Vec<String> = app.selection.get_untracked().into_iter().collect();
    if keys.is_empty() || profile.is_empty() {
        return;
    }
    let all = app.all_images();
    let targets: Vec<Image> = keys
        .iter()
        .filter_map(|k| all.iter().find(|i| &i.key == k).cloned())
        .collect();
    app.selection.update(|s| s.clear());
    spawn_local(async move {
        let mut ok = 0;
        for img in &targets {
            if api::file_to_trash(&profile, &img.name, img.folder.as_deref())
                .await
                .is_ok()
            {
                ok += 1;
            }
        }
        app.reload_index();
        app.reload_trash();
        app.reload_favorites();
        toast(format!("已把 {ok} 张移到回收站"));
    });
}

/* ==========================================================================
   照片网格 / 列表
   ========================================================================== */

#[component]
pub fn PhotoView(
    /// 数据源：已经过「过滤 + 排序」的列表
    #[prop(into)]
    items: Signal<Vec<Image>>,
    /// 灯箱与多选条用的视图标识（`"all"` 或相册目录）
    view: String,
    /// 是否自带工具行（搜索 / 排序 / 视图切换）。
    /// 相册总览里已经有一层页面结构，再叠一条工具行会显得重复。
    #[prop(default = true)]
    toolbar: bool,
) -> impl IntoView {
    let app = App::use_ctx();
    let limit = RwSignal::new(CHUNK);
    let menu = RwSignal::new(None::<MenuState>);

    // 灯箱翻页要用「当前这一屏的完整列表」，在这里同步一次
    Effect::new(move |_| {
        app.view_items.set(items.get());
    });

    // 换视图 / 换搜索条件时把分块重置，否则会带着上一页的 limit 进去
    Effect::new(move |_| {
        let _ = app.query.get();
        let _ = app.route.get();
        limit.set(CHUNK);
    });

    view! {
        {toolbar.then(|| view! { <PhotoToolbar /> })}
        <MultiBar view=view.clone() />

        {move || {
            let items = items.get();
            let total = items.len();
            let shown = limit.get().min(total);
            let list_mode = app.settings.get().view_mode == "list";

            if total == 0 {
                return view! {
                    <div class="lumina-empty">
                        <Empty
                            icon=IconName::IMAGE_OFF
                            title=if app.query.get().is_empty() { "这里还没有照片" } else { "没有匹配的照片" }
                            desc=if app.query.get().is_empty() {
                                "把图片放进图库文件夹，或者点右上角「重新扫描」".to_string()
                            } else {
                                "换个关键词试试，或者清空搜索框".to_string()
                            }
                        />
                    </div>
                }
                .into_any();
            }

            let slice: Vec<Image> = items[..shown].to_vec();
            let has_more = shown < total;

            if list_mode {
                return view! {
                    <div class="lumina-list">
                        {slice.into_iter().map(|img| view! { <ListRow img=img menu=menu /> }).collect_view()}
                        {has_more.then(|| view! {
                            <Button
                                label="加载更多"
                                variant=ButtonVariant::Plain
                                on_click=Callback::new(move |_| limit.update(|n| *n += CHUNK))
                            />
                        })}
                    </div>
                }
                .into_any();
            }

            // 单元宽度跟「缩略图分辨率」挂钩（与旧版 gridThumbWidth 同一条公式），
            // 用户显式指定每行张数时以它为准。
            let cell = ((app.settings.with(|s| s.thumbnail_size) as f64 * 0.45).round() as u32)
                .clamp(96, 260);
            let gap = app.ui.with(|u| u.grid_gap);
            let cols = app.ui.with(|u| u.grid_columns);
            let template = if cols > 0 {
                format!("repeat({cols}, minmax(0, 1fr))")
            } else {
                format!("repeat(auto-fill, minmax({cell}px, 1fr))")
            };
            let style = format!("--grid-cols:{template};--grid-gap:{gap}px");

            view! {
                <div class="lumina-grid" style=style>
                    {slice.into_iter().map(|img| view! { <Tile img=img menu=menu /> }).collect_view()}
                </div>
                {has_more.then(|| view! {
                    <div class="lumina-loadmore">
                        <Button
                            label=format!("加载更多（还有 {} 张）", total - shown)
                            variant=ButtonVariant::Plain
                            on_click=Callback::new(move |_| limit.update(|n| *n += CHUNK))
                        />
                    </div>
                })}
                {move || menu.get().map(|m| view! { <ImageMenu state=m menu=menu /> })}
            }
            .into_any()
        }}
    }
}

#[derive(Clone, PartialEq)]
pub struct MenuState {
    pub x: f64,
    pub y: f64,
    pub img: Image,
}

#[component]
fn Tile(img: Image, menu: RwSignal<Option<MenuState>>) -> impl IntoView {
    let app = App::use_ctx();
    let key = img.key.clone();
    let selected = Signal::derive({
        let key = key.clone();
        move || app.selection.with(|s| s.contains(&key))
    });
    let fav = Signal::derive({
        let key = key.clone();
        move || app.is_fav(&key)
    });

    // 缩略图：挂载即登记，批量 IPC 会在本帧末尾合并发出
    let url = RwSignal::new(None::<String>);
    let size = app.settings.with(|s| s.thumbnail_size.max(100) as u32);
    let t = app.thumbs;
    let cache_key = crate::state::Thumbs::key(img.folder.as_deref(), &img.name, size);
    if let Some(hit) = t.get(&cache_key) {
        url.set(Some(hit));
    } else {
        t.request(
            cache_key.clone(),
            img.name.clone(),
            img.folder.clone(),
            size,
        );
        let watch_key = cache_key.clone();
        Effect::new(move |_| {
            if let Some(v) = t.map.with(|m| m.get(&watch_key).cloned()) {
                url.set(Some(v));
            }
        });
    }

    let open_img = img.clone();
    let ctx_img = img.clone();
    let name = img.name.clone();

    view! {
        <div
            class="lumina-tile"
            attr:data-selected=move || selected.get().to_string()
            title=name.clone()
            on:click={
                let img = open_img.clone();
                move |ev: web_sys::MouseEvent| {
                    let multi = ev.ctrl_key() || ev.meta_key() || ev.shift_key();
                    let key = img.key.clone();
                    if multi || app.selection.with(|s| !s.is_empty()) {
                        app.selection.update(|s| {
                            if !s.remove(&key) {
                                s.insert(key);
                            }
                        });
                    } else {
                        open_lightbox(app, img.clone());
                    }
                }
            }
            on:dblclick={
                let img = open_img.clone();
                move |_| open_lightbox(app, img.clone())
            }
            on:contextmenu=move |ev: web_sys::MouseEvent| {
                ev.prevent_default();
                menu.set(Some(MenuState {
                    x: ev.client_x() as f64,
                    y: ev.client_y() as f64,
                    img: ctx_img.clone(),
                }));
            }
        >
            {move || match url.get() {
                Some(src) => view! { <img class="lumina-tile__img" src=src loading="lazy" alt="" /> }.into_any(),
                None => view! { <div class="lumina-tile__img"></div> }.into_any(),
            }}
            <span class="lumina-tile__check">
                {move || selected.get().then(|| view! { <Icon name=IconName::CHECK size=12 /> })}
            </span>
            {move || fav.get().then(|| view! {
                <span class="lumina-tile__fav"><Icon name=IconName::STAR size=12 /></span>
            })}
            <span class="lumina-tile__name">{name.clone()}</span>
        </div>
    }
}

#[component]
fn ListRow(img: Image, menu: RwSignal<Option<MenuState>>) -> impl IntoView {
    let app = App::use_ctx();
    let key = img.key.clone();
    let selected = Signal::derive({
        let key = key.clone();
        move || app.selection.with(|s| s.contains(&key))
    });

    let size = app.settings.with(|s| s.thumbnail_size.max(100) as u32);
    let t = app.thumbs;
    let cache_key = crate::state::Thumbs::key(img.folder.as_deref(), &img.name, size);
    let url = RwSignal::new(t.get(&cache_key));
    if url.get_untracked().is_none() {
        t.request(cache_key.clone(), img.name.clone(), img.folder.clone(), size);
        let watch_key = cache_key.clone();
        Effect::new(move |_| {
            if let Some(v) = t.map.with(|m| m.get(&watch_key).cloned()) {
                url.set(Some(v));
            }
        });
    }

    let name = img.name.clone();
    let meta_size = human_size(img.size.max(0) as u64);
    let open_img = img.clone();
    let ctx_img = img.clone();

    view! {
        <div
            class="lumina-list__row"
            attr:data-selected=move || selected.get().to_string()
            on:click={
                let img = open_img.clone();
                move |ev: web_sys::MouseEvent| {
                    let multi = ev.ctrl_key() || ev.meta_key() || ev.shift_key();
                    let key = img.key.clone();
                    if multi || app.selection.with(|s| !s.is_empty()) {
                        app.selection.update(|s| {
                            if !s.remove(&key) {
                                s.insert(key);
                            }
                        });
                    } else {
                        open_lightbox(app, img.clone());
                    }
                }
            }
            on:dblclick={
                let img = open_img.clone();
                move |_| open_lightbox(app, img.clone())
            }
            on:contextmenu=move |ev: web_sys::MouseEvent| {
                ev.prevent_default();
                menu.set(Some(MenuState {
                    x: ev.client_x() as f64,
                    y: ev.client_y() as f64,
                    img: ctx_img.clone(),
                }));
            }
        >
            {move || match url.get() {
                Some(src) => view! { <img class="lumina-list__thumb" src=src loading="lazy" alt="" /> }.into_any(),
                None => view! { <div class="lumina-list__thumb"></div> }.into_any(),
            }}
            <span class="lumina-list__name">{name}</span>
            <span class="lumina-list__meta">{meta_size}</span>
            <span class="lumina-list__meta">{img.folder.clone().unwrap_or_else(|| "根目录".into())}</span>
            <span class="lumina-list__meta">{format_ms(img.date)}</span>
        </div>
    }
}

/* ==========================================================================
   右键菜单
   ========================================================================== */

#[component]
fn ImageMenu(state: MenuState, menu: RwSignal<Option<MenuState>>) -> impl IntoView {
    let app = App::use_ctx();
    let img = state.img.clone();
    let fav = app.is_fav(&img.key);

    let mut items = vec![
        MenuItem::new("open", "打开").icon(IconName::EYE),
        MenuItem::new("fav", if fav { "取消收藏" } else { "收藏" })
            .icon(if fav { IconName::STAR_OFF } else { IconName::STAR })
            .separator_before(),
    ];
    if !app.folders.with(|f| f.is_empty()) {
        items.push(MenuItem::new("move", "移动到相册…").icon(IconName::MOVE));
    }
    items.push(MenuItem::new("rename", "重命名…").icon(IconName::SQUARE_PEN));
    items.push(
        MenuItem::new("reveal", "在资源管理器中打开")
            .icon(IconName::EXTERNAL_LINK)
            .separator_before(),
    );
    items.push(
        MenuItem::new("trash", "移到回收站")
            .icon(IconName::TRASH)
            .danger()
            .separator_before(),
    );

    let anchor = (state.x, state.y, 0.0);
    let target = img.clone();

    view! {
        <Menu
            open=Signal::derive(move || menu.get().is_some())
            anchor=anchor
            items=items
            focus_first=false
            on_close=Callback::new(move |_| menu.set(None))
            on_select=Callback::new(move |id: String| {
                menu.set(None);
                run_menu_action(app, &id, &target);
            })
        />
    }
}

fn run_menu_action(app: App, id: &str, img: &Image) {
    let profile = app.profile_id.get_untracked();
    match id {
        "open" => open_lightbox(app, img.clone()),
        "fav" => {
            let img = img.clone();
            spawn_local(async move {
                if api::favorite_toggle(&profile, &img.name, img.folder.as_deref())
                    .await
                    .is_ok()
                {
                    app.reload_favorites();
                }
            });
        }
        "trash" => {
            let img = img.clone();
            spawn_local(async move {
                if api::file_to_trash(&profile, &img.name, img.folder.as_deref())
                    .await
                    .is_ok()
                {
                    app.reload_index();
                    app.reload_trash();
                    app.reload_favorites();
                    toast("已移到回收站");
                } else {
                    toast_with("移到回收站失败", Tone::Danger, None);
                }
            });
        }
        "rename" => {
            let img = img.clone();
            crate::pages::dialog::prompt_rename(app, img);
        }
        "move" => {
            let img = img.clone();
            crate::pages::dialog::pick_album(app, img);
        }
        "reveal" => {
            let folder = app.profile_folder();
            let img = img.clone();
            spawn_local(async move {
                let path = match &img.folder {
                    Some(f) if !f.is_empty() => format!("{folder}\\{f}\\{}", img.name),
                    _ => format!("{folder}\\{}", img.name),
                };
                // 打开的是所在目录，不是文件本身
                let dir = match path.rfind(['\\', '/']) {
                    Some(i) => path[..i].to_string(),
                    None => folder,
                };
                let _ = api::open_in_explorer(&dir).await;
            });
        }
        _ => {}
    }
}

/* ==========================================================================
   灯箱入口
   ========================================================================== */

pub fn open_lightbox(app: App, img: Image) {
    let route = app.route.get_untracked();
    let view = if route.page == crate::state::Page::Albums {
        route.view.clone()
    } else {
        "all".to_string()
    };
    let list = app.view_items.get_untracked();
    let list = if list.is_empty() {
        app.visible(&view)
    } else {
        list
    };
    let index = list.iter().position(|i| i.key == img.key).unwrap_or(0);
    app.lightbox.set(Some(Lightbox::new(list, index, view)));
}

/// 键盘：Esc 退出选择、Delete 移到回收站、Ctrl+A 全选
pub fn wire_shortcuts(app: App) {
    Effect::new(move |_| {
        let Some(win) = web_sys::window() else { return };
        let cb = wasm_bindgen::closure::Closure::<dyn FnMut(web_sys::KeyboardEvent)>::new(
            move |ev: web_sys::KeyboardEvent| {
                // 正在输入时不抢键
                if let Some(target) = ev.target() {
                    if let Some(el) = target.dyn_ref::<web_sys::HtmlElement>() {
                        let tag = el.tag_name().to_lowercase();
                        if tag == "input" || tag == "textarea" {
                            return;
                        }
                    }
                }
                let ctrl = ev.ctrl_key() || ev.meta_key();
                match ev.key().as_str() {
                    "Escape" => {
                        if app.lightbox.with(|l| l.is_some()) {
                            app.lightbox.set(None);
                        } else if app.selection.with(|s| !s.is_empty()) {
                            app.selection.update(|s| s.clear());
                        }
                    }
                    "Delete" if !app.selection.with(|s| s.is_empty()) => {
                        ev.prevent_default();
                        trash_selection(app, String::new());
                    }
                    "a" | "A" if ctrl => {
                        ev.prevent_default();
                        let list = app.visible("all");
                        app.selection
                            .set(list.iter().map(|i| i.key.clone()).collect());
                    }
                    _ => {}
                }
            },
        );
        let _ = win.add_event_listener_with_callback("keydown", cb.as_ref().unchecked_ref());
        cb.forget();
    });
}
