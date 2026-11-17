// ============================================================
// Lumina · 应用外壳
// 顶栏（红绿灯 / 收起导航 / 前进后退 + 页面名 / 右侧胶囊）
// + 导航栏（NavColumn）+ 内容舞台。
//
// 顶栏属于**窗口**，不属于内容列：导航栏收起时内容列会变宽，
// 顶栏如果跟着内容列走，标题会在第一帧瞬移。GlassDesign 的
// `Toolbar` 就挂在 `.l-app` 里，跨整窗宽，正好对上这条。
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;
use wasm_bindgen::JsCast;

use crate::api;
use crate::models::{format_ms, last_segment, Profile};
use crate::pages;
use crate::pages::dialog::{Modal, ModalKind};
use crate::state::{App, Page, Route, Screen};

/* ==========================================================================
   窗口事件：焦点（红绿灯收敛）与导航栏顶部渐进模糊
   ========================================================================== */

fn window() -> Option<web_sys::Window> {
    web_sys::window()
}

/// 红绿灯要跟着窗口焦点走：失焦时三灯退成中性灰。
/// 在应用根上调用一次（信号挂在 App 上，永不销毁）。
pub fn track_window_focus(app: App) {
    track_focus(app.focused);
}

fn track_focus(focused: RwSignal<bool>) {
    let Some(win) = window() else { return };
    let on_focus = wasm_bindgen::closure::Closure::<dyn FnMut()>::new(move || focused.set(true));
    let on_blur = wasm_bindgen::closure::Closure::<dyn FnMut()>::new(move || focused.set(false));
    let _ = win.add_event_listener_with_callback("focus", on_focus.as_ref().unchecked_ref());
    let _ = win.add_event_listener_with_callback("blur", on_blur.as_ref().unchecked_ref());
    on_focus.forget();
    on_blur.forget();
}

/// 内容滚进固定区时，顶部那条渐进模糊才出现（`data-on="1"`）。
///
/// `.c-topveil` 的高度就是 `--toolbar-h`：只化开「滚到顶栏那一条」的内容。
/// 顶栏 z10、面纱 z2，所以工具栏 / 搜索框自己不会被糊 —— 这也是库里的
/// 约定，别把面纱高度撑进内容区。
///
/// 导航栏与内容区各一条：`--nav` 从 `.l-nav__head` 下沿开始，主区那条
/// 从窗口顶端开始（顶栏是透明的，内容会从它底下穿过去）。
fn wire_veil(scroller_sel: &str, veil_sel: &str) {
    let Some(doc) = window().and_then(|w| w.document()) else {
        return;
    };
    let (Ok(Some(scroller)), Ok(Some(veil))) = (
        doc.query_selector(scroller_sel),
        doc.query_selector(veil_sel),
    ) else {
        return;
    };
    let paint = {
        let el = scroller.clone();
        let veil = veil.clone();
        move || {
            let on = if el.scroll_top() > 2 { "1" } else { "0" };
            let _ = veil.set_attribute("data-on", on);
        }
    };
    // 先按当前滚动位置定一次初值：切页后重新挂载时可能已经不是顶部了
    paint();
    let cb = wasm_bindgen::closure::Closure::<dyn FnMut()>::new(paint);
    let _ = scroller.add_event_listener_with_callback("scroll", cb.as_ref().unchecked_ref());
    cb.forget();
}

fn wire_veils() {
    wire_veil(".l-nav__body", ".c-topveil--nav");
    wire_veil(".l-stage", ".l-main > .c-topveil");
}

/* ==========================================================================
   外壳
   ========================================================================== */

