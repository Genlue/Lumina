// ============================================================
// Photo Album — Adaptive Theme Color Extraction (Canvas + WCAG)
// ============================================================

/**
 * WCAG 2.0 relative luminance
 */
function relativeLuminance(r, g, b) {
  const c = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * WCAG contrast ratio between two RGB colors
 */
function contrastRatio(r1, g1, b1, r2, g2, b2) {
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Parse hex color to RGB
 */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * RGB to HSL
 */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, l };
}

/**
 * HSL to RGB
 */
function hslToRgb(h, s, l) {
  h /= 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return { r: Math.round(hue2rgb(h + 1/3) * 255), g: Math.round(hue2rgb(h) * 255), b: Math.round(hue2rgb(h - 1/3) * 255) };
}

/**
 * Adaptive accent extraction
 * - Samples pixels from a Canvas-rendered image
 * - Scores by vividness (saturation × count)
 * - Tests top 5 candidates against current theme background contrast
 * - If none pass, adjusts lightness via HSL while preserving hue
 */
async function extractAccentFromImage(dataUrl) {
  try {
    // Fetch as blob → blob URL to avoid canvas tainting.
    // Tauri asset protocol URLs (https://asset.localhost/…) are cross-origin
    // and would taint the canvas, causing getImageData() to throw SecurityError.
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);
        try {
          // Step 1: sample pixels
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 100;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 100, 100);
          const pixels = ctx.getImageData(0, 0, 100, 100).data;

          const colorMap = new Map();
          for (let i = 0; i < pixels.length; i += 16) {
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
            if (a < 128) continue;
            const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
            const bright = (r + g + b) / 3;
            if (bright < 25 || bright > 230) continue;
            const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
            if (sat < 0.2) continue;

            const qr = Math.round(r / 8) * 8, qg = Math.round(g / 8) * 8, qb = Math.round(b / 8) * 8;
            const key = `${qr},${qg},${qb}`;
            const ex = colorMap.get(key);
            if (ex) ex.count++; else colorMap.set(key, { r: qr, g: qg, b: qb, count: 1 });
          }

          const scored = [...colorMap.values()].map(c => {
            const maxC = Math.max(c.r, c.g, c.b), minC = Math.min(c.r, c.g, c.b);
            return { ...c, score: (maxC === 0 ? 0 : (maxC - minC) / maxC) * c.count };
          });
          scored.sort((a, b) => b.score - a.score);

          if (scored.length === 0) {
            resolve({ dominant: '#60CDFF', palette: ['#60CDFF'] });
            return;
          }

          const palette = scored.slice(0, 5).map(c => rgbToHex(c.r, c.g, c.b));

          // Step 2: determine current theme background for contrast comparison
          const isDark = (App?._settings?.theme_mode ?? 'dark') === 'dark';
          const bgHex = isDark ? '#1c1c1c' : '#f3f3f3';
          const bgRgb = hexToRgb(bgHex);

          // Step 3: find first candidate with sufficient contrast (≥ 3.0 for accent)
          const MIN_CONTRAST = 5.0; // WCAG AAA for large text, ~AA for normal text
          let bestColor = null;
          for (const hex of palette) {
            const rgb = hexToRgb(hex);
            if (contrastRatio(rgb.r, rgb.g, rgb.b, bgRgb.r, bgRgb.g, bgRgb.b) >= MIN_CONTRAST) {
              bestColor = hex;
              break;
            }
          }

          // Step 4: if none pass, HSL-adapt the top candidate
          if (!bestColor) {
            const top = hexToRgb(palette[0]);
            const hsl = rgbToHsl(top.r, top.g, top.b);

            // Boost saturation slightly
            hsl.s = Math.min(1, hsl.s + 0.15);

            // Adjust lightness for contrast against background
            if (isDark) {
              // On dark bg: lighten to at least 55% for good contrast
              hsl.l = Math.max(0.55, hsl.l);
            } else {
              // On light bg: darken to at most 40% for good contrast
              hsl.l = Math.min(0.40, hsl.l);
            }

            const adapted = hslToRgb(hsl.h, hsl.s, hsl.l);
            bestColor = rgbToHex(adapted.r, adapted.g, adapted.b);
          }

          resolve({ dominant: bestColor, palette: [bestColor, ...palette.slice(0, 4)] });
        } catch (e) {
          resolve({ dominant: '#60CDFF', palette: ['#60CDFF'] });
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        resolve({ dominant: '#60CDFF', palette: ['#60CDFF'] });
      };
      img.src = blobUrl;
    });
  } catch (e) {
    return { dominant: '#60CDFF', palette: ['#60CDFF'] };
  }
}
