// Golden Gate · forms/date-picker
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { createDisposer } from '../_shared/disposer.js';
import { applyControlState } from '../_shared/control.js';
import { openLayer, positionLayer } from '../_shared/overlay.js';

/* ==========================================================================
   DatePicker

   纯日期只有年月日三个整数。内部一律用 {y, m, d} + 字符串拼接，
   不做「日期 → Date → 本地时间」的往返：`new Date('2026-11-06')` 按 UTC
   解析、再按本地时区读回，负偏移时区会掉到 11 月 5 日，这类前移一天的错误
   在日期控件里最难查。只有两件事借 Date.UTC：
     1) 算星期几（getUTCDay）
     2) 取月份天数 / 交给 Intl 做本地化名称（timeZone:'UTC'）

   面板不是模态：不隔离背景、不 trap Tab，Esc 与外部点击交给层栈统一处理，
   所以我们自己只处理「已消费的键」，其余键放行给层栈。
   ========================================================================== */

const pad2 = (n) => String(n).padStart(2, '0');
const mod = (n, m) => ((n % m) + m) % m;

/** 纯整数取月长：Date.UTC(y, m, 0) 是「下个月第 0 天」，不参与展示 */
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parseYmd(input) {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input ?? '').trim());
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

const toYmd = ({ y, m, d }) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;

function normalizeYmd(input) {
  const parsed = parseYmd(input);
  return parsed ? toYmd(parsed) : '';
}

/**
 * 手输可接受的写法。语义等价，只是分隔符与补零不同：
 *   2026-11-06 · 2026/11/6 · 20261106
 * 解析完统一升成 toYmd() 的规范串，绝不保留用户输入的分隔符。
 */
function parseTypedDate(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const hit = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text) || /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** 逐日推进；只做整数进位，不碰时区 */
function addDays({ y, m, d }, delta) {
  let yy = y;
  let mm = m;
  let dd = d + delta;
  while (dd > daysInMonth(yy, mm)) {
    dd -= daysInMonth(yy, mm);
    mm += 1;
    if (mm > 12) {
      mm = 1;
      yy += 1;
    }
  }
  while (dd < 1) {
    mm -= 1;
    if (mm < 1) {
      mm = 12;
      yy -= 1;
    }
    dd += daysInMonth(yy, mm);
  }
  return { y: yy, m: mm, d: dd };
}

/** 跨月时把日夹到目标月长度，1 月 31 日 + 1 月 → 2 月 28/29 日 */
function addMonths({ y, m, d }, delta) {
  const total = y * 12 + (m - 1) + delta;
  const yy = Math.floor(total / 12);
  const mm = mod(total, 12) + 1;
  return { y: yy, m: mm, d: Math.min(d, daysInMonth(yy, mm)) };
}

const weekdayOf = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const monthKey = (y, m) => `${String(y).padStart(4, '0')}-${pad2(m)}`;

/* Intl 实例很贵，按 locale + 选项缓存；timeZone 固定 UTC，避免再走本地时区 */
const dtfCache = new Map();
function dtf(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let fmt = dtfCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
    dtfCache.set(key, fmt);
  }
  return fmt;
}
const utcDate = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d));

