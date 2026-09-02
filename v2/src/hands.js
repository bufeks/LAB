import { CONFIG } from './config.js';

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;
const MIDDLE_MCP = 9;

// Pinch-driven pointers, with the per-frame velocity that directional
// spatter needs.
export class HandPointers {
  constructor() {
    this.state = new Map();
  }

  update(hands, width, height) {
    const seen = new Set();
    const out = [];

    for (const hand of hands) {
      const lm = hand.landmarks;
      const thumb = lm[THUMB_TIP];
      const index = lm[INDEX_TIP];
      const span = Math.hypot(
        (lm[MIDDLE_MCP].x - lm[WRIST].x) * width,
        (lm[MIDDLE_MCP].y - lm[WRIST].y) * height,
      ) || 1;
      const gap = Math.hypot((index.x - thumb.x) * width, (index.y - thumb.y) * height);
      const ratio = gap / span;

      const id = `hand:${hand.id}`;
      seen.add(id);
      const px = ((thumb.x + index.x) / 2) * width;
      const py = ((thumb.y + index.y) / 2) * height;

      let s = this.state.get(id);
      if (!s) {
        s = { x: px, y: py, vx: 0, vy: 0, pinching: false };
        this.state.set(id, s);
      } else {
        const a = CONFIG.handSmoothing;
        const nx = s.x + (px - s.x) * (1 - a);
        const ny = s.y + (py - s.y) * (1 - a);
        s.vx = nx - s.x;
        s.vy = ny - s.y;
        s.x = nx;
        s.y = ny;
      }

      const was = s.pinching;
      s.pinching = was ? ratio < CONFIG.pinchOff : ratio < CONFIG.pinchOn;

      out.push({
        id, x: s.x, y: s.y, vx: s.vx, vy: s.vy,
        pinching: s.pinching,
        pressed: s.pinching && !was,
        released: !s.pinching && was,
      });
    }

    for (const [id, s] of this.state) {
      if (seen.has(id)) continue;
      this.state.delete(id);
      // A hand leaving the frame mid-gesture still has to end the gesture.
      if (s.pinching) {
        out.push({ id, x: s.x, y: s.y, vx: 0, vy: 0, pinching: false, pressed: false, released: true });
      }
    }

    return out;
  }
}
