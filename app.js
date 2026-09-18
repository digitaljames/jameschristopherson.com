'use strict';

/* ==================================================================
   James Christopherson — Winamp-style personal site
   - Web Audio synth "track" (generated live, no audio files)
   - Real 10-band EQ, volume, balance, seek, spectrum / scope
   - Draggable, collapsible windows on a Windows 95 desktop
=================================================================== */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ------------------------------------------------------------------
   Slider — pointer + keyboard, works with any ancestor CSS transform
------------------------------------------------------------------- */
class Slider {
  constructor(el, opts = {}) {
    Object.assign(this, { min: 0, max: 100, step: 1, big: 10, vertical: false,
      fmt: v => String(v), value: 0, disabled: () => false }, opts);
    this.el = el;
    this.thumb = el.querySelector('.thumb');
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-valuemin', this.min);
    el.setAttribute('aria-valuemax', this.max);
    if (this.vertical) el.setAttribute('aria-orientation', 'vertical');
    this.render();

    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.disabled()) return;
      el.setPointerCapture(e.pointerId);
      el.classList.add('drag');
      this.dragging = true;
      this.onStart?.();
      this.update(e);
    });
    el.addEventListener('pointermove', e => { if (this.dragging) this.update(e); });
    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      el.classList.remove('drag');
      this.onEnd?.(this.value);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    if (opts.resetTo !== undefined) {
      el.addEventListener('dblclick', () => this.commit(opts.resetTo));
    }
    el.addEventListener('keydown', e => {
      if (this.disabled()) return;
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: this.big, PageDown: -this.big }[e.key];
      let v;
      if (d !== undefined) v = this.value + d * this.step;
      else if (e.key === 'Home') v = this.min;
      else if (e.key === 'End') v = this.max;
      else return;
      e.preventDefault();
      this.onStart?.();
      this.commit(v);
      this.onEnd?.(this.value);
    });
  }

  get p() { return (this.value - this.min) / (this.max - this.min); }

  set(v) { this.value = this.snap(v); this.render(); }

  snap(v) { return clamp(Math.round(v / this.step) * this.step, this.min, this.max); }

  commit(v) {
    const nv = this.snap(v);
    if (nv === this.value) return;
    this.value = nv;
    this.render();
    this.onInput?.(nv);
  }

  render() {
    this.el.style.setProperty('--p', this.p);
    this.el.setAttribute('aria-valuenow', this.value);
    this.el.setAttribute('aria-valuetext', this.fmt(this.value));
  }

  update(e) {
    const r = this.el.getBoundingClientRect();
    const size = this.vertical ? this.el.offsetHeight : this.el.offsetWidth;
    const k = (this.vertical ? r.height : r.width) / size || 1;      // current visual scale
    const tw = this.vertical ? this.thumb.offsetHeight : this.thumb.offsetWidth;
    const pos = (this.vertical ? e.clientY - r.top : e.clientX - r.left) / k;
    let p = clamp((pos - tw / 2) / (size - tw), 0, 1);
    if (this.vertical) p = 1 - p;
    this.commit(this.min + p * (this.max - this.min));
  }
}

/* ------------------------------------------------------------------
   Seven-segment time display
------------------------------------------------------------------- */
const timeUI = (() => {
  const svg = $('#time-svg');
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (n, a, parent = svg) => {
    const e = document.createElementNS(NS, n);
    for (const k in a) e.setAttribute(k, a[k]);
    parent.appendChild(e);
    return e;
  };
  const SEG_RECTS = {
    a: [1, 0, 7, 2], b: [7, 1, 2, 5.5], c: [7, 6.5, 2, 5.5],
    d: [1, 11, 7, 2], e: [0, 6.5, 2, 5.5], f: [0, 1, 2, 5.5], g: [1, 5.5, 7, 2],
  };
  const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
  const minus = mk('rect', { x: 0, y: 5.5, width: 7, height: 2 });
  const digits = [10, 21, 39, 50].map(x => {
    const segs = {};
    for (const [k, [sx, sy, w, h]] of Object.entries(SEG_RECTS)) {
      segs[k] = mk('rect', { x: x + sx, y: sy, width: w, height: h });
    }
    return segs;
  });
  mk('rect', { x: 33, y: 3.5, width: 2, height: 2, class: 'on' });
  mk('rect', { x: 33, y: 8.5, width: 2, height: 2, class: 'on' });

  return {
    show(seconds, negative) {
      const s = Math.max(0, Math.floor(seconds));
      const vals = [Math.floor(s / 600) % 10, Math.floor(s / 60) % 10, Math.floor((s % 60) / 10), s % 10];
      vals.forEach((v, i) => {
        for (const k in digits[i]) digits[i][k].classList.toggle('on', DIGITS[v].includes(k));
      });
      minus.classList.toggle('on', negative);
    },
  };
})();

