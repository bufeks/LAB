import { CONFIG } from './config.js';

const PALM = [0, 5, 9, 13, 17];
const CHAINS = [
  [0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16], [0, 17, 18, 19, 20],
];

// Where the visitor's own hands are, in display space.
//
// Selfie segmentation counts hands as part of the person, so paint aimed at a
// face would also appear on the hand held in front of it. This is subtracted
// from the paint mask, which both removes that and gives the hand the right
// behaviour: it occludes the coat while it is there, and what is underneath
// comes back when it moves away.
export class HandMask {
  constructor(width, height) {
    const w = CONFIG.handMaskWidth;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = Math.max(1, Math.round((w * height) / width));
    this.ctx = this.canvas.getContext('2d');
    this.scaleX = this.canvas.width / width;
    this.scaleY = this.canvas.height / height;
    this.active = false;
  }

  update(hands) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const drawn = hands.filter((h) => h.points);
    this.active = drawn.length > 0;
    if (!this.active) return;

    // Work in screen pixels and let the transform do the scaling, so the
    // dilation is expressed in the same units as the hand's own size.
    ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const hand of drawn) {
      const p = hand.points;
      const grow = hand.span * CONFIG.handDilate;

      ctx.lineWidth = hand.span * 0.3 + grow;
      ctx.beginPath();
      PALM.forEach((i, n) => (n ? ctx.lineTo(p[i].x, p[i].y) : ctx.moveTo(p[i].x, p[i].y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.lineWidth = hand.span * 0.24 + grow;
      for (const chain of CHAINS) {
        ctx.beginPath();
        chain.forEach((i, n) => (n ? ctx.lineTo(p[i].x, p[i].y) : ctx.moveTo(p[i].x, p[i].y)));
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