#[component]
pub fn Shell() -> impl IntoView {
    let app = App::use_ctx();

    Effect::new(move |_| {
        // 等 NavColumn / ScrollArea 真正进 DOM 之后再挂滚动监听
        if let Some(w) = window() {
            let cb = wasm_bindgen::closure::Closure::once(Box::new(wire_veils) as Box<dyn FnOnce()>);
            let _ =
                w.set_timeout_with_callback_and_timeout_and_arguments_0(cb.as_ref().unchecked_ref(), 0);
            cb.forget();
        }
    });

    let nav_hidden = Signal::derive(move || app.ui.get().nav_hidden);
    // 外壳常驻、只换内容：切屏时**不销毁 AppShell / Toolbar / Main**。
    // 每个屏幕各套一层壳的做法会让整棵树随切屏重建，常驻的 window 监听
    // 就会写到已释放的信号上（wasm 里表现为 `unreachable`）。
    let in_app = move || app.screen.get() == Screen::App;

    view! {
        <AppShell nav_hidden=nav_hidden>
            <Toolbar>
                <ToolbarChrome>
                    <WindowChrome />
                    {move || {
                        if !in_app() {
                            return ().into_any();
                        }
                        let hidden = app.ui.get().nav_hidden;
                        view! {
                            <Capsule size=CapsuleSize::Round class="l-chrome__toggle">
                                <IconButton
                                    icon=IconName::PANEL_LEFT
                                    label=if hidden { "展开导航栏" } else { "收起导航栏" }
                                    toggle=true
                                    active=!hidden
                                    on_click=Callback::new(move |_| toggle_nav(app))
                                />
                            </Capsule>
                        }
                        .into_any()
                    }}
                </ToolbarChrome>

                <ToolbarLead>
                    {move || {
                        // 依赖必须在块的开头显式读一次。
                        // `IconButton` 的 `disabled` 是静态 bool，不是响应式 prop ——
                        // 把 `!app.can_back()` 直接写在属性位置，读发生在组件自己的
                        // 作用域里，块不会因为 cursor 变化而重建，按钮就永远灰着。
                        let can_back = app.can_back();
                        let can_fwd = app.can_forward();
                        // 封面页与加载页没有「上一页 / 下一页」，别摆一对永远灰着的按钮
                        if !in_app() {
                            return ().into_any();
                        }
                        view! {
                            <Capsule size=CapsuleSize::Auto>
                                <IconButton
                                    icon=IconName::CHEVRON_LEFT
                                    label="后退"
                                    size=Size::Sm
                                    disabled=!can_back
                                    on_click=Callback::new(move |_| app.back())
                                />
                                <IconButton
                                    icon=IconName::CHEVRON_RIGHT
                                    label="前进"
                                    size=Size::Sm
                                    disabled=!can_fwd
                                    on_click=Callback::new(move |_| app.forward())
                                />
                            </Capsule>
                        }
                        .into_any()
                    }}
                    {move || {
                        if !in_app() {
                            let sub = if app.screen.get() == Screen::Launcher { "本地相册" } else { "" };
                            return view! { <ToolbarTitle title="Lumina" subtitle=sub /> }.into_any();
                        }
                        let route = app.route.get();
                        let subtitle = match route.page {
                            Page::Home => app.profile_name(),
                            Page::Albums if !route.view.is_empty() && route.view != "albums" => {
                                last_segment(&route.view)
                            }
                            p => p.subtitle().to_string(),
                        };
                        view! { <ToolbarTitle title=route.page.title() subtitle=subtitle /> }.into_any()
                    }}
                </ToolbarLead>

                <ToolbarPills>
                    {move || if in_app() { library_chip(app) } else { ().into_any() }}
                    {move || if in_app() { page_pills(app) } else { ().into_any() }}
                </ToolbarPills>
            </Toolbar>

            {move || {
                if !in_app() {
                    return ().into_any();
                }
                view! {
                    <NavColumn>
                        {move || {
                            let name = app.profile_name();
                            view! {
                                <NavInfo
                                    icon=IconName::IMAGES
                                    title="Lumina"
                                    subtitle=name
                                    on_click=Callback::new(move |_| app.go(Route::page(Page::Home)))
                                />
                            }
                        }}
                        {move || nav_group(app)}
                    </NavColumn>
                }
                .into_any()
            }}

            <Main>
                <ScrollArea>
                    {move || match app.screen.get() {
                        Screen::Launcher => view! { <LauncherBody /> }.into_any(),
                        Screen::Entering => view! { <EnteringBody /> }.into_any(),
                        Screen::App => page_body(app),
                    }}
                </ScrollArea>
                // 顶栏下面那条渐进模糊。高度就是 --toolbar-h，
                // 只在内容滚到它底下时出现（wire_veils 负责切 data-on）。
                <div class="c-topveil" data-on="0"></div>
                <div class="lumina-status">
                    {move || if in_app() { status_strip(app) } else { ().into_any() }}
                </div>
            </Main>
        </AppShell>
    }
}

