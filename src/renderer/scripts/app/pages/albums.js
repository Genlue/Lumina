// ============================================================
// Lumina · 相册
// 根层级是相册卡网格；进入某个相册后是「相册头 + 子相册 + 照片网格」。
// 照片可以直接拖到相册卡或侧栏的相册树上完成移动。
// ============================================================

import { h, fill } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { Badge } from '../../ui/content/badge.js';
import { List, ListRow } from '../../ui/content/list.js';
import { Thumb } from '../../ui/content/media-tile.js';
import { Empty } from '../../ui/content/states.js';
import { Button, IconButton } from '../../ui/controls/button.js';
import { Breadcrumb } from '../../ui/navigation/breadcrumb.js';
import { Capsule } from '../../ui/navigation/toolbar.js';
import { openMenu } from '../../ui/overlays/menu.js';
import { Card } from '../../ui/surfaces/card.js';
import { revealOnScroll } from '../../core/scrollbar.js';
import { S, childAlbums, hasChildren, imagesInFolder, albumCover } from '../state.js';
import { lastSegment, readDragKeys } from '../util.js';
import * as api from '../api.js';
import * as actions from '../actions.js';
import * as shell from '../shell.js';
import * as router from '../router.js';
import { on } from '../bus.js';
import { albumTile } from '../album-card.js';
import { mountPhotoPage } from './photo.js';

/* ==========================================================================
   相册卡
   ========================================================================== */

function albumCard(folder, { showChildren = true } = {}) {
  const count = imagesInFolder(folder).length;
  const kids = showChildren && hasChildren(folder);

  const card = albumTile(folder, {
    subtitle: `${count} 张${kids ? ` · ${childAlbums(folder).length} 个子相册` : ''}`,
    onClick: () => router.go({ page: 'albums', view: folder }),
    onContextMenu: (e) => {
      e.preventDefault();
      openAlbumMenu(folder, e);
    },
  });
  card.dataset.folder = folder;
  card.title = folder;

  // 拖拽落点
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    card.dataset.over = '1';
  });
  card.addEventListener('dragleave', () => {
    delete card.dataset.over;
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    delete card.dataset.over;
    const keys = readDragKeys(e);
    if (keys.length) actions.dropIntoAlbum(keys, folder);
  });

  return card;
}

/** 子相册：一行一个，40px 高，不用大封面 */
function subAlbumRow(folder) {
  const count = imagesInFolder(folder).length;
  const kids = hasChildren(folder);

  const row = ListRow({
    icon: kids ? 'folder-tree' : 'folder',
    title: lastSegment(folder),
    subtitle: kids ? `${childAlbums(folder).length} 个子相册` : '',
    meta: `${count} 张`,
    chevron: true,
    onClick: () => router.go({ page: 'albums', view: folder }),
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openAlbumMenu(folder, e);
  });

  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    row.dataset.over = '1';
  });
  row.addEventListener('dragleave', () => delete row.dataset.over);
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    delete row.dataset.over;
    const keys = readDragKeys(e);
    if (keys.length) actions.dropIntoAlbum(keys, folder);
  });

  return row;
}

/** 子相册卡（网格模式）：和主页「最近相册」同款，带拖拽落点 */
function subAlbumCard(folder) {
  const card = albumTile(folder, {
    onClick: () => router.go({ page: 'albums', view: folder }),
    onContextMenu: (e) => {
      e.preventDefault();
      openAlbumMenu(folder, e);
    },
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    card.dataset.over = '1';
  });
  card.addEventListener('dragleave', () => delete card.dataset.over);
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    delete card.dataset.over;
    const keys = readDragKeys(e);
    if (keys.length) actions.dropIntoAlbum(keys, folder);
  });
  return card;
}

