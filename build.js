/**
 * Build script — generates index.html from template + sources.
 * Run: node build.js
 * Output: src/renderer/index.html (self-contained, all CSS+JS inlined)
 */
const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, 'src', 'renderer');
const TEMPLATE = path.join(RENDERER, 'index_cn.html');
const OUTPUT = path.join(RENDERER, 'index.html');

// 1. Read template
let html = fs.readFileSync(TEMPLATE, 'utf8');

// 2. Inline CSS
const cssFiles = ['styles/win11-vars.css', 'styles/theme.css', 'styles/layout.css'];
let css = '';
for (const f of cssFiles) {
  css += fs.readFileSync(path.join(RENDERER, f), 'utf8') + '\n';
}
html = html.replace('</head>', `<style>\n${css}\n</style>\n</head>`);

// 3. Inline JS
const scriptFiles = [
  'constants.js', 'utils.js', 'state.js', 'api.js',
  'modal.js', 'toast.js', 'context-menu.js', 'lightbox.js',
  'renderer.js', 'discover.js', 'theme-extractor.js', 'settings.js', 'app.js',
];
let js = '';
for (const f of scriptFiles) {
  js += `\n// ====== ${f} ======\n`;
  js += fs.readFileSync(path.join(RENDERER, 'scripts', f), 'utf8') + '\n';
}
html = html.replace(
  '<script src="scripts/all-inline.js"></script>',
  `<script>\n${js}\n</script>`
);

// 4. Write output
fs.writeFileSync(OUTPUT, html, 'utf8');
console.log(`✅ Built ${OUTPUT} (${(html.length / 1024).toFixed(0)} KB)`);