function formatDay(day, locale) {
  return dtf(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(utcDate(day));
}
function formatMonth(y, m, locale) {
  return dtf(locale, { year: 'numeric', month: 'long' }).format(new Date(Date.UTC(y, m - 1, 1)));
}
function formatYear(y, locale) {
  return dtf(locale, { year: 'numeric' }).format(new Date(Date.UTC(y, 0, 1)));
}

export function DatePicker({
  value = '',
  min = '',
  max = '',
  locale = 'zh-CN',
  mode = 'date',
  weekStart = 1,
  placeholder = '选择日期',
  label = '',
  disabledDate,
  clearable = false,
  editable = true,
  onChange,
  className = '',
} = {}) {
  const ws = weekStart === 0 ? 0 : 1;
  const initialMode = mode === 'month' || mode === 'year' ? mode : 'date';

  let current = normalizeYmd(value);
  let minStr = normalizeYmd(min);
  let maxStr = normalizeYmd(max);
  let viewMode = initialMode;
  let view = { y: 2000, m: 1 };
  let focus = { y: 2000, m: 1, d: 1 };
  /** 当前视图里可聚焦的格子：key -> { el, day } */
  let cells = new Map();
  let panel = null;
  let body = null;
  let titleEl = null;
  let prevBtn = null;
  let nextBtn = null;
  let layer = null;
  let pos = null;
  let openDisposer = null;
  let disabled = false;
  let disposed = false;
  let composing = false;
  let flashOff = null;

  /* ---------------- 触发器 ----------------
     editable（默认）时刻的是真 input：日历按钮只负责开面板，输入框自己解析文本。
     不能把 input 塞进 <button>（按钮里嵌可编辑控件既是无效 HTML，也会让点击
     永远落到按钮上），所以两种形态的根节点一个是 div、一个是 button。 */

  const valueEl = editable ? null : h('span', { class: 'c-datepicker__value' }, placeholder);

  const inputEl = editable
    ? h('input', {
        class: 'c-datepicker__input',
        type: 'text',
        inputmode: 'numeric',
        autocomplete: 'off',
        spellcheck: 'false',
        // 默认占位直接写契约格式：用户不用猜该打什么
        placeholder: placeholder === '选择日期' ? 'YYYY-MM-DD' : placeholder,
        'aria-label': label || '日期',
      })
    : null;

  const toggleBtn = h(
    'button',
    {
      class: 'c-datepicker__toggle',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-label': '选择日期',
    },
    h('span', { class: 'c-datepicker__icon', html: icon('calendar-range', 14) })
  );

  const trigger = editable
    ? h('div', { class: 'c-datepicker__trigger c-datepicker__trigger--editable c-btn' }, inputEl, toggleBtn)
    : h(
        'button',
        {
          class: 'c-datepicker__trigger c-btn',
          type: 'button',
          'aria-haspopup': 'dialog',
          'aria-expanded': 'false',
          'aria-label': label || null,
        },
        valueEl,
        h('span', { class: 'c-datepicker__icon', html: icon('calendar-range', 14) })
      );

  /** 面板展开状态写在这个节点上：两种形态的「打开按钮」不是同一个元素 */
  const opener = editable ? toggleBtn : trigger;

  const el = h('div', { class: `c-datepicker ${className}`.trim() }, trigger);

  const syncTrigger = () => {
    if (current) el.removeAttribute('data-empty');
    else el.setAttribute('data-empty', 'true');

    if (editable) {
      // 编辑态显示契约格式（YYYY-MM-DD）：本地化的「2026年11月6日」改起来
      // 没法对齐光标，看起来也不像能输入的东西
      inputEl.value = current;
      return;
    }
    const parsed = parseYmd(current);
    valueEl.textContent = parsed ? formatDay(parsed, locale) : placeholder;
  };

  /** 关闭面板后焦点该回到哪：编辑态是输入框，只读态是整个按钮 */
  const focusBack = () => {
    if (editable) inputEl.focus({ preventScroll: true });
    else trigger.focus({ preventScroll: true });
  };

  const todayParts = () => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  };

  const enabledAt = (day) => {
    const key = toYmd(day);
    if (minStr && key < minStr) return false;
    if (maxStr && key > maxStr) return false;
    if (disabledDate?.(key)) return false;
    return true;
  };

  /** 某个月里还剩下的可选日区间；lo > hi 表示整月不可选 */
  const rangeOfMonth = (y, m) => {
    const dim = daysInMonth(y, m);
    const mk = monthKey(y, m);
    let lo = 1;
    let hi = dim;
    if (minStr) {
      const k = minStr.slice(0, 7);
      if (mk < k) return { lo: 1, hi: 0 };
      if (mk === k) lo = Math.max(lo, Number(minStr.slice(8, 10)));
    }
    if (maxStr) {
      const k = maxStr.slice(0, 7);
      if (mk > k) return { lo: 1, hi: 0 };
      if (mk === k) hi = Math.min(hi, Number(maxStr.slice(8, 10)));
    }
    return { lo, hi };
  };

  const firstEnabledInMonth = (y, m) => {
    const { lo, hi } = rangeOfMonth(y, m);
    const last = Math.min(hi, daysInMonth(y, m));
    for (let d = Math.max(1, lo); d <= last; d += 1) {
      const day = { y, m, d };
      if (enabledAt(day)) return day;
    }
    return null;
  };

  /* 整月 / 整年 / 整块没有一天可选时，导航按钮必须禁用。
     只在日网格里划线是不够的：用户会一直点「下个月」，翻过一屏全灰的月份
     才意识到根本到不了那里。 */
  const monthAllDisabled = (y, m) => firstEnabledInMonth(y, m) === null;

  const yearAllDisabled = (y) => {
    for (let m = 1; m <= 12; m += 1) {
      if (!monthAllDisabled(y, m)) return false;
    }
    return true;
  };

  const blockStart = (y) => y - mod(y, 12);

  /** 往 dir 方向翻一步还有没有可选日；render 用它决定导航按钮的禁用态 */
  const canShift = (dir) => {
    if (viewMode === 'date') {
      const t = addMonths({ y: view.y, m: view.m, d: 1 }, dir);
      return !monthAllDisabled(t.y, t.m);
    }
    if (viewMode === 'month') return !yearAllDisabled(view.y + dir);
    const first = blockStart(view.y) + dir * 12;
    for (let i = 0; i < 12; i += 1) {
      if (!yearAllDisabled(first + i)) return true;
    }
    return false;
  };

  /* ---------------- 打开 / 关闭 ---------------- */

  const focusKeyOf = (day) => {
    if (viewMode === 'date') return toYmd(day);
    if (viewMode === 'month') return monthKey(day.y, day.m);
    return String(day.y);
  };

  const focusActiveCell = () => {
    const hit = cells.get(focusKeyOf(focus)) ?? cells.values().next().value;
    hit?.el.focus({ preventScroll: true });
  };

  const render = () => {
    if (!panel) return;
    panel.dataset.view = viewMode;

    const start = view.y - mod(view.y, 12);
    titleEl.textContent =
      viewMode === 'date'
        ? formatMonth(view.y, view.m, locale)
        : viewMode === 'month'
          ? formatYear(view.y, locale)
          : `${start}–${start + 11}`;
    // 年视图已经是最粗一级，标题不再上钻
    titleEl.disabled = viewMode === 'year';
    prevBtn.setAttribute('aria-label', navLabel(-1));
    nextBtn.setAttribute('aria-label', navLabel(1));
    prevBtn.disabled = !canShift(-1);
    nextBtn.disabled = !canShift(1);

    body.replaceChildren(
      viewMode === 'date' ? buildDateTable() : viewMode === 'month' ? buildMonthTable() : buildYearTable()
    );
  };

  const navLabel = (dir) => {
    if (viewMode === 'date') return dir < 0 ? '上个月' : '下个月';
    if (viewMode === 'month') return dir < 0 ? '上一年' : '下一年';
    return dir < 0 ? '向前十二年' : '向后十二年';
  };

  /** 单张表格的公共骨架：表头可选，格子由调用方给 */
  const buildTable = (labelText, headCells, records, cols) => {
    const table = h('table', {
      class: 'c-datepicker__grid',
      role: 'grid',
      'aria-label': labelText,
    });
    if (headCells) table.append(h('thead', null, h('tr', null, ...headCells)));

    const tbody = h('tbody');
    for (let i = 0; i < records.length; i += cols) {
      const tr = h('tr');
      for (const rec of records.slice(i, i + cols)) tr.append(h('td', null, rec.el));
      tbody.append(tr);
    }
    table.append(tbody);
    return table;
  };

  /** 只让一个格子进 Tab 序列；焦点日不可见时退到第一个可选格子 */
  const applyRoving = (records) => {
    cells = new Map();
    for (const rec of records) if (rec.enabled) cells.set(rec.key, rec);
    const wanted = cells.get(focusKeyOf(focus));
    const active = wanted ?? cells.values().next().value;
    if (!active) return;
    active.el.tabIndex = 0;
    // 焦点日翻出了当前视图：把状态挪到落点上，否则下一次方向键会从屏幕外开始算
    if (active !== wanted) focus = { ...active.day };
  };

  const buildDateTable = () => {
    const now = todayParts();
    const todayKey = toYmd(now);
    const first = { y: view.y, m: view.m, d: 1 };
    const offset = mod(weekdayOf(first) - ws, 7);
    let cursor = addDays(first, -offset);

    const headCells = [];
    for (let i = 0; i < 7; i += 1) {
      const dow = (ws + i) % 7;
      // 2023-01-01 是周日，用这一周取任意 locale 的星期名
      const ref = new Date(Date.UTC(2023, 0, 1 + dow));
      const full = dtf(locale, { weekday: 'long' }).format(ref);
      headCells.push(
        h(
          'th',
          { class: 'c-datepicker__weekday', scope: 'col', abbr: full, 'aria-label': full },
          dtf(locale, { weekday: 'narrow' }).format(ref)
        )
      );
    }

    const records = [];
    // 固定 6 行：翻月时面板高度不跳，指针不用重新找落点
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        const day = cursor;
        cursor = addDays(cursor, 1);
        const key = toYmd(day);
        const ok = enabledAt(day);
        const selected = key === current;
        const props = {
          class: 'c-datepicker__day',
          type: 'button',
          tabindex: '-1',
          'aria-label': formatDay(day, locale),
          onclick: () => {
            if (ok) pickDay(day);
          },
        };
        // 不用 h() 的 dataset 批量赋值：Object.assign 会把 null 写成字符串 "null"
        props.dataset = { date: key };
        if (day.m !== view.m) props.dataset.outside = 'true';
        if (selected) props['aria-selected'] = 'true';
        if (key === todayKey) props['aria-current'] = 'date';
        if (!ok) props['aria-disabled'] = 'true';

        const rec = {
          key,
          day,
          enabled: ok,
          el: h('button', props, String(day.d)),
        };
        records.push(rec);
      }
    }
    applyRoving(records);
    return buildTable(titleEl.textContent, headCells, records, 7);
  };

  const buildMonthTable = () => {
    const records = [];
    const mk = current.slice(0, 7);
    for (let m = 1; m <= 12; m += 1) {
      const key = monthKey(view.y, m);
      const ok = firstEnabledInMonth(view.y, m) !== null;
      const day = { y: view.y, m, d: Math.min(focus.d, daysInMonth(view.y, m)) };
      const rec = {
        key,
        day,
        enabled: ok,
        el: h(
          'button',
          {
            class: 'c-datepicker__cell',
            type: 'button',
            tabindex: '-1',
            dataset: { month: key },
            'aria-label': formatMonth(view.y, m, locale),
            'aria-selected': key === mk ? 'true' : null,
            'aria-disabled': ok ? null : 'true',
            onclick: () => {
              if (ok) pickMonth(view.y, m);
            },
          },
          dtf(locale, { month: 'long' }).format(new Date(Date.UTC(view.y, m - 1, 1)))
        ),
      };
      records.push(rec);
    }
    applyRoving(records);
    return buildTable(titleEl.textContent, null, records, 3);
  };

  const buildYearTable = () => {
    const start = view.y - mod(view.y, 12);
    const records = [];
    const year = current.slice(0, 4);
    for (let i = 0; i < 12; i += 1) {
      const y = start + i;
      const ok = Array.from({ length: 12 }, (_, k) => k + 1).some(
        (m) => firstEnabledInMonth(y, m) !== null
      );
      const rec = {
        key: String(y),
        day: { y, m: 1, d: 1 },
        enabled: ok,
        el: h(
          'button',
          {
            class: 'c-datepicker__cell',
            type: 'button',
            tabindex: '-1',
            dataset: { year: String(y) },
            'aria-label': formatYear(y, locale),
            'aria-selected': String(y) === year ? 'true' : null,
            'aria-disabled': ok ? null : 'true',
            onclick: () => {
              if (ok) pickYear(y);
            },
          },
          String(y)
        ),
      };
      records.push(rec);
    }
    applyRoving(records);
    return buildTable(titleEl.textContent, null, records, 3);
  };

  const commit = (next) => {
    const changed = next !== current;
    current = next;
    syncTrigger();
    close('pick');
    if (changed) onChange?.(next);
  };

  const pickDay = (day) => {
    if (!enabledAt(day)) return;
    commit(toYmd(day));
  };

  const pickMonth = (y, m) => {
    // mode:'month' 才是「选月份」；date 模式下点月份只是翻页，别把用户弹出去
    if (initialMode !== 'month') {
      viewMode = 'date';
      view = { y, m };
      focus = firstEnabledInMonth(y, m) ?? { y, m, d: 1 };
      render();
      focusActiveCell();
      return;
    }
    const { lo, hi } = rangeOfMonth(y, m);
    if (lo > hi) return;
    commit(toYmd({ y, m, d: Math.max(1, lo) }));
  };

  const pickYear = (y) => {
    if (initialMode !== 'year') {
      viewMode = 'month';
      view = { y, m: view.m };
      // 重新渲染会把被点的年份按钮摘掉，焦点必须自己接回来
      focus = { y, m: focus.m, d: Math.min(focus.d, daysInMonth(y, focus.m)) };
      render();
      focusActiveCell();
      return;
    }
    for (let m = 1; m <= 12; m += 1) {
      const { lo, hi } = rangeOfMonth(y, m);
      if (lo <= hi) {
        commit(toYmd({ y, m, d: lo }));
        return;
      }
    }
  };

  const clearValue = () => {
    const had = current !== '';
    current = '';
    syncTrigger();
    close('clear');
    if (had) onChange?.('');
  };

  /* ---------------- 键盘 ---------------- */

  /** 朝一个方向找最近的可选日；整段都不可选就原地不动 */
  const seek = (from, step, limit = 400) => {
    let cursor = from;
    for (let i = 0; i < limit; i += 1) {
      cursor = step(cursor);
      if (enabledAt(cursor)) return cursor;
    }
    return null;
  };

  const moveTo = (next) => {
    if (!next) return;
    focus = next;
    view = { y: focus.y, m: focus.m };
    render();
    focusActiveCell();
  };

  const handleDateKeys = (e) => {
    const key = e.key;
    let next = null;

    if (key === 'ArrowLeft') next = seek(focus, (c) => addDays(c, -1));
    else if (key === 'ArrowRight') next = seek(focus, (c) => addDays(c, 1));
    else if (key === 'ArrowUp') next = seek(focus, (c) => addDays(c, -7));
    else if (key === 'ArrowDown') next = seek(focus, (c) => addDays(c, 7));
    else if (key === 'Home') {
      const back = mod(weekdayOf(focus) - ws, 7);
      next = seek(addDays(focus, -back - 1), (c) => addDays(c, 1), 8);
    } else if (key === 'End') {
      const ahead = mod(ws + 6 - weekdayOf(focus), 7);
      next = seek(addDays(focus, ahead + 1), (c) => addDays(c, -1), 8);
    } else if (key === 'PageUp') {
      next = seek(focus, (c) => addMonths(c, e.shiftKey ? -12 : -1), 30);
    } else if (key === 'PageDown') {
      next = seek(focus, (c) => addMonths(c, e.shiftKey ? 12 : 1), 30);
    }

    if (next) {
      e.preventDefault();
      e.stopPropagation();
      moveTo(next);
      return;
    }

    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      pickDay(focus);
    }
  };

  const handleBlockKeys = (e) => {
    const key = e.key;
    const stepUnit = viewMode === 'month' ? 1 : 12;
    let next = null;

    if (key === 'ArrowLeft') next = shiftBlock(focus, -stepUnit);
    else if (key === 'ArrowRight') next = shiftBlock(focus, stepUnit);
    else if (key === 'ArrowUp') next = shiftBlock(focus, -stepUnit * 3);
    else if (key === 'ArrowDown') next = shiftBlock(focus, stepUnit * 3);
    else if (key === 'Home') next = shiftBlock(focus, viewMode === 'month' ? -11 : -11 * 12);
    else if (key === 'End') next = shiftBlock(focus, viewMode === 'month' ? 11 : 11 * 12);
    else if (key === 'PageUp') next = shiftBlock(focus, viewMode === 'month' ? -12 : -144);
    else if (key === 'PageDown') next = shiftBlock(focus, viewMode === 'month' ? 12 : 144);

    if (next) {
      e.preventDefault();
      e.stopPropagation();
      focus = next;
      view = { y: focus.y, m: view.m };
      render();
      focusActiveCell();
      return;
    }

    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      if (viewMode === 'month') pickMonth(view.y, focus.m);
      else pickYear(focus.y);
    }
  };

  /** 月/年视图的位移：以月为单位进退，日夹到目标月长度 */
  const shiftBlock = (from, months) => {
    if (viewMode === 'month') return addMonths(from, months);
    const y = from.y + months / 12;
    return { y, m: from.m, d: Math.min(from.d, daysInMonth(y, from.m)) };
  };

  const onPanelKey = (e) => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    const key = e.key;

    if (key === 'Tab') {
      const footBtn = panel.querySelector('.c-datepicker__foot button');
      const inFoot = footBtn && document.activeElement === footBtn;
      if (!e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        // 面板里有两个可 Tab 的落点：当前日期格 → 清除 → 退出
        if (footBtn && !inFoot) footBtn.focus();
        else {
          close('tab');
          focusBack();
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (inFoot) focusActiveCell();
      else {
        close('tab');
        focusBack();
      }
      return;
    }

    // Esc 交给层栈：它负责关层并把焦点还给触发器，这里再拦一次会关两层
    if (key === 'Escape') return;

    if ((key === 'Delete' || key === 'Backspace') && clearable) {
      e.preventDefault();
      e.stopPropagation();
      clearValue();
      return;
    }

    if (viewMode === 'date') handleDateKeys(e);
    else handleBlockKeys(e);
  };

  /* ---------------- 面板 ---------------- */

  const shift = (dir) => {
    // 按钮禁用后键盘也不该翻过去：两者必须用同一个判据，否则会出现
    // 「按钮灰着但 PageUp 还能到」的不一致
    if (!canShift(dir)) return;
    if (viewMode === 'date') {
      const next = addMonths({ y: view.y, m: view.m, d: 1 }, dir);
      view = { y: next.y, m: next.m };
    } else if (viewMode === 'month') {
      view = { y: view.y + dir, m: view.m };
    } else {
      view = { y: view.y + dir * 12, m: view.m };
    }
    render();
  };

  const drillUp = () => {
    if (viewMode === 'date') viewMode = 'month';
    else if (viewMode === 'month') viewMode = 'year';
    render();
  };

  const buildPanel = () => {
    openDisposer = createDisposer();
    body = h('div', { class: 'c-datepicker__body' });

    prevBtn = h('button', {
      class: 'c-datepicker__nav',
      type: 'button',
      'aria-label': '上个月',
      html: icon('chevron-left', 14),
      onclick: () => shift(-1),
    });
    nextBtn = h('button', {
      class: 'c-datepicker__nav',
      type: 'button',
      'aria-label': '下个月',
      html: icon('chevron-right', 14),
      onclick: () => shift(1),
    });
    titleEl = h(
      'button',
      { class: 'c-datepicker__title', type: 'button', onclick: () => drillUp() },
      ''
    );

    const foot = clearable
      ? h(
          'div',
          { class: 'c-datepicker__foot' },
          h(
            'button',
            {
              class: 'c-datepicker__clear',
              type: 'button',
              disabled: current ? null : true,
              onclick: () => clearValue(),
            },
            '清除'
          )
        )
      : null;

    panel = h(
      'div',
      {
        class: 'c-datepicker__panel',
        role: 'dialog',
        'aria-modal': 'false',
        'aria-label': '选择日期',
        tabindex: '-1',
      },
      h('div', { class: 'c-datepicker__head' }, prevBtn, titleEl, nextBtn),
      body,
      foot
    );

    /* 面板挂在「最近的层容器」里，而不是无条件挂 body：
       模态 Dialog / Sheet 打开时会给 body 的其它子节点加 inert，面板挂在
       body 上会跟着被冻住（看起来像「打开就消失了」）。挂进同一层容器后，
       inert 的范围与面板无关，定位仍然用 fixed + 视口坐标。
       注意不能挂在 .c-dialog 本身：它带 transform，会成为 fixed 的包含块，
       坐标会整体偏掉 —— 所以落点是它的遮罩（层容器）。 */
    const host = layerHostFor(el);
    host.append(panel);
    render();

    layer = openLayer({
      el: panel,
      container: panel,
      modal: false,
      dismissible: true,
      outside: true,
      ignore: [el],
      initialFocus: 'self',
      // 焦点归还自己管：程序化打开时开层前的焦点可能不在触发器上，
      // 而 Esc / 选完都必须落回触发器（键盘用户继续往下走的落点）
      returnFocus: false,
      onClose: (reason) => {
        layer = null;
        pos?.stop();
        pos = null;
        panel.remove();
        openDisposer?.dispose();
        openDisposer = null;
        panel = null;
        body = null;
        titleEl = null;
        prevBtn = null;
        nextBtn = null;
        cells = new Map();
        opener.setAttribute('aria-expanded', 'false');
        if (!disposed && (reason === 'escape' || reason === 'tab' || reason === 'pick' || reason === 'clear')) {
          // 用宏任务而不是 rAF：后台标签页里 rAF 会停，焦点就永远回不来了
          setTimeout(() => {
            if (trigger.isConnected) focusBack();
          }, 0);
        }
      },
    });
    // 非模态子层不该把父对话框整体设为 inert（见 releaseParentInert 注释）
    releaseParentInert(layer);
    panel.style.zIndex = String(900 + layer.level * 20);

    pos = positionLayer(panel, {
      anchor: trigger,
      placement: 'bottom',
      align: 'start',
      gap: 6,
      onHidden: () => layer?.close('hidden'),
    });

    openDisposer.on(panel, 'keydown', onPanelKey);
    opener.setAttribute('aria-expanded', 'true');

    // openLayer 的 initialFocus 会先聚焦面板本身；下一个宏任务把焦点交给日期格。
    // 不用 rAF：后台标签页里 rAF 会停，面板就会「打开但键盘进不去」。
    // 但 openLayer 自己的 initialFocus 也是 rAF，比宏任务更晚生效，所以再用
    // 一帧把焦点重新压回格子 —— 否则打开后的第一下方向键落在面板上，
    // 读屏也只会念「对话框」。
    openDisposer.timeout(() => focusActiveCell(), 0);
    openDisposer.frame(() => {
      if (panel && !document.activeElement?.classList?.contains('c-datepicker__day')) {
        focusActiveCell();
      }
    });
  };

  const open = () => {
    if (disabled || disposed || layer) return;
    viewMode = initialMode;
    const seed = parseYmd(current) || todayParts();
    focus = { ...seed };
    view = { y: seed.y, m: seed.m };
    // 选中的那天被 min/max 挡在外面时，落点换成本月第一个可选日
    if (!enabledAt(focus)) focus = firstEnabledInMonth(focus.y, focus.m) ?? focus;
    buildPanel();
  };

  const close = (reason = 'api') => {
    layer?.close(reason);
  };

  /* ---------------- 手动输入 ----------------
     键入只改草稿、不改值：Enter / 失焦才提交，Esc 还原。
     非法输入回退到上一个合法值并闪一次 invalid，而不是长期标红 ——
     持续的红框会让整个表单看起来一直处于错误状态。 */

  const flashInvalid = () => {
    if (!editable) return;
    inputEl.dataset.invalidDraft = '1';
    flashOff?.();
    flashOff = disposer?.timeout(() => {
      delete inputEl.dataset.invalidDraft;
      flashOff = null;
    }, 600);
  };

  const commitTyped = () => {
    if (!editable || disposed || composing) return;
    const raw = inputEl.value.trim();
    if (!raw) {
      inputEl.value = '';
      if (current) {
        current = '';
        syncTrigger();
        onChange?.('');
      }
      return;
    }
    const parsed = parseTypedDate(raw);
    // min / max / disabledDate 也在这里拦：手输不该绕过面板上的可选性
    if (!parsed || !enabledAt(parsed)) {
      flashInvalid();
      inputEl.value = current;
      return;
    }
    const next = toYmd(parsed);
    const before = current;
    current = next;
    syncTrigger();
    if (layer) {
      focus = { ...parsed };
      view = { y: parsed.y, m: parsed.m };
      render();
    }
    if (next !== before) onChange?.(next);
  };

  /** 还原到当前值；返回「草稿是否被改过」 */
  const revertTyped = () => {
    if (!editable) return false;
    const dirty = inputEl.value !== current;
    inputEl.value = current;
    return dirty;
  };

  /* ---------------- 对外接口 ---------------- */

  const disposer = createDisposer();

  if (editable) {
    disposer.on(inputEl, 'compositionstart', () => {
      composing = true;
    });
    disposer.on(inputEl, 'compositionend', () => {
      composing = false;
    });
    // 只是输入，不 open()：复合框那种「一聚焦就铺开」在这里是干扰
    disposer.on(inputEl, 'input', () => {
      if (inputEl.value.trim()) el.removeAttribute('data-empty');
      else el.setAttribute('data-empty', 'true');
    });
    disposer.on(inputEl, 'blur', () => commitTyped());
    disposer.on(inputEl, 'keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTyped();
        return;
      }
      if (e.key === 'Escape') {
        const dirty = revertTyped();
        if (layer) {
          e.preventDefault();
          e.stopPropagation();
          close('escape');
        } else if (dirty) {
          // 改过才拦：没改就放行，让外层（对话框）按自己的规则处理 Esc
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        open();
      }
    });
    // 按下日历按钮时别把焦点从输入框带走：一走就会触发 blur 提交，
    // 面板还没开就先闪一次 invalid
    disposer.on(toggleBtn, 'pointerdown', (e) => e.preventDefault());
    disposer.on(toggleBtn, 'click', () => {
      if (layer) {
        close('toggle');
        return;
      }
      // 先收下正在打的草稿，再开面板：否则面板里的日子和输入框里的字会打架
      commitTyped();
      open();
    });

    // 点触发器空白处（输入框吃不到的那几个像素）也应该开始编辑
    disposer.on(trigger, 'pointerdown', (e) => {
      if (e.target === inputEl || toggleBtn.contains(e.target)) return;
      e.preventDefault();
      inputEl.focus();
      const end = inputEl.value.length;
      inputEl.setSelectionRange(end, end);
    });
  } else {
    disposer.on(trigger, 'click', () => (layer ? close('toggle') : open()));
    disposer.on(trigger, 'keydown', (e) => {
      if (e.key !== 'ArrowDown' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      open();
    });
  }

  disposer.add(() => {
    layer?.close('dispose');
    openDisposer?.dispose();
  });

  el.set = (v) => {
    current = normalizeYmd(v);
    syncTrigger();
    if (layer) render();
  };
  el.value = () => current;
  el.open = open;
  el.close = () => close('api');
  el.setMin = (v) => {
    minStr = normalizeYmd(v);
    if (layer) render();
  };
  el.setMax = (v) => {
    maxStr = normalizeYmd(v);
    if (layer) render();
  };
  el.setDisabled = (v) => {
    disabled = !!v;
    applyControlState(trigger, { disabled });
    if (editable) {
      applyControlState(inputEl, { disabled });
      toggleBtn.disabled = disabled;
    }
    if (disabled) close('disabled');
  };
  el.setReadonly = (v) => {
    applyControlState(el, { readonly: v });
    if (editable) {
      inputEl.readOnly = !!v;
      applyControlState(inputEl, { readonly: v });
    }
  };
  el.setInvalid = (v) => {
    applyControlState(el, { invalid: v });
    applyControlState(trigger, { invalid: v });
    // 读屏读的是内部可编辑控件上的 aria-invalid，容器描边只是视觉
    if (editable) applyControlState(inputEl, { invalid: v });
  };
  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    close('dispose');
    disposer.dispose();
  };

  syncTrigger();
  return el;
}

