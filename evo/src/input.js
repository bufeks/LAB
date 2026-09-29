// Keyboard / mouse / touch state, polled once per frame by the active scene.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, down: false, right: false, moved: false };
    this.clicks = [];      // {x, y, button, shift}
    this.drag = null;      // {x0, y0, x, y} while left button is held
    this.dragEnd = null;   // finished drag rectangle, one frame
    this.wheel = 0;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = this.mouse.right = false; });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pos(e);
      if (e.button === 2) { this.mouse.right = true; return; }
      this.mouse.down = true;
      this.drag = { x0: this.mouse.x, y0: this.mouse.y, x: this.mouse.x, y: this.mouse.y, touch: e.pointerType === 'touch' };
    });
    canvas.addEventListener('pointermove', (e) => {
      this.pos(e);
      this.mouse.moved = true;
      if (this.drag) { this.drag.x = this.mouse.x; this.drag.y = this.mouse.y; }
    });
    canvas.addEventListener('pointerup', (e) => {
      this.pos(e);
      if (e.button === 2) {
        this.mouse.right = false;
        this.clicks.push({ x: this.mouse.x, y: this.mouse.y, button: 2, shift: e.shiftKey });
        return;
      }
      this.mouse.down = false;
      const d = this.drag;
      this.drag = null;
      if (d && Math.hypot(d.x - d.x0, d.y - d.y0) > 8) this.dragEnd = d;
      else this.clicks.push({ x: this.mouse.x, y: this.mouse.y, button: 0, shift: e.shiftKey, touch: d?.touch });
    });
    canvas.addEventListener('pointercancel', () => { this.mouse.down = false; this.drag = null; });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
  }

  isDown(...codes) { return codes.some((c) => this.keys.has(c)); }
  wasPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }

  // WASD / arrows as a vector.
  axis() {
    let x = 0, y = 0;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y -= 1;
    if (this.isDown('KeyS', 'ArrowDown')) y += 1;
    const l = Math.hypot(x, y);
    return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  }

  endFrame() {
    this.pressed.clear();
    this.clicks.length = 0;
    this.dragEnd = null;
    this.wheel = 0;
    this.mouse.moved = false;
  }
}
