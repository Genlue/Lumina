// ============================================================
// Lumina · 收藏
// 与「全部照片」同构，数据源换成 favorites_list。
// 批量动作：取消收藏 / 导出 / 复制到壁纸。
// ============================================================

import { Button } from '../../ui/controls/button.js';
import { S } from '../state.js';
import * as actions from '../actions.js';
import * as router from '../router.js';
import { mountPhotoPage } from './photo.js';

export function mount(ctx) {
  const view = mountPhotoPage(ctx, {
    page: 'favorites',
    title: '收藏',
    subtitle: () => `${S.favoriteList.length.toLocaleString('zh-CN')} 张收藏`,
    getItems: () => S.favoriteList,
    empty: {
      icon: 'star',
      title: '还没有收藏',
      desc: '在照片上点右键选「收藏」，或在灯箱里按空格。',
      action: () =>
        Button({
          label: '去全部照片',
          variant: 'primary',
          icon: 'images',
          onClick: () => router.go({ page: 'library' }),
        }),
    },
    multibar: [
      {
        label: '取消收藏',
        icon: 'star-off',
        onClick: (keys) => {
          const set = new Set(keys);
          actions.setFavoriteMany(S.favoriteList.filter((f) => set.has(f.key)), false);
        },
      },
      { label: '导出', icon: 'download', onClick: () => actions.exportFavorites() },
      { label: '取消', icon: 'x', onClick: () => view.clearSelection() },
    ],
    moreItems: [
      { sep: true },
      { label: '导出收藏…', icon: 'download', onClick: () => actions.exportFavorites() },
      { label: '导入收藏…', icon: 'upload', onClick: () => actions.importFavorites() },
    ],
  });

  // 进入页面时拉一次最新收藏（别的页面可能刚改过）
  actions.loadFavorites();
  return view;
}