fn toggle_nav(app: App) {
    app.ui.update(|p| p.nav_hidden = !p.nav_hidden);
    crate::prefs::save(app.ui.get_untracked());
}

/* ==========================================================================
   导航
   ========================================================================== */

/// `NavItem` 的 `count` 是 `Option<u32>` 但走 optional prop（接受 `u32`），
/// 所以「有计数」和「没计数」只能分成两个分支建。0 就不显示，省得导航栏一排零。
fn nav_row(
    icon: IconName,
    label: &'static str,
    count: Option<u32>,
    selected: Signal<bool>,
    on_click: Callback<()>,
) -> AnyView {
    match count {
        Some(n) => view! {
            <NavItem icon=icon label=label count=n selected=selected on_click=on_click />
        }
        .into_any(),
        None => view! {
            <NavItem icon=icon label=label selected=selected on_click=on_click />
        }
        .into_any(),
    }
}

fn nav_group(app: App) -> AnyView {
    // 计数不是响应式 prop，所以整组跟着数据重建。
    // 只读「会变的东西」：照片数、相册数、收藏数、回收站数。
    let total = app.total_count();
    let album_count = app.folders.with(|f| f.len());
    let fav_count = app.favorites.with(|f| f.len());
    let trash_count = app.trash_count.get();
    let tree = album_tree(app);

    view! {
        <NavGroup>
            <NavSection label="图库" />
            {nav_row(
                IconName::HOUSE,
                "主页",
                None,
                Signal::derive(move || app.route.get().page == Page::Home),
                Callback::new(move |_| app.go(Route::page(Page::Home))),
            )}
            {nav_row(
                IconName::IMAGES,
                "全部照片",
                (total > 0).then_some(total as u32),
                Signal::derive(move || app.route.get().page == Page::Library),
                Callback::new(move |_| app.go(Route::page(Page::Library))),
            )}
            {nav_row(
                IconName::COMPASS,
                "发现",
                None,
                Signal::derive(move || app.route.get().page == Page::Discover),
                Callback::new(move |_| {
                    let tab = app.route.get_untracked().tab;
                    app.go(Route {
                        page: Page::Discover,
                        view: String::new(),
                        tab,
                    })
                }),
            )}

            <NavSection label="相册" />
            {nav_row(
                IconName::ALBUM,
                "相册",
                (album_count > 0).then_some(album_count as u32),
                Signal::derive(move || {
                    let r = app.route.get();
                    r.page == Page::Albums && (r.view.is_empty() || r.view == "albums")
                }),
                Callback::new(move |_| app.go(Route::album("albums"))),
            )}
            {tree}

            <NavSection label="收藏" />
            {nav_row(
                IconName::STAR,
                "收藏",
                (fav_count > 0).then_some(fav_count as u32),
                Signal::derive(move || app.route.get().page == Page::Favorites),
                Callback::new(move |_| app.go(Route::page(Page::Favorites))),
            )}
            {nav_row(
                IconName::TRASH,
                "回收站",
                (trash_count > 0).then_some(trash_count as u32),
                Signal::derive(move || app.route.get().page == Page::Trash),
                Callback::new(move |_| app.go(Route::page(Page::Trash))),
            )}
            {nav_row(
                IconName::SETTINGS,
                "设置",
                None,
                Signal::derive(move || app.route.get().page == Page::Settings),
                Callback::new(move |_| app.go(Route::page(Page::Settings))),
            )}
        </NavGroup>
    }
    .into_any()
}

