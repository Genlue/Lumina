// 模块回归使用与文档相同的机器清单。
export const componentCatalog = await fetch('../docs/component-manifest.json').then(r => {
  if (!r.ok) throw new Error('控件机器清单加载失败');
  return r.json();
});
