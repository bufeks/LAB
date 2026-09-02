import { CONFIG } from './config.js';

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const PALM = [0, 5, 9, 13, 17];

// tip / pip pairs for the four fingers that decide the pose.
const FINGERS = [
  { tip: 8, pip: 6 },    // index
  { tip: 12, pip: 10 },  // middle
  { tip: 16, pip: 14 },  // ring
  { tip: 20, pip: 18 },  // pinky
];

// Reads a hand as one of four intentions. Every action in the piece is a
// pose, so the classification has to be stable: a pose only takes over after
// it has persisted for a few frames, which stops the tool flickering while a
// hand is in transit between shapes.
export class Gestures {
  constructor() {
    this.state = new Map();
  }

  read(hands, width, height) {
    const seen = new Set();
    const out = [];

    for (const hand of hands) {
      const lm = hand.landmarks;
      const id = `hand:${hand.id}`;
      seen.add(id);

      const px = lm.map((p) => ({ x: p.x * width, y: p.y * height }));
      const span = dist(px[WRIST], px[MIDDLE_MCP]) || 1;

      // A finger is out when its tip has travelled further from the wrist
      // than its own middle joint. Scale-free, and it survives rotation.
      const extended = FINGERS.map((f) => dist(px[f.tip], px[WRIST]) > dist(px[f.pip], px[WRIST]) * 1.02);
      const count = extended.filter(Boolean).length;

      const pinchRatio = dist(px[THUMB_TIP], px[INDEX_TIP]) / span;
      // A closed fist also brings thumb and index together, so a pinch only
      // counts when the index is genuinely reaching forward.
      const indexReach = dist(px[INDEX_TIP], px[WRIST]) / span;

      let s = this.state.get(id);
      if (!s) {
        s = { pose: 'idle', candidate: 'idle', held: 0, since: 0, fast: false,
              x: 0, y: 0, vx: 0, vy: 0, seeded: false };
        this.state.set(id, s);
      }

      const pinching = s.pose === 'pinch'
        ? pinchRatio < CONFIG.gesture.pinchOff
        : pinchRatio < CONFIG.gesture.pinchOn;

      let pose = 'idle';
      if (pinching && indexReach > 1.35) pose = 'pinch';
      else if (count === 0) pose = 'fist';
      else if (extended[0] && count <= 2 && !extended[3]) pose = 'point';
      else if (count >= 3) pose = 'open';
      else pose = s.pose === 'idle' ? 'idle' : s.pose;

      if (pose === s.candidate) s.held++;
      else { s.candidate = pose; s.held = 1; }

      const previous = s.pose;
      if (s.held >= CONFIG.gesture.holdFrames && pose !== s.pose) {
        s.pose = pose;
        s.since = 0;
        s.fast = false;
      }
      s.since++;

      const anchor = anchorFor(s.pose, px);
      // Each pose acts from a different part of the hand, so a change of pose
      // teleports the anchor. Re-seeding rather than smoothing across that
      // jump is what stops the surface being yanked on every switch.
      if (!s.seeded || s.pose !== previous) {
        s.x = anchor.x; s.y = anchor.y; s.vx = 0; s.vy = 0; s.seeded = true;
      } else {
        const a = CONFIG.gesture.smoothing;
        const nx = s.x + (anchor.x - s.x) * (1 - a);
        const ny = s.y + (anchor.y - s.y) * (1 - a);
        s.vx = nx - s.x;
        s.vy = ny - s.y;
        s.x = nx;
        s.y = ny;
      }

      // While the fingers are still rearranging, the classifier and the hand
      // disagree and the anchor can jump between landmarks. A hand in transit
      // is disarmed, so a change of grip can never fire an action by itself.
      const settled = pose === s.pose;
      const speed = Math.hypot(s.vx, s.vy);
      const threshold = CONFIG.gesture.speed[s.pose] ?? Infinity;
      const fast = speed > threshold;
      // The rising edge is the action: one swing, one blot. Holding a hand
      // in motion does not keep firing.
      const struck = fast && !s.fast;
      s.fast = fast;

      out.push({
        id,
        pose: s.pose,
        entered: s.pose !== previous,
        // Held long enough to mean it. Until then the hand is only travelling.
        armed: settled && s.since >= CONFIG.gesture.armFrames,
        moving: fast,
        struck,
        x: s.x, y: s.y, vx: s.vx, vy: s.vy,
        // Where the hand actually is this frame. Smoothing is right for
        // dragging a finger, but a one-shot impact wants the truth: at throw
        // speed the smoothed point trails the hand by a visible margin.
        rawX: anchor.x, rawY: anchor.y,
        speed,
        span,
        points: px,
      });
    }

    for (const [id, s] of this.state) {
      if (seen.has(id)) continue;
      this.state.delete(id);
      // A hand leaving frame mid-gesture still has to end the gesture.
      if (s.pose !== 'idle') {
        out.push({
          id, pose: 'idle', entered: true, armed: false, moving: false, struck: false,
          x: s.x, y: s.y, rawX: s.x, rawY: s.y, vx: 0, vy: 0, speed: 0, span: 1, points: null,
        });
      }
    }

    return out;
  }
}

// Where the pose "acts from": the fingertip when pointing, the knuckles when
// throwing, the centre of the palm when pouring.
function anchorFor(pose, px) {
  if (pose === 'point') return px[INDEX_TIP];
  if (pose === 'pinch') {
    return { x: (px[THUMB_TIP].x + px[INDEX_TIP].x) / 2, y: (px[THUMB_TIP].y + px[INDEX_TIP].y) / 2 };
  }
  if (pose === 'open') {
    let x = 0, y = 0;
    for (const i of PALM) { x += px[i].x; y += px[i].y; }
    return { x: x / PALM.length, y: y / PALM.length };
  }
  return px[MIDDLE_MCP];
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
