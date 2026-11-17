// Golden Gate · forms/time-picker
import { h } from '../../core/dom.js';
import { createDisposer } from '../_shared/disposer.js';
import { applyControlState } from '../_shared/control.js';

/* ==========================================================================
   TimePicker

   时间只有「本地墙上时间」：时、分（可选秒），没有时区。
   内部先折成一天内的分钟数（0–1439），加减、夹取、吸附都在整数上做，
   不构造 Date —— 一旦引入 Date，夏令时那两天会凭空多出或少掉一小时。

   两种形态共用同一份状态：
   · editable（默认）—— 一个真 input，直接键入 `9:5`，提交时归一化成 `09:05`；
     光标所在的段决定 ↑↓ 改小时还是分钟。键入不提交在每一键上，Enter / 失焦才收。
   · 内联三段 —— 小时 / 分钟 /（秒）/ 上午下午，各自是 spinbutton，
     数字键直输、↑↓ 段内步进。形态不同，步进规则同一套。

   值对外永远是 24 小时制 'HH:mm'（withSeconds 时 'HH:mm:ss'），
   12 小时制只是显示层。
   ========================================================================== */

const pad2 = (n) => String(n).padStart(2, '0');
const wrap = (n, m) => ((n % m) + m) % m;

/** 接受 `9:5` / `09:05` / `09:05:03`；不补零也能读，这是手输的最低要求 */
function parseTime(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const hit = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(text);
  if (!hit) return null;
  const hh = Number(hit[1]);
  const mm = Number(hit[2]);
  const ss = hit[3] == null ? 0 : Number(hit[3]);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return { h: hh, m: mm, s: ss };
}

const toTotal = (input) => {
  const parsed = parseTime(input);
  return parsed ? parsed.h * 60 + parsed.m : null;
};

const normalizeHm = (input) => {
  const parsed = parseTime(input);
  return parsed ? `${pad2(parsed.h)}:${pad2(parsed.m)}` : '';
};

/** 按 locale 决定默认是否 12 小时制（zh-CN 是 24 小时） */
function prefers12h(locale) {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 === true;
  } catch {
    return false;
  }
}

function dayPeriod(locale, pm) {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      hour12: true,
      timeZone: 'UTC',
    }).formatToParts(new Date(Date.UTC(2023, 0, 1, pm ? 13 : 9)));
    return parts.find((p) => p.type === 'dayPeriod')?.value ?? (pm ? 'PM' : 'AM');
  } catch {
    return pm ? 'PM' : 'AM';
  }
}