/* ------------------------------------------------------------------
   Audio engine — a small generative synth-pop track, ~1:36
------------------------------------------------------------------- */
const BPM = 120;
const STEP = 60 / BPM / 4;            // one 16th note
const BARS = 48;
const STEPS = BARS * 16;
const DURATION = STEPS * STEP;         // 96s
const LOOKAHEAD = 0.8;

const EQ_FREQS  = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const EQ_LABELS = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];
const EQ_PRESETS = {
  FLAT:   { pre: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ROCK:   { pre: -2, bands: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5] },
  POP:    { pre: -1, bands: [-1, 2, 4, 5, 3, 0, -1, -1, -1, -1] },
  TECHNO: { pre: -2, bands: [4, 3, 0, -3, -2, 0, 3, 5, 5, 4] },
  BASS:   { pre: -3, bands: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0] },
  TREBLE: { pre: -2, bands: [0, 0, 0, 0, 0, 1, 3, 5, 7, 8] },
};

const eqState = { on: true, pre: 0, bands: new Array(10).fill(0), name: 'FLAT' };

const CHORDS = [ { root: 45, third: 3 }, { root: 41, third: 4 }, { root: 48, third: 4 }, { root: 43, third: 4 } ]; // Am F C G
const LEAD_A = [[0, 'R', 3], [4, 'F', 2], [6, 'O', 2], [8, 'T', 3], [12, 'F', 2], [14, 'T', 2]];
const LEAD_B = [[0, 'O', 4], [4, 'N', 2], [6, 'O', 2], [8, 'F', 4], [12, 'T', 2], [14, 'R', 2]];
const BASS_HITS = [0, 3, 6, 8, 11, 14];
const midi = m => 440 * Math.pow(2, (m - 69) / 12);

