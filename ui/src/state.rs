// ============================================================
// Lumina · 应用状态
// 一个 Copy 的句柄，内部全是 RwSignal。页面通过 `App::use_ctx()` 拿。
//
// 为什么不是「一个大对象 + 手动重绘」：Leptos 的细粒度响应式已经解决了
// 「数据变了谁该重画」，这里只负责把数据切成足够细的信号，
// 让切换收藏状态不会把整个网格重排。
// ============================================================

use std::collections::{HashMap, HashSet};

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::api;
use crate::models::*;
use crate::prefs::UiPrefs;
use crate::search::{compare_name, Filter, SortBy};
use crate::theme;
use crate::ui::toast_with;

/* ==========================================================================
   启动流程
   ========================================================================== */

/// 应用当前停在哪个屏幕。
///
/// 启动**永远**先进封面页：直接钻进上次的图库会让人分不清这是哪一本，
/// 也没地方放「添加 / 移除图库」这些库级操作。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Screen {
    /// 封面页：选图库、添加、移除、重定位
    #[default]
    Launcher,
    /// 进入中：加载动画。数据没落定之前不切到主界面
    Entering,
    /// 主界面
    App,
}

/// 加载动画至少显示这么久，避免小图库一闪而过。
const MIN_ENTERING_MS: f64 = 700.0;

fn now_ms() -> f64 {
    js_sys::Date::now()
}

/// 下一帧再跑。用于「在事件回调里改会拆掉当前子树的状态」的场合。
fn defer(f: impl FnOnce() + 'static) {
    let cb = wasm_bindgen::closure::Closure::once(Box::new(f) as Box<dyn FnOnce()>);
    if let Some(w) = web_sys::window() {
        let _ = w.set_timeout_with_callback_and_timeout_and_arguments_0(
            wasm_bindgen::JsCast::unchecked_ref(cb.as_ref()),
            0,
        );
    }
    cb.forget();
}

/* ==========================================================================
   路由
   ========================================================================== */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Page {
    #[default]
    Home,
    Library,
    Albums,
    Favorites,
    Discover,
    Trash,
    Settings,
}

impl Page {
    pub fn key(self) -> &'static str {
        match self {
            Self::Home => "home",
            Self::Library => "library",
            Self::Albums => "albums",
            Self::Favorites => "favorites",
            Self::Discover => "discover",
            Self::Trash => "trash",
            Self::Settings => "settings",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::Home => "主页",
            Self::Library => "全部照片",
            Self::Albums => "相册",
            Self::Favorites => "收藏",
            Self::Discover => "发现",
            Self::Trash => "回收站",
            Self::Settings => "设置",
        }
    }

    pub fn subtitle(self) -> &'static str {
        match self {
            Self::Home => "",
            Self::Library => "",
            Self::Albums => "",
            Self::Favorites => "标记过的照片都在这儿",
            Self::Discover => "换一种方式看同一批照片",
            Self::Trash => "删除的照片先放这里",
            Self::Settings => "改动立即生效并保存",
        }
    }

    pub fn from_key(s: &str) -> Self {
        match s {
            "library" => Self::Library,
            "albums" => Self::Albums,
            "favorites" => Self::Favorites,
            "discover" => Self::Discover,
            "trash" => Self::Trash,
            "settings" => Self::Settings,
            _ => Self::Home,
        }
    }
}

/// 发现页的三种形态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DiscoverTab {
    #[default]
    Waterfall,
    Draw,
    Slideshow,
}

