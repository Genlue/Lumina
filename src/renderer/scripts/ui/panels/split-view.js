// Golden Gate · panels/split-view
import { h, clamp } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { createDisposer } from '../_shared/disposer.js';

/* ==========================================================================
   48. 分栏 SplitView

   和 Resizer 的分工：Resizer 只报「位移」，因为它不知道被拖的是哪一栏、
   上下限是多少。分栏容器知道 —— 它持有每一栏的 min/max，也量得到容器宽度，
   所以能自己解约束、在容器变化时按比例重算、在窄窗里降级成滚动。

   三条设计约束：
   ① 一次拖动只改相邻两栏，总长不变。若让整行一起被推挤，其他栏会在指针下
      跳动，读起来像布局在抖。
   ② 常态下任何栏不低于 min。容器真的装不下时不再硬撑：比例压缩 + data-overflow，
      容器滚动。压碎两栏比出一条滚动条糟得多。
   ③ 折叠不是把宽度设成 0 就完事 —— 折叠栏的展开入口在分隔条上，所以分隔条
      本身必须一直存在，否则那一栏再也打不开。

   尺寸与折叠状态是「应用想记住的东西」，所以这里提供 serialize() / restore()，
   并在给了 persistKey 时自己写 localStorage（读失败、坏数据一律当没存过）。
   注意：存储的是用户意图（像素），不是容器当前的可用宽度 —— 换窗口大小后
   由约束求解器重新夹取，而不是把旧布局硬塞回去。

   作为 flex 子项：根元素默认 width: 100%（水平）/ height: 100%（垂直），
   不要求调用方写显式宽度；容器尺寸变化时按比例重算，但**用户拖过的栏**
   保持绝对像素（只按 min/max 夹取），否则每次窗口缩放都会把手工调好的
   分栏打回默认比例。
   ========================================================================== */

const SEP = 9; // 与 .c-split__sep 的 flex-basis 一致，量可用空间时要先扣掉
const STEP = 16; // 键盘每步位移，和系统分隔条手感一致
const COLLAPSE_SLACK = 40; // 可折叠栏允许被拖过 min 多少像素后判定为收起
const EDGE = 48; // 溢出状态下不再解 min，只留一个「还抓得住」的硬底