function openAlbumMenu(folder, event) {
  openMenu({
    x: event?.clientX,
    y: event?.clientY,
    items: [
      { label: '打开相册', icon: 'folder-open', onClick: () => router.go({ page: 'albums', view: folder }) },
      {
        label: '在资源管理器中打开',
        icon: 'external-link',
        onClick: () => actions.openInExplorer(`${S.profileFolder.replace(/\\/g, '/')}/${folder}`),
      },
      { sep: true },
      { label: '新建子相册…', icon: 'folder-plus', onClick: () => actions.createAlbum(folder) },
      { label: '重命名…', icon: 'square-pen', onClick: () => actions.renameAlbum(folder) },
      { sep: true },
      { label: '删除相册', icon: 'trash', danger: true, onClick: () => actions.deleteAlbum(folder) },
    ],
  });
}

/* ==========================================================================
   根层级：相册卡网格
   ========================================================================== */

function mountRoot(ctx) {
  const seg = h('div', { class: 'app-albumgrid' });
  const emptyWrap = h('div');

  const addBtn = IconButton({ icon: 'folder-plus', label: '新建相册' });
  addBtn.addEventListener('click', () => actions.createAlbum(''));

  shell.pageTopbar({
    title: '相册',
    subtitle: `${S.albumFolders.length} 个相册`,
    nav: router.navState(),
    pills: [Capsule({ round: true, children: addBtn })],
  });

  const page = h('div', { class: 'app-page' });
  page.append(seg, emptyWrap);
  ctx.stage.append(page);
  const detach = revealOnScroll(ctx.stage);

  function render() {
    fill(seg);
    const roots = childAlbums('');
    seg.style.display = roots.length ? '' : 'none';
    emptyWrap.style.display = roots.length ? 'none' : '';

    for (const folder of roots) seg.append(albumCard(folder));

    if (!roots.length) {
      fill(emptyWrap);
      emptyWrap.append(
        Empty({
          icon: 'album',
          title: '还没有相册',
          desc: '相册按图库里的文件夹自动生成。也可以现在建一个。',
          action: Button({
            label: '新建相册',
            variant: 'primary',
            icon: 'folder-plus',
            onClick: () => actions.createAlbum(''),
          }),
        })
      );
    }
  }

  render();
  const off = on('images', render);
  return {
    destroy() {
      off();
      detach();
    },
  };
}

/* ==========================================================================
   某个相册
   ========================================================================== */

