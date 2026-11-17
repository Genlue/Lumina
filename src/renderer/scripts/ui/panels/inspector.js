// Golden Gate · panels/inspector
import { h } from '../../core/dom.js';
import { IconButton } from '../controls/button.js';
import { Segmented } from '../controls/segmented.js';
import { disposeComponentTree } from '../_shared/lifecycle.js';

/* ==========================================================================
   24. Inspector（右侧栏）
   —— 外壳只负责「视图切换 + 收起」，不预设里面是什么。
      views 里每一项是 { id, label, node }；node 由调用方组装，
      换成大纲、属性、AI 面板都只是换一个视图。

   重建是最容易漏资源的地方：旧的 Segmented 有 ResizeObserver，
   被 replaceChildren 摘掉的 pane 里可能挂着玻璃透镜。
   所以每次重建都先释放旧的，再建新的；视图被移除时也先释放子树。
   ========================================================================== */

export function Inspector({
  views = [],
  value,
  onChange,
  onCollapse,
  label = '侧栏',
  collapseLabel = '收起侧栏',
  className = '',
} = {}) {
  let list = [...views];
  let current = value ?? list[0]?.id;
  let seg = null;
  let disposed = false;

  const body = h('div', { class: 'c-inspector__body' });
  const tabsHost = h('div', { class: 'c-inspector__tabs' });
  const paneMap = new Map();

  const head = h('div', { class: 'c-inspector__head' }, tabsHost);
  if (onCollapse) {
    head.append(
      IconButton({ icon: 'chevron-right', label: collapseLabel, size: 'sm', onClick: onCollapse })
    );
  }

  const el = h(
    'aside',
    { class: `c-inspector ${className}`.trim(), 'aria-label': label },
    head,
    body
  );

  const sync = () => {
    for (const [id, pane] of paneMap) pane.dataset.active = id === current ? '1' : '0';
    seg?.set(current);
  };

  const disposePane = (id) => {
    const pane = paneMap.get(id);
    if (!pane) return;
    paneMap.delete(id);
    disposeComponentTree(pane);
    pane.remove();
  };

  const ensurePane = (view) => {
    let pane = paneMap.get(view.id);
    if (!pane) {
      pane = h('div', { class: 'c-inspector__pane', 'data-pane': view.id }, view.node ?? null);
      paneMap.set(view.id, pane);
      body.append(pane);
    } else if (view.node && view.node.parentNode !== pane) {
      pane.append(view.node);
    }
    return pane;
  };

  const rebuild = () => {
    if (disposed) return;

    // 旧的分段控件持有 ResizeObserver 与 rAF；换掉它之前必须先释放
    seg?.dispose();
    seg = null;
    tabsHost.replaceChildren();

    if (!list.length) {
      for (const id of [...paneMap.keys()]) disposePane(id);
      return;
    }
    if (!list.some((v) => v.id === current)) current = list[0].id;

    for (const view of list) ensurePane(view);

    // 移除已经不在注册表里的视图：先释放子树，再摘 DOM
    for (const id of [...paneMap.keys()]) {
      if (!list.some((v) => v.id === id)) disposePane(id);
    }

    seg = Segmented({
      value: current,
      options: list.map((v) => ({ value: v.id, label: v.label, icon: v.icon })),
      onChange: (v) => {
        current = v;
        sync();
        onChange?.(v);
      },
    });
    tabsHost.append(seg);
    sync();
  };

  rebuild();

  el.setTab = (id) => {
    if (!paneMap.has(id)) return;
    current = id;
    sync();
  };
  el.getTab = () => current;
  el.setViews = (next) => {
    list = [...next];
    rebuild();
  };
  el.addView = (view) => {
    list = [...list, view];
    rebuild();
  };
  el.removeView = (id) => {
    list = list.filter((v) => v.id !== id);
    rebuild();
  };
  /** 幂等：重复调用只释放一次；不摘 root 自己的 DOM */
  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    seg?.dispose();
    seg = null;
    for (const id of [...paneMap.keys()]) disposePane(id);
  };
  el.body = body;
  return el;
}