fn album_tree(app: App) -> AnyView {
    let folders = app.folders.get();
    if folders.is_empty() {
        return ().into_any();
    }
    let route = app.route.get();
    let selected = if route.page == Page::Albums && route.view != "albums" {
        route.view.clone()
    } else {
        String::new()
    };

    // 只展开选中相册的祖先链：一进来就全展开会把导航栏撑成一棵树。
    let mut expanded: Vec<String> = Vec::new();
    if !selected.is_empty() {
        let segs: Vec<&str> = selected.split('/').collect();
        let mut cur = String::new();
        for seg in segs.iter().take(segs.len().saturating_sub(1)) {
            cur = if cur.is_empty() {
                (*seg).to_string()
            } else {
                format!("{cur}/{seg}")
            };
            expanded.push(cur.clone());
        }
        expanded.push(selected.clone());
    }

    let nodes = build_nodes(&app, "", 0);

    view! {
        <div class="lumina-navtree">
            <TreeView
                nodes=nodes
                default_expanded=expanded
                selected=selected
                on_select=Callback::new(move |id: String| app.go(Route::album(&id)))
                on_activate=Callback::new(move |id: String| app.go(Route::album(&id)))
                label="相册目录"
            />
        </div>
    }
    .into_any()
}

fn build_nodes(app: &App, parent: &str, depth: usize) -> Vec<TreeNode> {
    if depth > 6 {
        return Vec::new();
    }
    app.child_albums(parent)
        .into_iter()
        .map(|folder| {
            let kids = build_nodes(app, &folder, depth + 1);
            let count = app
                .album_images
                .with(|m| m.get(&folder).map(|v| v.len()).unwrap_or(0));
            let name = crate::models::last_segment(&folder);
            let mut node = TreeNode::new(folder.clone(), name).icon(if kids.is_empty() {
                IconName::FOLDER
            } else {
                IconName::FOLDER_TREE
            });
            if count > 0 {
                node = node.badge(count.to_string());
            }
            node = node.children(kids);
            node
        })
        .collect()
}

/* ==========================================================================
   顶栏胶囊：图库选择器 + 页面胶囊
   ========================================================================== */

fn library_chip(app: App) -> AnyView {
    if app.profile_id.get().is_empty() {
        return ().into_any();
    }
    let label = app.profile_name();
    let items = profile_menu_items(&app);

    view! {
        <Capsule size=CapsuleSize::Auto>
            <MenuButton
                label=label
                icon=IconName::FOLDER
                items=items
                on_select=Callback::new(move |id: String| on_profile_menu(&app, &id))
            />
        </Capsule>
    }
    .into_any()
}

const M_LAUNCHER: &str = "profile:launcher";
const M_ADD: &str = "profile:add";
const M_RELOCATE: &str = "profile:relocate";
const M_REVEAL: &str = "profile:reveal";
const M_REMOVE: &str = "profile:remove";
const M_SWITCH: &str = "profile:switch:";

