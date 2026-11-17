// ============================================================
// Lumina · 回收站
// 删除的照片先落到 `{图库}/.album/trash/`，可还原到原位置。
// ============================================================

use glass_design::prelude::*;
use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::api;
use crate::models::*;
use crate::pages::dialog::{confirm, Modal, ModalKind};
use crate::state::App;
use crate::ui::{toast, toast_with};

#[component]
pub fn TrashPage() -> impl IntoView {
    let app = App::use_ctx();

    view! {
        <div class="lumina-page">
            {move || {
                let list = app.trash.get();
                if list.is_empty() {
                    // 区分「没删过」和「已清空」：后者是用户主动清过
                    let cleared = app.trash_ever_had.get();
                    return view! {
                        <div class="lumina-empty">
                            <Empty
                                icon=IconName::TRASH
                                title=if cleared { "回收站已清空" } else { "回收站是空的" }
                                desc=if cleared {
                                    "清空之后照片不会再回来"
                                } else {
                                    "把照片移到回收站后，会先在这里等你确认"
                                }
                            />
                        </div>
                    }
                    .into_any();
                }

                view! {
                    <div class="l-stack l-stack--2">
                        {list.into_iter().map(|item| view! { <TrashRow item=item /> }).collect_view()}
                    </div>
                }
                .into_any()
            }}
        </div>
    }
}

#[component]
fn TrashRow(item: TrashItem) -> impl IntoView {
    let app = App::use_ctx();
    let size = app.settings.with(|s| s.thumbnail_size.max(100) as u32);
    let t = app.thumbs;
    let img = item.image();
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

    let rec = item.record.clone();
    let rec_restore = rec.clone();
    let rec_delete = rec.clone();

    view! {
        <div class="lumina-trash-row">
            {move || match url.get() {
                Some(src) => view! { <img class="lumina-list__thumb" src=src loading="lazy" alt="" /> }.into_any(),
                None => view! { <div class="lumina-list__thumb"></div> }.into_any(),
            }}
            <div class="l-stack l-stack--1" style="min-width:0">
                <span class="lumina-list__name">{item.display_name.clone()}</span>
                <span class="c-subtitle">
                    {rec.original_folder.clone().unwrap_or_else(|| "根目录".into())}
                </span>
            </div>
            <span class="lumina-list__meta">{format_ms(item.deleted_ms)}</span>
            <Cluster end=true>
                <Button
                    label="还原"
                    icon=IconName::UNDO
                    variant=ButtonVariant::Plain
                    size=Size::Sm
                    on_click=Callback::new(move |_| {
                        let profile = app.profile_id.get_untracked();
                        let r = rec_restore.clone();
                        spawn_local(async move {
                            match api::trash_restore(
                                &profile,
                                &r.trash_name,
                                &r.original_name,
                                r.original_folder.as_deref(),
                            )
                            .await
                            {
                                Ok(_) => {
                                    app.reload_index();
                                    app.reload_trash();
                                    toast("已还原");
                                }
                                Err(e) => toast_with(format!("还原失败：{e}"), Tone::Danger, None),
                            }
                        });
                    })
                />
                <Button
                    label="永久删除"
                    icon=IconName::X
                    variant=ButtonVariant::Danger
                    size=Size::Sm
                    on_click=Callback::new(move |_| {
                        let profile = app.profile_id.get_untracked();
                        let r = rec_delete.clone();
                        spawn_local(async move {
                            if api::file_permanent_delete(
                                &profile,
                                &r.trash_name,
                                Some(".album/trash"),
                            )
                            .await
                            .is_ok()
                            {
                                app.reload_trash();
                                toast("已永久删除");
                            }
                        });
                    })
                />
            </Cluster>
        </div>
    }
}

/* ==========================================================================
   批量动作
   ========================================================================== */

pub fn restore_all(app: App) {
    let profile = app.profile_id.get_untracked();
    let list = app.trash.get_untracked();
    if list.is_empty() || profile.is_empty() {
        return;
    }
    app.trash.set(Vec::new());
    spawn_local(async move {
        let mut ok = 0;
        for item in &list {
            let r = &item.record;
            if api::trash_restore(
                &profile,
                &r.trash_name,
                &r.original_name,
                r.original_folder.as_deref(),
            )
            .await
            .is_ok()
            {
                ok += 1;
            }
        }
        app.reload_index();
        app.reload_trash();
        toast(format!("已还原 {ok} 张"));
    });
}

pub fn empty_all(app: App) {
    let n = app.trash.with(|t| t.len());
    if n == 0 {
        return;
    }
    confirm(
        app,
        "清空回收站",
        &format!("{n} 张照片会被永久删除，无法恢复。"),
        "trash:empty",
    );
}

pub fn do_empty(app: App) {
    let profile = app.profile_id.get_untracked();
    if profile.is_empty() {
        return;
    }
    spawn_local(async move {
        match api::trash_empty(&profile).await {
            Ok(n) => {
                app.reload_trash();
                toast(format!("已清空 {n} 张"));
            }
            Err(e) => toast_with(format!("清空失败：{e}"), Tone::Danger, None),
        }
    });
}

/// 供「设置 → 数据」复用：把回收站也当成数据目录的一部分展示
#[allow(dead_code)]
pub fn open_trash_dir(app: App) {
    let root = app.profile_folder();
    spawn_local(async move {
        let _ = api::open_in_explorer(&format!("{root}\\.album\\trash")).await;
    });
}

#[allow(dead_code)]
fn unused(_: ModalKind, _: Modal) {}
