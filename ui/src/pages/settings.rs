// ============================================================
// Lumina · 设置
// 只保留两类东西：
//   ① 功能开关：视图 / 排序 / 缩略图 / 缓存 / 收藏导入导出
//   ② 界面尺寸参数：侧栏宽度、每行图片数、图片间距
// 每一行都是 `Row`；需要整行的控件用 `stack` 语义（这里用 lumina-rowfill）。
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::api;
use crate::models::*;
use crate::pages::dialog::{confirm, Modal, ModalKind};
use crate::search::SortBy;
use crate::state::App;
use crate::theme;
use crate::ui::{toast, toast_with};

const APP_VERSION: &str = "4.0.1";

#[component]
pub fn SettingsPage() -> impl IntoView {
    let app = App::use_ctx();
    let th = use_context::<Theme>().expect("Theme");

    view! {
        <div class="lumina-page">
            // ================= 外观 =================
            <Card>
                <SectionTitle>"外观"</SectionTitle>
                <Row label="主题" hint="跟随系统时随 Windows 明暗切换">
                    <Segmented
                        options=vec![
                            SegmentedOption::new("light", "浅色"),
                            SegmentedOption::new("dark", "深色"),
                            SegmentedOption::new("system", "跟随系统"),
                        ]
                        value=Signal::derive(move || app.settings.get().theme_mode)
                        on_change=Callback::new(move |v: String| {
                            let mode = theme::parse_mode(&v);
                            theme::set_mode(th, mode);
                            app.patch(serde_json::json!({ "theme_mode": v }));
                        })
                    />
                </Row>
                <Row label="强调色" hint="选中态、开关、滑块会一起变色">
                    <ColorWell
                        value=Signal::derive(move || app.settings.get().accent_color)
                        label="强调色"
                        show_hex=true
                        on_change=Callback::new(move |hex: String| {
                            theme::set_accent(th, &hex);
                            app.patch(serde_json::json!({ "accent_color": hex }));
                        })
                    />
                </Row>
            </Card>

            // ================= 界面 =================
            <Card>
                <SectionTitle>"界面"</SectionTitle>
                <SliderRow
                    label="侧边栏宽度"
                    min=190.0
                    max=340.0
                    value=Signal::derive(move || app.settings.get().sidebar_width as f64)
                    fmt=|v| format!("{}px", v as i64)
                    on_input=Callback::new(move |v: f64| {
                        th.set_token("--nav-w", &format!("{}px", v as i64));
                        app.patch(serde_json::json!({ "sidebar_width": v as i64 }));
                    })
                />
                <SliderRow
                    label="每行图片数"
                    hint="0 = 按缩略图尺寸自动铺满"
                    min=0.0
                    max=12.0
                    value=Signal::derive(move || app.ui.get().grid_columns as f64)
                    fmt=|v| if v < 1.0 { "自动".into() } else { format!("{} 张", v as i64) }
                    on_input=Callback::new(move |v: f64| {
                        app.ui.update(|p| p.grid_columns = v as u32);
                        crate::prefs::save(app.ui.get_untracked());
                    })
                />
                <SliderRow
                    label="图片间距"
                    min=0.0
                    max=16.0
                    value=Signal::derive(move || app.ui.get().grid_gap as f64)
                    fmt=|v| format!("{}px", v as i64)
                    on_input=Callback::new(move |v: f64| {
                        app.ui.update(|p| p.grid_gap = v as u32);
                        crate::prefs::save(app.ui.get_untracked());
                    })
                />
            </Card>

            // ================= 浏览 =================
            <Card>
                <SectionTitle>"浏览"</SectionTitle>
                <Row label="默认视图">
                    <Segmented
                        options=vec![
                            SegmentedOption::new("grid", "网格"),
                            SegmentedOption::new("list", "列表"),
                        ]
                        value=Signal::derive(move || app.settings.get().view_mode)
                        on_change=Callback::new(move |v: String| {
                            app.patch(serde_json::json!({ "view_mode": v }));
                        })
                    />
                </Row>
                <Row label="默认排序" hint="「全部照片」打开时按这个顺序排列">
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
                        width=140
                        label="默认排序"
                        on_change=Callback::new(move |v: String| {
                            app.patch(serde_json::json!({ "sort_by": v }));
                        })
                    />
                </Row>
                <SliderRow
                    label="缩略图分辨率"
                    hint="请求的缩略图尺寸，影响清晰度与内存占用"
                    min=100.0
                    max=800.0
                    step=20.0
                    value=Signal::derive(move || app.settings.get().thumbnail_size as f64)
                    fmt=|v| format!("{}px", v as i64)
                    on_input=Callback::new(move |v: f64| {
                        app.patch(serde_json::json!({ "thumbnail_size": v as i64 }));
                    })
                />
                <SliderRow
                    label="列表列数"
                    min=1.0
                    max=5.0
                    value=Signal::derive(move || app.settings.get().list_columns as f64)
                    fmt=|v| format!("{}", v as i64)
                    on_input=Callback::new(move |v: f64| {
                        app.patch(serde_json::json!({ "list_columns": v as i64 }));
                    })
                />
                <Row label="排除搜索栏" hint="在搜索框旁边多一个「排除关键词」输入框">
                    <Switch
                        checked=Signal::derive(move || app.settings.get().reverse_search())
                        on_change=Callback::new(move |v: bool| {
                            app.patch(serde_json::json!({
                                "reverse_search_enabled": if v { 1 } else { 0 }
                            }));
                            toast(if v { "已开启排除搜索栏" } else { "已关闭排除搜索栏" });
                        })
                    />
                </Row>
                <SliderRow
                    label="抽卡张数"
                    min=1.0
                    max=30.0
                    value=Signal::derive(move || app.settings.get().draw_count as f64)
                    fmt=|v| format!("{}", v as i64)
                    on_input=Callback::new(move |v: f64| {
                        app.patch(serde_json::json!({ "draw_count": v as i64 }));
                    })
                />
                <SliderRow
                    label="幻灯片间隔"
                    min=1.0
                    max=30.0
                    value=Signal::derive(move || app.settings.get().random_interval as f64)
                    fmt=|v| format!("{}s", v as i64)
                    on_input=Callback::new(move |v: f64| {
                        app.patch(serde_json::json!({ "random_interval": v as i64 }));
                    })
                />
            </Card>

            // ================= 性能 =================
            <Card>
                <SectionTitle>"性能"</SectionTitle>
                <Row label="缩略图缓存" hint="预生成后浏览不再等待解码">
                    <div class="l-stack l-stack--3" style="width:100%">
                        <span class="c-subtitle">
                            {move || {
                                let c = app.cache.get();
                                format!("缓存 {} 个文件 · {}", c.file_count, human_size(c.size))
                            }}
                        </span>
                        <Cluster>
                            {move || {
                                let running = app.gen.get().running;
                                view! {
                                    <Button
                                        label=if running { "取消生成" } else { "生成缩略图" }
                                        icon=IconName::LAYERS
                                        variant=if running { ButtonVariant::Danger } else { ButtonVariant::Primary }
                                        on_click=Callback::new(move |_| toggle_generate(app))
                                    />
                                }
                            }}
                            <Button
                                label="检查孤儿缓存"
                                icon=IconName::FOLDER_SEARCH
                                variant=ButtonVariant::Plain
                                size=Size::Sm
                                on_click=Callback::new(move |_| reconcile_cache(app))
                            />
                            <Button
                                label="清理缓存"
                                icon=IconName::TRASH
                                variant=ButtonVariant::Plain
                                size=Size::Sm
                                on_click=Callback::new(move |_| {
                                    confirm(app, "清理缓存", "缩略图会被删掉，下次浏览时重新生成。原始照片不受影响。", "cache:clear");
                                })
                            />
                        </Cluster>
                        {move || {
                            let g = app.gen.get();
                            if !g.running {
                                return ().into_any();
                            }
                            let pct = if g.total > 0 {
                                (g.done as f64 / g.total as f64) * 100.0
                            } else {
                                0.0
                            };
                            view! {
                                <Progress value=pct max=100.0 />
                                <span class="c-subtitle">
                                    {format!("正在生成 {} / {}（{:.0}%）", g.done, g.total, pct)}
                                </span>
                            }
                            .into_any()
                        }}
                    </div>
                </Row>
                <Row label="限制生成并发" hint="同时解码的缩略图数量，关掉则不限（默认 10）">
                    <Switch
                        checked=Signal::derive(move || app.settings.get().thumb_gen_concurrency == 0)
                        on_change=Callback::new(move |v: bool| {
                            let next = if v {
                                0
                            } else {
                                app.settings.with(|s| s.thumb_gen_concurrency).max(1)
                            };
                            app.patch(serde_json::json!({ "thumb_gen_concurrency": next }));
                        })
                    />
                </Row>
                {move || {
                    let unlimited = app.settings.get().thumb_gen_concurrency == 0;
                    if unlimited {
                        return ().into_any();
                    }
                    view! {
                        <SliderRow
                            label="并发数"
                            min=1.0
                            max=64.0
                            value=Signal::derive(move || {
                                app.settings.with(|s| s.thumb_gen_concurrency).max(1) as f64
                            })
                            fmt=|v| format!("{}", v as i64)
                            on_input=Callback::new(move |v: f64| {
                                app.patch(serde_json::json!({ "thumb_gen_concurrency": v as i64 }));
                            })
                        />
                    }
                    .into_any()
                }}
            </Card>

            // ================= 数据 =================
            <Card>
                <SectionTitle>"数据"</SectionTitle>
                <Row label="收藏" hint="导出为 JSON，可在别的图库里导入">
                    <Cluster>
                        <Button
                            label="导出收藏"
                            icon=IconName::DOWNLOAD
                            size=Size::Sm
                            on_click=Callback::new(move |_| export_favorites(app))
                        />
                        <Button
                            label="导入收藏"
                            icon=IconName::UPLOAD
                            size=Size::Sm
                            on_click=Callback::new(move |_| import_favorites(app))
                        />
                    </Cluster>
                </Row>
                {move || {
                    let folder = app.profile_folder();
                    view! {
                        <Row label="图库位置" hint=folder>
                            <Cluster>
                                <Button
                                    label="打开"
                                    icon=IconName::EXTERNAL_LINK
                                    size=Size::Sm
                                    on_click=Callback::new(move |_| {
                                        let folder = app.profile_folder();
                                        spawn_local(async move {
                                            let _ = api::open_in_explorer(&folder).await;
                                        });
                                    })
                                />
                                <Button
                                    label="重新扫描"
                                    icon=IconName::REFRESH_CW
                                    variant=ButtonVariant::Plain
                                    size=Size::Sm
                                    on_click=Callback::new(move |_| app.reload_index())
                                />
                            </Cluster>
                        </Row>
                    }
                }}
                <Row label="数据目录" hint="缓存 / 回收站都在这里，卸载不会删">
                    <Button
                        label="打开"
                        icon=IconName::FOLDER_OPEN
                        size=Size::Sm
                        on_click=Callback::new(move |_| {
                            let folder = app.profile_folder();
                            spawn_local(async move {
                                let _ = api::open_in_explorer(&format!("{folder}\\.album")).await;
                            });
                        })
                    />
                </Row>
            </Card>

            // ================= 关于 =================
            <Card>
                <SectionTitle>"关于"</SectionTitle>
                <Row label="Lumina" hint="本地相册管理 · Tauri v2 + Rust + Leptos">
                    <Badge label=format!("v{APP_VERSION}") />
                </Row>
                {move || {
                    let folder = app.profile_folder();
                    let albums = app.folders.with(|f| f.len());
                    let favs = app.favorites.with(|f| f.len());
                    view! {
                        <Row label="当前图库" hint=folder>
                            <Cluster>
                                <Badge label=format!("{albums} 个相册") />
                                <Badge label=format!("{favs} 收藏") />
                            </Cluster>
                        </Row>
                    }
                }}
                <Row label="搜索语法与快捷键" hint="空格 = 且、| = 或、- = 排除、&quot;&quot; = 精确短语">
                    <Button
                        label="查看说明"
                        icon=IconName::KEYBOARD
                        variant=ButtonVariant::Plain
                        size=Size::Sm
                        on_click=Callback::new(move |_| {
                            app.modal.set(Some(Modal::new(ModalKind::SearchHelp, "搜索语法与快捷键")));
                        })
                    />
                </Row>
                <Row label="设计系统" hint="GlassDesign 0.8 · 104 个组件 · 构建期预计算液态玻璃">
                    <Badge label="glass-design" variant=BadgeVariant::Accent />
                </Row>
            </Card>
        </div>
    }
}

