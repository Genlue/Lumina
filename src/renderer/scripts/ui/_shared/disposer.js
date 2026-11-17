// Golden Gate · _shared/disposer
import { disposeComponentTree } from './lifecycle.js';

/* ==========================================================================
   生命周期登记簿（M3）

   每个有副作用的控件都该有一个。事件、observer、计时器、rAF、弹簧、
   玻璃实例、子树，全部登记在同一个地方，销毁时倒序释放一次。

   两条硬规则：
   1) dispose() 幂等。第二次调用直接返回，不抛错、不重复回滚。
   2) dispose 只结束资源，不替调用方摘 DOM。要摘由调用方 remove 或重新渲染 ——
      「释放」和「移除」是两件事，混在一起会让复用节点的场景丢掉 DOM。
   ========================================================================== */

export function createDisposer() {
  /** @type {Array<() => void>} */
  let items = [];
  let disposed = false;

  /** 登记一个清理函数；返回可提前撤销登记的句柄（执行一次即摘除）。 */
  const add = (fn) => {
    if (typeof fn !== 'function') return () => {};
    if (disposed) {
      safe(fn);
      return () => {};
    }
    items.push(fn);
    let spent = false;
    return () => {
      if (spent) return;
      spent = true;
      const i = items.indexOf(fn);
      if (i >= 0) items.splice(i, 1);
      safe(fn);
    };
  };

  const api = {
    /** 任意清理函数 */
    add,

    /** 监听：自动 off，返回可提前解绑的句柄 */
    on(target, type, handler, opts) {
      if (!target?.addEventListener) return () => {};
      target.addEventListener(type, handler, opts);
      return add(() => target.removeEventListener(type, handler, opts));
    },

    /** ResizeObserver / MutationObserver / IntersectionObserver 统一断连 */
    observe(observer) {
      if (!observer?.disconnect) return () => {};
      return add(() => observer.disconnect());
    },

    /** 一次性计时器：触发后自动从登记簿摘除 */
    timeout(fn, ms) {
      let id = 0;
      const off = add(() => clearTimeout(id));
      id = setTimeout(() => {
        off();
        fn();
      }, ms);
      return off;
    },

    /** 间隔计时器 */
    interval(fn, ms) {
      const id = setInterval(fn, ms);
      return add(() => clearInterval(id));
    },

    /** 单次 rAF：触发后自动摘除；未触发就销毁则取消 */
    frame(fn) {
      let id = 0;
      const off = add(() => {
        if (id) cancelAnimationFrame(id);
        id = 0;
      });
      id = requestAnimationFrame(() => {
        id = 0;
        off();
        fn();
      });
      return off;
    },

    /** 弹簧 / 手势等带 stop() 的句柄 */
    stop(handle) {
      return add(() => handle?.stop?.());
    },

    /** 子树：按 disposeComponentTree 的约定递归释放 */
    child(node) {
      return add(() => disposeComponentTree(node));
    },

    get disposed() {
      return disposed;
    },

    /** 已登记数量；测试用它确认没有泄漏 */
    get size() {
      return items.length;
    },

    /** 倒序释放并清空。幂等。 */
    dispose() {
      if (disposed) return;
      disposed = true;
      const queue = items;
      items = [];
      for (let i = queue.length - 1; i >= 0; i--) safe(queue[i]);
    },
  };

  return api;
}

function safe(fn) {
  try {
    fn();
  } catch (err) {
    // 单个清理项失败不能阻断其余资源回收
    console.warn('[golden-gate] dispose 清理项失败', err);
  }
}