export function SplitView({
  axis = 'x', // 'x' 左右 | 'y' 上下
  panes = [],
  sizes: initialSizes,
  persistKey = '', // 给了才写 localStorage
  label = '分栏',
  onResize,
  className = '',
} = {}) {
  const vertical = axis === 'y';

  const specs = (Array.isArray(panes) ? panes : []).map((p, i) => ({
    id: p?.id ?? `pane-${i + 1}`,
    node: p?.node ?? null,
    min: Number.isFinite(p?.min) ? Math.max(0, p.min) : 120,
    max: Number.isFinite(p?.max) ? Math.max(0, p.max) : Infinity,
    collapsible: Boolean(p?.collapsible),
    resizable: p?.resizable !== false,
    preset: p?.size,
  }));
  const n = specs.length;

  const disposer = createDisposer();
  let disposed = false;
  let drag = null;
  let holdingCursor = false;

  const collapsed = new Set();
  /** 收起前的尺寸：展开时原样还回去，而不是「回到默认值」 */
  const lastSize = new Map();
  /** 每栏占「可用空间」的比例；容器尺寸变化时按它重算 */
  const ratios = new Array(n).fill(1 / Math.max(1, n));
  let sizes = new Array(n).fill(n ? 640 / n : 0);
  /** 用户拖过的栏：容器变化时按绝对像素保留，不再跟比例走 */
  const pinned = new Set();

  /* ---------------- 初始尺寸 ---------------- */

  const parseDim = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return { px: v };
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.endsWith('%')) {
        const r = parseFloat(s) / 100;
        if (Number.isFinite(r)) return { ratio: r };
      }
      const px = parseFloat(s);
      if (Number.isFinite(px)) return { px };
    }
    return null;
  };

  const preset = Array.isArray(initialSizes) && initialSizes.length === n
    ? initialSizes
    : specs.map((s) => s.preset);
  const hints = preset.map(parseDim);

  if (n && hints.every((x) => x?.px != null)) {
    sizes = hints.map((x) => Math.max(0, x.px));
    const sum = sizes.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < n; i++) ratios[i] = sizes[i] / sum;
  } else if (n && hints.every((x) => x?.ratio != null)) {
    const sum = hints.reduce((a, x) => a + Math.max(0, x.ratio), 0) || 1;
    for (let i = 0; i < n; i++) ratios[i] = Math.max(0, hints[i].ratio) / sum;
    sizes = ratios.map((r) => r * 640);
  }

  // 双击复位到「打开时的比例」，而不是「所有栏等宽」——
  // 等宽会把调用方精心设定的 280/1fr 结构一夜抹平。
  const initialRatios = ratios.slice();

  /* ---------------- 结构 ---------------- */

  const el = h('div', {
    class: `c-split ${className}`.trim(),
    role: 'group',
    'aria-label': label,
    dataset: { axis: vertical ? 'y' : 'x', overflow: '0' },
  });

  const paneEls = [];
  const sepEls = [];
  /** 折叠后出现的展开按钮；按分隔条 + 相邻栏登记，状态变化时统一同步 */
  const expandButtons = [];

  const arrowFor = (paneIdx, sepIdx) => {
    if (vertical) return paneIdx === sepIdx ? 'chevron-up' : 'chevron-down';
    return paneIdx === sepIdx ? 'chevron-left' : 'chevron-right';
  };

  for (let i = 0; i < n; i++) {
    const s = specs[i];
    const pane = h(
      'div',
      {
        class: 'c-split__pane',
        dataset: { id: s.id, index: String(i), collapsed: '0' },
        // 尺寸只走一个自定义属性：flex-basis 在 CSS 里读它，
        // 拖动时改一个值就够，不用反复拼 flex 简写。
        style: { '--pane-size': `${Math.round(sizes[i])}px`, '--pane-min': `${s.min}px` },
      },
      s.node
    );
    paneEls.push(pane);
    el.append(pane);

    if (i >= n - 1) continue;

    const sep = h('div', {
      class: 'c-split__sep',
      role: 'separator',
      tabindex: '0',
      'aria-orientation': vertical ? 'horizontal' : 'vertical',
      'aria-label': `调整 ${specs[i].id} 与 ${specs[i + 1].id} 的分隔`,
      'aria-valuenow': String(Math.round(sizes[i])),
      'aria-valuemin': String(Math.round(specs[i].min)),
      'aria-valuemax': String(Math.round(estimateMax(i))),
      dataset: { index: String(i) },
    });

    // 折叠栏的「门」压在分隔条上：栏没了，门必须还在
    for (const idx of [i, i + 1]) {
      if (!specs[idx].collapsible) continue;
      const btn = h(
        'button',
        {
          class: 'c-split__expand',
          type: 'button',
          hidden: true,
          'aria-label': `展开 ${specs[idx].id}`,
          onclick: (e) => {
            e.stopPropagation();
            expand(specs[idx].id);
          },
        },
        h('span', { class: 'c-split__expand-icon', html: icon(arrowFor(idx, i), 12) })
      );
      expandButtons.push({ sepIndex: i, paneIndex: idx, btn });
      sep.append(btn);
    }

    // 两端任一端禁止调整，这条缝就整体失效：只锁一半会让人以为另一端坏了
    if (!specs[i].resizable || !specs[i + 1].resizable) {
      sep.setAttribute('aria-disabled', 'true');
      sep.tabIndex = -1;
      sep.dataset.disabled = '1';
    } else {
      disposer.on(sep, 'pointerdown', (e) => onPointerDown(e, i));
      disposer.on(sep, 'pointermove', onPointerMove);
      disposer.on(sep, 'pointerup', onPointerUp);
      disposer.on(sep, 'pointercancel', onPointerUp);
      disposer.on(sep, 'keydown', (e) => onKeyDown(e, i));
      disposer.on(sep, 'dblclick', (e) => {
        e.preventDefault();
        reset();
      });
    }

    sepEls.push(sep);
    el.append(sep);
  }

  /* ---------------- 度量与约束 ---------------- */

  // 用 border-box 而不是 clientWidth/clientHeight：滚动条进出只影响内容盒，
  // 拿内容盒当容器尺寸会让「溢出 → 出滚动条 → 尺寸变小 → 重算」自己转起来。
  const extent = () => {
    const rect = el.getBoundingClientRect();
    return vertical ? rect.height : rect.width;
  };
  const sepTotal = () => Math.max(0, n - 1) * SEP;
  const available = () => Math.max(0, extent() - sepTotal());
  const openIndexes = () => {
    const out = [];
    for (let i = 0; i < n; i++) if (!collapsed.has(specs[i].id)) out.push(i);
    return out;
  };
  const indexOf = (id) => specs.findIndex((s) => s.id === id);
  const pointOf = (e) => (vertical ? e.clientY : e.clientX);

  /** 相邻两栏的可行区间；pair 是不变量，两边只在这个和里分 */
  function pairBounds(k) {
    const a = specs[k];
    const b = specs[k + 1];
    const pair = sizes[k] + sizes[k + 1];
    return { pair, lo: Math.max(a.min, pair - b.max), hi: Math.min(a.max, pair - b.min) };
  }

  /** 分隔条可拖动到的上限（用于 aria-valuemax，必须在排版前就能算） */
  function estimateMax(k) {
    const b = specs[k + 1];
    return Math.min(specs[k].max, Math.max(specs[k].min, sizes[k] + sizes[k + 1] - b.min));
  }

  /**
   * 把一组期望尺寸塞进 avail：
   *  - 先按 min/max 夹紧；
   *  - 总和不等时，把差额按各自「还能走多远」摊回去（无限空间按容器长度估）；
   *  - 摊不动（sum(min) 已经超过 avail）就按比例压缩到 min 以下并报溢出。
   */
  function solve(raw, avail, open) {
    const out = new Array(n).fill(0);
    const mins = new Array(n).fill(0);
    const maxs = new Array(n).fill(0);
    for (const i of open) {
      mins[i] = specs[i].min;
      maxs[i] = specs[i].max;
    }
    const sumMin = open.reduce((s, i) => s + mins[i], 0);

    if (sumMin > avail + 0.5) {
      // 装不下：只保留比例。视觉上 CSS 会用 --pane-min 把每栏撑回去并出滚动条，
      // 所以这里压到 min 以下不会变成「内容被裁掉」。
      let base = 0;
      for (const i of open) base += Math.max(raw[i], 1);
      if (base <= 0) base = 1;
      for (const i of open) out[i] = Math.max(0, (Math.max(raw[i], 1) / base) * avail);
      return { sizes: out, overflow: true };
    }

    for (const i of open) out[i] = clamp(raw[i], mins[i], maxs[i]);

    for (let iter = 0; iter < 8; iter++) {
      const sum = open.reduce((s, i) => s + out[i], 0);
      const diff = avail - sum;
      if (Math.abs(diff) < 0.5) break;

      const roomOf = (i) => {
        const v = diff > 0 ? maxs[i] - out[i] : out[i] - mins[i];
        // Infinity 会让「按比例摊」退化成 0/0，用一个等价于「很大」的上界代替
        return Number.isFinite(v) ? Math.max(0, v) : avail;
      };
      const pool = open.filter((i) => roomOf(i) > 0.5);
      if (!pool.length) break;

      const room = pool.reduce((s, i) => s + roomOf(i), 0);
      const take = Math.min(Math.abs(diff), room);
      if (take <= 0.5) break;
      for (const i of pool) out[i] += Math.sign(diff) * (roomOf(i) / room) * take;
    }

    return { sizes: out, overflow: false };
  }

  /** 把 sizes 写进 DOM —— 只在尺寸真的变了之后调用 */
  function apply() {
    for (let i = 0; i < n; i++) {
      const pane = paneEls[i];
      if (!pane) continue;
      const off = collapsed.has(specs[i].id);
      pane.dataset.collapsed = off ? '1' : '0';
      pane.style.setProperty('--pane-size', `${Math.round(Math.max(0, sizes[i]) * 100) / 100}px`);
      // 折叠后内容不能再用 Tab 进去；分隔条在栏外，不受影响
      if (off) pane.setAttribute('inert', '');
      else pane.removeAttribute('inert');
    }
    for (const item of expandButtons) {
      item.btn.hidden = !collapsed.has(specs[item.paneIndex].id);
    }
  }

  function rememberRatios(open) {
    const sum = open.reduce((s, i) => s + sizes[i], 0);
    if (sum <= 0) return;
    for (const i of open) ratios[i] = sizes[i] / sum;
  }

  function relayout({ fromContainer = false } = {}) {
    if (n === 0) return;
    const total = extent();
    if (total <= 0) {
      // 还没进文档 / 被 display:none：状态先落到 DOM 上，等 ResizeObserver 来叫
      apply();
      return;
    }

    const avail = Math.max(0, total - sepTotal());
    const open = openIndexes();

    if (!open.length) {
      sizes = new Array(n).fill(0);
      el.dataset.overflow = '0';
      apply();
      return;
    }

    const raw = new Array(n).fill(0);
    if (fromContainer) {
      // 容器尺寸变了：拖过的栏留在绝对像素（只夹 min/max），其余的按比例分剩下的。
      // 全部按比例重算会把用户手工调好的分栏在窗口放大/缩小时打回默认比例。
      let fixed = 0;
      const flexible = [];
      for (const i of open) {
        if (pinned.has(specs[i].id)) {
          raw[i] = clamp(sizes[i], specs[i].min, specs[i].max);
          fixed += raw[i];
        } else {
          flexible.push(i);
        }
      }
      const rest = Math.max(0, avail - fixed);
      let sumRatio = 0;
      for (const i of flexible) sumRatio += ratios[i];
      if (sumRatio <= 0) sumRatio = flexible.length || 1;
      for (const i of flexible) raw[i] = (ratios[i] / sumRatio) * rest;
    } else {
      for (const i of open) raw[i] = sizes[i];
    }

    const solved = solve(raw, avail, open);
    for (let i = 0; i < n; i++) sizes[i] = solved.sizes[i];
    el.dataset.overflow = solved.overflow ? '1' : '0';
    rememberRatios(open);
    apply();
    // 第一次量到尺寸后补一次初值：此前的 aria-valuenow 是按预设像素写的，
    // 和真实排版对不上。之后再变（容器缩放/折叠）就不刷它了。
    if (!syncedOnce) {
      syncedOnce = true;
      for (let k = 0; k < n - 1; k++) syncMetric(k);
    }
  }

  /* ---------------- 折叠 / 展开 ---------------- */

  function collapse(id) {
    const i = indexOf(id);
    if (i < 0 || disposed) return false;
    // 只有一栏时折叠没有意义：没有分隔条，也就没有展开按钮，收起来就再也打不开
    if (n < 2) return false;
    if (collapsed.has(id) || !specs[i].collapsible) return false;
    lastSize.set(id, Math.max(specs[i].min, sizes[i]));
    collapsed.add(id);
    sizes[i] = 0;
    // 用当前像素解，而不是比例：拖动刚结束时的比例还是拖动前的，
    // 拿它重算会让邻居在收起的瞬间跳一下。
    relayout();
    syncMetricsAround(i);
    emit(i);
    persist();
    return true;
  }

  function expand(id) {
    const i = indexOf(id);
    if (i < 0 || disposed || !collapsed.has(id)) return false;
    collapsed.delete(id);

    const total = extent();
    const avail = Math.max(0, total - sepTotal());
    const want = clamp(lastSize.get(id) ?? specs[i].min, specs[i].min, specs[i].max);
    sizes[i] = want;

    const open = openIndexes();
    const others = open.filter((j) => j !== i);
    if (avail > 0 && others.length) {
      const othersMin = others.reduce((s, j) => s + specs[j].min, 0);
      // 空间不够时优先保 min：先按「剩余空间 - 本栏」定其他栏的总量，
      // 真不够就让 solve 去报溢出，而不是把邻居压到看不见。
      const target = Math.max(othersMin, avail - want);
      const sum = others.reduce((s, j) => s + sizes[j], 0);
      if (sum > 0) {
        const scale = target / sum;
        for (const j of others) sizes[j] = Math.max(0, sizes[j] * scale);
      }
    }

    relayout();
    syncMetricsAround(i);
    emit(i);
    persist();
    return true;
  }

  function syncMetricsAround(i) {
    if (n < 2) return;
    syncMetric(Math.max(0, i - 1), false);
    syncMetric(Math.min(i, n - 2), false);
  }

  /**
   * aria-valuenow 只在「用户真的改了尺寸」时更新。
   * 容器缩放、折叠造成的数值变化不刷新它 —— 屏幕阅读器不该被布局抖动反复打断。
   */
  function syncMetric(k, live = true) {
    const sep = sepEls[k];
    if (!sep) return;
    const a = specs[k];
    const b = specs[k + 1];
    const pair = sizes[k] + sizes[k + 1];
    const hi = Math.min(a.max, Math.max(a.min, pair - b.min));
    sep.setAttribute('aria-valuemin', String(Math.round(a.min)));
    sep.setAttribute('aria-valuemax', String(Math.round(hi)));
    if (live) {
      const value = Math.round(sizes[k]);
      sep.setAttribute('aria-valuenow', String(value));
      sep.setAttribute('aria-valuetext', `${a.id} ${value} 像素`);
    }
  }

  function emit(i) {
    if (disposed) return;
    onResize?.({
      id: specs[i]?.id,
      size: Math.round(sizes[i] * 100) / 100,
      sizes: sizes.slice(),
    });
  }

  /* ---------------- 持久化 ---------------- */

  /** 只在用户真的改了布局时写：尺寸/折叠状态，格式见 el.serialize() */
  function persist() {
    if (!persistKey || disposed) return;
    try {
      localStorage.setItem(persistKey, JSON.stringify(el.serialize()));
    } catch {
      // 隐私模式 / 配额满 / key 非法：持久化是增强项，失败不能拖垮交互
    }
  }

  function readPersisted() {
    if (!persistKey) return null;
    try {
      const raw = localStorage.getItem(persistKey);
      if (!raw) return null;
      const state = JSON.parse(raw);
      return state && typeof state === 'object' ? state : null;
    } catch {
      // 坏 JSON 当没存过 —— 不能因为一段脏数据让整个分栏起不来
      return null;
    }
  }

  /** 用户亲手改过的栏钉住：容器变化时保持绝对像素 */
  function pinAround(k) {
    if (specs[k]) pinned.add(specs[k].id);
    if (specs[k + 1]) pinned.add(specs[k + 1].id);
  }

  /* ---------------- 拖动 ---------------- */

  function onPointerDown(e, k) {
    if (disposed || e.button !== 0 || drag) return;

    // 已经收起的邻栏：先把尺寸还回去再拖。这样「拖一下」就等于展开，
    // 不用先瞄准那颗小按钮。
    if (collapsed.has(specs[k].id)) expand(specs[k].id);
    if (collapsed.has(specs[k + 1].id)) expand(specs[k + 1].id);

    const total = extent();
    if (total <= 0) return;

    const base = sizes.slice();
    // 溢出时 CSS 用 min 撑开了每一栏，实际宽度不等于 sizes。
    // 从「看到的宽度」起拖，否则指针移了半天栏也不动。
    if (el.dataset.overflow === '1') {
      for (const i of openIndexes()) {
        const rect = paneEls[i]?.getBoundingClientRect?.();
        if (rect) base[i] = vertical ? rect.height : rect.width;
      }
    }

    drag = { k, id: e.pointerId, start: pointOf(e), base, want: null };
    // 指针已被释放 / 合成事件时捕获会抛错；抛了就整段拖动都没了，所以吞掉
    try {
      sepEls[k].setPointerCapture(e.pointerId);
    } catch {}
    sepEls[k].dataset.active = '1';
    // 拖动期间整页统一光标；这条全局规则在 43-resizer.css 里，复用同一套
    document.documentElement.dataset.resizing = vertical ? 'y' : 'x';
    holdingCursor = true;
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const k = drag.k;
    const a = specs[k];
    const b = specs[k + 1];
    const pair = drag.base[k] + drag.base[k + 1];
    const overflow = el.dataset.overflow === '1';

    // 可折叠的栏允许被拖过 min 一小段：越过阈值就判定「用户想收起它」
    const slackA = a.collapsible ? Math.min(COLLAPSE_SLACK, a.min * 0.5) : 0;
    const slackB = b.collapsible ? Math.min(COLLAPSE_SLACK, b.min * 0.5) : 0;

    const lo = overflow ? EDGE : Math.max(0, a.min - slackA, pair - b.max);
    const hi = overflow ? Math.max(EDGE + 1, pair - EDGE) : Math.min(a.max, pair - b.min + slackB);

    const delta = pointOf(e) - drag.start;
    const want = clamp(drag.base[k] + delta, Math.min(lo, hi), Math.max(lo, hi));

    drag.want = want;
    sizes[k] = want;
    sizes[k + 1] = Math.max(0, pair - want);

    apply();
    syncMetric(k);
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { k, want, base } = drag;
    releaseDrag(e.pointerId);
    drag = null;

    const a = specs[k];
    const b = specs[k + 1];
    const pair = base[k] + base[k + 1];

    // 拖过 min 才收起。放在松手时判定：拖到一半折叠会让其余栏在指针下跳一下。
    if (a.collapsible && want != null && want < a.min - 2) {
      collapse(a.id);
      syncMetric(k);
      return;
    }
    if (b.collapsible && want != null && pair - want < b.min - 2) {
      collapse(b.id);
      syncMetric(k);
      return;
    }

    relayout(); // 收尾：把像素总和重新对齐容器（浏览器滚动条等因素会带来 1px 误差）
    pinAround(k); // 拖过就按绝对像素记住，窗口缩放时不再回到默认比例
    syncMetric(k);
    emit(k);
    persist();
  }

  function releaseDrag(pointerId) {
    const k = drag?.k;
    if (k != null && sepEls[k]) {
      delete sepEls[k].dataset.active;
      try {
        sepEls[k].releasePointerCapture(pointerId);
      } catch {}
    }
    for (const sep of sepEls) delete sep.dataset.active;
    if (holdingCursor) {
      delete document.documentElement.dataset.resizing;
      holdingCursor = false;
    }
  }

  /* ---------------- 键盘 ---------------- */

  function onKeyDown(e, k) {
    // 中文输入法组合期不改尺寸
    if (e.isComposing || e.keyCode === 229) return;

    const back = vertical ? 'ArrowUp' : 'ArrowLeft';
    const fwd = vertical ? 'ArrowDown' : 'ArrowRight';
    let delta = 0;
    let jump = '';

    if (e.key === back) delta = -STEP;
    else if (e.key === fwd) delta = STEP;
    else if (e.key === 'Home') jump = 'min';
    else if (e.key === 'End') jump = 'max';
    else return;

    e.preventDefault();
    e.stopPropagation();

    // 隔壁收起了就先打开，否则方向键只会在一条 0 宽的分隔条上「挪动空气」
    if (collapsed.has(specs[k].id)) expand(specs[k].id);
    if (collapsed.has(specs[k + 1].id)) expand(specs[k + 1].id);

    const { pair, lo, hi } = pairBounds(k);
    const floor = Math.min(lo, hi);
    const ceil = Math.max(lo, hi);
    const base = sizes[k];
    const want = jump === 'min' ? floor : jump === 'max' ? ceil : clamp(base + delta, floor, ceil);

    sizes[k] = want;
    sizes[k + 1] = Math.max(0, pair - want);
    apply();
    syncMetric(k);
    rememberRatios(openIndexes());
    pinAround(k);
    emit(k);
    persist();
  }

  /** 双击复位：恢复到构造时给的比例，并把折叠全部打开 */
  function reset() {
    if (disposed || n === 0) return;
    collapsed.clear();
    lastSize.clear();
    pinned.clear();
    for (let i = 0; i < n; i++) ratios[i] = initialRatios[i] ?? 1 / Math.max(1, n);
    relayout({ fromContainer: true });
    for (let k = 0; k < n - 1; k++) syncMetric(k);
    emit(0);
    persist();
  }

  /* ---------------- 容器尺寸 ---------------- */

  let lastExtent = 0;
  let syncedOnce = false;

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (disposed) return;
      const next = extent();
      if (Math.abs(next - lastExtent) < 0.5) return;
      lastExtent = next;
      relayout({ fromContainer: true });
    });
    ro.observe(el);
    disposer.observe(ro);
  } else {
    // 老环境兜底：没有 RO 就退回窗口 resize，至少窗口变化时能重算
    disposer.on(window, 'resize', () => {
      const next = extent();
      if (Math.abs(next - lastExtent) < 0.5) return;
      lastExtent = next;
      relayout({ fromContainer: true });
    });
  }

  /* ---------------- 对外接口 ---------------- */

  apply();

  el.sizes = () => sizes.map((v) => Math.round(v * 100) / 100);
  el.setSizes = (next) => {
    if (disposed || !Array.isArray(next) || !next.length) return;
    const avail = available();
    for (let i = 0; i < n; i++) {
      const dim = parseDim(next[i]);
      if (!dim) continue;
      if (dim.ratio != null) {
        sizes[i] = dim.ratio * (avail || extent() || 640);
        pinned.delete(specs[i].id);
      } else {
        sizes[i] = Math.max(0, dim.px);
        // 显式给了像素就等于「我要这个宽度」，后续容器变化别按比例冲掉它
        pinned.add(specs[i].id);
      }
    }
    relayout();
    persist();
  };
  el.pane = (id) => {
    const i = indexOf(id);
    return i < 0 ? null : paneEls[i];
  };
  el.collapse = (id) => collapse(id);
  el.expand = (id) => expand(id);
  el.isCollapsed = (id) => collapsed.has(id);

  /**
   * 布局快照。sizes 是像素（折叠栏为 0），collapsed 是栏 id 数组。
   * 这是「用户意图」而不是「容器此刻的宽度」，所以换窗口后再 restore
   * 仍然会过一次 min/max 求解，不会把旧布局硬塞回去。
   */
  el.serialize = () => ({
    sizes: sizes.map((v) => Math.round(v * 100) / 100),
    collapsed: specs.filter((s) => collapsed.has(s.id)).map((s) => s.id),
  });

  /**
   * 还原 serialize() 的结果。坏数据一律忽略（未知 id、不可折叠的栏、
   * 长度不够的 sizes 都跳过），返回是否吃到了有效状态。
   */
  el.restore = (state) => {
    if (disposed || !state || typeof state !== 'object') return false;
    let applied = false;
    const list = Array.isArray(state.sizes) ? state.sizes : [];
    for (let i = 0; i < n; i += 1) {
      const px = Number(list[i]);
      if (!Number.isFinite(px) || px < 0) continue;
      sizes[i] = px;
      applied = true;
    }

    collapsed.clear();
    lastSize.clear();
    if (Array.isArray(state.collapsed)) {
      for (const id of state.collapsed) {
        const i = indexOf(id);
        if (i < 0 || !specs[i].collapsible) continue;
        collapsed.add(id);
        // 折叠栏的 sizes 存的是 0，展开时要还回一个合理值
        lastSize.set(id, Math.max(specs[i].min, sizes[i] || 0));
        sizes[i] = 0;
        applied = true;
      }
    }
    if (!applied) return false;

    // 还没进文档时 extent 为 0，relayout 只能先把状态落到 DOM 上；
    // 比例要在这里先记一次，否则 ResizeObserver 第一次回调会按构造初值重算，
    // 存下来的尺寸等于白读。
    rememberRatios(openIndexes());
    relayout();
    for (let k = 0; k < n - 1; k += 1) syncMetric(k);
    return true;
  };

  let disposedOnce = false;
  /** 幂等：断开观察者、结束手势；不摘自己的 DOM（是否移除由调用方决定） */
  el.dispose = () => {
    if (disposedOnce) return;
    disposedOnce = true;
    disposed = true;
    if (drag) releaseDrag(drag.id);
    drag = null;
    disposer.dispose();
    if (holdingCursor) {
      delete document.documentElement.dataset.resizing;
      holdingCursor = false;
    }
  };
  el.destroy = () => {
    el.dispose();
    el.remove();
  };

  // 只在给了 persistKey 时读盘；坏数据、读不到都按构造参数走
  const savedState = readPersisted();
  if (savedState) el.restore(savedState);

  return el;
}
