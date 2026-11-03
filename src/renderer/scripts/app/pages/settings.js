// ============================================================
// Lumina · 设置
// 只保留两类东西：
//   1) 功能开关：视图 / 排序 / 缩略图 / 缓存 / 收藏导入导出
//   2) 界面尺寸参数：侧栏宽度与透明度、每行图片数、图片间距
// 壁纸、圆角、字体、顶栏模式这些「换皮」选项不再提供。
// ============================================================

import { h, fill } from '../../core/dom.js';
import {
  Row,
  CardGroup,
  Button,
  Divider,
  Switch,
  Slider,
  Segmented,
  Swatches,
  Select,
  Progress,
  Badge,
  toast,
} from '../../ui/kit.js';
import { revealOnScroll } from '../../core/scrollbar.js';
import { openPanel } from '../dialog.js';
import { S } from '../state.js';
import { fmtSize } from '../util.js';
import * as api from '../api.js';
import * as actions from '../actions.js';
import * as shell from '../shell.js';
import * as router from '../router.js';
import * as materials from '../materials.js';
import { on, emit } from '../bus.js';
import { getPrefs, setPrefs } from '../prefs.js';

const APP_VERSION = '3.0.0';

/* ==========================================================================
   保存：合并写库（拖动滑块时不要每帧都 invoke）
   ========================================================================== */

let pendingSave = {};
let saveTimer = 0;