const engine = {
  ctx: null, session: null, timer: 0,
  state: 'stopped',           // stopped | playing | paused
  offset: 0, startCtx: 0, startOffset: 0, step: 0, nextTime: 0,
  volume: 0.75, pan: 0,

  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.eqIn = ctx.createGain();
    this.preamp = ctx.createGain();
    this.filters = EQ_FREQS.map(f => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.1;
      return b;
    });
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    this.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();

    let node = this.eqIn;
    const chain = [this.preamp, ...this.filters, this.analyser, this.panner, this.master, this.comp, ctx.destination].filter(Boolean);
    for (const n of chain) { node.connect(n); node = n; }

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.applyEQ(); this.applyVolume(); this.applyPan();
    ui.onCtxReady(ctx);
  },

  applyEQ() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.preamp.gain.setTargetAtTime(eqState.on ? Math.pow(10, eqState.pre / 20) : 1, t, 0.01);
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(eqState.on ? eqState.bands[i] : 0, t, 0.01));
  },
  applyVolume() { if (this.ctx) this.master.gain.setTargetAtTime(Math.pow(this.volume, 1.6), this.ctx.currentTime, 0.01); },
  applyPan()    { if (this.panner) this.panner.pan.setTargetAtTime(this.pan, this.ctx.currentTime, 0.01); },

  elapsed() {
    if (this.state !== 'playing') return this.offset;
    return Math.min(DURATION, this.startOffset + Math.max(0, this.ctx.currentTime - this.startCtx));
  },

  /* ----- transport ----- */
  play(from = 0) {
    this.init();
    this.ctx.resume();
    this.killSession();
    const s = clamp(Math.round(from / STEP), 0, STEPS - 1);
    this.step = s;
    this.startOffset = s * STEP;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.startCtx = this.nextTime;
    this.newSession();
    this.timer = setInterval(() => this.tick(), 50);
    this.tick();
    this.setState('playing');
  },
  pause() {
    if (this.state === 'playing') {
      this.offset = this.elapsed();
      this.killSession();
      this.setState('paused');
    } else if (this.state === 'paused') {
      this.play(this.offset);
    }
  },
  stop() {
    if (this.state === 'stopped') return;
    this.killSession();
    this.offset = 0;
    this.setState('stopped');
  },
  seek(sec) {
    sec = clamp(sec, 0, DURATION - STEP);
    if (this.state === 'playing') this.play(sec);
    else if (this.state === 'paused') { this.offset = sec; ui.kick(); }
  },
  ended() {
    if (ui.repeat) this.play(0); else this.stop();
  },
  setState(s) { this.state = s; ui.onState(s); },

  /* ----- scheduling ----- */
  newSession() {
    const ctx = this.ctx;
    const bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(this.eqIn);
    const delay = ctx.createDelay(1); delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.33;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(bus);
    this.session = { bus, delay, fb, wet };
  },
  killSession() {
    clearInterval(this.timer);
    const s = this.session;
    if (!s) return;
    this.session = null;
    s.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.012);
    setTimeout(() => { for (const n of Object.values(s)) n.disconnect(); }, 400);
  },
  tick() {
    const ctx = this.ctx;
    while (this.session && this.step < STEPS && this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  },

  scheduleStep(s, t) {
    const bar = Math.floor(s / 16), sp = s % 16;
    const c = CHORDS[bar % 4];
    const breakdown = bar >= 32 && bar < 40;
    const outro = bar >= 46;
    const drums = bar >= 8 && !breakdown && !outro;
    const off = { R: 0, T: c.third, F: 7, O: 12, N: 14 };

    if (sp === 0) {                                             // pad: one held chord per bar
      for (const k of [0, c.third, 7]) {
        for (const det of [-9, 9]) {
          this.tone({ type: 'sawtooth', freq: midi(c.root + 12 + k), t, dur: 16 * STEP + 0.4,
                      vol: 0.02, a: 0.5, r: 0.6, lp: 1100, det });
        }
      }
    }
    if (bar >= 4) {                                             // arpeggio
      const k = [0, c.third, 7, c.third][sp % 4];
      this.tone({ type: 'square', freq: midi(c.root + 12 + k), t, dur: STEP * 0.9,
                  vol: 0.028, a: 0.003, r: 0.03, lp: 2600 });
    }
    if (bar >= 8 && !outro && BASS_HITS.includes(sp)) {         // bass
      const up = sp === 6 || sp === 14 ? 12 : 0;
      this.tone({ type: 'sawtooth', freq: midi(c.root + up), t, dur: STEP * 2, vol: 0.13,
                  a: 0.004, r: 0.05, lp: 650 });
    }
    if (drums && sp % 4 === 0) this.kick(t);
    if (drums && bar >= 12 && (sp === 4 || sp === 12)) this.snare(t);
    if ((bar >= 8 && !outro) && sp % 2 === 0) this.hat(t, sp === 14);

    const lead = (bar >= 16 && bar < 32) || (bar >= 40 && bar < 46);
    if (lead) {
      for (const [ls, name, len] of (bar % 8 < 4 ? LEAD_A : LEAD_B)) {
        if (ls === sp) {
          this.tone({ type: 'sawtooth', freq: midi(c.root + 24 + off[name]), t, dur: len * STEP,
                      vol: 0.05, a: 0.01, r: 0.08, lp: 3200, send: true });
        }
      }
    }
  },

  /* ----- voices ----- */
  tone({ type, freq, t, dur, vol, a = 0.005, r = 0.05, lp, det = 0, send = false }) {
    const ctx = this.ctx, s = this.session;
    if (!s) return;
    a = Math.min(a, dur * 0.5); r = Math.min(r, dur * 0.5);
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = det;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + dur - r);
    g.gain.linearRampToValueAtTime(0, t + dur);
    let n = o;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); n = f; }
    n.connect(g); g.connect(s.bus);
    if (send) g.connect(s.delay);
    o.start(t); o.stop(t + dur + 0.02);
  },
  kick(t) {
    const ctx = this.ctx, s = this.session; if (!s) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(s.bus); o.start(t); o.stop(t + 0.32);
  },
  noiseHit(t, { hp, vol, dur }) {
    const ctx = this.ctx, s = this.session; if (!s) return;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(s.bus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  },
  snare(t) {
    this.noiseHit(t, { hp: 1500, vol: 0.3, dur: 0.18 });
    this.tone({ type: 'triangle', freq: 190, t, dur: 0.1, vol: 0.18, a: 0.002, r: 0.08 });
  },
  hat(t, open) { this.noiseHit(t, { hp: 7000, vol: open ? 0.1 : 0.08, dur: open ? 0.25 : 0.05 }); },
};