function mountAlbum(ctx, view) {
  const name = lastSegment(view);

  const photo = mountPhotoPage(ctx, {
    page: 'albums',
    title: name,
    subtitle: () => `${imagesInFolder(view).length} 张 · ${view}`,
    getItems: () => imagesInFolder(view),
    empty: {
      icon: 'folder-open',
      title: '这个相册还没有照片',
      desc: '把照片拖到左侧的相册名上，或者右键选「移动到…」。',
    },
    moreItems: [
      { sep: true },
      { label: '新建子相册…', icon: 'folder-plus', onClick: () => actions.createAlbum(view) },
      { label: '重命名相册…', icon: 'square-pen', onClick: () => actions.renameAlbum(view) },
      { label: '删除相册', icon: 'trash', danger: true, onClick: () => actions.deleteAlbum(view) },
    ],
  });

  /* ---- 面包屑 ---- */

  const segs = view.split('/').filter(Boolean);
  const crumbItems = [
    { label: '相册', onClick: () => router.go({ page: 'albums', view: 'albums' }) },
  ];
  let acc = '';
  segs.forEach((seg, i) => {
    acc = acc ? `${acc}/${seg}` : seg;
    const target = acc;
    crumbItems.push({
      label: seg,
      // 最后一段是当前页：Breadcrumb 会把它渲染成不可点的 span
      onClick: i === segs.length - 1 ? null : () => router.go({ page: 'albums', view: target }),
    });
  });
  const crumb = Breadcrumb({ items: crumbItems });

  /* ---- 相册头 ---- */

  const cover = albumCover(view);
  const coverBox = h('div', { class: 'app-albumhead__cover' });
  if (cover) {
    const thumb = Thumb({ src: '' });
    thumb.querySelector('img')?.removeAttribute('src');
    coverBox.append(thumb);
    api
      .getThumb(cover.name, cover.folder, 240)
      .then((r) => {
        const img = thumb.querySelector('img');
        if (img && r?.dataUrl) img.src = r.dataUrl;
      })
      .catch(() => {});
  } else {
    coverBox.append(h('div', { class: 'app-album__placeholder', html: icon('folder', 24) }));
  }

  const header = Card({
    className: 'app-albumhead app-dropzone',
    children: [
    coverBox,
    h(
      'div',
      { class: 'app-albumhead__body' },
      h('div', { class: 'app-albumhead__title' }, name),
      h(
        'div',
        { class: 'l-row l-row--3' },
        Badge({ label: `${imagesInFolder(view).length} 张` }),
        hasChildren(view) ? Badge({ label: `${childAlbums(view).length} 个子相册` }) : null,
        h('span', { class: 'c-subtitle' }, view)
      )
    ),
    h(
      'div',
      { class: 'l-row l-row--2' },
      Button({
        label: '设为封面',
        icon: 'image',
        size: 'sm',
        disabled: !cover,
        onClick: () => cover && actions.setAlbumCover(cover),
      }),
      Button({
        label: '重命名',
        icon: 'square-pen',
        size: 'sm',
        onClick: () => actions.renameAlbum(view),
      }),
      Button({
        label: '删除',
        icon: 'trash',
        size: 'sm',
        variant: 'danger',
        onClick: () => actions.deleteAlbum(view),
      })
    ),
    ],
  });
  header.dataset.folder = view;

  header.addEventListener('dragover', (e) => {
    e.preventDefault();
    header.dataset.over = '1';
  });
  header.addEventListener('dragleave', () => delete header.dataset.over);
  header.addEventListener('drop', (e) => {
    e.preventDefault();
    delete header.dataset.over;
    const keys = readDragKeys(e);
    if (keys.length) actions.dropIntoAlbum(keys, view);
  });

  /* ---- 子相册 ---- */

  // 网格模式用「最近相册」同款卡片横向排开；列表模式才用紧凑行
  const subHost = h('div');
  const subTitle = h('div', { class: 'c-section' }, '子相册');

  function renderSubAlbums() {
    fill(subHost);
    const kids = childAlbums(view);
    subTitle.style.display = kids.length ? '' : 'none';
    subHost.style.display = kids.length ? '' : 'none';
    if (!kids.length) return;

    if (S.settings.view_mode === 'list') {
      subHost.append(List({ variant: 'inset', children: kids.map((f) => subAlbumRow(f)) }));
    } else {
      subHost.append(h('div', { class: 'app-rail' }, ...kids.map((f) => subAlbumCard(f))));
    }
  }

  const block = h(
    'div',
    { class: 'app-page__block' },
    crumb,
    h('div', { style: { height: 'var(--s-4)' } }),
    header,
    subTitle,
    subHost
  );

  renderSubAlbums();
  photo.page.prepend(block);

  /* ---- 键盘：Esc 返回上级 ---- */

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (S.selection.size) return; // 先取消选择，再按一次才返回
    const segs2 = view.split('/').filter(Boolean);
    const parent = segs2.slice(0, -1).join('/');
    router.go({ page: 'albums', view: parent || 'albums' });
  };
  document.addEventListener('keydown', onKey);

  const offView = on('viewmode', renderSubAlbums);

  const destroyInner = photo.destroy;
  return {
    ...photo,
    destroy() {
      offView();
      document.removeEventListener('keydown', onKey);
      destroyInner();
    },
  };
}

/* ==========================================================================
   入口
   ========================================================================== */

export function mount(ctx) {
  const view = S.route.view || 'albums';
  if (!view || view === 'albums') return mountRoot(ctx);
  return mountAlbum(ctx, view);
}
