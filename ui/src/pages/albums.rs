// ============================================================
// Lumina · 相册
// 两种形态：总览（卡片墙）与单相册（照片网格）。
// 相册目录由后端扫描磁盘层级得出，这里只负责展示与操作。
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::api;
use crate::grid::PhotoView;
use crate::models::*;
use crate::pages::dialog::{confirm, Modal, ModalKind};
use crate::state::{App, Page, Route};
use crate::ui::{toast, toast_with};

#[component]
pub fn AlbumsPage() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        {move || {
            let route = app.route.get();
            if route.page != Page::Albums {
                return ().into_any();
            }
            if route.view.is_empty() || route.view == "albums" {
                view! { <div class="lumina-page"><AlbumOverview /></div> }.into_any()
            } else {
                let folder = route.view.clone();
                view! { <AlbumDetail folder=folder /> }.into_any()
            }
        }}
    }
}

/* ==========================================================================
   总览
   ========================================================================== */

#[component]
fn AlbumOverview() -> impl IntoView {
    let app = App::use_ctx();

    // 根目录下的照片不属于任何相册，只在「全部照片」里能看到。
    // 相册页是「按文件夹看照片」的地方，这些照片也得在这儿露个面。
    let root_photos = move || {
        let list = app.root.get();
        if list.is_empty() {
            return ().into_any();
        }
        let n = list.len();
        view! {
            <div class="lumina-albumroot">
                <div class="lumina-roothead">
                    <SectionTitle>"根目录照片"</SectionTitle>
                    <span class="c-subtitle">{format!("{n} 张")}</span>
                </div>
                <PhotoView
                    items=Signal::derive(move || app.sort_filter(app.root.get()))
                    view="root".to_string()
                    toolbar=false
                />
            </div>
        }
        .into_any()
    };

    view! {
        {move || {
            let roots = app.child_albums("");
            if roots.is_empty() {
                let has_root_photos = app.root.with(|r| !r.is_empty());
                return view! {
                    <div class="l-stack l-stack--9">
                        <div class="lumina-empty">
                            <Empty
                                icon=IconName::ALBUM
                                title="还没有相册"
                                desc="在图库文件夹里建子文件夹，然后点「重新扫描」；也可以在这里直接新建"
                            >
                                <Button
                                    label="新建相册"
                                    icon=IconName::PLUS
                                    variant=ButtonVariant::Primary
                                    on_click=Callback::new(move |_| create_album(app))
                                />
                            </Empty>
                        </div>
                        {if has_root_photos { root_photos() } else { ().into_any() }}
                    </div>
                }
                .into_any();
            }

            view! {
                <div class="l-stack l-stack--9">
                    <div class="lumina-album-grid">
                        {roots.into_iter().map(|folder| {
                            let f = folder.clone();
                            let cover = app.album_cover(&folder);
                            let count = app.album_images.with(|m| m.get(&folder).map(|v| v.len()).unwrap_or(0));
                            let name = last_segment(&folder);
                            let has_kids = app.has_children(&folder);
                            view! {
                                <AlbumCard folder=f.clone() name=name count=count cover=cover has_kids=has_kids />
                            }
                        }).collect_view()}
                    </div>
                    {root_photos()}
                </div>
            }
            .into_any()
        }}
    }
}

#[component]
pub fn AlbumCard(
    folder: String,
    name: String,
    count: usize,
    cover: Option<Image>,
    has_kids: bool,
) -> impl IntoView {
    let app = App::use_ctx();
    let go_folder = folder.clone();

    let size = app.settings.with(|s| s.thumbnail_size.max(100) as u32);
    let t = app.thumbs;
    let url = RwSignal::new(None::<String>);
    if let Some(c) = &cover {
        let key = crate::state::Thumbs::key(c.folder.as_deref(), &c.name, size);
        if let Some(hit) = t.get(&key) {
            url.set(Some(hit));
        } else {
            t.request(key.clone(), c.name.clone(), c.folder.clone(), size);
            let watch = key.clone();
            Effect::new(move |_| {
                if let Some(v) = t.map.with(|m| m.get(&watch).cloned()) {
                    url.set(Some(v));
                }
            });
        }
    }

    view! {
        <div
            class="lumina-album-card"
            on:click=move |_| app.go(Route::album(&go_folder))
        >
            <div class="lumina-album-card__cover">
                {move || url.get().map(|src| view! {
                    <img src=src loading="lazy" alt="" />
                })}
            </div>
            <div class="l-row l-row--3" style="min-width:0">
                <Icon name=if has_kids { IconName::FOLDER_TREE } else { IconName::FOLDER } size=14 />
                <span class="lumina-album-card__name">{name}</span>
            </div>
            <span class="lumina-album-card__meta">{format!("{count} 张")}</span>
        </div>
    }
}

