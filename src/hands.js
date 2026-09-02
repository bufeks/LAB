import { CONFIG } from './config.js';

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;
const MIDDLE_MCP = 9;

// Turns hand landmarks into a small set of pointers with a press/release state,
// so painting, the tool rail and the mouse can all share one code path.
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
      const gap = Math.hypot(
        (index.x - thumb.x) * width,
        (index.y - thumb.y) * height,
      );
      const ratio = gap / span;

      const id = `hand:${hand.id}`;
      seen.add(id);
      let s = this.state.get(id);

      // The pinch point sits between the fingertips, where the visitor is
      // looking, rather than at the index tip.
      const px = ((thumb.x + index.x) / 2) * width;
      const py = ((thumb.y + index.y) / 2) * height;

      if (!s) {
        s = { x: px, y: py, pinching: false };
        this.state.set(id, s);
      } else {
        const a = CONFIG.handSmoothing;
        s.x += (px - s.x) * (1 - a);
        s.y += (py - s.y) * (1 - a);
      }

      const was = s.pinching;
      s.pinching = was ? ratio < CONFIG.pinchOff : ratio < CONFIG.pinchOn;

      out.push({
        id,
        x: s.x,
        y: s.y,
        pinching: s.pinching,
        pressed: s.pinching && !was,
        released: !s.pinching && was,
        strength: 1 - Math.min(1, ratio / CONFIG.pinchOff),
      });
    }

    for (const [id, s] of this.state) {
      if (seen.has(id)) continue;
      this.state.delete(id);
      // A hand that leaves the frame mid-stroke must still end the stroke.
      if (s.pinching) {
        out.push({ id, x: s.x, y: s.y, pinching: false, pressed: false, released: true, strength: 0 });
      }
    }

    return out;
  }
}