/* ==========================================================================
   滑块行
   ========================================================================== */

#[component]
fn SliderRow(
    label: &'static str,
    #[prop(optional)] hint: &'static str,
    min: f64,
    max: f64,
    #[prop(default = 1.0)] step: f64,
    value: Signal<f64>,
    fmt: fn(f64) -> String,
    on_input: Callback<f64>,
) -> impl IntoView {
    view! {
        <Row label=label hint=hint wide=true>
            <div class="lumina-rowfill">
                <Slider min=min max=max step=step value=value label=label on_input=on_input />
                <span class="lumina-setting-value">{move || fmt(value.get())}</span>
            </div>
        </Row>
    }
}

/* ==========================================================================
   动作
   ========================================================================== */

fn toggle_generate(app: App) {
    let profile = app.profile_id.get_untracked();
    if profile.is_empty() {
        return;
    }
    if app.gen.get_untracked().running {
        spawn_local(async move {
            let _ = api::cache_generate_cancel().await;
        });
        return;
    }
    let grid = app.settings.with(|s| s.thumbnail_size.max(100) as u32);
    let waterfall = (grid as f64 * 1.25).round().max(240.0) as u32;
    spawn_local(async move {
        match api::cache_generate(&profile, vec![grid, waterfall]).await {
            Ok(0) => toast("图库为空，没有需要生成的图片"),
            Ok(n) => toast(format!("开始生成 {n} 张缩略图")),
            Err(e) => toast_with(format!("启动失败：{e}"), Tone::Danger, None),
        }
    });
}