fn profile_menu_items(app: &App) -> Vec<MenuItem> {
    let mut items = Vec::new();
    let current = app.profile_id.get();
    let mut list = app.profiles.get();
    list.sort_by(|a, b| b.last_access.unwrap_or(0).cmp(&a.last_access.unwrap_or(0)));

    for p in &list {
        let mut it = MenuItem::new(format!("{M_SWITCH}{}", p.id), &p.name)
            .checked(p.id == current)
            .icon(if p.unavailable == 0 {
                IconName::FOLDER
            } else {
                IconName::X_CIRCLE
            });
        if p.unavailable != 0 {
            it.label = format!("{}（文件夹不可用）", p.name);
        }
        items.push(it);
    }

    if !current.is_empty() {
        items.push(
            MenuItem::new(M_LAUNCHER, "返回封面")
                .icon(IconName::LAYOUT_GRID)
                .separator_before(),
        );
    }

    items.push(MenuItem::new(M_ADD, "添加图库…").icon(IconName::FOLDER_PLUS).separator_before());

    if !current.is_empty() {
        items.push(MenuItem::new(M_RELOCATE, "重新定位当前图库…").icon(IconName::MOVE));
        items.push(MenuItem::new(M_REVEAL, "在资源管理器中打开").icon(IconName::EXTERNAL_LINK));
        items.push(
            MenuItem::new(M_REMOVE, "移除这个图库")
                .icon(IconName::TRASH)
                .danger()
                .separator_before(),
        );
    }
    items
}

fn on_profile_menu(app: &App, id: &str) {
    if id == M_LAUNCHER {
        app.back_to_launcher();
    } else if id == M_ADD {
        app.add_profile();
    } else if id == M_RELOCATE {
        let cur = app.profile_id.get_untracked();
        if !cur.is_empty() {
            app.relocate_profile(cur);
        }
    } else if id == M_REVEAL {
        let folder = app.profile_folder();
        spawn_local(async move {
            let _ = api::open_in_explorer(&folder).await;
        });
    } else if id == M_REMOVE {
        let cur = app.profile_id.get_untracked();
        if !cur.is_empty() {
            app.remove_profile(cur);
        }
    } else if let Some(target) = id.strip_prefix(M_SWITCH) {
        let target = target.to_string();
        if target != app.profile_id.get_untracked() {
            app.enter_profile(target);
        }
    }
}

/// 顶栏右侧的页面胶囊。切页只换内容，不重建整条顶栏。
fn page_pills(app: App) -> AnyView {
    let route = app.route.get();
    match route.page {
        Page::Home => view! {
            <Capsule size=CapsuleSize::Auto>
                <Button
                    label="重新扫描"
                    icon=IconName::REFRESH_CW
                    variant=ButtonVariant::Plain
                    size=Size::Sm
                    on_click=Callback::new(move |_| app.reload_index())
                />
            </Capsule>
        }
        .into_any(),

        Page::Library | Page::Favorites => view! {
            // 「更多」是 图标 + 文字 + 箭头，宽度不固定：必须走 Auto。
            // 塞进 Round(34×34) 的贴图档，内容会比外壳宽 —— 就是被拉长的圈。
            <Capsule size=CapsuleSize::Auto>
                <MenuButton
                    icon=IconName::MORE
                    label="更多"
                    items=photo_menu_items(route.page)
                    on_select=Callback::new(move |id: String| on_photo_menu(&app, &id))
                />
            </Capsule>
        }
        .into_any(),

        Page::Albums => {
            if route.view.is_empty() || route.view == "albums" {
                view! {
                    <Capsule size=CapsuleSize::Round>
                        <IconButton
                            icon=IconName::PLUS
                            label="新建相册"
                            on_click=Callback::new(move |_| pages::albums::create_album(app))
                        />
                    </Capsule>
                }
                .into_any()
            } else {
                view! {
                    <Capsule size=CapsuleSize::Auto>
                        <MenuButton
                            icon=IconName::MORE
                            label="更多"
                            items=album_menu_items(&app)
                            on_select=Callback::new(move |id: String| {
                                pages::albums::on_album_menu(app, &id)
                            })
                        />
                    </Capsule>
                }
                .into_any()
            }
        }

        Page::Discover => {
            let tab = route.tab;
            view! {
                <Capsule size=CapsuleSize::Auto>
                    <Segmented
                        options=vec![
                            SegmentedOption::new("waterfall", "瀑布流"),
                            SegmentedOption::new("draw", "抽卡"),
                            SegmentedOption::new("slideshow", "幻灯片"),
                        ]
                        value=tab.key()
                        on_change=Callback::new(move |v: String| {
                            app.go(Route {
                                page: Page::Discover,
                                view: String::new(),
                                tab: crate::state::DiscoverTab::from_key(&v),
                            })
                        })
                    />
                </Capsule>
            }
            .into_any()
        }

        Page::Trash => {
            let n = app.trash.with(|t| t.len());
            let empty = n == 0;
            view! {
                <Capsule size=CapsuleSize::Auto>
                    <Button
                        label="全部还原"
                        icon=IconName::UNDO
                        variant=ButtonVariant::Plain
                        size=Size::Sm
                        disabled=empty
                        on_click=Callback::new(move |_| pages::trash::restore_all(app))
                    />
                    <Button
                        label=format!("清空（{n}）")
                        icon=IconName::TRASH
                        variant=ButtonVariant::Plain
                        size=Size::Sm
                        disabled=empty
                        on_click=Callback::new(move |_| pages::trash::empty_all(app))
                    />
                </Capsule>
            }
            .into_any()
        }

        Page::Settings => ().into_any(),
    }
}