export function TimePicker({
  value = '',
  min = '',
  max = '',
  step = 15,
  use12h = 'auto',
  locale = 'zh-CN',
  label = '',
  placeholder = '--:--',
  editable = true,
  withSeconds = false,
  disabledTime,
  onChange,
  className = '',
} = {}) {
  const stepMin = Math.min(59, Math.max(1, Math.round(Number(step) || 1)));
  const twelve = use12h === 'auto' ? prefers12h(locale) : !!use12h;
  const minStr = normalizeHm(min);
  const maxStr = normalizeHm(max);

  const initial = parseTime(value);
  let total = initial ? initial.h * 60 + initial.m : null;
  let seconds = initial ? initial.s : 0;
  let disabled = false;
  let disposed = false;
  let composing = false;
  let flashOff = null;

  const disposer = createDisposer();

  const amText = dayPeriod(locale, false);
  const pmText = dayPeriod(locale, true);

  let hourFmt = null;
  try {
    // hour12 跟显示一致，否则 24 小时制下读屏会念出 "2 PM"
    hourFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: !twelve, timeZone: 'UTC' });
  } catch {
    hourFmt = null;
  }
  const hourText = (hh) => (hourFmt ? hourFmt.format(new Date(Date.UTC(2023, 0, 1, hh))) : String(hh));

  /** 合法区间；min 大于 max 时对调，避免整段被判成空 */
  const allowed = () => {
    const lo = minStr ? toTotal(minStr) : 0;
    const hi = maxStr ? toTotal(maxStr) : 1439;
    return lo <= hi ? { lo, hi } : { lo: hi, hi: lo };
  };

  /** 某个「一天内分钟数」是否可选：先区间，再应用给的 disabledTime */
  const minuteAllowed = (t) => {
    const { lo, hi } = allowed();
    if (t < lo || t > hi) return false;
    return disabledTime?.(t) !== true;
  };

  /* ---------------- DOM ---------------- */

  const inputEl = editable
    ? h('input', {
        class: 'c-timepicker__input',
        type: 'text',
        inputmode: 'numeric',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder,
        'aria-label': label || '时间',
        role: 'spinbutton',
      })
    : null;

  const segs = [];

  const hourSeg = editable
    ? null
    : h('span', {
        class: 'c-timepicker__seg c-timepicker__hour',
        role: 'spinbutton',
        tabindex: '0',
        'aria-label': '小时',
        dataset: { seg: 'hour' },
      });
  const colon = editable ? null : h('span', { class: 'c-timepicker__colon', 'aria-hidden': 'true' }, ':');
  const minSeg = editable
    ? null
    : h('span', {
        class: 'c-timepicker__seg c-timepicker__minute',
        role: 'spinbutton',
        tabindex: '0',
        'aria-label': '分钟',
        dataset: { seg: 'minute' },
      });
  const secSeg =
    editable || !withSeconds
      ? null
      : h('span', {
          class: 'c-timepicker__seg c-timepicker__second',
          role: 'spinbutton',
          tabindex: '0',
          'aria-label': '秒',
          dataset: { seg: 'second' },
        });
  const secColon =
    editable || !withSeconds
      ? null
      : h('span', { class: 'c-timepicker__colon', 'aria-hidden': 'true' }, ':');
  const merSeg =
    editable || !twelve
      ? null
      : h('span', {
          class: 'c-timepicker__seg c-timepicker__meridiem',
          role: 'spinbutton',
          tabindex: '0',
          'aria-label': '上午或下午',
          dataset: { seg: 'meridiem' },
        });

  const el = h(
    'div',
    {
      class: `c-timepicker ${className}`.trim(),
      role: 'group',
      'aria-label': label || '时间',
      dataset: withSeconds ? { seconds: '1' } : null,
    },
    inputEl,
    hourSeg,
    colon,
    minSeg,
    secColon,
    secSeg,
    merSeg
  );

  for (const seg of [hourSeg, minSeg, secSeg, merSeg]) if (seg) segs.push(seg);

  /* ---------------- 值的读写 ---------------- */

  const hourOf = () => (total == null ? 0 : Math.floor(total / 60));
  const minuteOf = () => (total == null ? 0 : total % 60);

  const valueOf = () => {
    if (total == null) return '';
    const base = `${pad2(hourOf())}:${pad2(minuteOf())}`;
    return withSeconds ? `${base}:${pad2(seconds)}` : base;
  };

  const paint = () => {
    const has = total != null;
    const hh = hourOf();
    const mm = minuteOf();

    if (editable) {
      // 写入 value 会把光标顶到末尾：↑↓ 步进后如果不还原，下一次按键
      // 就会从「小时段」跳到「分钟段」，连续步进直接跑偏
      const focused = document.activeElement === inputEl;
      const caret = focused ? inputEl.selectionStart : null;
      inputEl.value = valueOf();
      if (focused && caret != null) {
        const pos = Math.min(caret, inputEl.value.length);
        try {
          inputEl.setSelectionRange(pos, pos);
        } catch {
          // 类型不是 text 时浏览器会抛，忽略即可
        }
      }
      inputEl.setAttribute('aria-valuenow', String(has ? total : ''));
      inputEl.setAttribute('aria-valuemin', '0');
      inputEl.setAttribute('aria-valuemax', '1439');
      inputEl.setAttribute('aria-valuetext', has ? valueOf() : '未选择');
    }

    if (hourSeg) {
      const dispH = twelve ? (hh % 12 === 0 ? 12 : hh % 12) : hh;
      hourSeg.textContent = has ? pad2(dispH) : '--';
      hourSeg.setAttribute('aria-valuenow', String(has ? dispH : 0));
      hourSeg.setAttribute('aria-valuemin', twelve ? '1' : '0');
      hourSeg.setAttribute('aria-valuemax', twelve ? '12' : '23');
      hourSeg.setAttribute('aria-valuetext', has ? hourText(hh) : '未选择');
    }

    if (minSeg) {
      minSeg.textContent = has ? pad2(mm) : '--';
      minSeg.setAttribute('aria-valuenow', String(has ? mm : 0));
      minSeg.setAttribute('aria-valuemin', '0');
      minSeg.setAttribute('aria-valuemax', '59');
      minSeg.setAttribute('aria-valuetext', has ? pad2(mm) : '未选择');
    }

    if (secSeg) {
      secSeg.textContent = has ? pad2(seconds) : '--';
      secSeg.setAttribute('aria-valuenow', String(has ? seconds : 0));
      secSeg.setAttribute('aria-valuemin', '0');
      secSeg.setAttribute('aria-valuemax', '59');
      secSeg.setAttribute('aria-valuetext', has ? pad2(seconds) : '未选择');
    }

    if (merSeg) {
      const pm = hh >= 12;
      merSeg.textContent = has ? (pm ? pmText : amText) : '--';
      merSeg.setAttribute('aria-valuenow', String(pm ? 1 : 0));
      merSeg.setAttribute('aria-valuemin', '0');
      merSeg.setAttribute('aria-valuemax', '1');
      merSeg.setAttribute('aria-valuetext', has ? (pm ? pmText : amText) : '未选择');
    }

    if (has) delete el.dataset.empty;
    else el.dataset.empty = 'true';
  };

  /** 清空与最小值之间取一个起点：没填过时按 min 起步，没有 min 就 00:00 */
  const ensureTotal = () => (total == null ? allowed().lo : total);

  /** 从 from 出发按 delta 走，跳过禁用值；整圈都禁用则原地不动 */
  const stepAllowed = (from, delta) => {
    const { lo, hi } = allowed();
    const span = hi - lo + 1;
    if (span <= 0 || !delta) return null;
    let v = Math.min(Math.max(from, lo), hi);
    for (let i = 0; i < span; i += 1) {
      v += delta;
      while (v > hi) v -= span;
      while (v < lo) v += span;
      if (minuteAllowed(v)) return v;
    }
    return null;
  };

  /** 键盘直输的落点：先夹进区间，落在禁用值上就吸附到最近的可选值 */
  const snapAllowed = (target) => {
    const { lo, hi } = allowed();
    const v = Math.min(Math.max(wrap(Math.round(target), 1440), lo), hi);
    if (minuteAllowed(v)) return v;
    for (let d = 1; d <= hi - lo; d += 1) {
      if (v + d <= hi && minuteAllowed(v + d)) return v + d;
      if (v - d >= lo && minuteAllowed(v - d)) return v - d;
    }
    return null;
  };

  const setTotal = (next, { notify = true } = {}) => {
    const t = snapAllowed(next);
    if (t == null) return;
    const before = valueOf();
    total = t;
    paint();
    if (notify && valueOf() !== before) onChange?.(valueOf());
  };

  const setSegmentTotal = (next) => {
    // 第一下操作只负责「落一个值」，不要顺手再步进一格
    if (total == null) {
      const t = snapAllowed(next);
      if (t == null) return;
      total = t;
      paint();
      onChange?.(valueOf());
      return;
    }
    setTotal(next);
  };

  const bumpHour = (dir) => {
    const t = stepAllowed(ensureTotal(), dir * 60);
    if (t != null) setSegmentTotal(t);
  };

  const bumpMinute = (dir) => {
    const t = stepAllowed(ensureTotal(), dir * stepMin);
    if (t != null) setSegmentTotal(t);
  };

  const bumpSecond = (dir) => {
    if (total == null) return;
    const abs = total * 60 + seconds + dir;
    const day = 24 * 3600;
    const nextAbs = wrap(abs, day);
    const nextTotal = Math.floor(nextAbs / 60);
    if (!minuteAllowed(nextTotal)) return;
    seconds = nextAbs % 60;
    total = nextTotal;
    paint();
    onChange?.(valueOf());
  };

  const toggleMeridiem = () => {
    const base = ensureTotal();
    const t = stepAllowed(base, base >= 720 ? -720 : 720);
    if (t != null) setSegmentTotal(t);
  };

  /* ---------------- 键盘输入（内联三段） ---------------- */

  let buf = '';
  let bufSeg = '';
  let bufOff = null;

  const clearBuf = () => {
    buf = '';
    bufSeg = '';
    bufOff?.();
    bufOff = null;
  };

  /** 分钟落在 step 网格上；按键不强制改步长，只把落点吸附过去 */
  const snapMinute = (v) => {
    const stepped = Math.round(v / stepMin) * stepMin;
    const maxV = Math.floor(59 / stepMin) * stepMin;
    return Math.min(Math.max(0, stepped), maxV);
  };

  const typeDigit = (kind, digit) => {
    if (bufSeg !== kind) buf = '';
    bufSeg = kind;
    buf += digit;
    bufOff?.();
    bufOff = disposer.timeout(clearBuf, 800);

    // 缓冲整体当作数字：先按 "1" 是 1 点，再按 "2" 就变成 12 点
    const n = Number(buf);
    if (kind === 'hour') {
      const hh = twelve ? (n === 0 ? 12 : Math.min(n, 12)) : Math.min(n, 23);
      const h24 = twelve ? (hh % 12) + (ensureTotal() >= 720 ? 12 : 0) : hh;
      setSegmentTotal(h24 * 60 + (total == null ? 0 : total % 60));
      return;
    }
    if (kind === 'minute') {
      const base = ensureTotal();
      setSegmentTotal(Math.floor(base / 60) * 60 + snapMinute(Math.min(n, 59)));
      return;
    }
    if (kind === 'second') {
      seconds = Math.min(n, 59);
      // 没选过时间时先落一个可选起点，别把禁用的 lo 写进去
      if (total == null) total = snapAllowed(allowed().lo);
      if (total == null) return;
      paint();
      onChange?.(valueOf());
    }
  };

  const onSegKey = (e) => {
    if (disabled || e.isComposing || e.keyCode === 229) return;
    const seg = e.target.closest?.('.c-timepicker__seg');
    if (!seg) return;
    const kind = seg.dataset.seg;
    const key = e.key;

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      const at = segs.indexOf(seg);
      const dir = key === 'ArrowRight' ? 1 : -1;
      segs[Math.min(segs.length - 1, Math.max(0, at + dir))]?.focus();
      return;
    }

    if (key === 'Home' || key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      const { lo, hi } = allowed();
      const target = key === 'Home' ? stepAllowed(lo - 1, 1) : stepAllowed(hi + 1, -1);
      if (target != null) setSegmentTotal(target);
      return;
    }

    if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      e.stopPropagation();
      clearBuf();
      if (kind === 'meridiem' || total == null) return;
      // 删除只清本段：删小时不动分钟，删分钟不动小时
      if (kind === 'hour') setSegmentTotal(minuteOf());
      else if (kind === 'minute') setSegmentTotal(hourOf() * 60);
      else {
        seconds = 0;
        paint();
        onChange?.(valueOf());
      }
      return;
    }

    if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (/^[0-9]$/.test(key)) {
        e.preventDefault();
        e.stopPropagation();
        if (kind !== 'meridiem') typeDigit(kind, key);
        return;
      }
      if (kind === 'meridiem' && /^[ap]$/i.test(key)) {
        e.preventDefault();
        e.stopPropagation();
        const wantPm = key.toLowerCase() === 'p';
        const cur = ensureTotal();
        if (cur >= 720 !== wantPm) toggleMeridiem();
        return;
      }
    }

    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' || key === 'PageDown') {
      e.preventDefault();
      e.stopPropagation();
      if (kind === 'meridiem') {
        toggleMeridiem();
        return;
      }
      const up = key === 'ArrowUp' || key === 'PageUp';
      if (kind === 'second') {
        bumpSecond(up ? 1 : -1);
        return;
      }
      // PageUp/PageDown 固定走一小时，和分钟段一致
      if (key === 'PageUp' || key === 'PageDown' || kind === 'hour') bumpHour(up ? 1 : -1);
      else bumpMinute(up ? 1 : -1);
      return;
    }

    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      // spinbutton 没有「确认」动作，但空格不能滚页面
      e.preventDefault();
      e.stopPropagation();
    }
  };

  if (!editable) {
    disposer.on(el, 'keydown', onSegKey);
    // Safari 里 tabindex 的 span 点一下不一定拿焦点，这里显式接管
    for (const seg of segs) {
      disposer.on(seg, 'pointerdown', (e) => {
        if (disabled) return;
        e.preventDefault();
        seg.focus({ preventScroll: true });
      });
      // 双击/单击只负责聚焦，改值一律走键盘，避免误触改掉时间
      disposer.on(seg, 'click', (e) => {
        if (disabled) e.stopPropagation();
      });
    }
  }

  /* ---------------- 可编辑输入框 ---------------- */

  /** 光标落在哪一段：`09:|05` 改分，`|09:05` 改时 */
  const segmentAtCaret = () => {
    const pos = inputEl.selectionStart ?? 0;
    if (pos <= 2) return 'hour';
    if (pos <= 5 || !withSeconds) return 'minute';
    return 'second';
  };

  const flashInvalid = () => {
    if (!editable) return;
    inputEl.dataset.invalidDraft = '1';
    flashOff?.();
    flashOff = disposer.timeout(() => {
      delete inputEl.dataset.invalidDraft;
      flashOff = null;
    }, 600);
  };

  const commitText = () => {
    if (!editable || disposed || composing) return;
    const raw = inputEl.value.trim();
    if (!raw) {
      if (total != null) {
        total = null;
        seconds = 0;
        paint();
        onChange?.('');
      }
      return;
    }
    const parsed = parseTime(raw);
    if (!parsed) {
      flashInvalid();
      paint();
      return;
    }
    const t = parsed.h * 60 + parsed.m;
    // disabledTime 与 min/max 同样作用于手输：面板上不可选的值，打字也不该进来
    if (!minuteAllowed(t)) {
      flashInvalid();
      paint();
      return;
    }
    const before = valueOf();
    total = t;
    seconds = withSeconds ? parsed.s : 0;
    paint();
    if (valueOf() !== before) onChange?.(valueOf());
  };

  const revertText = () => {
    if (!editable) return false;
    const dirty = inputEl.value !== valueOf();
    inputEl.value = valueOf();
    return dirty;
  };

  if (editable) {
    disposer.on(inputEl, 'compositionstart', () => {
      composing = true;
    });
    disposer.on(inputEl, 'compositionend', () => {
      composing = false;
    });
    disposer.on(inputEl, 'blur', () => commitText());
    disposer.on(inputEl, 'keydown', (e) => {
      if (disabled || e.isComposing || e.keyCode === 229) return;
      const key = e.key;
      const seg = segmentAtCaret();

      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' || key === 'PageDown') {
        e.preventDefault();
        const up = key === 'ArrowUp' || key === 'PageUp';
        if (key === 'PageUp' || key === 'PageDown' || seg === 'hour') bumpHour(up ? 1 : -1);
        else if (seg === 'second') bumpSecond(up ? 1 : -1);
        else bumpMinute(up ? 1 : -1);
        return;
      }

      if (key === 'Home' || key === 'End') {
        e.preventDefault();
        const { lo, hi } = allowed();
        const target = key === 'Home' ? stepAllowed(lo - 1, 1) : stepAllowed(hi + 1, -1);
        if (target != null) setSegmentTotal(target);
        return;
      }

      if (key === 'Enter') {
        e.preventDefault();
        commitText();
        return;
      }

      if (key === 'Escape') {
        const dirty = revertText();
        if (dirty) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
    });
  }

  /* ---------------- 对外接口 ---------------- */

  el.input = inputEl;
  el.set = (v) => {
    const parsed = parseTime(v);
    total = parsed ? parsed.h * 60 + parsed.m : null;
    seconds = parsed ? parsed.s : 0;
    paint();
  };
  el.value = valueOf;
  el.setDisabled = (v) => {
    disabled = !!v;
    applyControlState(el, { disabled });
    if (editable) applyControlState(inputEl, { disabled });
    for (const seg of segs) seg.tabIndex = disabled ? -1 : 0;
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
    // 容器描边给视觉，aria-invalid 落在真正可编辑的节点上
    if (editable) applyControlState(inputEl, { invalid: v });
  };
  el.dispose = () => {
    if (disposed) return;
    disposed = true;
    clearBuf();
    flushFlash();
    disposer.dispose();
  };

  /** dispose 时把未执行的那次 invalidDraft 清理摘掉，别让闭包写到已拆掉的节点上 */
  function flushFlash() {
    flashOff?.();
    flashOff = null;
    if (editable) delete inputEl.dataset.invalidDraft;
  }

  paint();
  return el;
}
