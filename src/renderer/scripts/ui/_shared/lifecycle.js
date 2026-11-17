// Golden Gate · _shared/lifecycle
import { disposeGlassTree } from '../../core/glass-lens.js';

/**
 * 显式释放一棵组件子树，不根据 isConnected 猜测组件是否已经废弃。
 * 各组件的 dispose 必须幂等；这里包含 root 自身，且不移除 root 的 DOM。
 */
export function disposeComponentTree(root) {
  if (!root) return;
  const nodes = [root];
  if (typeof root.querySelectorAll === 'function') nodes.push(...root.querySelectorAll('*'));
  for (const node of nodes) {
    if (typeof node.dispose === 'function') node.dispose();
  }
  disposeGlassTree(root);
}
