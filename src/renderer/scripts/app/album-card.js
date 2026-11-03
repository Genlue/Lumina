// ============================================================
// Lumina · 相册卡
// 主页「最近相册」与相册页的子相册共用同一张卡：控件库的 Tile。
// 媒体块 + 标题 + 副标题，计数走 media.badge —— 与设计系统的内容格子同构。
// ============================================================

import { h } from '../core/dom.js';
import { Tile } from '../ui/kit.js';
import * as api from './api.js';
import { S, albumCover } from './state.js';
import { fmtDay, lastSegment } from './util.js';

/**
 * @param {string} folder 相册的相对路径
 * @param {{onClick?: Function, onContextMenu?: Function, subtitle?: string}} [handlers]
 */
export function albumTile(folder, { onClick, onContextMenu, subtitle } = {}) {
  const cover = albumCover(folder);
  const list = S.albumImages[folder] || [];
  const latest = list.reduce((m, img) => Math.max(m, img.date || 0), 0);
  const count = String(list.length);

  const tile = Tile({
    // Tile 只在 media.src 为真时才建 <img>；空串会被当成「没有媒体」。
    // 所以先用文件夹图标占位，封面到了再换成真正的图片。
    media: { icon: 'folder', badge: count },
    title: lastSegment(folder),
    subtitle: subtitle ?? `${list.length} 张${latest ? ` · ${fmtDay(latest)}` : ''}`,
    onClick,
    onDouble: onClick,
    className: 'app-albumtile',
  });

  if (cover) {
    const box = tile.querySelector('.c-tile__media');
    api
      .getThumb(cover.name, cover.folder, Math.round((S.settings.thumbnail_size ?? 400) * 0.75))
      .then((r) => {
        if (!box || !r?.dataUrl) return;
        box.querySelector('svg')?.remove();
        box.prepend(h('img', { src: r.dataUrl, alt: '', draggable: 'false' }));
      })
      .catch(() => {});
  }

  if (onContextMenu) tile.addEventListener('contextmenu', onContextMenu);
  return tile;
}

/** @deprecated 旧名；相册卡就是一张 Tile */
export const albumRecentCard = albumTile;
