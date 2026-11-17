// ============================================================
// Lumina · 主页工作台
// 概览指标 + 快捷操作 + 最近相册 + 分布分析。
// 没有真实数据的地方就画空状态，不编数据。
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::api;
use crate::models::*;
use crate::state::{App, Page, Route};
use crate::ui::{toast, toast_with};

#[component]
pub fn HomePage() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        <div class="lumina-page">
            // ---- 指标条 ----
            <Card>
                <Pad>
                <div class="lumina-metrics">
                    <Metric value=Signal::derive(move || app.total_count().to_string()) label="照片" />
                    <div class="lumina-vline"></div>
                    <Metric
                        value=Signal::derive(move || app.folders.with(|f| f.len()).to_string())
                        label="相册"
                    />
                    <div class="lumina-vline"></div>
                    <Metric
                        value=Signal::derive(move || app.favorites.with(|f| f.len()).to_string())
                        label="收藏"
                    />
                    <div class="lumina-vline"></div>
                    <Metric
                        value=Signal::derive(move || app.trash_count.get().to_string())
                        label="回收站"
                    />
                    <div class="lumina-vline"></div>
                    <Metric
                        value=Signal::derive(move || human_size(app.total_size()))
                        label="占用"
                    />
                </div>
                </Pad>
            </Card>

            // ---- 快捷操作 ----
            <Card>
                <SectionTitle>"快捷操作"</SectionTitle>
                <Pad>
                <Cluster>
                    <Button
                        label="导入文件夹"
                        icon=IconName::FOLDER_PLUS
                        variant=ButtonVariant::Primary
                        on_click=Callback::new(move |_| app.add_profile())
                    />
                    <Button
                        label="生成缓存"
                        icon=IconName::LAYERS
                        on_click=Callback::new(move |_| generate_cache(app))
                    />
                    <Button
                        label="打开图库位置"
                        icon=IconName::EXTERNAL_LINK
                        variant=ButtonVariant::Plain
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
                        on_click=Callback::new(move |_| app.reload_index())
                    />
                </Cluster>
                </Pad>
            </Card>

            // ---- 最近相册 ----
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
                        <div class="lumina-rail">
                            {folders.into_iter().take(12).map(|folder| {
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

            // ---- 分布 ----
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
                    let total = list.len().max(1);
                    view! {
                        <div class="l-stack l-stack--4">
                            {buckets.into_iter().take(6).map(|(ext, n)| {
                                let pct = (n as f64 / total as f64) * 100.0;
                                view! {
                                    <div class="l-stack l-stack--2">
                                        <Cluster between=true>
                                            <span class="c-subtitle">{ext.to_uppercase()}</span>
                                            <span class="c-subtitle">{format!("{n} · {:.0}%", pct)}</span>
                                        </Cluster>
                                        <Progress value=pct max=100.0 />
                                    </div>
                                }
                            }).collect_view()}
                        </div>
                    }
                    .into_any()
                }}
                </Pad>
            </Card>

            // ---- 当前图库 ----
            {move || {
                let folder = app.profile_folder();
                let name = app.profile_name();
                let cache = app.cache.get();
                view! {
                    <Card>
                        <SectionTitle>"当前图库"</SectionTitle>
                        <Row label="名称" hint=folder>
                            <Badge label=name variant=BadgeVariant::Accent />
                        </Row>
                        <Row label="照片总数">
                            <span class="c-subtitle">{move || format!("{} 张", app.total_count())}</span>
                        </Row>
                        <Row label="缓存">
                            <Cluster end=true>
                                <span class="c-subtitle">
                                    {format!("{} 个文件 · {}", cache.file_count, human_size(cache.size))}
                                </span>
                                <Button
                                    label="清理"
                                    variant=ButtonVariant::Plain
                                    size=Size::Sm
                                    on_click=Callback::new(move |_| app.go(Route::page(Page::Settings)))
                                />
                            </Cluster>
                        </Row>
                    </Card>
                }
            }}
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