const P_OPEN_FOLDER: &str = "photo:folder";
const P_SELECT_ALL: &str = "photo:select-all";
const P_INVERT: &str = "photo:invert";
const P_EXPORT: &str = "photo:export";
const P_IMPORT: &str = "photo:import";
const P_RESCAN: &str = "photo:rescan";

fn photo_menu_items(page: Page) -> Vec<MenuItem> {
    let mut items = vec![
        MenuItem::new(P_OPEN_FOLDER, "打开图库位置").icon(IconName::EXTERNAL_LINK),
        MenuItem::new(P_SELECT_ALL, "全选")
            .icon(IconName::SQUARE_CHECK)
            .separator_before(),
        MenuItem::new(P_INVERT, "反选").icon(IconName::SQUARE_DASHED),
    ];
    if page == Page::Favorites {
        items.push(
            MenuItem::new(P_EXPORT, "导出收藏…")
                .icon(IconName::DOWNLOAD)
                .separator_before(),
        );
        items.push(MenuItem::new(P_IMPORT, "导入收藏…").icon(IconName::UPLOAD));
    }
    items.push(
        MenuItem::new(P_RESCAN, "重新扫描")
            .icon(IconName::REFRESH_CW)
            .separator_before(),
    );
    items
}

fn on_photo_menu(app: &App, id: &str) {
    match id {
        P_OPEN_FOLDER => {
            let folder = app.profile_folder();
            spawn_local(async move {
                let _ = api::open_in_explorer(&folder).await;
            });
        }
        P_SELECT_ALL => {
            let list = app.visible("all");
            app.selection
                .set(list.iter().map(|i| i.key.clone()).collect());
        }
        P_INVERT => {
            let list = app.visible("all");
            let cur = app.selection.get_untracked();
            app.selection.set(
                list.iter()
                    .filter(|i| !cur.contains(&i.key))
                    .map(|i| i.key.clone())
                    .collect(),
            );
        }
        P_EXPORT => pages::settings::export_favorites(*app),
        P_IMPORT => pages::settings::import_favorites(*app),
        P_RESCAN => app.reload_index(),
        _ => {}
    }
}

fn album_menu_items(app: &App) -> Vec<MenuItem> {
    let folder = app.route.get().view;
    let items = vec![
        MenuItem::new("album:cover", "把选中的照片设为封面").icon(IconName::IMAGE),
        MenuItem::new("album:rename", "重命名相册…")
            .icon(IconName::SQUARE_PEN)
            .separator_before(),
        MenuItem::new("album:open", "在资源管理器中打开").icon(IconName::EXTERNAL_LINK),
        MenuItem::new("album:delete", "删除相册")
            .icon(IconName::TRASH)
            .danger()
            .separator_before(),
    ];
    items
        .into_iter()
        .map(|it| {
            if folder.is_empty() {
                MenuItem {
                    disabled: true,
                    ..it
                }
            } else {
                it
            }
        })
        .collect()
}