impl DiscoverTab {
    pub fn key(self) -> &'static str {
        match self {
            Self::Waterfall => "waterfall",
            Self::Draw => "draw",
            Self::Slideshow => "slideshow",
        }
    }
    pub fn from_key(s: &str) -> Self {
        match s {
            "draw" => Self::Draw,
            "slideshow" => Self::Slideshow,
            _ => Self::Waterfall,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Route {
    pub page: Page,
    /// 相册页的当前相册（`""` / `"albums"` = 相册总览）
    pub view: String,
    pub tab: DiscoverTab,
}

impl Route {
    pub fn page(p: Page) -> Self {
        Self {
            page: p,
            view: if p == Page::Albums { "albums".into() } else { String::new() },
            tab: DiscoverTab::Waterfall,
        }
    }
    pub fn album(folder: &str) -> Self {
        Self {
            page: Page::Albums,
            view: folder.to_string(),
            tab: DiscoverTab::Waterfall,
        }
    }
    /// 导航高亮用的键
    pub fn nav_key(&self) -> String {
        match self.page {
            Page::Albums if !self.view.is_empty() && self.view != "albums" => {
                format!("album:{}", self.view)
            }
            p => p.key().to_string(),
        }
    }
    pub fn hash(&self) -> String {
        match self.page {
            Page::Albums if !self.view.is_empty() && self.view != "albums" => {
                format!("#/albums/{}", self.view)
            }
            Page::Discover => format!("#/discover/{}", self.tab.key()),
            p => format!("#/{}", p.key()),
        }
    }
}

/* ==========================================================================
   缩略图：批量请求 + 内存缓存
   ========================================================================== */

/// `${folder}|${name}|${size}` → asset URL
type ThumbMap = HashMap<String, String>;

#[derive(Clone, Copy)]
pub struct Thumbs {
    pub map: RwSignal<ThumbMap>,
}

impl Thumbs {
    pub fn key(folder: Option<&str>, name: &str, size: u32) -> String {
        format!("{}\u{1}{}\u{1}{}", folder.unwrap_or(""), name, size)
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.map.with(|m| m.get(key).cloned())
    }

    /// 登记一张缩略图的需求；真正的 IPC 会在本帧末尾合并发出。
    pub fn request(&self, key: String, name: String, folder: Option<String>, size: u32) {
        if self.map.with(|m| m.contains_key(&key)) {
            return;
        }
        pending_push(Pending {
            thumbs: *self,
            key,
            name,
            folder,
            size,
        });
    }

    pub fn clear(&self) {
        self.map.set(ThumbMap::new());
    }
}

struct Pending {
    thumbs: Thumbs,
    key: String,
    name: String,
    folder: Option<String>,
    size: u32,
}

thread_local! {
    static PENDING: std::cell::RefCell<Vec<Pending>> = const { std::cell::RefCell::new(Vec::new()) };
    static SCHEDULED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// 当前图库 id —— 批量请求要用它，避免每个 Pending 各存一份
    static PROFILE: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
    /// 正在飞行中的键，避免同一张图被重复排队
    static INFLIGHT: std::cell::RefCell<HashSet<String>> = std::cell::RefCell::new(HashSet::new());
}

pub fn set_profile_for_thumbs(id: &str) {
    PROFILE.with(|p| *p.borrow_mut() = id.to_string());
}

fn pending_push(p: Pending) {
    let dup = INFLIGHT.with(|s| s.borrow().contains(&p.key));
    if dup {
        return;
    }
    INFLIGHT.with(|s| {
        s.borrow_mut().insert(p.key.clone());
    });
    PENDING.with(|q| q.borrow_mut().push(p));

    if SCHEDULED.with(|s| s.get()) {
        return;
    }
    SCHEDULED.with(|s| s.set(true));

    // 一帧之后再发：滚动过程中同一帧里登记的所有缩略图会合并成一次 IPC。
    schedule_frame(|| {
        SCHEDULED.with(|s| s.set(false));
        flush();
    });
}

fn schedule_frame(f: impl FnOnce() + 'static) {
    // 用 setTimeout(0) 而不是 rAF：窗口最小化时 rAF 不跑，缩略图会一直空着。
    let cb = wasm_bindgen::closure::Closure::once(Box::new(f) as Box<dyn FnOnce()>);
    let _ = web_timeout(cb.as_ref().unchecked_ref(), 0);
    cb.forget();
}

fn web_timeout(f: &js_sys::Function, ms: i32) -> Result<i32, wasm_bindgen::JsValue> {
    let win = js_sys::global();
    let set_timeout = js_sys::Reflect::get(&win, &"setTimeout".into())?;
    let set_timeout: js_sys::Function = set_timeout.dyn_into()?;
    set_timeout
        .call2(&win, f, &wasm_bindgen::JsValue::from_f64(ms as f64))
        .map(|v| v.as_f64().unwrap_or(0.0) as i32)
}

use wasm_bindgen::JsCast;

fn flush() {
    let batch: Vec<Pending> = PENDING.with(|q| std::mem::take(&mut *q.borrow_mut()));
    if batch.is_empty() {
        return;
    }
    let profile = PROFILE.with(|p| p.borrow().clone());
    if profile.is_empty() {
        INFLIGHT.with(|s| {
            for p in &batch {
                s.borrow_mut().remove(&p.key);
            }
        });
        return;
    }

    // 同尺寸的合成一批
    let mut by_size: HashMap<u32, Vec<Pending>> = HashMap::new();
    for p in batch {
        by_size.entry(p.size).or_default().push(p);
    }

    for (size, items) in by_size {
        let profile = profile.clone();
        spawn_local(async move {
            let req: Vec<(String, Option<String>)> = items
                .iter()
                .map(|p| (p.name.clone(), p.folder.clone()))
                .collect();
            let res = api::get_thumbnails_batch(&profile, &req, size).await;

            let mut add: Vec<(Thumbs, String, String)> = Vec::new();
            if let Ok(list) = res {
                for (p, item) in items.iter().zip(list.iter()) {
                    if let Some(url) = &item.data_url {
                        if !url.is_empty() {
                            add.push((p.thumbs, p.key.clone(), api::file_src(url)));
                        }
                    }
                }
            }
            // 无论成功失败都要把飞行标记撤掉，否则失败的图永远不会重试
            INFLIGHT.with(|s| {
                for p in &items {
                    s.borrow_mut().remove(&p.key);
                }
            });
            if add.is_empty() {
                return;
            }
            // 整个应用只有一个 Thumbs 实例（信号挂在 App 上），
            // 所以一批结果一次 update 写完，避免 N 次全表克隆。
            let Some((first, _, _)) = add.first() else { return };
            let target = first.map;
            target.update(|m| {
                for (_, k, u) in add {
                    m.insert(k, u);
                }
            });
        });
    }
}

/* ==========================================================================
   应用状态
   ========================================================================== */

#[derive(Clone, Copy)]
pub struct App {
    /* 图库 */
    pub profiles: RwSignal<Vec<Profile>>,
    pub profile_id: RwSignal<String>,
    pub settings: RwSignal<Settings>,

    /* 索引 */
    pub root: RwSignal<Vec<Image>>,
    pub folders: RwSignal<Vec<String>>,
    pub album_images: RwSignal<HashMap<String, Vec<Image>>>,
    pub albums: RwSignal<Vec<Album>>,

    /* 收藏 / 回收站 */
    pub favorites: RwSignal<Vec<Image>>,
    pub fav_set: RwSignal<HashSet<String>>,
    pub trash: RwSignal<Vec<TrashItem>>,
    pub trash_count: RwSignal<i64>,
    /// 本次会话里回收站曾经有过内容 —— 用来区分「没删过」和「已清空」
    pub trash_ever_had: RwSignal<bool>,

    /* 交互 */
    pub route: RwSignal<Route>,
    pub history: RwSignal<Vec<Route>>,
    pub cursor: RwSignal<usize>,
    pub selection: RwSignal<HashSet<String>>,
    pub query: RwSignal<crate::search::Query>,
    pub ui: RwSignal<UiPrefs>,
    pub lightbox: RwSignal<Option<crate::lightbox::Lightbox>>,

    /* 运行时 */
    pub status: RwSignal<String>,
    pub busy: RwSignal<bool>,
    pub cache: RwSignal<CacheInfo>,
    pub gen: RwSignal<CacheGenStatus>,
    pub thumbs: Thumbs,
    /// 首屏数据是否已经就绪（决定显示欢迎页还是内容）
    pub ready: RwSignal<bool>,
    /// 当前打开的模态框（重命名 / 移动 / 确认 / 新建相册）
    pub modal: RwSignal<Option<crate::pages::dialog::Modal>>,
    /// 当前视图里「过滤 + 排序」之后的完整列表（灯箱翻页用）
    pub view_items: RwSignal<Vec<Image>>,
    /// 封面页 / 加载页 / 主界面
    pub screen: RwSignal<Screen>,
    /// 进入动作的起始时刻（算最短加载时长用）
    pub enter_at: RwSignal<f64>,
    /// 窗口是否在前台。**必须挂在 App 上**：它由一条常驻的 window 监听写，
    /// 如果建在某个屏幕组件里，切屏时信号被销毁、监听还在，下一次失焦就 panic。
    pub focused: RwSignal<bool>,
}

impl App {
    pub fn provide() -> Self {
        let app = Self {
            profiles: RwSignal::new(Vec::new()),
            profile_id: RwSignal::new(String::new()),
            settings: RwSignal::new(Settings::fallback()),
            root: RwSignal::new(Vec::new()),
            folders: RwSignal::new(Vec::new()),
            album_images: RwSignal::new(HashMap::new()),
            albums: RwSignal::new(Vec::new()),
            favorites: RwSignal::new(Vec::new()),
            fav_set: RwSignal::new(HashSet::new()),
            trash: RwSignal::new(Vec::new()),
            trash_count: RwSignal::new(0),
            trash_ever_had: RwSignal::new(false),
            route: RwSignal::new(Route::default()),
            history: RwSignal::new(Vec::new()),
            cursor: RwSignal::new(0),
            selection: RwSignal::new(HashSet::new()),
            query: RwSignal::new(crate::search::Query::default()),
            ui: RwSignal::new(crate::prefs::load()),
            lightbox: RwSignal::new(None),
            status: RwSignal::new(String::new()),
            busy: RwSignal::new(false),
            cache: RwSignal::new(CacheInfo::default()),
            gen: RwSignal::new(CacheGenStatus::default()),
            thumbs: Thumbs {
                map: RwSignal::new(ThumbMap::new()),
            },
            ready: RwSignal::new(false),
            modal: RwSignal::new(None),
            view_items: RwSignal::new(Vec::new()),
            screen: RwSignal::new(Screen::Launcher),
            enter_at: RwSignal::new(0.0),
            focused: RwSignal::new(true),
        };
        provide_context(app);
        app
    }

    pub fn use_ctx() -> Self {
        use_context::<Self>().expect("App 未 provide")
    }

    /* ---------------- 派生数据 ---------------- */

    pub fn profile_folder(&self) -> String {
        let id = self.profile_id.get();
        self.profiles
            .with(|list| {
                list.iter()
                    .find(|p| p.id == id)
                    .map(|p| p.folder_path.clone())
            })
            .unwrap_or_default()
    }

    pub fn profile_name(&self) -> String {
        let id = self.profile_id.get();
        let name = self.profiles.with(|list| {
            list.iter()
                .find(|p| p.id == id)
                .map(|p| p.name.clone())
                .unwrap_or_default()
        });
        if name.is_empty() {
            let folder = self.profile_folder();
            if folder.is_empty() {
                "还没有图库".into()
            } else {
                last_segment(&folder)
            }
        } else {
            name
        }
    }

    /// 全部照片（根 + 各相册），已剔除 `.album/backgrounds`
    pub fn all_images(&self) -> Vec<Image> {
        let root = self.root.get();
        let albums = self.album_images.get();
        let mut out = Vec::with_capacity(root.len());
        out.extend(root);
        for list in albums.values() {
            out.extend(list.iter().cloned());
        }
        out
    }

    /// 某个视图的照片集合。`"all"` / `"albums"` = 全部，其余按相册过滤。
    pub fn images_in_view(&self, view: &str) -> Vec<Image> {
        if view.is_empty() || view == "all" || view == "albums" {
            return self.all_images();
        }
        self.album_images
            .with(|m| m.get(view).cloned())
            .unwrap_or_default()
    }

    /// 视图 → 过滤 → 排序。网格与列表都吃这个结果。
    pub fn visible(&self, view: &str) -> Vec<Image> {
        self.sort_filter(self.images_in_view(view))
    }

    /// 任意列表 → 过滤 → 排序（收藏页复用）
    pub fn sort_filter(&self, list: Vec<Image>) -> Vec<Image> {
        let mut list = list;
        let filter = Filter::from_query(&self.query.get());
        if !filter.is_empty() {
            list.retain(|img| filter.hits(&img.name));
        }
        let sort = SortBy::parse(&self.settings.with(|s| s.sort_by.clone()));
        match sort {
            SortBy::NameAsc => list.sort_by(|a, b| compare_name(&a.name, &b.name)),
            SortBy::NameDesc => list.sort_by(|a, b| compare_name(&b.name, &a.name)),
            SortBy::DateDesc => list.sort_by(|a, b| b.date.cmp(&a.date)),
            SortBy::DateAsc => list.sort_by(|a, b| a.date.cmp(&b.date)),
        }
        list
    }

    pub fn child_albums(&self, parent: &str) -> Vec<String> {
        let folders = self.folders.get();
        if parent.is_empty() {
            return folders.iter().filter(|f| !f.contains('/')).cloned().collect();
        }
        let prefix = format!("{parent}/");
        folders
            .iter()
            .filter(|f| f.starts_with(&prefix) && !f[prefix.len()..].contains('/'))
            .cloned()
            .collect()
    }

    pub fn has_children(&self, folder: &str) -> bool {
        !self.child_albums(folder).is_empty()
    }

    pub fn is_fav(&self, key: &str) -> bool {
        self.fav_set.with(|s| s.contains(key))
    }

    pub fn total_count(&self) -> usize {
        self.root.with(|r| r.len())
            + self
                .album_images
                .with(|m| m.values().map(|v| v.len()).sum::<usize>())
    }

    pub fn total_size(&self) -> u64 {
        let root: u64 = self.root.with(|r| r.iter().map(|i| i.size.max(0) as u64).sum());
        let albums: u64 = self.album_images.with(|m| {
            m.values()
                .flat_map(|v| v.iter())
                .map(|i| i.size.max(0) as u64)
                .sum()
        });
        root + albums
    }

    /// 相册封面：优先用户指定，否则第一张
    pub fn album_cover(&self, folder: &str) -> Option<Image> {
        let list = self.images_in_view(folder);
        let cover = self.albums.with(|a| {
            a.iter()
                .find(|x| x.folder_name == folder)
                .and_then(|x| x.cover_image.clone())
        });
        if let Some(name) = cover {
            if let Some(hit) = list.iter().find(|i| i.name == name) {
                return Some(hit.clone());
            }
        }
        list.into_iter().next()
    }

    /* ---------------- 路由 ---------------- */

    pub fn go(&self, route: Route) {
        let current = self.route.get_untracked();
        if current == route {
            return;
        }
        let mut stack = self.history.get_untracked();
        let mut cursor = self.cursor.get_untracked();
        stack.truncate(cursor + 1);
        stack.push(route.clone());
        cursor = stack.len().saturating_sub(1);
        self.history.set(stack);
        self.cursor.set(cursor);
        self.selection.update(|s| s.clear());
        self.route.set(route);
    }

    pub fn can_back(&self) -> bool {
        self.cursor.get() > 0
    }

    pub fn can_forward(&self) -> bool {
        self.cursor.get() + 1 < self.history.with(|h| h.len())
    }

    pub fn back(&self) {
        let cursor = self.cursor.get_untracked();
        if cursor == 0 {
            return;
        }
        let c = cursor - 1;
        if let Some(r) = self.history.with(|h| h.get(c).cloned()) {
            self.cursor.set(c);
            self.selection.update(|s| s.clear());
            self.route.set(r);
        }
    }

    pub fn forward(&self) {
        let cursor = self.cursor.get_untracked();
        let len = self.history.with(|h| h.len());
        if cursor + 1 >= len {
            return;
        }
        let c = cursor + 1;
        if let Some(r) = self.history.with(|h| h.get(c).cloned()) {
            self.cursor.set(c);
            self.selection.update(|s| s.clear());
            self.route.set(r);
        }
    }

    /* ---------------- 设置 ---------------- */

    /// 改设置：内存 → 立即生效 → 合并落库。
    ///
    /// 落库是**去抖**的：拖滑块时每帧都会调一次 patch，不合并就是几百次
    /// `settings_save`，每次都拿一次 DB 锁。这里攒 220ms，最后一次为准。
    pub fn patch(&self, updates: serde_json::Value) {
        // 内存先跟手（界面不等 IPC）。
        //
        // 必须走 `update`，不能走 `write_untracked`：后者的守卫是
        // `UntrackedWriteGuard`，**Drop 时不通知订阅者**（只有 `WriteGuard` 会
        // `notify()`）。用错的表现很迷惑 —— 值确实写进去了，下一次因为别的原因
        // 重绘时能读到新值，但所有订阅者都不醒：拖滑块时拇指冻住、旁边的数字不动，
        // 直到 220ms 去抖 + IPC 回包那次 `settings.set()` 才「瞬移」到位。
        self.settings.update(|s| apply_local(s, &updates));

        let profile = self.profile_id.get_untracked();
        if profile.is_empty() {
            return;
        }
        let app = *self;

        // 合并到待写缓冲
        SAVE_PENDING.with(|p| {
            let mut buf = p.borrow_mut();
            if let Some(obj) = updates.as_object() {
                for (k, v) in obj {
                    buf.insert(k.clone(), v.clone());
                }
            }
        });

        // 重排定时器
        SAVE_TIMER.with(|t| {
            if let Some(id) = t.get() {
                if let Some(w) = web_sys::window() {
                    w.clear_timeout_with_handle(id);
                }
            }
            let cb = wasm_bindgen::closure::Closure::once(Box::new(move || {
                flush_settings(app, profile);
            }) as Box<dyn FnOnce()>);
            let id = web_sys::window().and_then(|w| {
                w.set_timeout_with_callback_and_timeout_and_arguments_0(
                    wasm_bindgen::JsCast::unchecked_ref(cb.as_ref()),
                    220,
                )
                .ok()
            });
            cb.forget();
            t.set(id);
        });
    }

    /* ---------------- 数据加载 ---------------- */

    pub fn reload_index(&self) {
        let app = *self;
        let profile = app.profile_id.get_untracked();
        if profile.is_empty() {
            return;
        }
        app.busy.set(true);
        app.status.set("正在扫描图库…".into());

        // 扫描期间把后端报的进度写到状态行：加载页才有真的在动的反馈。
        let unlisten = api::listen("scan-progress", move |payload| {
            let files = js_sys::Reflect::get(&payload, &"files_found".into())
                .ok()
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0) as i64;
            if files > 0 {
                app.status.set(format!("已发现 {files} 个文件…"));
            }
        });

        spawn_local(async move {
            match api::scan_all(&profile).await {
                Ok(res) => {
                    app.apply_scan(&res);
                    app.status.set(String::new());
                }
                Err(e) => {
                    toast_with(format!("扫描失败：{e}"), Tone::Danger, None);
                    app.status.set(String::new());
                }
            }
            // 相册记录（封面 / 排序）
            if let Ok(list) = api::albums_list(&profile).await {
                app.albums.set(list);
            }
            unlisten();
            app.busy.set(false);
            app.ready.set(true);
            app.finish_entering();
        });
    }

    /// 索引就绪 → 结束加载页。不足最短时长就补一段，避免闪一下。
    pub fn finish_entering(&self) {
        if self.screen.get_untracked() != Screen::Entering {
            return;
        }
        let app = *self;
        let elapsed = now_ms() - self.enter_at.get_untracked();
        let wait = (MIN_ENTERING_MS - elapsed).max(0.0) as i32;
        if wait == 0 {
            app.screen.set(Screen::App);
            return;
        }
        let cb = wasm_bindgen::closure::Closure::once(Box::new(move || {
            if app.screen.get_untracked() == Screen::Entering {
                app.screen.set(Screen::App);
            }
        }) as Box<dyn FnOnce()>);
        if let Some(w) = web_sys::window() {
            let _ = w.set_timeout_with_callback_and_timeout_and_arguments_0(
                wasm_bindgen::JsCast::unchecked_ref(cb.as_ref()),
                wait,
            );
        }
        cb.forget();
    }

    pub fn apply_scan(&self, res: &ScanResult) {
        let root: Vec<Image> = res
            .root_images
            .iter()
            .map(|fi| Image::from_file(fi, None))
            .collect();

        let mut folders = res.album_folders.clone();
        // `.album/backgrounds` 不是一个相册，不能出现在图片网格里
        folders.retain(|f| f != ".album/backgrounds");
        folders.sort_by(|a, b| compare_name(a, b));

        let mut map: HashMap<String, Vec<Image>> = HashMap::new();
        for (folder, list) in &res.album_images {
            if folder == ".album/backgrounds" {
                continue;
            }
            map.insert(
                folder.clone(),
                list.iter().map(|fi| Image::from_file(fi, Some(folder))).collect(),
            );
        }

        self.root.set(root);
        self.folders.set(folders);
        self.album_images.set(map);
        self.thumbs.clear();
    }

    pub fn reload_favorites(&self) {
        let app = *self;
        let profile = app.profile_id.get_untracked();
        if profile.is_empty() {
            return;
        }
        spawn_local(async move {
            if let Ok(list) = api::favorites_list(&profile).await {
                let imgs: Vec<Image> = list.iter().map(Image::from_favorite).collect();
                app.fav_set
                    .set(imgs.iter().map(|i| i.key.clone()).collect::<HashSet<_>>());
                app.favorites.set(imgs);
            }
        });
    }

    pub fn reload_trash(&self) {
        let app = *self;
        let profile = app.profile_id.get_untracked();
        if profile.is_empty() {
            return;
        }
        spawn_local(async move {
            if let Ok(list) = api::trash_list(&profile).await {
                let items: Vec<TrashItem> = list.iter().map(TrashItem::from_record).collect();
                if !items.is_empty() {
                    app.trash_ever_had.set(true);
                }
                app.trash_count.set(items.len() as i64);
                app.trash.set(items);
            }
        });
    }

    pub fn reload_cache(&self) {
        let app = *self;
        let profile = app.profile_id.get_untracked();
        if profile.is_empty() {
            return;
        }
        spawn_local(async move {
            if let Ok(info) = api::cache_info(&profile).await {
                app.cache.set(info);
            }
        });
    }

    /// 进入图库：先切到加载页，等索引落定再进主界面。
    pub fn enter_profile(&self, id: String) {
        let app = *self;
        if id.is_empty() {
            return;
        }
        // 切屏会拆掉「封面页」整棵 DOM，而这次调用往往就发生在封面页某个
        // 卡片的 click 回调里。放到下一帧做，回调先安全退出。
        defer(move || {
            app.screen.set(Screen::Entering);
            app.enter_at.set(now_ms());
            app.status.set(String::new());
            // 历史栈先铺上「主页」这一格：否则 cursor 一直是 0，
            // can_back() 恒为 false，顶栏那对前进/后退看起来就像没接线。
            let home = Route::page(Page::Home);
            app.route.set(home.clone());
            app.history.set(vec![home]);
            app.cursor.set(0);
        });
        app.profile_id.set(id.clone());
        set_profile_for_thumbs(&id);
        app.thumbs.clear();
        app.selection.update(|s| s.clear());
        app.root.set(Vec::new());
        app.folders.set(Vec::new());
        app.album_images.set(HashMap::new());
        app.albums.set(Vec::new());
        app.favorites.set(Vec::new());
        app.fav_set.set(HashSet::new());
        app.trash.set(Vec::new());
        app.trash_count.set(0);
        app.ready.set(false);

        spawn_local(async move {
            api::profile_touch(&id).await.ok();
            match api::settings_get(&id).await {
                Ok(s) => app.settings.set(s),
                Err(_) => app.settings.set(Settings::fallback()),
            }
            app.reload_favorites();
            app.reload_trash();
            app.reload_cache();
            app.reload_index();
        });
    }

    /// 启动：只列图库，然后停在封面页。进入是用户的事。
    pub fn boot(&self) {
        let app = *self;
        spawn_local(async move {
            app.refresh_profiles().await;
            app.screen.set(Screen::Launcher);
        });
    }

    async fn refresh_profiles(&self) {
        match api::profiles_list().await {
            Ok(mut list) => {
                // 最近用过的排前面
                list.sort_by(|a, b| b.last_access.unwrap_or(0).cmp(&a.last_access.unwrap_or(0)));
                self.profiles.set(list);
            }
            Err(e) => {
                if api::is_desktop() {
                    toast_with(format!("读取图库列表失败：{e}"), Tone::Danger, None);
                }
            }
        }
    }

    /// 从主界面退回封面页。图库数据清掉，但磁盘上的东西一个字节都不动。
    pub fn back_to_launcher(&self) {
        let app = *self;
        self.lightbox.set(None);
        self.modal.set(None);
        self.selection.update(|s| s.clear());
        self.thumbs.clear();
        self.profile_id.set(String::new());
        set_profile_for_thumbs("");
        self.root.set(Vec::new());
        self.folders.set(Vec::new());
        self.album_images.set(HashMap::new());
        self.albums.set(Vec::new());
        self.favorites.set(Vec::new());
        self.fav_set.set(HashSet::new());
        self.trash.set(Vec::new());
        self.trash_count.set(0);
        self.view_items.set(Vec::new());
        self.status.set(String::new());
        self.route.set(Route::page(Page::Home));
        self.history.set(Vec::new());
        self.cursor.set(0);
        defer(move || app.screen.set(Screen::Launcher));
        spawn_local(async move {
            app.refresh_profiles().await;
        });
    }

    /// 添加图库：选文件夹 → 建 profile → 打开
    pub fn add_profile(&self) {
        let app = *self;
        spawn_local(async move {
            let Ok(Some(path)) = api::dialog_open_folder(Some("选择图库文件夹")).await else {
                return;
            };
            let name = last_segment(&path);
            match api::profile_create(&path, &name).await {
                Ok(p) => {
                    if let Ok(list) = api::profiles_list().await {
                        app.profiles.set(list);
                    }
                    app.enter_profile(p.id);
                    toast_with(format!("已添加图库「{name}」"), Tone::Success, None);
                }
                Err(e) => toast_with(format!("添加失败：{e}"), Tone::Danger, None),
            }
        });
    }

    pub fn remove_profile(&self, id: String) {
        let app = *self;
        spawn_local(async move {
            if let Err(e) = api::profile_remove(&id).await {
                toast_with(format!("移除失败：{e}"), Tone::Danger, None);
                return;
            }
            if let Ok(list) = api::profiles_list().await {
                app.profiles.set(list.clone());
                if app.profile_id.get_untracked() == id {
                    app.profile_id.set(String::new());
                    let mut sorted = list;
                    sorted.sort_by(|a, b| {
                        b.last_access
                            .unwrap_or(0)
                            .cmp(&a.last_access.unwrap_or(0))
                    });
                    // 移除的是当前图库：退回封面页，不替用户挑下一本
                    app.back_to_launcher();
                }
            }
            toast_with("已移除图库（照片文件未被删除）", Tone::Success, None);
        });
    }

    pub fn relocate_profile(&self, id: String) {
        let app = *self;
        spawn_local(async move {
            match api::profile_relocate(&id).await {
                Ok(Some(p)) => {
                    if let Ok(list) = api::profiles_list().await {
                        app.profiles.set(list);
                    }
                    app.enter_profile(p.id);
                    toast_with("图库位置已更新", Tone::Success, None);
                }
                Ok(None) => {}
                Err(e) => toast_with(format!("重定位失败：{e}"), Tone::Danger, None),
            }
        });
    }
}

thread_local! {
    /// 待落库的设置补丁（去抖窗口内累积）
    static SAVE_PENDING: std::cell::RefCell<serde_json::Map<String, serde_json::Value>> =
        std::cell::RefCell::new(serde_json::Map::new());
    static SAVE_TIMER: std::cell::Cell<Option<i32>> = const { std::cell::Cell::new(None) };
}

fn flush_settings(app: App, profile: String) {
    let batch = SAVE_PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    if batch.is_empty() {
        return;
    }
    let updates = serde_json::Value::Object(batch);
    spawn_local(async move {
        match api::settings_save(&profile, updates).await {
            Ok(s) => {
                // 用后端回传的整份设置校准（字段类型、clamp 都在后端）
                app.settings.set(s);
            }
            Err(e) => toast_with(format!("设置保存失败：{e}"), Tone::Danger, None),
        }
    });
}

/// 把 `settings_save` 的补丁就地写进本地 Settings，避免等 IPC 造成控件回弹。
fn apply_local(s: &mut Settings, updates: &serde_json::Value) {
    let Some(obj) = updates.as_object() else { return };
    let i = |v: &serde_json::Value| v.as_i64();
    let f = |v: &serde_json::Value| v.as_f64();
    let b = |v: &serde_json::Value| v.as_bool();

    for (k, v) in obj {
        match k.as_str() {
            "view_mode" => s.view_mode = v.as_str().unwrap_or("grid").to_string(),
            "sort_by" => s.sort_by = v.as_str().unwrap_or("name-asc").to_string(),
            "theme_mode" => s.theme_mode = v.as_str().unwrap_or("system").to_string(),
            "accent_color" => s.accent_color = v.as_str().unwrap_or(theme::DEFAULT_ACCENT).to_string(),
            "accent_mode" => s.accent_mode = v.as_str().unwrap_or("custom").to_string(),
            "accent_color_dark" => s.accent_color_dark = v.as_str().unwrap_or("").to_string(),
            "accent_color_light" => s.accent_color_light = v.as_str().unwrap_or("").to_string(),
            "thumbnail_size" => s.thumbnail_size = i(v).unwrap_or(s.thumbnail_size),
            "list_columns" => s.list_columns = i(v).unwrap_or(s.list_columns),
            "draw_count" => s.draw_count = i(v).unwrap_or(s.draw_count),
            "random_interval" => s.random_interval = i(v).unwrap_or(s.random_interval),
            "thumb_gen_concurrency" => {
                s.thumb_gen_concurrency = i(v).unwrap_or(s.thumb_gen_concurrency)
            }
            "reverse_search_enabled" => {
                s.reverse_search_enabled = i(v).unwrap_or(s.reverse_search_enabled)
            }
            "sidebar_width" => s.sidebar_width = i(v).unwrap_or(s.sidebar_width),
            "sidebar_opacity" => s.sidebar_opacity = f(v).unwrap_or(s.sidebar_opacity),
            "sidebar_blur" => s.sidebar_blur = i(v).unwrap_or(s.sidebar_blur),
            "card_opacity" => s.card_opacity = f(v).unwrap_or(s.card_opacity),
            "card_blur" => s.card_blur = i(v).unwrap_or(s.card_blur),
            "bg_blur" => s.bg_blur = i(v).unwrap_or(s.bg_blur),
            "bg_opacity" => s.bg_opacity = f(v).unwrap_or(s.bg_opacity),
            "bg_transparent" => s.bg_transparent = b(v).unwrap_or(s.bg_transparent),
            "bg_effect_type" => s.bg_effect_type = v.as_str().unwrap_or("acrylic").to_string(),
            "font_family" => s.font_family = v.as_str().unwrap_or("").to_string(),
            "panel_radius" => s.panel_radius = i(v).unwrap_or(s.panel_radius),
            "titlebar_mode" => s.titlebar_mode = v.as_str().unwrap_or("macos").to_string(),
            "home_title" => s.home_title = v.as_str().map(str::to_string),
            _ => {}
        }
    }
}
