// Golden Gate · panels/status-bar
import { h, clamp } from '../../core/dom.js';
import { icon, iconEl } from '../../core/icons.js';
import { createDisposer } from '../_shared/disposer.js';
import { openPopover } from '../overlays/popover.js';

/* ==========================================================================
   60. 状态栏 StatusBar

   为什么需要它：耗时操作需要一个「看得见、能取消、能重试」的常驻位置。
   塞进 toast 是错的 —— toast 会消失，失败之后无处回看；塞进对话框又太重，
   用户只是导出一个文件，不该被拦一次。系统原型是窗口底部的状态栏
   （Xcode 的构建进度、下载管理器、iTunes 的同步条）：左边只读状态，
   右边任务，任务用 { phase, progress, cancel, retry } 描述。

   三条边界：
   ① 组件不改任务状态。取消/重试只把 (id, type) 报给 onTaskAction，
      真相在应用那边 —— 组件也存一份就会出现「按钮说已取消、数据说还在跑」。
   ② 没有 progress 就不画百分比。不确定进度只给扫光条，绝不拿假数字凑。
   ③ 0 个任务时任务区不占位；items 与 tasks 都为空时整条栏 hidden，
      不留一条空栏长期压在窗口底部。

   朗读节流：可见文本本身不进 live region（否则每次进度刷新都念一遍），
   另有一个视觉隐藏的 role=status 节点。phase 变化立即播报，
   同一任务的进度最多每 1 秒一次。
   ========================================================================== */

const NARROW_W = 560; // 低于这个宽度：items 只留前两项，其余进「…」
const READ_THROTTLE = 1000; // 同一任务的进度朗读间隔
const LEAVE_MS = 320; // 成功项淡出时长，和 --dur-3 对齐

const PHASES = {
  queued: { dot: true, icon: '', text: '等待中' },
  running: { dot: true, icon: '', text: '' },
  paused: { dot: false, icon: 'pause', text: '已暂停' },
  success: { dot: false, icon: 'circle-check', text: '完成' },
  error: { dot: false, icon: 'triangle-alert', text: '失败' },
  cancelled: { dot: false, icon: 'ban', text: '已取消' },
};

const ACTION_LABEL = { cancel: '取消', retry: '重试' };
const ACTION_ICON = { cancel: 'x', retry: 'refresh-cw' };

const normalizeItem = (raw, i) => ({
  id: raw?.id ?? `item-${i + 1}`,
  label: String(raw?.label ?? ''),
  value: raw?.value ?? null,
  icon: raw?.icon || '',
  align: raw?.align === 'end' ? 'end' : 'start',
});

const normalizeTask = (raw, i) => {
  const phase = PHASES[raw?.phase] ? raw.phase : 'queued';
  let progress = raw?.progress;
  if (progress === '' || progress === null || progress === undefined) progress = null;
  else progress = Number(progress);
  if (progress !== null && !Number.isFinite(progress)) progress = null;
  return {
    id: raw?.id ?? `task-${i + 1}`,
    label: String(raw?.label ?? ''),
    phase,
    progress,
    detail: raw?.detail ?? '',
    tone: raw?.tone || '',
    cancel: Boolean(raw?.cancel),
    retry: Boolean(raw?.retry),
  };
};

const phaseInfo = (task) => {
  const key = PHASES[task.phase] ? task.phase : 'queued';
  return { phase: key, ...PHASES[key] };
};

const pctOf = (task) =>
  task.progress == null ? null : Math.round(clamp(task.progress, 0, 1) * 100);