/* ==========================================================================
   单相册
   ========================================================================== */

#[component]
fn AlbumDetail(folder: String) -> impl IntoView {
    let app = App::use_ctx();
    let f = folder.clone();
    let name = last_segment(&folder);
    let count = app.album_images.with(|m| m.get(&folder).map(|v| v.len()).unwrap_or(0));

    // 子相册：点进去继续下钻
    let kids = app.child_albums(&folder);

    view! {
        <div class="lumina-page">
            <Cluster between=true>
                <Cluster>
                    <Icon name=IconName::FOLDER_TREE size=16 />
                    <span class="c-title">{name}</span>
                    <Badge label=format!("{count} 张") />
                </Cluster>
                <Cluster end=true>
                    <Button
                        label="上一级"
                        icon=IconName::CHEVRON_LEFT
                        variant=ButtonVariant::Plain
                        size=Size::Sm
                        on_click=Callback::new({
                            let f = f.clone();
                            move |_| {
                                let parent = f.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_else(|| "albums".into());
                                app.go(Route::album(&parent));
                            }
                        })
                    />
                </Cluster>
            </Cluster>

            {(!kids.is_empty()).then(|| view! {
                <div class="l-row l-row--3" style="flex-wrap:wrap">
                    {kids.into_iter().map(|k| {
                        let k2 = k.clone();
                        let n = app.album_images.with(|m| m.get(&k).map(|v| v.len()).unwrap_or(0));
                        view! {
                            <Chip
                                label=format!("{}（{n}）", last_segment(&k))
                                icon=IconName::FOLDER
                                on_click=Callback::new(move |_| app.go(Route::album(&k2)))
                            />
                        }
                    }).collect_view()}
                </div>
            })}

            <PhotoView
                items=Signal::derive({
                    let f = folder.clone();
                    move || app.visible(&f)
                })
                view=folder.clone()
            />
        </div>
    }
}

/* ==========================================================================
   动作
   ========================================================================== */

pub fn create_album(app: App) {
    app.modal.set(Some(Modal::new(ModalKind::NewAlbum, "新建相册").desc("会在图库根目录下建同名文件夹")));
}

pub fn on_album_menu(app: App, id: &str) {
    let folder = app.route.get_untracked().view;
    if folder.is_empty() || folder == "albums" {
        return;
    }
    let profile = app.profile_id.get_untracked();

    match id {
        "album:cover" => {
            // 优先用选中的第一张，否则用当前相册第一张
            let picked = app
                .selection
                .get_untracked()
                .into_iter()
                .next()
                .or_else(|| {
                    app.album_images
                        .with(|m| m.get(&folder).and_then(|v| v.first().map(|i| i.key.clone())))
                });
            let Some(key) = picked else {
                toast("这个相册里还没有照片");
                return;
            };
            let name = app
                .album_images
                .with(|m| {
                    m.get(&folder)
                        .and_then(|v| v.iter().find(|i| i.key == key).map(|i| i.name.clone()))
                })
                .unwrap_or_default();
            let folder2 = folder.clone();
            spawn_local(async move {
                match api::album_set_cover(&profile, &folder2, &name).await {
                    Ok(()) => {
                        if let Ok(list) = api::albums_list(&profile).await {
                            app.albums.set(list);
                        }
                        toast("已设为封面");
                    }
                    Err(e) => toast_with(format!("设置封面失败：{e}"), Tone::Danger, None),
                }
            });
        }
        "album:rename" => {
            let base = last_segment(&folder);
            app.modal.set(Some(
                Modal::new(ModalKind::RenameAlbum, "重命名相册")
                    .value(&base)
                    .folder(&folder),
            ));
        }
        "album:open" => {
            let root = app.profile_folder();
            spawn_local(async move {
                let _ = api::open_in_explorer(&format!("{root}\\{folder}")).await;
            });
        }
        "album:delete" => {
            confirm(
                app,
                "删除相册",
                "相册里的照片会被移到上一级目录，不会被删除。",
                "album:delete:keep",
            );
            // 把目标文件夹补进模态框
            app.modal.update(|m| {
                if let Some(x) = m {
                    x.kind = ModalKind::DeleteAlbum;
                    x.folder = Some(folder.clone());
                }
            });
        }
        _ => {}
    }
}
