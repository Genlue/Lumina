// ============================================================
// Lumina · 主页工作台
// 指标条 / 快捷操作 / 最近相册 / 分析区。
// 分析区只用真实数据（文件大小与修改时间都来自扫描结果），没有数据就画空状态。
// ============================================================

import { h, fill } from '../../core/dom.js';
import { Button, Capsule, Badge, Card } from '../../ui/kit.js';
import { revealOnScroll } from '../../core/scrollbar.js';
import { S, allImages, totalCount, totalSize } from '../state.js';
import { fmtSize, fmtDay, lastSegment } from '../util.js';
import { albumRecentCard } from '../album-card.js';
import * as actions from '../actions.js';
import * as session from '../session.js';
import * as shell from '../shell.js';
import * as router from '../router.js';
import { on } from '../bus.js';

/* ---------------- 小组件 ---------------- */

function metric(value, label) {
  return h(
    'div',
    { class: 'app-metric' },
    h('div', { class: 'c-display app-metric__value' }, value),
    h('div', { class: 'c-subtitle app-metric__label' }, label)
  );
}

function chart(title, rows, foot) {
  return Card({
    className: 'app-chart',
    children: [
      h('div', { class: 'c-section app-chart__title' }, title),
      ...rows,
      foot ? h('div', { class: 'c-subtitle' }, foot) : null,
    ],
  });
}

function barRow(name, value, max, text) {
  return [
    h('div', { class: 'app-chart__row' },
      h('div', { class: 'app-chart__name' }, name),
      h('div', { class: 'app-chart__value' }, text ?? String(value))
    ),
    h('div', { class: 'app-chart__track' },
      h('div', { class: 'app-chart__fill', style: { width: `${Math.max(2, (value / Math.max(1, max)) * 100)}%` } })
    ),
  ];
}

/* ---------------- 页面 ---------------- */

