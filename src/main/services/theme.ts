import * as fs from 'fs';

interface HSLColor {
  dominant: string;
  palette: string[];
}

/**
 * Extract accent colors from a background image.
 * Since we can't decode JPEG/PNG server-side without sharp,
 * we read a header-relative sample and return best-effort results.
 * Real extraction should use Canvas API in renderer.
 */
export async function extractThemeColors(imagePath: string): Promise<HSLColor> {
  try {
    const buf = fs.readFileSync(imagePath);
    // Sample from the file at varying offsets (avoid headers)
    const colors = quickSample(buf);
    if (colors.length > 0 && colors[0] !== '#000000') {
      return { dominant: colors[0], palette: colors.slice(0, 5) };
    }
    return { dominant: '#60CDFF', palette: ['#60CDFF'] };
  } catch {
    return { dominant: '#60CDFF', palette: ['#60CDFF'] };
  }
}

function quickSample(buf: Buffer): string[] {
  const colors = new Map<string, { r: number; g: number; b: number; count: number }>();
  // Sample from multiple positions in the file
  const samplePoints = 500;
  const quarter = Math.floor(buf.length / 4);
  const half = Math.floor(buf.length / 2);

  for (let p = 0; p < samplePoints; p++) {
    // Pick positions from middle of file (where pixel-like data might be)
    const pos = quarter + Math.floor(p * (buf.length - quarter * 2) / samplePoints);
    if (pos + 2 >= buf.length) continue;
    const r = buf[pos];
    const g = buf[pos + 1];
    const b = buf[pos + 2];

    // Skip obviously non-color data
    const brightness = (r + g + b) / 3;
    if (brightness < 20 || brightness > 235) continue;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    if (maxC - minC < 20) continue; // Skip near-gray

    const qr = Math.round(r / 16) * 16;
    const qg = Math.round(g / 16) * 16;
    const qb = Math.round(b / 16) * 16;
    const key = `${qr},${qg},${qb}`;

    const existing = colors.get(key);
    if (existing) existing.count++;
    else colors.set(key, { r: qr, g: qg, b: qb, count: 1 });
  }

  // Score by vividness
  const scored = [...colors.values()].map(c => {
    const maxC = Math.max(c.r, c.g, c.b);
    const minC = Math.min(c.r, c.g, c.b);
    const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
    return { ...c, score: sat * c.count };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map(c => rgbToHex(c.r, c.g, c.b));
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}