/* ==========================================================================
   页面内容
   ========================================================================== */

fn page_body(app: App) -> AnyView {
    let route = app.route.get();

    // 没有图库：欢迎页。它不属于任何一页，所以不走路由。
    if app.profile_id.get().is_empty() {
        return view! { <pages::welcome::Welcome /> }.into_any();
    }

    match route.page {
        Page::Home => view! { <pages::home::HomePage /> }.into_any(),
        Page::Library => view! { <pages::library::LibraryPage /> }.into_any(),
        Page::Albums => view! { <pages::albums::AlbumsPage /> }.into_any(),
        Page::Favorites => view! { <pages::favorites::FavoritesPage /> }.into_any(),
        Page::Discover => view! { <pages::discover::DiscoverPage /> }.into_any(),
        Page::Trash => view! { <pages::trash::TrashPage /> }.into_any(),
        Page::Settings => view! { <pages::settings::SettingsPage /> }.into_any(),
    }
}

/* ==========================================================================
   底部状态条
   ========================================================================== */

fn status_strip(app: App) -> AnyView {
    let busy = app.busy.get();
    let status = app.status.get();
    let gen = app.gen.get();

    if !busy && !gen.running && status.is_empty() {
        return ().into_any();
    }

    let label = if gen.running {
        format!("生成缩略图 {} / {}", gen.done, gen.total)
    } else if !status.is_empty() {
        status
    } else {
        "处理中…".into()
    };
    let pct = if gen.running && gen.total > 0 {
        gen.done as f64 / gen.total as f64
    } else {
        0.0
    };

    view! {
        <StatusBar>
            <StatusItem
                icon=IconName::LOADER
                label=label
                value=if gen.running {
                    format!("{}%", (pct * 100.0).round() as i64)
                } else {
                    String::new()
                }
            />
            <StatusProgress label="" value=pct phase="" />
        </StatusBar>
    }
    .into_any()
}


/* ==========================================================================
   封面页（启动后的第一屏）
   ========================================================================== */

/// 只有红绿灯的窗口区。封面页与加载页没有导航栏，用不到「收起导航」那颗按钮。
#[component]
fn WindowChrome() -> impl IntoView {
    let app = App::use_ctx();
    view! {
        <TrafficLights
            focused=Signal::derive(move || app.focused.get())
            on_close=Callback::new(|_| api::window_action("close"))
            on_minimize=Callback::new(|_| api::window_action("minimize"))
            on_zoom=Callback::new(|_| api::window_action("toggleMaximize"))
        />
    }
}

#[component]
fn LauncherBody() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        <div class="lumina-launcher">
            <div class="lumina-launcher__inner">
                <div class="lumina-launcher__head">
                    <div class="lumina-launcher__mark">
                        <Icon name=IconName::IMAGES size=26 />
                    </div>
                    <div class="l-stack l-stack--1">
                        <span class="lumina-launcher__title">"Lumina"</span>
                        <span class="c-subtitle">
                            "选一个图库开始。照片始终留在这台电脑上，Lumina 只做索引。"
                        </span>
                    </div>
                </div>

                {move || {
                    let list = app.profiles.get();
                    if list.is_empty() {
                        return view! {
                            <div class="lumina-launcher__empty">
                                <Empty
                                    icon=IconName::FOLDER_PLUS
                                    title="还没有图库"
                                    desc="选一个装照片的文件夹，它就会成为你的第一个图库。文件不会被移动，也不会被上传。"
                                >
                                    <Button
                                        label="选择文件夹"
                                        icon=IconName::FOLDER_PLUS
                                        variant=ButtonVariant::Primary
                                        size=Size::Lg
                                        on_click=Callback::new(move |_| app.add_profile())
                                    />
                                </Empty>
                            </div>
                        }
                        .into_any();
                    }

                    view! {
                        <div class="lumina-launcher__grid">
                            {list
                                .into_iter()
                                .map(|p| view! { <LibCard profile=p /> })
                                .collect_view()}
                            <button
                                class="lumina-libcard lumina-libcard--add"
                                on:click=move |_| app.add_profile()
                            >
                                <span class="lumina-libcard__plus">
                                    <Icon name=IconName::PLUS size=22 />
                                </span>
                                <span class="lumina-libcard__name">"添加图库"</span>
                                <span class="lumina-libcard__path">"选一个装照片的文件夹"</span>
                            </button>
                        </div>
                    }
                    .into_any()
                }}
            </div>
        </div>
    }
}

