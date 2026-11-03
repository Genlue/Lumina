// ============================================================
// Lumina · DOM helpers
// 极简的建树工具。没有虚拟 DOM，没有编译，元素直接就是真 DOM。
// ============================================================

/**
 * 建元素。
 *  h('div', { class: 'c-row', onclick: fn }, child1, child2)
 *  - class / className / style(对象) / dataset / on* 事件 / 其余为 attribute
 *  - 子节点接受 string / Node / 数组 / null
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;

      if (k === 'class' || k === 'className') {
        el.className = v;
      } else if (k === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v)) {
          if (val === null || val === undefined) continue;
          // 自定义属性只能走 setProperty
          if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
          else el.style[prop] = val;
        }
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (k === 'html') {
        el.innerHTML = v;
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'ref' && typeof v === 'function') {
        v(el);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, v);
      }
    }
  }

  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function frag(...children) {
  return append(document.createDocumentFragment(), children);
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 清空并重新填充 */
export function fill(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** 事件委托：on(root, 'click', '.c-btn', handler) */
export function on(root, type, selector, handler, opts) {
  root.addEventListener(
    type,
    (e) => {
      const target = e.target.closest(selector);
      if (target && root.contains(target)) handler(e, target);
    },
    opts
  );
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

let rafPending = false;
/** 合并同一帧内的多次调用 */
export function nextFrame(fn) {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    fn();
  });
}

export function debounce(fn, ms = 180) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** 点击外部关闭：返回解绑函数 */
export function onOutside(target, handler) {
  const fn = (e) => {
    if (!target.contains(e.target)) handler(e);
  };
  // 延后一帧，避免绑定当次点击立刻触发
  requestAnimationFrame(() => document.addEventListener('pointerdown', fn, true));
  return () => document.removeEventListener('pointerdown', fn, true);
}