export function mount(ctx) {
  const title = S.settings.home_title || '我的相册';

  const rescanBtn = Button({
    label: '重新扫描',
    icon: 'refresh-cw',
    variant: 'plain',
    onClick: () => actions.rescan(),
  });

  shell.pageTopbar({
    title,
    subtitle: S.profileName || '本地相册',
    nav: router.navState(),
    pills: [Capsule({ children: [rescanBtn] })],
  });

  const page = h('div', { class: 'app-page' });
  ctx.stage.append(page);
  const detach = revealOnScroll(ctx.stage);

  const metricsEl = Card({ className: 'app-metrics' });
  const quickEl = h('div', { class: 'l-row l-row--4', style: { flexWrap: 'wrap' } });
  const railEl = h('div', { class: 'app-rail' });
  const analyticsEl = h('div', { class: 'app-analytics' });

  page.append(
    metricsEl,
    h(
      'div',
      { class: 'l-stack l-stack--4' },
      h('div', { class: 'c-section' }, '快捷操作'),
      quickEl
    ),
    h(
      'div',
      { class: 'l-stack l-stack--4' },
      h(
        'div',
        { class: 'l-row l-row--4 l-row--between' },
        h('div', { class: 'c-section' }, '最近相册'),
        h(
          'div',
          { class: 'l-row l-row--3' },
          Badge({ label: `${S.albumFolders.length} 个相册` }),
          Button({
            label: '全部相册',
            size: 'sm',
            variant: 'plain',
            icon: 'folder-tree',
            onClick: () => router.go({ page: 'albums', view: 'albums' }),
          })
        )
      ),
      railEl
    ),
    h(
      'div',
      { class: 'l-stack l-stack--4' },
      h('div', { class: 'c-section' }, '分析'),
      analyticsEl
    )
  );

  /* ---------------- 渲染 ---------------- */

  function renderMetrics() {
    fill(metricsEl);
    const items = [
      metric(totalCount().toLocaleString('zh-CN'), '照片总数'),
      metric(String(S.albumFolders.length), '相册'),
      metric(String(S.favoriteSet.size), '收藏'),
      metric(String(S.trashCount), '回收站'),
    ];
    items.forEach((el, i) => {
      if (i > 0) metricsEl.append(h('span', { class: 'c-vline app-metrics__sep' }));
      metricsEl.append(el);
    });
  }

  function renderQuick() {
    fill(quickEl);
    quickEl.append(
      Button({
        label: '导入文件夹',
        icon: 'folder-plus',
        variant: 'primary',
        onClick: () => session.addProfile(),
      }),
      Button({
        label: '生成缓存',
        icon: 'layers',
        onClick: () => router.go({ page: 'settings' }),
      }),
      Button({
        label: '打开图库位置',
        icon: 'folder-open',
        onClick: () => actions.openInExplorer(S.profileFolder),
      }),
      Button({
        label: '发现',
        icon: 'compass',
        variant: 'plain',
        onClick: () => router.go({ page: 'discover', tab: 'waterfall' }),
      })
    );
  }

  function renderRail() {
    fill(railEl);
    const folders = [...S.albumFolders]
      .sort((a, b) => {
        const t = (f) => (S.albumImages[f] || []).reduce((m, img) => Math.max(m, img.date || 0), 0);
        return t(b) - t(a);
      })
      .slice(0, 8);

    if (!folders.length) {
      railEl.append(h('div', { class: 'c-subtitle' }, '还没有相册。相册按文件夹自动生成。'));
      return;
    }

    for (const folder of folders) {
      railEl.append(
        albumRecentCard(folder, {
          onClick: () => router.go({ page: 'albums', view: folder }),
        })
      );
    }
  }

  function renderAnalytics() {
    fill(analyticsEl);
    const all = allImages();
    const size = totalSize();
    const cacheSize = S.cacheInfo?.size || 0;

    /* 容量 */
    const avg = all.length ? Math.round(size / all.length) : 0;
    analyticsEl.append(
      chart(
        '容量占用',
        [
          ...barRow('原图', size, Math.max(size, cacheSize, 1), fmtSize(size)),
          ...barRow('缩略图缓存', cacheSize, Math.max(size, cacheSize, 1), fmtSize(cacheSize)),
        ],
        `${fmtSize(size)} · 平均每张 ${fmtSize(avg)}`
      )
    );

    /* 最近 7 天 */
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({ key: d.getTime(), label: fmtDay(d.getTime()), count: 0 });
    }
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (const img of all) {
      if (!img.date) continue;
      const d = new Date(img.date);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diff = Math.round((startOfToday - dayStart) / 86_400_000);
      if (diff >= 0 && diff <= 6) days[6 - diff].count += 1;
    }

    const weekTotal = days.reduce((n, d) => n + d.count, 0);
    const maxDay = Math.max(1, ...days.map((d) => d.count));

    const dayChart = Card({
      className: 'app-chart',
      children: [
      h('div', { class: 'c-section app-chart__title' }, '最近 7 天新增'),
      weekTotal === 0
        ? h('div', { class: 'c-subtitle' }, '最近 7 天没有新增照片')
        : h(
            'div',
            { class: 'app-days' },
            ...days.map((d) =>
              h(
                'div',
                { class: 'app-day', title: `${d.label} · ${d.count} 张` },
                h('div', {
                  class: 'app-day__bar',
                  style: { height: `${Math.max(3, (d.count / maxDay) * 56)}px` },
                }),
                h('div', { class: 'app-day__label' }, d.label.slice(3))
              )
            )
          ),
      h('div', { class: 'c-subtitle' }, `共 ${weekTotal} 张`),
      ],
    });
    analyticsEl.append(dayChart);

    /* 格式分布 */
    const formats = new Map();
    for (const img of all) {
      const ext = (img.name.split('.').pop() || '').toLowerCase();
      const key = ext === 'jpeg' ? 'JPG' : ext.toUpperCase() || '其他';
      formats.set(key, (formats.get(key) || 0) + 1);
    }
    const top = [...formats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    analyticsEl.append(
      chart(
        '格式分布',
        top.length ? top.flatMap(([name, n]) => barRow(name, n, top[0][1])) : [h('div', { class: 'c-subtitle' }, '暂无数据')],
        top.length ? `${formats.size} 种格式` : ''
      )
    );

    /* 相册分布 */
    const byAlbum = [...S.albumFolders]
      .map((f) => [lastSegment(f), (S.albumImages[f] || []).length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (S.rootImages.length) byAlbum.unshift(['根目录', S.rootImages.length]);
    analyticsEl.append(
      chart(
        '相册分布',
        byAlbum.length
          ? byAlbum.flatMap(([name, n]) => barRow(name, n, byAlbum[0][1]))
          : [h('div', { class: 'c-subtitle' }, '还没有相册数据')],
        byAlbum.length ? `Top ${Math.min(5, byAlbum.length)}` : ''
      )
    );
  }

  function renderAll() {
    renderMetrics();
    renderQuick();
    renderRail();
    renderAnalytics();
  }

  renderAll();

  const offs = [
    on('images', renderAll),
    on('favorites', renderMetrics),
    on('trash', renderMetrics),
    on('cache', renderAnalytics),
    on('albums', renderRail),
  ];

  return {
    destroy() {
      offs.forEach((off) => off());
      detach();
    },
  };
}
