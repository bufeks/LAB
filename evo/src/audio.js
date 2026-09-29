// Tiny synthesized sound effects; no audio files needed.

let ac = null;
let master = null;
let muted = false;

function ctx() {
  if (!ac) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 0.25;
      master.connect(ac.destination);
    } catch { return null; }
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }
export function unlockAudio() { ctx(); }

function tone(freq, dur, { type = 'sine', vol = 0.5, slide = 0, delay = 0 } = {}) {
  if (muted) return;
  const a = ctx();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, { vol = 0.4, freq = 800, delay = 0 } = {}) {
  if (muted) return;
  const a = ctx();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

let last = {};
function throttle(name, ms) {
  const now = performance.now();
  if (last[name] && now - last[name] < ms) return false;
  last[name] = now;
  return true;
}

export const sfx = {
  eat() { if (throttle('eat', 60)) tone(520 + Math.random() * 200, 0.08, { type: 'triangle', vol: 0.3, slide: 1.6 }); },
  dna() { if (throttle('dna', 80)) { tone(880, 0.07, { vol: 0.25 }); tone(1320, 0.1, { vol: 0.2, delay: 0.05 }); } },
  hit() { if (throttle('hit', 70)) { noise(0.12, { vol: 0.5, freq: 400 }); tone(180, 0.12, { type: 'square', vol: 0.15, slide: 0.5 }); } },
  hurt() { if (throttle('hurt', 150)) tone(220, 0.2, { type: 'sawtooth', vol: 0.2, slide: 0.5 }); },
  die() { tone(300, 0.6, { type: 'sawtooth', vol: 0.25, slide: 0.2 }); },
  level() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.3, delay: i * 0.09 })); },
  part() { [660, 880, 1175].forEach((f, i) => tone(f, 0.18, { type: 'sine', vol: 0.3, delay: i * 0.07 })); },
  click() { tone(700, 0.05, { type: 'square', vol: 0.1 }); },
  place() { tone(400, 0.08, { type: 'triangle', vol: 0.3, slide: 1.8 }); },
  remove() { tone(500, 0.1, { type: 'triangle', vol: 0.25, slide: 0.5 }); },
  sing() { [0, 4, 7].forEach((s, i) => tone(440 * 2 ** (s / 12), 0.3, { type: 'sine', vol: 0.25, delay: i * 0.12 })); },
  dance() { [0, 2].forEach((s, i) => noise(0.08, { vol: 0.4, freq: 2000, delay: i * 0.15 })); tone(330, 0.15, { type: 'square', vol: 0.1 }); },
  charm() { tone(660, 0.4, { type: 'sine', vol: 0.25, slide: 1.5 }); },
  pose() { tone(392, 0.25, { type: 'triangle', vol: 0.3 }); tone(523, 0.3, { type: 'triangle', vol: 0.3, delay: 0.15 }); },
  good() { tone(784, 0.12, { vol: 0.3 }); tone(1047, 0.2, { vol: 0.3, delay: 0.08 }); },
  bad() { tone(200, 0.25, { type: 'square', vol: 0.15, slide: 0.7 }); },
  zap() { if (throttle('zap', 100)) { noise(0.15, { vol: 0.4, freq: 3000 }); tone(1200, 0.12, { type: 'sawtooth', vol: 0.1, slide: 0.3 }); } },
  build() { noise(0.1, { vol: 0.3, freq: 300 }); tone(260, 0.1, { type: 'square', vol: 0.12, delay: 0.05 }); },
  warp() { tone(200, 0.8, { type: 'sine', vol: 0.3, slide: 6 }); },
  laser() { if (throttle('laser', 90)) tone(1400, 0.15, { type: 'sawtooth', vol: 0.12, slide: 0.2 }); },
  win() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.5, { type: 'triangle', vol: 0.3, delay: i * 0.13 })); },
};
