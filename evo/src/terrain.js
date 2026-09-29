// Procedural island shared by the land stages. Heights are sampled once into
// a grid (for walkability) and painted once into an offscreen image.

import { makeNoise, clamp, lerp } from './util.js';

export const SEA = 0.3;

export class Terrain {
  constructor(size, seed, style = 'wild') {
    this.size = size;
    this.style = style;
    const n1 = makeNoise(seed), n2 = makeNoise(seed + 7), n3 = makeNoise(seed + 13);
    this.n3 = n3;
    const half = size / 2;
    const hf = (x, y) => {
      const dx = (x - half) / half, dy = (y - half) / half;
      const d = Math.sqrt(dx * dx + dy * dy);
      const warp = n2(x / 500, y / 500, 2) * 0.35;
      return n1(x / 800 + warp, y / 800, 5) * 0.75 + n2(x / 220, y / 220, 3) * 0.25 + 0.12 - Math.pow(d, 2.4) * 0.85;
    };
    this.hf = hf;

    // height grid
    const G = (this.gs = 16);
    const n = (this.gn = Math.ceil(size / G) + 1);
    this.grid = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.grid[j * n + i] = hf(i * G, j * G);

    this.paint();
  }

  height(x, y) {
    const G = this.gs, n = this.gn;
    const fx = clamp(x / G, 0, n - 1.001), fy = clamp(y / G, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const g = this.grid;
    return lerp(lerp(g[j * n + i], g[j * n + i + 1], tx), lerp(g[(j + 1) * n + i], g[(j + 1) * n + i + 1], tx), ty);
  }

  isLand(x, y) {
    if (x < 0 || y < 0 || x > this.size || y > this.size) return false;
    return this.height(x, y) > SEA + 0.015;
  }

  isForest(x, y) { return this.n3(x / 260, y / 260, 3) > 0.55 && this.height(x, y) > SEA + 0.05 && this.height(x, y) < 0.62; }

  paint() {
    const R = 5;
    const w = Math.ceil(this.size / R);
    const cv = document.createElement('canvas');
    cv.width = cv.height = w;
    const c = cv.getContext('2d');
    const img = c.createImageData(w, w);
    const d = img.data;
    const civ = this.style === 'civ';
    for (let j = 0; j < w; j++) {
      for (let i = 0; i < w; i++) {
        const x = i * R, y = j * R;
        const h = this.height(x, y);
        const hx = this.height(x + R * 2, y) - h, hy = this.height(x, y + R * 2) - h;
        const shade = clamp(1 - (hx + hy) * 18, 0.7, 1.25);
        let r, g, b;
        if (h < SEA) {
          const t = clamp((SEA - h) / 0.3, 0, 1);
          r = lerp(60, 14, t); g = lerp(150, 50, t); b = lerp(170, 110, t);
          const wave = Math.sin(x * 0.05 + y * 0.03) * 0.5 + 0.5;
          if (h > SEA - 0.02) { r += 60 * wave; g += 60 * wave; b += 50 * wave; }
        } else if (h < SEA + 0.04) {
          r = 222; g = 206; b = 150;
        } else if (h > 0.66) {
          const t = clamp((h - 0.66) / 0.15, 0, 1);
          r = lerp(130, 235, t); g = lerp(122, 235, t); b = lerp(110, 240, t);
        } else {
          const f = this.isForest(x, y);
          const t = clamp((h - SEA) / 0.35, 0, 1);
          if (civ) { r = lerp(120, 90, t); g = lerp(170, 130, t); b = lerp(90, 70, t); }
          else { r = lerp(110, 70, t); g = lerp(175, 140, t); b = lerp(80, 60, t); }
          if (f) { r *= 0.62; g *= 0.78; b *= 0.62; }
          const speck = this.n3(x / 30, y / 30, 1);
          r += (speck - 0.5) * 18; g += (speck - 0.5) * 22;
        }
        const k = (j * w + i) * 4;
        d[k] = r * shade; d[k + 1] = g * shade; d[k + 2] = b * shade; d[k + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    this.image = cv;
    this.res = R;
  }

  draw(ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.image, 0, 0, this.size + this.res, this.size + this.res);
  }

  randomLand(r, minH = SEA + 0.05, maxH = 0.64, tries = 200) {
    for (let i = 0; i < tries; i++) {
      const x = r.range(100, this.size - 100), y = r.range(100, this.size - 100);
      const h = this.height(x, y);
      if (h > minH && h < maxH) return { x, y };
    }
    return { x: this.size / 2, y: this.size / 2 };
  }

  // Draw the island as a minimap into a small canvas-sized box.
  drawMini(ctx, x, y, s) {
    ctx.drawImage(this.image, x, y, s, s);
  }
}