/* ------------------------------------------------------------------
   UI: state, marquee, time, visualizer
------------------------------------------------------------------- */
const ui = {
  repeat: false, remaining: false, seeking: false, seekValue: 0, raf: 0,

  kick() { if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()); },

  frame() {
    this.raf = 0;
    if (engine.state === 'playing' && engine.elapsed() >= DURATION - 0.001) { engine.ended(); }
    const e = this.seeking ? this.seekValue : engine.elapsed();
    this.updateTime(e);
    const vizAlive = viz.draw();
    if (engine.state === 'playing' || vizAlive || this.seeking) this.kick();
  },

  updateTime(e) {
    const stopped = engine.state === 'stopped' && !this.seeking;
    const neg = this.remaining && !stopped;
    timeUI.show(neg ? DURATION - e : e, neg);
    if (!this.seeking) seek.set(e);
    $('#pl-time').textContent = `${mmss(e)}/${mmss(DURATION)}`;
  },

  onCtxReady(ctx) { this.khz = Math.round(ctx.sampleRate / 1000); },

  onState(s) {
    $('#state-icon').dataset.state = s;
    $('#time').classList.toggle('blink', s === 'paused');
    $$('[data-act="play"]').forEach(b => b.toggleAttribute('data-down', s === 'playing'));
    $$('[data-act="pause"]').forEach(b => b.toggleAttribute('data-down', s === 'paused'));
    $('#s-seek').classList.toggle('idle', s === 'stopped');
    $('#chan-stereo').classList.toggle('on', s === 'playing');
    $('#kbps').textContent = s === 'stopped' ? '---' : '128';
    $('#khz').textContent = s === 'stopped' ? '--' : String(this.khz || 44);
    $('#status-live').textContent = { playing: 'Playing', paused: 'Paused', stopped: 'Stopped' }[s];
    this.kick();
  },
};

const seek = new Slider($('#s-seek'), {
  max: DURATION, step: 0.25, big: 8, fmt: mmss,
  disabled: () => engine.state === 'stopped',
});
seek.onStart = () => { ui.seeking = true; ui.seekValue = seek.value; ui.kick(); };
seek.onInput = v => { ui.seekValue = v; ui.kick(); };
seek.onEnd = v => { ui.seeking = false; engine.seek(v); ui.kick(); };

const vol = new Slider($('#s-vol'), { value: 75, fmt: v => `${v}%`, big: 10 });
vol.onInput = v => { engine.volume = v / 100; engine.applyVolume(); };

const bal = new Slider($('#s-bal'), {
  min: -100, max: 100, value: 0, big: 20, resetTo: 0,
  fmt: v => v === 0 ? 'center' : v < 0 ? `${-v}% left` : `${v}% right`,
});
bal.onInput = v => {
  if (Math.abs(v) <= 8 && v !== 0) { bal.set(0); v = 0; }          // magnetic centre
  engine.pan = v / 100; engine.applyPan();
};

$('#time').addEventListener('click', () => { ui.remaining = !ui.remaining; ui.updateTime(engine.elapsed()); });