fn reconcile_cache(app: App) {
    let profile = app.profile_id.get_untracked();
    spawn_local(async move {
        match api::cache_reconcile(&profile).await {
            Ok(r) => {
                if r.removed_count == 0 {
                    toast(format!("缓存干净：{} 个文件都在用", r.kept_count));
                } else {
                    toast(format!(
                        "清掉 {} 个孤儿缓存，省了 {}",
                        r.removed_count,
                        human_size(r.removed_bytes)
                    ));
                }
                app.reload_cache();
            }
            Err(e) => toast_with(format!("检查失败：{e}"), Tone::Danger, None),
        }
    });
}

pub fn do_clear_cache(app: App) {
    let profile = app.profile_id.get_untracked();
    spawn_local(async move {
        match api::cache_clear(&profile).await {
            Ok(n) => {
                app.reload_cache();
                app.thumbs.clear();
                toast(format!("已清理 {n} 个缓存文件"));
            }
            Err(e) => toast_with(format!("清理失败：{e}"), Tone::Danger, None),
        }
    });
}

pub fn export_favorites(app: App) {
    let profile = app.profile_id.get_untracked();
    if profile.is_empty() {
        return;
    }
    spawn_local(async move {
        let Ok(data) = api::favorites_export(&profile).await else {
            toast_with("导出失败", Tone::Danger, None);
            return;
        };
        let Some(path) = api::dialog_save_json("favorites.json").await.unwrap_or(None) else {
            return;
        };
        match api::write_text_file(&path, &data).await {
            Ok(()) => toast("收藏已导出"),
            Err(e) => toast_with(format!("写入失败：{e}"), Tone::Danger, None),
        }
    });
}

pub fn import_favorites(app: App) {
    let profile = app.profile_id.get_untracked();
    if profile.is_empty() {
        return;
    }
    spawn_local(async move {
        let Some(path) = api::dialog_open_json().await.unwrap_or(None) else {
            return;
        };
        let Ok(data) = api::read_text_file(&path).await else {
            toast_with("读取文件失败", Tone::Danger, None);
            return;
        };
        match api::favorites_import(&profile, &data, "merge").await {
            Ok(n) => {
                app.reload_favorites();
                toast(format!("已导入 {n} 条收藏"));
            }
            Err(e) => toast_with(format!("导入失败：{e}"), Tone::Danger, None),
        }
    });
}