#[component]
fn LibCard(profile: Profile) -> impl IntoView {
    let app = App::use_ctx();

    let enter_click = profile.id.clone();
    let enter_key = profile.id.clone();
    let relocate_id = profile.id.clone();
    let remove_target = profile.clone();
    let unavailable = profile.unavailable != 0;
    let last = profile.last_access.unwrap_or(0);
    let meta = if last > 0 {
        format!("上次打开 {}", format_ms(last))
    } else {
        "还没打开过".to_string()
    };
    let path = profile.folder_path.clone();
    // `title` 会被 view! 包成一个闭包并移走，所以这里先分一份给它
    let path_title = path.clone();
    let name = profile.name.clone();

    view! {
        <div
            class="lumina-libcard"
            role="button"
            tabindex="0"
            title=path_title
            on:click=move |_| app.enter_profile(enter_click.clone())
            on:keydown=move |ev: web_sys::KeyboardEvent| {
                if ev.key() == "Enter" || ev.key() == " " {
                    ev.prevent_default();
                    app.enter_profile(enter_key.clone());
                }
            }
        >
            <div class="lumina-libcard__art">
                <Icon
                    name=if unavailable { IconName::TRIANGLE_ALERT } else { IconName::IMAGES }
                    size=30
                />
            </div>

            <div class="lumina-libcard__body">
                <span class="lumina-libcard__name">{name}</span>
                <span class="lumina-libcard__path">{path}</span>
                <span class="lumina-libcard__meta">
                    {if unavailable { "文件夹不可用，需要重新定位".to_string() } else { meta }}
                </span>
            </div>

            <div class="lumina-libcard__actions">
                <button
                    class="lumina-libcard__act"
                    title="重新定位"
                    aria-label="重新定位"
                    on:click=move |ev: web_sys::MouseEvent| {
                        ev.stop_propagation();
                        app.relocate_profile(relocate_id.clone());
                    }
                >
                    <Icon name=IconName::MOVE size=13 />
                </button>
                <button
                    class="lumina-libcard__act"
                    title="移除图库"
                    aria-label="移除图库"
                    on:click=move |ev: web_sys::MouseEvent| {
                        ev.stop_propagation();
                        confirm_remove_profile(app, &remove_target);
                    }
                >
                    <Icon name=IconName::TRASH size=13 />
                </button>
            </div>
        </div>
    }
}

fn confirm_remove_profile(app: App, p: &Profile) {
    app.modal.set(Some(
        Modal::new(ModalKind::RemoveProfile, "移除图库")
            .desc(&format!(
                "「{}」会从列表里移除。磁盘上的照片不会被删除，之后还可以再添加回来。",
                p.name
            ))
            .folder(&p.id),
    ));
}

/* ==========================================================================
   加载页（进入图库时）
   ========================================================================== */

#[component]
fn EnteringBody() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        <div class="lumina-loading">
            <div class="lumina-loading__mark">
                <Icon name=IconName::IMAGES size=30 />
            </div>
            <div class="lumina-loading__title">
                {move || format!("正在打开「{}」", app.profile_name())}
            </div>
            <div class="lumina-loading__bar">
                <Progress indeterminate=true label="正在加载图库" />
            </div>
            <div class="lumina-loading__status">
                {move || {
                    let s = app.status.get();
                    if s.is_empty() { "正在准备…".to_string() } else { s }
                }}
            </div>
        </div>
    }
}
