// ============================================================
// Lumina · 全部照片
// 主战场：网格 / 列表、懒加载、窗口化、选择、右键、批量操作。
// ============================================================

import { allImages, S } from '../state.js';
import { mountPhotoPage } from './photo.js';

export function mount(ctx) {
  return mountPhotoPage(ctx, {
    page: 'library',
    title: '全部照片',
    subtitle: () => `${allImages().length.toLocaleString('zh-CN')} 张 · ${S.albumFolders.length} 个相册`,
    getItems: allImages,
    empty: {
      icon: 'images',
      title: '还没有照片',
      desc: '把图片放进图库文件夹，然后点下面的按钮重新扫描。',
    },
  });
}