/* ----- marquee ----- */
(() => {
  const text = `1. JAMES CHRISTOPHERSON - DIGITAL TECHNOLOGIST (${mmss(DURATION)}) *** LINKEDIN.COM/IN/JAMESCHRISTOPHERSON *** INSTAGRAM.COM/DIGITALJAMES ***`;
  const track = $('#marquee-track');
  track.innerHTML = `<span>${text}</span><span>${text}</span>`;
  const fit = () => {
    const w = track.firstElementChild.offsetWidth;
    if (w) track.style.setProperty('--dur', `${w / 32}s`);
  };
  fit();
  document.fonts?.ready.then(fit);
})();

/* ----- visualizer ----- */
const viz = (() => {
  const cv = $('#viz'), g = cv.getContext('2d');
  const W = 76, H = 16, N = 19;
  const pal = Array.from({ length: H }, (_, r) => {
    const t = r / (H - 1);
    const [a, b, k] = t < 0.5 ? [[25, 230, 25], [216, 230, 25], t * 2] : [[216, 230, 25], [230, 50, 25], (t - 0.5) * 2];
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
  });
  const level = new Float32Array(N), peak = new Float32Array(N), hold = new Uint8Array(N);
  const edges = Array.from({ length: N + 1 }, (_, i) => Math.round(1.2 * Math.pow(110 / 1.2, i / N)));
  let mode = 0, fbuf, tbuf;

  cv.addEventListener('click', () => { mode = (mode + 1) % 3; ui.kick(); });

  function draw() {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const an = engine.analyser;
    if (mode === 2) return false;

    if (mode === 1) {                                              // oscilloscope
      if (!an || engine.state !== 'playing') return false;
      tbuf ||= new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(tbuf);
      for (let x = 0; x < W; x++) {
        const v = (tbuf[Math.floor(x * tbuf.length / W)] - 128) / 128;
        const y = clamp(Math.round(7.5 - v * 14), 0, H - 1);
        g.fillStyle = pal[clamp(Math.abs(y - 8) * 2, 0, H - 1)];
        g.fillRect(x, y, 1, 1);
      }
      return true;
    }

    const live = an && engine.state === 'playing';
    if (live) { fbuf ||= new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(fbuf); }
    let alive = false;
    for (let i = 0; i < N; i++) {
      let target = 0;
      if (live) {
        let m = 0;
        for (let b = edges[i]; b < Math.max(edges[i + 1], edges[i] + 1); b++) m = Math.max(m, fbuf[b]);
        target = Math.pow(m / 255, 1.7) * (H + 2) * (1 + i * 0.015);
      }
      level[i] = Math.max(target, level[i] - 0.7);
      if (level[i] >= peak[i]) { peak[i] = level[i]; hold[i] = 18; }
      else if (hold[i] > 0) hold[i]--;
      else peak[i] = Math.max(0, peak[i] - 0.35);

      const x = i * 4, h = clamp(Math.round(level[i]), 0, H);
      for (let r = 0; r < h; r++) { g.fillStyle = pal[r]; g.fillRect(x, H - 1 - r, 3, 1); }
      const p = clamp(Math.round(peak[i]), 0, H);
      if (p > 0) { g.fillStyle = '#c8c8d8'; g.fillRect(x, H - p, 3, 1); }
      if (level[i] > 0.05 || peak[i] > 0.05) alive = true;
    }
    return alive;
  }
  return { draw };
})();

/* ------------------------------------------------------------------
   Transport wiring (buttons, shortcuts, playlist)
------------------------------------------------------------------- */
function jump(to) {
  if (to >= DURATION) { engine.ended(); return; }
  if (engine.state === 'paused') { engine.offset = to; ui.kick(); }
  else engine.play(to);
}

const actions = {
  play()  { engine.state === 'paused' ? engine.pause() : engine.play(0); },
  pause() { engine.pause(); },
  stop()  { engine.stop(); },
  next()  { jump((Math.floor(engine.elapsed() / 16) + 1) * 16); },       // 16s = 8 bars = one "chapter"
  prev()  { jump(Math.max(0, Math.floor((engine.elapsed() - 1) / 16) * 16)); },
  eject() {
    const pl = $('#win-pl');
    if (pl.hidden) setWindowVisible(pl, true);
    pl.classList.remove('shaded');
    layout();
    $('#pl-list a').focus();
  },
  shade(btn) { toggleShade(btn.closest('.win')); },
  close(btn) { setWindowVisible(btn.closest('.win'), false); },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) actions[b.dataset.act](b);
});

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('[role="slider"], input, textarea')) return;
  const map = { z: 'prev', x: 'play', c: 'pause', v: 'stop', b: 'next' };
  const act = map[e.key.toLowerCase()];
  if (act) { e.preventDefault(); actions[act](); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    vol.commit(vol.value + (e.key === 'ArrowUp' ? 5 : -5));
  }
});

