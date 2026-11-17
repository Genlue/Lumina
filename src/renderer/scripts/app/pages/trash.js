// ============================================================
// Lumina · 回收站
// 列表形态：缩略图 + 原名 + 删除时间 + 来源相册。
// 空状态要区分「从没删过」和「刚被清空」。
// ============================================================

import { h, fill } from '../../core/dom.js';
import { List, ListRow } from '../../ui/content/list.js';
import { Thumb } from '../../ui/content/media-tile.js';
import { Empty } from '../../ui/content/states.js';
import { Button, IconButton } from '../../ui/controls/button.js';
import { Capsule } from '../../ui/navigation/toolbar.js';
import { openMenu } from '../../ui/overlays/menu.js';
import { toast } from '../../ui/overlays/toast.js';
import { revealOnScroll } from '../../core/scrollbar.js';
import { S, normalizeTrash } from '../state.js';
import { fmtAgo } from '../util.js';
import { confirm } from '../dialog.js';
import * as api from '../api.js';
import * as actions from '../actions.js';
import * as shell from '../shell.js';
import * as router from '../router.js';
import { on } from '../bus.js';

export function mount(ctx) {
  const list = List({ variant: 'inset' });
  const emptyWrap = h('div');

  const restoreAllBtn = Button({
    label: '全部还原',
    icon: 'undo',
    variant: 'plain',
    onClick: async () => {
      if (!S.trash.length) return;
      await actions.restoreAllTrash();
    },
  });

  const emptyBtn = Button({
    label: '清空回收站',
    icon: 'trash',
    variant: 'danger',
    onClick: () => actions.emptyTrash(),
  });

  // 胶囊里放纯文本，不要再塞一颗 Badge（那是「胶囊里套胶囊」）
  const countText = h('span', null, '0 项');

  shell.pageTopbar({
    title: '回收站',
    subtitle: '删除的照片会先放在这里',
    nav: router.navState(),
    pills: [Capsule({ text: true, children: [countText] }), Capsule({ children: [restoreAllBtn, emptyBtn] })],
  });

  const page = h('div', { class: 'app-page' });
  page.append(list, emptyWrap);
  ctx.stage.append(page);
  const detach = revealOnScroll(ctx.stage);

  /* ---------------- 行 ---------------- */

  function row(rec) {
    const thumbBox = h('div', { class: 'app-listrow__thumb' });
    const thumb = Thumb({ src: '' });
    thumb.querySelector('img')?.removeAttribute('src');
    thumbBox.append(thumb);
    api
      .getThumb(rec.name, '.album/trash', 120)
      .then((r) => {
        const img = thumb.querySelector('img');
        if (img && r?.dataUrl) img.src = r.dataUrl;
      })
      .catch(() => {});

    const more = IconButton({
      icon: 'more',
      label: '更多',
      size: 'sm',
      onClick: (e) => {
        e.stopPropagation();
        openMenu({
          anchor: more,
          items: [
            { label: '还原到原位置', icon: 'undo', onClick: () => actions.restoreTrash(rec) },
            { sep: true },
            {
              label: '永久删除',
              icon: 'trash',
              danger: true,
              onClick: async () => {
                const ok = await confirm({
                  title: '永久删除',
                  body: `「${rec.displayName}」将被彻底删除，无法还原。`,
                  okLabel: '永久删除',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await api.files.permanentDelete(S.profileId, rec.name, '.album/trash');
                  await actions.loadTrash();
                  shell.refreshStatus();
                  shell.syncNav();
                  render();
                } catch (err) {
                  toast(`删除失败：${err.message || err}`, { icon: 'x-circle', tone: 'danger' });
                }
              },
            },
          ],
        });
      },
    });

    return ListRow({
      avatar: thumbBox,
      title: rec.displayName,
      subtitle: `原位置：${rec.originalFolder || '根目录'}`,
      meta: fmtAgo(rec.date),
      trailing: h(
        'div',
        { class: 'l-row l-row--3' },
        Button({
          label: '还原',
          icon: 'undo',
          size: 'sm',
          variant: 'plain',
          onClick: () => actions.restoreTrash(rec),
        }),
        more
      ),
    });
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    fill(list);
    const records = S.trash.map(normalizeTrash);
    const has = records.length > 0;

    list.style.display = has ? '' : 'none';
    emptyWrap.style.display = has ? 'none' : '';
    countText.textContent = `${records.length} 项`;
    restoreAllBtn.disabled = !has;
    emptyBtn.disabled = !has;

    for (const rec of records) list.append(row(rec));

    if (!has) {
      fill(emptyWrap);
      emptyWrap.append(
        S.trashEverHad
          ? Empty({
              icon: 'circle-check',
              title: '回收站已清空',
              desc: '这里的照片已经被永久删除。',
              action: Button({
                label: '去全部照片',
                variant: 'primary',
                icon: 'images',
                onClick: () => router.go({ page: 'library' }),
              }),
            })
          : Empty({
              icon: 'trash',
              title: '回收站是空的',
              desc: '在照片上右键选「移到回收站」，它会先放到这里。',
              action: Button({
                label: '去全部照片',
                variant: 'primary',
                icon: 'images',
                onClick: () => router.go({ page: 'library' }),
              }),
            })
      );
    }
  }

  // 进入页面先拉一次最新列表
  actions.loadTrash().then(() => {
    shell.refreshStatus();
    shell.syncNav();
    render();
  });

  render();
  const off = on('trash', render);

  return {
    destroy() {
      off();
      detach();
    },
  };
}