function flushSave() {
  const data = pendingSave;
  pendingSave = {};
  if (!Object.keys(data).length || !S.profileId) return;
  api.settings.save(S.profileId, data).catch((e) => {
    toast(`设置保存失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
  });
}

function queueSave(updates) {
  Object.assign(pendingSave, updates);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 240);
}

/** 改设置：内存 → 立即生效 → 合并落库 */
function patch(updates) {
  Object.assign(S.settings, updates);
  if ('theme_mode' in updates) materials.applyThemeMode(S.settings);
  if (Object.keys(updates).some((k) => k.startsWith('accent_color'))) {
    materials.applyAccent(S.settings);
  }
  if ('sidebar_width' in updates) {
    materials.applyUiParams(S.settings);
  }
  queueSave(updates);
}

/* ==========================================================================
   行构造器
   ========================================================================== */

function sliderRow({ label, hint, min, max, step = 1, value, format = String, onInput }) {
  const out = h('span', { class: 'app-settings__value' }, format(value));
  const slider = Slider({
    min,
    max,
    step,
    value,
    label,
    onInput: (v) => {
      out.textContent = format(v);
      onInput(v);
    },
  });
  return Row({
    label,
    hint,
    stack: true,
    control: h(
      'div',
      { class: 'app-settings__rowfill' },
      h('div', { class: 'l-fill' }, slider),
      out
    ),
  });
}

/* ==========================================================================
   搜索语法说明
   ========================================================================== */

function showSearchHelp() {
  // 按键用 Badge：设计系统里没有「键帽」这个控件，给一串等宽代码另造一层视觉
  // 就违反了「不自创视觉」。徽标是最接近的一档（小、圆角、描边、不可点）。
  const line = (k, v) =>
    h(
      'div',
      { class: 'l-row l-row--4', style: { alignItems: 'flex-start' } },
      h('span', { style: { flex: 'none', width: '132px' } }, Badge({ label: k })),
      h('span', { class: 'c-subtitle' }, v)
    );

  const body = h(
    'div',
    { class: 'l-stack l-stack--3' },
    line('猫 狗', '空格 = AND，同时包含「猫」和「狗」'),
    line('猫 | 狗', '| = OR，包含任意一个'),
    line('猫 -狗', '- = 排除，含「猫」但不含「狗」'),
    line('"猫 | 狗"', '双引号 = 精确短语，里面的符号不再当操作符'),
    Divider(),
    line('单击 / 双击照片', '用灯箱打开'),
    line('长按照片', '进入选择模式，之后单击为选中'),
    line('Ctrl / ⌘ / Shift + 单击', '直接进入选择模式并多选'),
    line('Esc', '退出选择模式'),
    Divider(),
    line('Ctrl / ⌘ + F', '聚焦搜索框'),
    line('空格', '没有选中照片时聚焦搜索框'),
    line('Ctrl / ⌘ + A', '全选；加 Shift 为反选'),
    line('Enter', '用灯箱打开选中的照片'),
    line('Delete', '把选中的照片移到回收站'),
    line('Esc', '退出选择模式；在相册里再按一次返回上级'),
    Divider(),
    line('← / →', '灯箱翻页'),
    line('R / Shift+R', '灯箱顺时针 / 逆时针旋转 90°'),
    line('空格', '灯箱里收藏当前照片')
  );

  // 与其它模态共用 L4 玻璃外壳（docs/02 §6），别在这里手搓第二套遮罩与关窗逻辑
  const panel = openPanel('搜索语法与快捷键', body, [
    Button({ label: '知道了', variant: 'primary', onClick: () => panel.destroy() }),
  ]);
}

/* ==========================================================================
   页面
   ========================================================================== */

export function mount(ctx) {
  shell.pageTopbar({
    title: '设置',
    subtitle: '改动立即生效并保存',
    nav: router.navState(),
  });

  const page = h('div', { class: 'app-settings l-stack l-stack--9' });
  ctx.stage.append(page);
  const detach = revealOnScroll(ctx.stage);

  /* ---------------- 外观 ---------------- */

  const themeSeg = Segmented({
    value: S.settings.theme_mode,
    options: [
      { value: 'light', label: '浅色' },
      { value: 'dark', label: '深色' },
      { value: 'system', label: '跟随系统' },
    ],
    onChange: (v) => patch({ theme_mode: v }),
  });

  const swatches = Swatches({
    value: S.settings.accent_color,
    onChange: (hex) => {
      // 只存一个强调色：浅色压暗 / 深色提亮由 theme.js 派生（docs/01 §7）
      patch({ accent_color: hex });
    },
  });

  page.append(
    CardGroup({
      title: '外观',
      children: [
        Row({ label: '主题', hint: '跟随系统时随 Windows 明暗切换', control: themeSeg }),
        Row({ label: '强调色', hint: '选中态、开关、滑块会一起变色', stack: true, control: swatches }),
      ],
    })
  );

  /* ---------------- 界面 ---------------- */

  const uiPrefs = getPrefs();

  page.append(
    CardGroup({
      title: '界面',
      children: [
        sliderRow({
          label: '侧边栏宽度',
          // 范围取自 tokens.css 的 --nav-w-min / --nav-w-max
          min: 190,
          max: 340,
          value: S.settings.sidebar_width ?? 224,
          format: (v) => `${v}px`,
          onInput: (v) => patch({ sidebar_width: v }),
        }),
        sliderRow({
          label: '每行图片数',
          hint: '0 = 按缩略图尺寸自动铺满',
          min: 0,
          max: 12,
          value: uiPrefs.gridColumns,
          format: (v) => (v ? `${v} 张` : '自动'),
          onInput: (v) => {
            setPrefs({ gridColumns: v });
            emit('ui');
          },
        }),
        sliderRow({
          label: '图片间距',
          min: 0,
          max: 16,
          value: uiPrefs.gridGap,
          format: (v) => `${v}px`,
          onInput: (v) => {
            setPrefs({ gridGap: v });
            emit('ui');
          },
        }),
      ],
    })
  );

  /* ---------------- 浏览 ---------------- */

  const viewSeg = Segmented({
    value: S.settings.view_mode === 'list' ? 'list' : 'grid',
    options: [
      { value: 'grid', label: '网格' },
      { value: 'list', label: '列表' },
    ],
    onChange: (v) => patch({ view_mode: v }),
  });

  const sortSelect = Select({
    options: [
      { value: 'name-asc', label: '名称 A→Z' },
      { value: 'name-desc', label: '名称 Z→A' },
      { value: 'date-desc', label: '最新优先' },
      { value: 'date-asc', label: '最旧优先' },
    ],
    value: S.settings.sort_by || 'name-asc',
    width: '128px',
    label: '默认排序',
    onChange: (v) => patch({ sort_by: v }),
  });

  const reverseSwitch = Switch({
    checked: !!S.settings.reverse_search_enabled,
    label: '排除搜索栏',
    onChange: (v) => {
      patch({ reverse_search_enabled: v ? 1 : 0 });
      toast(v ? '已开启排除搜索栏' : '已关闭排除搜索栏', { icon: 'search' });
    },
  });

  page.append(
    CardGroup({
      title: '浏览',
      children: [
        Row({ label: '默认视图', control: viewSeg }),
        Row({ label: '默认排序', hint: '「全部照片」打开时按这个顺序排列', control: sortSelect }),
        sliderRow({
          label: '缩略图分辨率',
          hint: '请求的缩略图尺寸，影响清晰度与内存占用',
          min: 100,
          max: 800,
          step: 20,
          value: S.settings.thumbnail_size ?? 400,
          format: (v) => `${v}px`,
          onInput: (v) => patch({ thumbnail_size: v }),
        }),
        sliderRow({
          label: '列表列数',
          min: 1,
          max: 5,
          value: S.settings.list_columns ?? 3,
          format: String,
          onInput: (v) => patch({ list_columns: v }),
        }),
        Row({ label: '排除搜索栏', hint: '在搜索框旁边多一个「排除关键词」输入框', control: reverseSwitch }),
        sliderRow({
          label: '抽卡张数',
          min: 1,
          max: 30,
          value: S.settings.draw_count ?? 10,
          format: String,
          onInput: (v) => patch({ draw_count: v }),
        }),
        sliderRow({
          label: '幻灯片间隔',
          min: 1,
          max: 30,
          value: S.settings.random_interval ?? 3,
          format: (v) => `${v}s`,
          onInput: (v) => patch({ random_interval: v }),
        }),
      ],
    })
  );

  /* ---------------- 性能 ---------------- */

  const cacheLabel = h('span', { class: 'c-subtitle' }, '统计中…');
  const genBar = Progress({ value: 0 });
  const genText = h('div', { class: 'c-subtitle' });
  const genWrap = h('div', { class: 'l-stack l-stack--3', style: { width: '100%' } }, genBar, genText);
  genWrap.style.display = 'none';

  const genBtn = Button({ label: '生成缩略图', icon: 'layers', onClick: () => toggleGenerate() });

  const concSwitch = Switch({
    checked: (S.settings.thumb_gen_concurrency ?? 10) === 0,
    label: '不限制并发',
    onChange: (v) => {
      const next = v ? 0 : Math.max(1, S.settings.thumb_gen_concurrency || 10);
      patch({ thumb_gen_concurrency: next });
      concSliderWrap.style.display = v ? 'none' : '';
      concSlider.set(next || 10);
      concOut.textContent = String(next || 10);
    },
  });

  const concOut = h('span', { class: 'app-settings__value' }, String(S.settings.thumb_gen_concurrency || 10));
  const concSlider = Slider({
    min: 1,
    max: 64,
    step: 1,
    value: S.settings.thumb_gen_concurrency || 10,
    label: '生成并发',
    onInput: (v) => {
      concOut.textContent = String(v);
      patch({ thumb_gen_concurrency: v });
    },
  });
  const concSliderWrap = h(
    'div',
    { class: 'app-settings__rowfill' },
    h('div', { class: 'l-fill' }, concSlider),
    concOut
  );
  concSliderWrap.style.display = (S.settings.thumb_gen_concurrency ?? 10) === 0 ? 'none' : '';

  async function refreshCache() {
    try {
      S.cacheInfo = await api.cache.info(S.profileId);
    } catch {
      S.cacheInfo = { size: 0, file_count: 0 };
    }
    cacheLabel.textContent = `缓存 ${S.cacheInfo.file_count} 个文件 · ${fmtSize(S.cacheInfo.size)}`;
  }

  async function toggleGenerate() {
    if (S.gen.running) {
      await api.cache.cancel().catch(() => {});
      return;
    }
    const grid = S.settings.thumbnail_size ?? 400;
    const waterfall = Math.max(240, Math.round(grid * 1.25));
    genBtn.disabled = true;
    genBtn.querySelector('.c-btn__label').textContent = '启动中…';
    try {
      const total = await api.cache.generate(S.profileId, [grid, waterfall]);
      if (!total) toast('图库为空，没有需要生成的图片', { icon: 'info' });
    } catch (e) {
      toast(`启动失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger' });
    } finally {
      genBtn.disabled = false;
      syncGenUi();
    }
  }

  function syncGenUi() {
    const running = S.gen.running;
    genBtn.querySelector('.c-btn__label').textContent = running ? '取消生成' : '生成缩略图';
    genBtn.classList.toggle('c-btn--danger', running);
    genBtn.classList.toggle('c-btn--primary', !running);
    genWrap.style.display = running ? '' : 'none';
    if (running) {
      const pct = S.gen.total ? Math.round((S.gen.done / S.gen.total) * 100) : 0;
      genBar.set(pct);
      genText.textContent = `正在生成 ${S.gen.done} / ${S.gen.total}（${pct}%）`;
    }
  }

  page.append(
    CardGroup({
      title: '性能',
      children: [
        Row({
          label: '缩略图缓存',
          hint: '预生成后浏览不再等待解码',
          stack: true,
          control: h(
            'div',
            { class: 'l-stack l-stack--3', style: { width: '100%' } },
            h('div', { class: 'c-subtitle' }, cacheLabel),
            h(
              'div',
              { class: 'l-row l-row--3' },
              genBtn,
              Button({
                label: '检查孤儿缓存',
                icon: 'folder-search',
                size: 'sm',
                variant: 'plain',
                onClick: () => actions.reconcileCache(),
              }),
              Button({
                label: '清理缓存',
                icon: 'trash',
                size: 'sm',
                variant: 'plain',
                onClick: () => actions.clearCache(),
              })
            ),
            genWrap
          ),
        }),
        Row({ label: '限制生成并发', hint: '同时解码的缩略图数量，关掉则不限（默认 10）', control: concSwitch }),
        Row({ label: '并发数', stack: true, control: concSliderWrap }),
      ],
    })
  );

  /* ---------------- 数据 ---------------- */

  page.append(
    CardGroup({
      title: '数据',
      children: [
        Row({
          label: '收藏',
          hint: '导出为 JSON，可在别的图库里导入',
          stack: true,
          control: h(
            'div',
            { class: 'l-row l-row--3' },
            Button({ label: '导出收藏', icon: 'download', size: 'sm', onClick: () => actions.exportFavorites() }),
            Button({ label: '导入收藏', icon: 'upload', size: 'sm', onClick: () => actions.importFavorites() })
          ),
        }),
        Row({
          label: '图库位置',
          hint: S.profileFolder || '—',
          control: h(
            'div',
            { class: 'l-row l-row--3' },
            Button({
              label: '打开',
              icon: 'external-link',
              size: 'sm',
              onClick: () => actions.openInExplorer(S.profileFolder),
            }),
            Button({
              label: '重新扫描',
              icon: 'refresh-cw',
              size: 'sm',
              variant: 'plain',
              onClick: () => actions.rescan(),
            })
          ),
        }),
        Row({
          label: '数据目录',
          hint: `${S.profileFolder.replace(/\\/g, '/')}/.album（缓存 / 回收站）`,
          control: Button({
            label: '打开',
            icon: 'folder-open',
            size: 'sm',
            onClick: () => actions.openInExplorer(`${S.profileFolder.replace(/\\/g, '/')}/.album`),
          }),
        }),
      ],
    })
  );

  /* ---------------- 关于 ---------------- */

  page.append(
    CardGroup({
      title: '关于',
      children: [
        Row({
          label: 'Lumina',
          hint: '本地相册管理 · Tauri v2 + Rust + SQLite',
          control: Badge({ label: `v${APP_VERSION}` }),
        }),
        Row({
          label: '当前图库',
          hint: S.profileFolder || '—',
          control: h(
            'div',
            { class: 'l-row l-row--3' },
            Badge({ label: `${S.albumFolders.length} 个相册` }),
            Badge({ label: `${S.favoriteList.length} 收藏` })
          ),
        }),
        Row({
          label: '搜索语法与快捷键',
          hint: '空格 = AND、| = OR、- = 排除、"" = 精确短语',
          control: Button({
            label: '查看说明',
            icon: 'keyboard',
            size: 'sm',
            variant: 'plain',
            onClick: () => showSearchHelp(),
          }),
        }),
        Row({
          label: '开源地址',
          hint: 'github.com/Genlue/Lumina',
          control: Button({
            label: '复制',
            icon: 'layers',
            size: 'sm',
            variant: 'plain',
            onClick: async () => {
              try {
                await navigator.clipboard.writeText('https://github.com/Genlue/Lumina');
                toast('地址已复制', { icon: 'check' });
              } catch {
                toast('无法访问剪贴板', { icon: 'info' });
              }
            },
          }),
        }),
      ],
    })
  );

  /* ---------------- 初始化 ---------------- */

  refreshCache();
  syncGenUi();

  const offs = [
    on('cache', refreshCache),
    on('gen', () => {
      syncGenUi();
      if (!S.gen.running) refreshCache();
    }),
  ];

  return {
    destroy() {
      offs.forEach((off) => off());
      detach();
      flushSave();
    },
  };
}