const trackRow = $('#pl-track');
trackRow.addEventListener('click', () => engine.play(0));
trackRow.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); engine.play(0); }
});

const repBtn = $('#t-rep');
repBtn.addEventListener('click', () => {
  ui.repeat = repBtn.getAttribute('aria-pressed') !== 'true';
  repBtn.setAttribute('aria-pressed', ui.repeat);
});

/* ------------------------------------------------------------------
   Equalizer UI
------------------------------------------------------------------- */
const eqSliders = [];
let eqPre;
(() => {
  const host = $('#eq-sliders');
  const mkCol = (label, pre) => {
    const col = document.createElement('div');
    col.className = 'eq-col' + (pre ? ' pre' : '');
    col.innerHTML = `<div class="slider v"><div class="thumb"></div></div><span class="lbl" aria-hidden="true">${pre ? 'PRE' : label}</span>`;
    host.appendChild(col);
    return new Slider($('.slider', col), {
      min: -12, max: 12, step: 1, big: 3, vertical: true, value: 0, resetTo: 0,
      fmt: v => `${v > 0 ? '+' : ''}${v} dB`,
    });
  };
  eqPre = mkCol('', true);
  eqPre.el.setAttribute('aria-label', 'Preamp');
  eqPre.onInput = v => { eqState.pre = v; eqChanged(); };
  EQ_LABELS.forEach((l, i) => {
    const s = mkCol(l, false);
    s.el.setAttribute('aria-label', `${l} Hz`);
    s.onInput = v => { eqState.bands[i] = v; eqChanged(); };
    eqSliders.push(s);
  });
})();

const curve = $('#eq-curve'), cg = curve.getContext('2d');
function drawCurve() {
  cg.fillStyle = '#000'; cg.fillRect(0, 0, 113, 19);
  cg.fillStyle = '#2a3a2a';
  for (let x = 0; x < 113; x += 2) cg.fillRect(x, 9, 1, 1);           // dotted zero line
  const yFor = db => clamp(Math.round(9 - (db / 12) * 8), 0, 18);
  cg.fillStyle = '#5a5a7a';
  const py = yFor(eqState.pre);
  for (let x = 0; x < 113; x++) cg.fillRect(x, py, 1, 1);             // preamp line
  const color = y => y < 6 ? '#e63219' : y < 13 ? '#d8e619' : '#19e619';
  let prev = null;
  for (let x = 0; x < 113; x++) {
    const f = x / 112 * 9, i = Math.min(8, Math.floor(f)), k = f - i;
    const sm = (1 - Math.cos(k * Math.PI)) / 2;
    const y = yFor(eqState.bands[i] * (1 - sm) + eqState.bands[i + 1] * sm);
    const [a, b] = prev === null ? [y, y] : [Math.min(prev, y), Math.max(prev, y)];
    for (let yy = a; yy <= b; yy++) { cg.fillStyle = color(yy); cg.fillRect(x, yy, 1, 1); }
    prev = y;
  }
}
function eqChanged(name = 'CUSTOM') {
  eqState.name = name;
  $('#eq-name').textContent = name;
  engine.applyEQ();
  drawCurve();
}
function setEQOn(on) {
  eqState.on = on;
  $('#eq-on').setAttribute('aria-pressed', on);
  $('.eq-body').classList.toggle('off', !on);
  engine.applyEQ();
}
$('#eq-on').addEventListener('click', () => setEQOn(!eqState.on));

const presetNames = Object.keys(EQ_PRESETS);
let presetIdx = 0;
$('#eq-presets').addEventListener('click', () => {
  presetIdx = (presetIdx + 1) % presetNames.length;
  const name = presetNames[presetIdx], p = EQ_PRESETS[name];
  eqState.pre = p.pre; eqState.bands = [...p.bands];
  eqPre.set(p.pre);
  eqSliders.forEach((s, i) => s.set(p.bands[i]));
  eqChanged(name);
});
drawCurve();

