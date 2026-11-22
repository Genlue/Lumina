// ============================================================
// Lumina · 主页工作台
// 一屏三块：图库身份 + 指标（hero）｜ 最近相册 / 格式分布（主列）｜
// 缓存与维护（侧列）。没有真实数据的地方就画空状态，不编数据。
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::api;
use crate::models::*;
use crate::pages::dialog::confirm;
use crate::state::{App, Page, Route};
use crate::ui::{toast, toast_with};

#[component]
pub fn HomePage() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        <div class="lumina-page">
            // ---- 图库身份 + 指标 ----
            <Card>
                <Pad>
                    <div class="lumina-hero">
                        <div class="lumina-hero__id">
                            <span class="lumina-hero__mark">
                                <Icon name=IconName::IMAGES size=20 />
                            </span>
                            <div class="lumina-hero__text">
                                <span class="lumina-hero__name">{move || app.profile_name()}</span>
                                <span class="lumina-hero__path" title=move || app.profile_folder()>
                                    {move || app.profile_folder()}
                                </span>
                            </div>
                        </div>
                        <Cluster>
                            <Button
                                label="全部照片"
                                icon=IconName::IMAGES
                                variant=ButtonVariant::Primary
                                on_click=Callback::new(move |_| app.go(Route::page(Page::Library)))
                            />
                            <Button
                                label="重新扫描"
                                icon=IconName::REFRESH_CW
                                variant=ButtonVariant::Plain
                                on_click=Callback::new(move |_| app.reload_index())
                            />
                        </Cluster>
                    </div>

                    <div class="lumina-metrics">
                        <Metric value=Signal::derive(move || app.total_count().to_string()) label="照片" />
                        <Metric
                            value=Signal::derive(move || app.folders.with(|f| f.len()).to_string())
                            label="相册"
                        />
                        <Metric
                            value=Signal::derive(move || app.favorites.with(|f| f.len()).to_string())
                            label="收藏"
                        />
                        <Metric
                            value=Signal::derive(move || app.trash_count.get().to_string())
                            label="回收站"
                        />
                        <Metric value=Signal::derive(move || human_size(app.total_size())) label="占用" />
                    </div>
                </Pad>
            </Card>

            <div class="lumina-home-grid">
                // ---- 主列 ----
                <div class="lumina-home-main">
                    <Card>
                        <div class="lumina-cardhead">
                            <SectionTitle>"最近相册"</SectionTitle>
                            <Button
                                label="全部相册"
                                variant=ButtonVariant::Plain
                                size=Size::Sm
                                on_click=Callback::new(move |_| app.go(Route::album("albums")))
                            />
                        </div>
                        <Pad>
                            {move || {
                                let folders = app.child_albums("");
                                if folders.is_empty() {
                                    return view! {
                                        <p class="c-subtitle">"图库根目录下还没有子文件夹。建几个文件夹再扫描，它们就会出现在这里。"</p>
                                    }
                                    .into_any();
                                }
                                view! {
                                    <div class="lumina-album-grid lumina-album-grid--home">
                                        {folders.into_iter().take(8).map(|folder| {
                                            let n = app.album_images.with(|m| m.get(&folder).map(|v| v.len()).unwrap_or(0));
                                            let cover = app.album_cover(&folder);
                                            let kids = app.has_children(&folder);
                                            view! {
                                                <crate::pages::albums::AlbumCard
                                                    folder=folder.clone()
                                                    name=last_segment(&folder)
                                                    count=n
                                                    cover=cover
                                                    has_kids=kids
                                                />
                                            }
                                        }).collect_view()}
                                    </div>
                                }
                                .into_any()
                            }}
                        </Pad>
                    </Card>
                </div>

                // ---- 侧列 ----
                <div class="lumina-home-side">
                    <Card>
                        <SectionTitle>"格式与体量"</SectionTitle>
                        <Pad>
                            {move || {
                                let list = app.all_images();
                                if list.is_empty() {
                                    return view! {
                                        <Empty icon=IconName::IMAGE_OFF title="还没有照片" desc="选一个文件夹作为图库，然后扫描" />
                                    }
                                    .into_any();
                                }
                                let mut buckets: Vec<(String, usize)> = Vec::new();
                                for img in &list {
                                    let ext = img
                                        .name
                                        .rsplit_once('.')
                                        .map(|(_, e)| e.to_lowercase())
                                        .unwrap_or_else(|| "其他".into());
                                    match buckets.iter_mut().find(|(k, _)| *k == ext) {
                                        Some((_, n)) => *n += 1,
                                        None => buckets.push((ext, 1)),
                                    }
                                }
                                buckets.sort_by(|a, b| b.1.cmp(&a.1));
                                let total = list.len().max(1) as f64;
                                let shown: Vec<(String, usize)> = buckets.into_iter().take(6).collect();

                                view! {
                                    <div class="lumina-formats">
                                        // 一条堆叠条：宽度＝占比，色阶按名次递减
                                        <div class="lumina-formatbar">
                                            {shown.iter().enumerate().map(|(i, (_, n))| {
                                                let share = *n as f64 / total * 100.0;
                                                view! {
                                                    <span
                                                        class="lumina-formatbar__seg"
                                                        data-i=i
                                                        style=format!("width:{share:.3}%")
                                                    ></span>
                                                }
                                            }).collect_view()}
                                        </div>
                                        <div class="lumina-legend">
                                            {shown.into_iter().enumerate().map(|(i, (ext, n))| {
                                                let pct = n as f64 / total * 100.0;
                                                view! {
                                                    <span class="lumina-legend__item">
                                                        <i class="lumina-legend__dot" data-i=i></i>
                                                        <span class="lumina-legend__ext">{ext.to_uppercase()}</span>
                                                        <span class="lumina-legend__num">{n}</span>
                                                        <span class="lumina-legend__pct">
                                                            {format!("{pct:.0}%")}
                                                        </span>
                                                    </span>
                                                }
                                            }).collect_view()}
                                        </div>
                                    </div>
                                }
                                .into_any()
                            }}
                        </Pad>
                    </Card>
                    <Card>
                        <SectionTitle>"缓存与维护"</SectionTitle>
                        <Row label="缩略图缓存" hint="预生成后浏览不再等待解码">
                            <Cluster end=true>
                                <span class="c-subtitle">
                                    {move || {
                                        let c = app.cache.get();
                                        format!("{} 个文件 · {}", c.file_count, human_size(c.size))
                                    }}
                                </span>
                            </Cluster>
                        </Row>
                        <Pad>
                            <Cluster>
                                <Button
                                    label="生成缓存"
                                    icon=IconName::LAYERS
                                    on_click=Callback::new(move |_| generate_cache(app))
                                />
                                <Button
                                    label="清理缓存"
                                    icon=IconName::TRASH
                                    variant=ButtonVariant::Plain
                                    on_click=Callback::new(move |_| {
                                        confirm(
                                            app,
                                            "清理缓存",
                                            "缩略图会被删掉，下次浏览时重新生成。原始照片不受影响。",
                                            "cache:clear",
                                        );
                                    })
                                />
                            </Cluster>
                        </Pad>
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
                                <Pad>
                                    <div class="l-stack l-stack--2">
                                        <Progress value=pct max=100.0 />
                                        <span class="c-subtitle">
                                            {format!("正在生成 {} / {}（{:.0}%）", g.done, g.total, pct)}
                                        </span>
                                    </div>
                                </Pad>
                            }
                            .into_any()
                        }}
                        <Row label="图库文件夹" hint="在资源管理器中打开">
                            <Button
                                label="打开"
                                icon=IconName::FOLDER_OPEN
                                size=Size::Sm
                                variant=ButtonVariant::Plain
                                on_click=Callback::new(move |_| {
                                    let folder = app.profile_folder();
                                    spawn_local(async move {
                                        let _ = api::open_in_explorer(&folder).await;
                                    });
                                })
                            />
                        </Row>
                        <Row label="添加图库" hint="再挂一个装了照片的文件夹">
                            <Button
                                label="添加"
                                icon=IconName::FOLDER_PLUS
                                size=Size::Sm
                                variant=ButtonVariant::Plain
                                on_click=Callback::new(move |_| app.add_profile())
                            />
                        </Row>
                    </Card>
                </div>
            </div>
        </div>
    }
}

#[component]
fn Metric(#[prop(into)] value: Signal<String>, #[prop(into)] label: &'static str) -> impl IntoView {
    view! {
        <div class="lumina-metric">
            <span class="lumina-metric__value">{move || value.get()}</span>
            <span class="lumina-metric__label">{label}</span>
        </div>
    }
}

fn generate_cache(app: App) {
    let profile = app.profile_id.get_untracked();
    if profile.is_empty() {
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