export function StatusBar({
  items: initialItems = [],
  tasks: initialTasks = [],
  label = '状态栏',
  compact = false,
  linger = 5000,
  onTaskAction,
  className = '',
} = {}) {
  const disposer = createDisposer();
  let items = (Array.isArray(initialItems) ? initialItems : []).map(normalizeItem);
  let tasks = (Array.isArray(initialTasks) ? initialTasks : []).map(normalizeTask);

  let disposed = false;
  let disposedOnce = false;
  let narrow = false;
  let lastLive = '';

  /** 已淡出、不再占位的成功任务（数据仍保留在 tasks 里） */
  const lingered = new Set();
  /** 正在淡出的任务 */
  const leaving = new Set();
  /** id -> 取消句柄 */
  const lingerTimers = new Map();
  /** id -> { phase, pct, ts }：朗读节流账本 */
  const announced = new Map();

  let taskPopover = null;
  let itemsPopover = null;

  /* ---------------- 骨架（可复用节点） ---------------- */

  const root = h('div', {
    class: ['c-statusbar', className].filter(Boolean).join(' '),
    role: 'region',
    'aria-label': label,
  });
  if (compact) root.dataset.compact = '1';
  if (onTaskAction) root.dataset.interactive = '1';

  const itemsStart = h('div', { class: 'c-statusbar__items-start' });
  const itemsEnd = h('div', { class: 'c-statusbar__items-end' });
  const itemsBox = h('div', { class: 'c-statusbar__items' }, itemsStart, itemsEnd);
  const tasksBox = h('div', { class: 'c-statusbar__tasks' });

  // 这两颗按钮跨重绘复用：浮层的锚点必须一直连在 DOM 上，
  // 每次重绘换一颗新按钮会让定位器判定「锚点没了」并顺手收起浮层。
  const overflowBtn = h(
    'button',
    {
      class: 'c-statusbar__overflow',
      type: 'button',
      'aria-label': '其余状态',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    },
    h('span', { class: 'c-statusbar__overflow-icon', 'aria-hidden': 'true', html: icon('more', 14) })
  );

  const moreLabel = h('span', { class: 'c-statusbar__more-label' });
  const moreShort = h('span', { class: 'c-statusbar__more-short', 'aria-hidden': 'true' });
  const moreBtn = h(
    'button',
    {
      class: 'c-statusbar__more',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    },
    moreLabel,
    moreShort,
    h('span', { class: 'c-statusbar__more-caret', 'aria-hidden': 'true', html: icon('chevron-up', 12) })
  );

  const live = h('span', {
    class: 'c-statusbar__live',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });

  root.append(itemsBox, tasksBox, live);

  /* ---------------- 朗读 ---------------- */

  const say = (text) => {
    if (!text || text === lastLive) return;
    lastLive = text;
    live.textContent = text;
  };

  const liveTextOf = (task) => {
    const info = phaseInfo(task);
    const pct = pctOf(task);
    if (info.phase === 'running') {
      return pct == null ? `${task.label} 进行中` : `${task.label} ${pct}%`;
    }
    return `${task.label} ${info.text}`.trim();
  };

  /** 节流：phase 变了立刻读；同一任务进度最多 1 秒一次 */
  const announce = () => {
    const now = Date.now();
    // 任务被移除后账本条目要一起清掉，否则长驻状态栏里会一直攒
    if (announced.size > tasks.length) {
      const alive = new Set(tasks.map((t) => t.id));
      for (const id of [...announced.keys()]) if (!alive.has(id)) announced.delete(id);
    }
    for (const task of tasks) {
      const info = phaseInfo(task);
      const pct = pctOf(task);
      const prev = announced.get(task.id);
      if (!prev || prev.phase !== info.phase) {
        say(liveTextOf(task));
        announced.set(task.id, { phase: info.phase, pct, ts: now });
        continue;
      }
      if (pct == null) {
        prev.pct = null;
        continue;
      }
      if (pct !== prev.pct && now - prev.ts >= READ_THROTTLE) {
        say(liveTextOf(task));
        prev.ts = now;
      }
      prev.pct = pct;
    }
  };

  /* ---------------- 小部件 ---------------- */

  const actionsNode = (task) => {
    if (!task.cancel && !task.retry) return null;
    const buttons = [];
    for (const type of ['cancel', 'retry']) {
      if (!task[type]) continue;
      buttons.push(
        h(
          'button',
          {
            class: 'c-statusbar__action',
            type: 'button',
            dataset: { action: type, id: task.id },
            title: `${ACTION_LABEL[type]}${task.label}`,
            'aria-label': `${ACTION_LABEL[type]}${task.label}`,
            // 只上报，不改自己的状态：应用负责改数据，再通过 setTask 回来
            onclick: (e) => {
              e.stopPropagation();
              onTaskAction?.(task.id, type);
            },
          },
          iconEl(ACTION_ICON[type], 12),
          h('span', { class: 'c-statusbar__action-label' }, ACTION_LABEL[type])
        )
      );
    }
    return h('span', { class: 'c-statusbar__actions' }, ...buttons);
  };

  const phaseMarker = (info) =>
    h('span', {
      class: 'c-statusbar__phase',
      'aria-hidden': 'true',
      html: info.dot ? '<span class="c-statusbar__dot"></span>' : icon(info.icon, 13),
    });

  const progressNode = (task) => {
    const pct = pctOf(task);
    const bar = h('span', { class: 'c-statusbar__progress-fill' });
    if (pct != null) bar.style.width = `${pct}%`;
    const props = {
      class: 'c-statusbar__progress',
      role: 'progressbar',
      'aria-label': `${task.label} 进度`,
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': pct == null ? null : String(pct),
      'aria-valuetext': pct == null ? '进行中' : null,
    };
    if (pct == null) props.dataset = { indeterminate: '1' };
    return h('span', props, bar);
  };

  const taskDataset = (task, info) => {
    const dataset = { id: task.id, phase: info.phase };
    if (task.tone) dataset.tone = task.tone;
    if (leaving.has(task.id)) dataset.leaving = '1';
    return dataset;
  };

  /** 单条任务（状态栏里直接显示的那一条） */
  const taskNode = (task) => {
    const info = phaseInfo(task);
    const pct = pctOf(task);
    const showBar = pct != null || info.phase === 'running';
    return h(
      'div',
      { class: 'c-statusbar__task', dataset: taskDataset(task, info) },
      phaseMarker(info),
      h('span', { class: 'c-statusbar__task-label', title: task.label }, task.label),
      showBar ? progressNode(task) : null,
      pct != null ? h('span', { class: 'c-statusbar__pct' }, `${pct}%`) : null,
      info.text ? h('span', { class: 'c-statusbar__note' }, info.text) : null,
      task.detail ? h('span', { class: 'c-statusbar__detail' }, task.detail) : null,
      actionsNode(task)
    );
  };

  /** 列表里的一行（浮层内，两行排版） */
  const rowNode = (task, refs) => {
    const info = phaseInfo(task);
    const pct = pctOf(task);
    const showBar = pct != null || info.phase === 'running';
    const pctEl = pct != null ? h('span', { class: 'c-statusbar__pct' }, `${pct}%`) : null;
    refs?.set(task.id, { bar: null, pct: pctEl });
    const node = h(
      'div',
      { class: 'c-statusbar__row', role: 'listitem', dataset: taskDataset(task, info) },
      phaseMarker(info),
      h(
        'div',
        { class: 'c-statusbar__row-main' },
        h(
          'div',
          { class: 'c-statusbar__row-top' },
          h('span', { class: 'c-statusbar__task-label', title: task.label }, task.label),
          pctEl
        ),
        h(
          'div',
          { class: 'c-statusbar__row-sub' },
          showBar ? progressNode(task) : null,
          info.text ? h('span', { class: 'c-statusbar__note' }, info.text) : null,
          task.detail ? h('span', { class: 'c-statusbar__detail' }, task.detail) : null
        )
      ),
      actionsNode(task)
    );
    if (refs && showBar) refs.get(task.id).bar = node.querySelector('.c-statusbar__progress');
    return node;
  };

  const itemNode = (item) =>
    h(
      'div',
      { class: 'c-statusbar__item', dataset: { id: item.id, align: item.align } },
      item.icon
        ? h('span', { class: 'c-statusbar__item-icon', 'aria-hidden': 'true', html: icon(item.icon, 12) })
        : null,
      item.label ? h('span', { class: 'c-statusbar__item-label' }, item.label) : null,
      item.value != null && item.value !== ''
        ? h('span', { class: 'c-statusbar__item-value' }, String(item.value))
        : null
    );

  /* ---------------- 浮层 ---------------- */

  const closeTaskPopover = () => {
    if (taskPopover && taskPopover.ctl.el?.isConnected) taskPopover.ctl.close();
    taskPopover = null;
    moreBtn.setAttribute('aria-expanded', 'false');
  };

  const closeItemsPopover = () => {
    if (itemsPopover && itemsPopover.ctl.el?.isConnected) itemsPopover.ctl.close();
    itemsPopover = null;
    overflowBtn.setAttribute('aria-expanded', 'false');
  };

  const visibleTaskList = () => tasks.filter((t) => !lingered.has(t.id));

  const taskSignature = () =>
    visibleTaskList()
      .map((t) => `${t.id}|${t.phase}|${t.label}|${t.detail}|${t.tone}|${t.cancel}|${t.retry}`)
      .join('~');

  const pctPair = (id) => {
    const task = tasks.find((t) => t.id === id);
    return task ? pctOf(task) : null;
  };

  const fillTaskList = () => {
    if (!taskPopover) return;
    const list = visibleTaskList();
    taskPopover.title.textContent = `任务 · ${list.length} 项`;
    const refs = new Map();
    taskPopover.body.replaceChildren(...list.map((t) => rowNode(t, refs)));
    taskPopover.refs = refs;
    taskPopover.signature = taskSignature();
  };

  /** 进度条在浮层里就地更新；结构（增删/换 phase）变了才重建，避免焦点被重绘吃掉 */
  const syncTaskPopover = () => {
    if (!taskPopover) return;
    if (!taskPopover.ctl.el?.isConnected) {
      taskPopover = null;
      moreBtn.setAttribute('aria-expanded', 'false');
      return;
    }
    if (visibleTaskList().length <= 1) {
      closeTaskPopover();
      return;
    }
    if (taskPopover.signature !== taskSignature()) {
      fillTaskList();
      return;
    }
    for (const [id, ref] of taskPopover.refs) {
      const pct = pctPair(id);
      if (pct == null) continue;
      if (ref.bar) ref.bar.querySelector('.c-statusbar__progress-fill').style.width = `${pct}%`;
      if (ref.pct) ref.pct.textContent = `${pct}%`;
    }
  };

  const openTaskList = () => {
    if (taskPopover) {
      closeTaskPopover();
      return;
    }
    closeItemsPopover();
    const list = visibleTaskList();
    if (list.length <= 1) return;

    const title = h('div', { class: 'c-statusbar__panel-title' });
    const body = h('div', { class: 'c-statusbar__list', role: 'list' });
    const panel = h('div', { class: 'c-statusbar__panel' }, title, body);

    const ctl = openPopover({
      anchor: moreBtn,
      content: panel,
      placement: 'top',
      align: 'end',
      width: 300,
      label: '任务列表',
      focus: 'self',
      onClose: () => {
        if (taskPopover?.ctl === ctl) taskPopover = null;
        moreBtn.setAttribute('aria-expanded', 'false');
      },
    });

    taskPopover = { ctl, title, body, refs: new Map(), signature: '' };
    fillTaskList();
    moreBtn.setAttribute('aria-expanded', 'true');
  };

  const openItemsMenu = () => {
    if (itemsPopover) {
      closeItemsPopover();
      return;
    }
    closeTaskPopover();
    const hidden = hiddenItems();
    if (!hidden.length) return;

    const panel = h(
      'div',
      { class: 'c-statusbar__panel' },
      h('div', { class: 'c-statusbar__panel-title' }, `其余状态 · ${hidden.length} 项`),
      h(
        'div',
        { class: 'c-statusbar__list', role: 'list' },
        ...hidden.map((item) =>
          h(
            'div',
            { class: 'c-statusbar__info-row', role: 'listitem' },
            item.icon
              ? h('span', {
                  class: 'c-statusbar__item-icon',
                  'aria-hidden': 'true',
                  html: icon(item.icon, 12),
                })
              : null,
            h('span', { class: 'c-statusbar__item-label' }, item.label),
            item.value != null && item.value !== ''
              ? h('span', { class: 'c-statusbar__item-value' }, String(item.value))
              : null
          )
        )
      )
    );

    const ctl = openPopover({
      anchor: overflowBtn,
      content: panel,
      placement: 'top',
      align: 'end',
      width: 240,
      label: '其余状态',
      focus: 'self',
      onClose: () => {
        if (itemsPopover?.ctl === ctl) itemsPopover = null;
        overflowBtn.setAttribute('aria-expanded', 'false');
      },
    });
    itemsPopover = { ctl };
    overflowBtn.setAttribute('aria-expanded', 'true');
  };

  /* ---------------- 窄容器降级 ---------------- */

  const hiddenItems = () => {
    if (!narrow) return [];
    const start = items.filter((i) => i.align === 'start');
    return [...start.slice(2), ...items.filter((i) => i.align === 'end')];
  };

  /* ---------------- 渲染 ---------------- */

  const pickCurrent = (list) => {
    const order = ['running', 'paused', 'queued'];
    for (const phase of order) {
      const hit = list.find((t) => t.phase === phase);
      if (hit) return hit;
    }
    return list[0] ?? null;
  };

  const scheduleLinger = () => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const [id, off] of [...lingerTimers]) {
      const task = byId.get(id);
      if (!task || task.phase !== 'success') {
        off();
        lingerTimers.delete(id);
      }
    }
    for (const id of [...lingered]) if (!byId.has(id)) lingered.delete(id);

    for (const task of tasks) {
      if (task.phase !== 'success') {
        lingered.delete(task.id);
        continue;
      }
      if (lingered.has(task.id) || leaving.has(task.id) || lingerTimers.has(task.id)) continue;
      const off = disposer.timeout(() => {
        lingerTimers.delete(task.id);
        if (disposed) return;
        leaving.add(task.id);
        // 先给已经在场的节点挂上淡出标记，才能真的过渡；随后再摘除
        const row = [...tasksBox.querySelectorAll('[data-id]')].find(
          (n) => n.dataset.id === task.id
        );
        if (row) row.dataset.leaving = '1';
        const node = [...(taskPopover?.body?.querySelectorAll('[data-id]') ?? [])].find(
          (n) => n.dataset.id === task.id
        );
        if (node) node.dataset.leaving = '1';
        disposer.timeout(() => {
          leaving.delete(task.id);
          lingered.add(task.id);
          paint();
        }, LEAVE_MS);
      }, Math.max(0, Number(linger) || 0));
      lingerTimers.set(task.id, off);
    }
  };

  const paint = () => {
    if (disposed) return;

    /* items */
    const startItems = items.filter((i) => i.align === 'start');
    const endItems = items.filter((i) => i.align === 'end');
    const keptStart = narrow ? startItems.slice(0, 2) : startItems;
    const keptEnd = narrow ? [] : endItems;
    const spare = hiddenItems();

    itemsStart.replaceChildren(...keptStart.map(itemNode));
    const endChildren = keptEnd.map(itemNode);
    if (spare.length) endChildren.push(overflowBtn);
    itemsEnd.replaceChildren(...endChildren);

    itemsStart.hidden = !keptStart.length;
    itemsEnd.hidden = !endChildren.length;
    itemsBox.hidden = !keptStart.length && !endChildren.length;
    overflowBtn.hidden = !spare.length;
    if (spare.length) {
      overflowBtn.setAttribute('aria-label', `其余 ${spare.length} 项状态`);
    }

    /* tasks */
    const list = visibleTaskList();
    const current = pickCurrent(list);
    const rest = current ? list.filter((t) => t !== current) : [];
    if (current) {
      tasksBox.replaceChildren(taskNode(current));
      if (rest.length) {
        moreLabel.textContent = `还有 ${rest.length} 项`;
        moreShort.textContent = `+${rest.length}`;
        moreBtn.setAttribute(
          'aria-label',
          `还有 ${rest.length} 项任务，展开任务列表`
        );
        tasksBox.append(moreBtn);
        moreBtn.hidden = false;
      } else {
        moreBtn.hidden = true;
        moreBtn.setAttribute('aria-expanded', 'false');
      }
    } else {
      tasksBox.replaceChildren();
      moreBtn.hidden = true;
    }
    tasksBox.hidden = !current;

    /* 空态：整条栏都不占位 */
    root.hidden = !current && !keptStart.length && !endChildren.length;

    /* 成功项 5 秒后淡出 */
    scheduleLinger();

    /* 浮层内容跟上数据 */
    syncTaskPopover();
    if (itemsPopover && !itemsPopover.ctl.el?.isConnected) itemsPopover = null;

    announce();
  };

  /* ---------------- 对外接口 ---------------- */

  const refreshNarrow = () => {
    if (disposed) return;
    const w = root.clientWidth;
    // 隐藏时 clientWidth 为 0：保持上一次判断，避免显示瞬间闪一次宽版布局
    if (!w) return;
    const next = w < NARROW_W;
    if (next === narrow) return;
    narrow = next;
    if (narrow) root.dataset.narrow = '1';
    else delete root.dataset.narrow;
    paint();
  };

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(refreshNarrow);
    ro.observe(root);
    disposer.observe(ro);
  } else {
    disposer.on(window, 'resize', refreshNarrow);
  }

  disposer.on(moreBtn, 'click', () => {
    if (moreBtn.hidden) return;
    openTaskList();
  });
  disposer.on(overflowBtn, 'click', () => {
    if (overflowBtn.hidden) return;
    openItemsMenu();
  });

  root.setItems = (list) => {
    if (disposed) return root;
    items = (Array.isArray(list) ? list : []).map(normalizeItem);
    paint();
    return root;
  };

  root.setTasks = (list) => {
    if (disposed) return root;
    tasks = (Array.isArray(list) ? list : []).map(normalizeTask);
    paint();
    return root;
  };

  root.setTask = (id, patch = {}) => {
    if (disposed) return root;
    const i = tasks.findIndex((t) => t.id === id);
    if (i < 0) return root; // 未知 id：忽略，不凭空造一条任务
    tasks[i] = normalizeTask({ ...tasks[i], ...patch }, i);
    paint();
    return root;
  };

  root.set = ({ items: nextItems, tasks: nextTasks } = {}) => {
    if (disposed) return root;
    if (Array.isArray(nextItems)) items = nextItems.map(normalizeItem);
    if (Array.isArray(nextTasks)) tasks = nextTasks.map(normalizeTask);
    paint();
    return root;
  };

  root.value = () => ({
    items: items.map((i) => ({ ...i })),
    tasks: tasks.map((t) => ({ ...t })),
  });

  /** 幂等：只释放资源（观察者、计时器、浮层），不摘自己的 DOM */
  root.dispose = () => {
    if (disposedOnce) return;
    disposedOnce = true;
    disposed = true;
    closeTaskPopover();
    closeItemsPopover();
    lingerTimers.clear();
    disposer.dispose();
  };

  paint();
  refreshNarrow();
  return root;
}