/* ------------------------------------------------------------------
   Windows: layout/scale, shade, close, drag
------------------------------------------------------------------- */
const ws = $('#workspace'), stage = $('#stage'), desktop = $('#desktop');
let scale = 1, lastCls = '', zTop = 10;

function layout() {
  const availW = desktop.clientWidth - 24, availH = desktop.clientHeight - 24;
  let best = null;
  for (const cls of ['two', 'one']) {
    ws.className = `workspace ${cls}`;
    const w = ws.offsetWidth, h = ws.offsetHeight;
    // fit the viewport when possible, but never shrink below a legible size just to avoid scrolling
    const s = Math.min(2, availW / w, Math.max(availH / h, 1.3));
    if (!best || s > best.s + 0.01) best = { cls, w, h, s };
  }
  ws.className = `workspace ${best.cls}`;
  scale = Math.max(0.5, Math.floor(best.s * 20) / 20);
  ws.style.transform = `scale(${scale})`;
  stage.style.width = `${best.w * scale}px`;
  stage.style.height = `${best.h * scale}px`;
  if (best.cls !== lastCls) {
    lastCls = best.cls;
    $$('.win').forEach(w => { w.style.transform = ''; delete w.dataset.x; delete w.dataset.y; });
  }
}

function toggleShade(win) {
  win.classList.toggle('shaded');
  layout();
}

function setWindowVisible(win, visible) {
  win.hidden = !visible;
  const t = { 'win-eq': '#t-eq', 'win-pl': '#t-pl' }[win.id];
  if (t) $(t).setAttribute('aria-pressed', visible);
  layout();
}

for (const [btn, win] of [['#t-eq', '#win-eq'], ['#t-pl', '#win-pl']]) {
  $(btn).addEventListener('click', () => setWindowVisible($(win), $(win).hidden));
}

$$('.titlebar').forEach(tb => {
  const win = tb.closest('.win');
  tb.addEventListener('dblclick', e => { if (!e.target.closest('button')) toggleShade(win); });
  tb.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    win.style.zIndex = ++zTop;
    const sx = e.clientX, sy = e.clientY;
    const ox = +win.dataset.x || 0, oy = +win.dataset.y || 0;
    tb.setPointerCapture(e.pointerId);
    const move = ev => {
      const x = ox + (ev.clientX - sx) / scale, y = oy + (ev.clientY - sy) / scale;
      win.dataset.x = x; win.dataset.y = y;
      win.style.transform = `translate(${x}px, ${y}px)`;
    };
    const up = () => {
      tb.removeEventListener('pointermove', move);
      tb.removeEventListener('pointerup', up);
      tb.removeEventListener('pointercancel', up);
    };
    tb.addEventListener('pointermove', move);
    tb.addEventListener('pointerup', up);
    tb.addEventListener('pointercancel', up);
  });
});

window.addEventListener('resize', layout);
document.fonts?.ready.then(layout);

/* ------------------------------------------------------------------
   Windows 95 taskbar
------------------------------------------------------------------- */
const startBtn = $('#start'), menu = $('#startmenu');
function setMenu(open) {
  menu.hidden = !open;
  startBtn.setAttribute('aria-expanded', open);
}
startBtn.addEventListener('click', e => { e.stopPropagation(); setMenu(menu.hidden); });
document.addEventListener('click', e => { if (!menu.hidden && (!menu.contains(e.target) || e.target.closest('a'))) setMenu(false); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !menu.hidden) { setMenu(false); startBtn.focus(); }
});
$('#task-winamp').addEventListener('click', () => {
  const main = $('#win-main');
  main.classList.remove('shaded');
  main.style.zIndex = ++zTop;
  layout();
  main.scrollIntoView({ block: 'nearest' });
});

const clock = $('#clock');
const tickClock = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
tickClock();
setInterval(tickClock, 15000);

/* ----- boot ----- */
ui.onState('stopped');
ui.updateTime(0);
layout();
