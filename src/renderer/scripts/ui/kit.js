// Golden Gate · 兼容总入口。实现位于分类目录；可直接导入具体控件以缩小依赖范围。
export { disposeComponentTree } from './_shared/lifecycle.js';
export { createDisposer } from './_shared/disposer.js';
export { createSelection } from './_shared/selection.js';
export { focusScope, openLayer, closeLayer, layerDepth } from './_shared/overlay.js';
export { CommandRegistry, UndoManager } from './_shared/commands.js';
export * from './controls/index.js';
export * from './forms/index.js';
export * from './surfaces/index.js';
export * from './navigation/index.js';
export * from './content/index.js';
export * from './collections/index.js';
export * from './overlays/index.js';
export * from './appearance/index.js';
export * from './panels/index.js';