/**
 * 非模态子层（下拉、日期面板）不该把打开它的对话框整体设为 inert：
 * 焦点要留在输入框上，面板只是「另一块可见区域」。openLayer 的父子隔离
 * 是为模态子层准备的（二级 Dialog），这里撤回自己那一份。
 * 关闭时 closeLayer 会再撤一次，重复撤除无副作用。
 */
function releaseParentInert(layer) {
  const saved = layer?._parentInert;
  if (saved?.node && !saved.had) saved.node.removeAttribute('inert');
}

/**
 * 最近的「层容器」：优先挂遮罩（Dialog / Sheet 的 scrim）—— 它是层里唯一
 * 不带变换的元素，position: fixed 才仍然相对视口。没有遮罩的自定义层，
 * 只有自身不带 transform / filter 时才敢挂进去。
 */
function layerHostFor(node) {
  const scope = node.closest('[data-layer-root], .c-dialog, .c-sheet, .c-drawer, [role="dialog"]');
  if (!scope) return document.body;
  const box = scope.closest('[data-layer-root], .c-dialog-scrim, .c-sheet-scrim');
  if (box) return box;
  try {
    const cs = getComputedStyle(scope);
    if (
      cs.transform !== 'none' ||
      cs.filter !== 'none' ||
      cs.backdropFilter !== 'none' ||
      cs.perspective !== 'none'
    ) {
      return document.body;
    }
  } catch {
    return document.body;
  }
  return scope;
}
