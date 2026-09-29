// Shared game object. Scenes import this; main.js fills in the factories
// so the stage modules never import each other.

import { ui } from './ui.js';
import { writeSave, STAGES } from './save.js';

export const game = {
  canvas: null,
  ctx: null,
  input: null,
  w: 1, h: 1, dpr: 1,
  time: 0,
  save: null,
  scene: null,
  factories: {},   // name -> (opts) => scene

  setScene(scene) {
    this.scene?.exit?.();
    ui.clear();
    document.querySelectorAll('.modal-back').forEach((m) => m.remove());
    this.scene = scene;
    scene.enter?.();
  },

  go(name, opts) { this.setScene(this.factories[name](opts)); },

  persist() { if (this.save) writeSave(this.save); },

  // Mark a stage reached and show its title card first.
  startStage(stage) {
    const s = this.save;
    s.stage = stage;
    if (!s.reached.includes(stage)) s.reached.push(stage);
    s.reached.sort((a, b) => STAGES.indexOf(a) - STAGES.indexOf(b));
    this.persist();
    this.go('card', { stage });
  },
};
