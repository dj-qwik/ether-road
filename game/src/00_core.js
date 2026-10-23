// timing shared with the simulation (the global scope has 01_base; these come from the sim instance)
const COLLAPSE_AT = SIM0.COLLAPSE_AT;
// ───────────────────────── constants + money (same rules as the escrow contract) ─────────────────────────
const WEI = 10n ** 18n;
const TIERS = ['0.001', '0.005', '0.01', '0.05'];
const SIZES = [2, 3, 4];
function parseEth(s) { const [a, b = ''] = String(s).split('.'); return BigInt(a || '0') * WEI + BigInt((b + '0'.repeat(18)).slice(0, 18)); }
function fmtEth(w) { const neg = w < 0n; if (neg) w = -w; const whole = w / WEI; const frac = (w % WEI).toString().padStart(18, '0').replace(/0+$/, ''); return (neg ? '-' : '') + whole + (frac ? '.' + frac : ''); }
function splitPot(stake, n) { const pot = stake * BigInt(n); const house = pot * 1000n / 10000n; return { pot, house, champ: pot - house }; }
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const $ = (s) => document.querySelector(s);
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
// practice wallet (offline demo only; real money lives in the Privy wallet)
let wallet = (() => { const v = store.get('er_test_wallet'); try { return v ? BigInt(v) : parseEth('0.05'); } catch { return parseEth('0.05'); } })();
function setWallet(v) { wallet = v; store.set('er_test_wallet', v.toString()); const el = $('#bal'); if (el) el.textContent = fmtEth(v); }
const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// ───────────────────────── INPUT: step left, step right, use ─────────────────────────
// Keyboard: ← / A step left, → / D step right (hold to keep sliding round the pipe), Space uses the held item.
// Touch: tap the left or right half of the screen to step, the USE button to use. Controller: d-pad, left stick or
// bumpers step; ✕ (PlayStation) / A (Xbox) uses. Each action is time-stamped when pressed; the race reads them in order.
const INPUT = { acts: [], enabled: false, hold: { L: 0, R: 0 }, rep: { L: 0, R: 0 } };
const HOLD_DELAY = 110, HOLD_EVERY = 67; // ms: hold a direction 110 ms and the ball keeps stepping, one position per 67 ms
function actNow(a) { if (INPUT.enabled) INPUT.acts.push([performance.now(), a]); }
function holdStart(d) { if (!INPUT.hold[d]) { INPUT.hold[d] = performance.now(); INPUT.rep[d] = INPUT.hold[d] + HOLD_DELAY; actNow(d); } }
function holdEnd(d) { INPUT.hold[d] = 0; }
function pollHolds(now) {
  for (const d of ['L', 'R']) if (INPUT.hold[d] && !INPUT.hold[d === 'L' ? 'R' : 'L']) while (now >= INPUT.rep[d]) { if (INPUT.enabled) INPUT.acts.push([INPUT.rep[d], d]); INPUT.rep[d] += HOLD_EVERY; }
}
const KEY_DIR = { ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R' };
const keySrc = { L: new Set(), R: new Set() }; // which keys/buttons are holding each direction
function srcDown(d, id) { keySrc[d].add(id); holdStart(d); }
function srcUp(d, id) { keySrc[d].delete(id); if (!keySrc[d].size) holdEnd(d); }
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const d = KEY_DIR[e.code];
  if (d) { if (INPUT.enabled) e.preventDefault(); if (!e.repeat) srcDown(d, e.code); return; }
  if (e.code === 'Space') { if (INPUT.enabled) { e.preventDefault(); if (!e.repeat) actNow('U'); } }
});
addEventListener('keyup', (e) => { const d = KEY_DIR[e.code]; if (d) srcUp(d, e.code); });
addEventListener('blur', () => { for (const d of ['L', 'R']) { keySrc[d].clear(); holdEnd(d); } });
const touchDir = new Map();
addEventListener('pointerdown', (e) => {
  if (!INPUT.enabled || e.target.closest('.card, button, header, a, input, .wallet')) return;
  const d = e.clientX < innerWidth / 2 ? 'L' : 'R'; touchDir.set(e.pointerId, d); srcDown(d, 'p' + e.pointerId);
}, { passive: true });
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, (e) => { const d = touchDir.get(e.pointerId); if (d) { touchDir.delete(e.pointerId); srcUp(d, 'p' + e.pointerId); } }, { passive: true });
// ── controllers (standard mapping: Xbox, PlayStation, Switch Pro, 8BitDo…). In a race: d-pad ←/→, the left stick or
// L1/R1 step; ✕ / A uses the held item. In menus: d-pad / left stick moves between buttons, ✕ / A presses,
// ○ / B goes back, Start presses the main button. Rumble on crashes, hits and pickups where supported.
const PAD = { connected: false, prev: [], navAt: 0, lastDir: '', used: false, stick: [] };
addEventListener('gamepadconnected', () => { PAD.connected = true; document.body.classList.add('pad'); });
addEventListener('gamepaddisconnected', () => { PAD.connected = [...(navigator.getGamepads ? navigator.getGamepads() : [])].some(Boolean); document.body.classList.toggle('pad', PAD.connected); });
const PAD_LEFT = [14, 4], PAD_RIGHT = [15, 5], PAD_USE = [0];
function padRumble(strength = 0.5, ms = 120) {
  for (const p of navigator.getGamepads ? navigator.getGamepads() : []) {
    const v = p && p.vibrationActuator; if (!v) continue;
    try { v.playEffect ? v.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: Math.min(1, strength * 1.3) }) : v.pulse && v.pulse(strength, ms); } catch {}
  }
}
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (let pi = 0; pi < pads.length; pi++) {
    const p = pads[pi]; if (!p) continue;
    const prev = PAD.prev[pi] || [], now = p.buttons.map((b) => b.pressed || b.value > 0.5);
    const edge = (k) => now[k] && !prev[k];
    PAD.prev[pi] = now;
    if (now.some(Boolean) && !PAD.used) { PAD.used = true; PAD.connected = true; document.body.classList.add('pad'); }
    if (INPUT.enabled) {
      const sx = p.axes[0] || 0, was = PAD.stick[pi] || 0, st = sx < -0.5 ? -1 : sx > 0.5 ? 1 : Math.abs(sx) < 0.35 ? 0 : was;
      const want = { L: PAD_LEFT.some((k) => now[k]) || st < 0, R: PAD_RIGHT.some((k) => now[k]) || st > 0 };
      PAD.stick[pi] = st;
      for (const d of ['L', 'R']) { const id = 'pad' + pi; if (want[d] && !keySrc[d].has(id)) srcDown(d, id); else if (!want[d] && keySrc[d].has(id)) srcUp(d, id); }
      if (PAD_USE.some(edge)) actNow('U');
      continue;
    }
    for (const d of ['L', 'R']) srcUp(d, 'pad' + pi);
    // menus
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    const dir = now[12] || ay < -0.6 ? 'up' : now[13] || ay > 0.6 ? 'down' : now[14] || ax < -0.6 ? 'left' : now[15] || ax > 0.6 ? 'right' : '';
    const t = performance.now();
    if (dir && (dir !== PAD.lastDir || t - PAD.navAt > 220)) { PAD.navAt = t; padNav(dir); }
    PAD.lastDir = dir;
    if (edge(0)) padPress();
    if (edge(1)) padBack();
    if (edge(9)) padStart();
  }
}
const navTargets = () => [...document.querySelectorAll('#ov button:not([disabled]), #ov input, #ov a.btn, #ov label.check, header button')].filter((e) => e.offsetParent !== null);
function padFocus(el) { if (!el) return; document.querySelectorAll('.padfocus').forEach((e) => e.classList.remove('padfocus')); el.classList.add('padfocus'); el.focus({ preventScroll: false }); el.scrollIntoView({ block: 'nearest' }); }
function padNav(dir) {
  const list = navTargets(); if (!list.length) return;
  const cur = document.querySelector('.padfocus');
  if (!cur || !list.includes(cur)) return padFocus(list.find((e) => e.closest('#ov')) || list[0]);
  const a = cur.getBoundingClientRect(), ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  let best = null, bestD = 1e9;
  for (const e of list) {
    if (e === cur) continue;
    const r = e.getBoundingClientRect(), c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }, dx = c.x - ac.x, dy = c.y - ac.y;
    const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
    if (!ok) continue;
    const along = dir === 'up' || dir === 'down' ? Math.abs(dy) : Math.abs(dx), across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    const d = along + across * 2.2;
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best) { padFocus(best); if (typeof SFX !== 'undefined') SFX.ui(); }
}
function padPress() {
  const cur = document.querySelector('.padfocus');
  if (cur && navTargets().includes(cur)) { if (cur.matches('label.check')) cur.querySelector('input').click(); else cur.click(); return; }
  padFocus(navTargets()[0]);
}
function padBack() { const b = document.querySelector('#ov #back, #ov #walletBack, #ov #cashBack, #ov #netLeave, #ov #home, #ov #dbgClose'); if (b) b.click(); }
function padStart() { const b = document.querySelector('#ov .btn.primary:not([disabled])'); if (b) b.click(); }
// keep a controller focus on screen after menus redraw
new MutationObserver(() => { if (PAD.used && !document.querySelector('#ov .padfocus') && !INPUT.enabled) { const first = document.querySelector('#ov .btn.primary:not([disabled])') || navTargets()[0]; if (first) setTimeout(() => padFocus(first), 0); } }).observe(document.getElementById('ov') || document.body, { childList: true, subtree: true });

// ───────────────────────── AUDIO: original synthesized soundtrack + effects ─────────────────────────
// Everything is generated with Web Audio at 144 BPM (the race's beat: gates and crushers move on it). The race
// mix is adaptive stems over one clock: kick + rolling bass from the start, claps and hats join, then arps,
// then a lead; at the final collapse a distorted counter-rhythm and an octave lift.
let actx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null, drive = null;
const AUDIO = { muted: store.get('er_muted') === '1', mode: 'menu', t0: 0, next: 0, step: 0, timer: 0 };
function audioInit() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = actx.createGain(); master.gain.value = AUDIO.muted ? 0 : 0.85;
    const comp = actx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.12;
    master.connect(comp).connect(actx.destination);
    sfxBus = actx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    musicBus = actx.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    drive = actx.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(x * 3.2); } drive.curve = c; drive.connect(musicBus);
    AUDIO.next = actx.currentTime + 0.1; AUDIO.timer = setInterval(schedule, 25);
  } catch { actx = null; }
}
addEventListener('pointerdown', audioInit, { once: true });
addEventListener('keydown', audioInit, { once: true });
function setMuted(m) { AUDIO.muted = m; store.set('er_muted', m ? '1' : '0'); if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, actx.currentTime, 0.05); }
const outLatency = () => (actx ? (actx.outputLatency || actx.baseLatency || 0) : 0);
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function osc(type, f, t, dur, peak, bus, a = 0.004, f2 = null, detune = 0) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune; if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  env(g, t, a, peak, dur); o.connect(g).connect(bus); o.start(t); o.stop(t + a + dur + 0.05);
  return o;
}
function noiseHit(t, dur, peak, freq, q, type, bus, sweepTo) {
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur); f.Q.value = q;
  env(g, t, 0.002, peak, dur); s.connect(f).connect(g).connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
// voices
const V = {
  kick(t, v = 1) { osc('sine', 155, t, 0.32, 0.9 * v, musicBus, 0.002, 42); noiseHit(t, 0.02, 0.12 * v, 3500, 0.7, 'highpass', musicBus); },
  clap(t) { for (let k = 0; k < 3; k++) noiseHit(t + k * 0.011, 0.09, 0.16, 1500, 1.1, 'bandpass', musicBus); },
  hat(t, open) { noiseHit(t, open ? 0.14 : 0.035, open ? 0.06 : 0.07, 9000, 0.8, 'highpass', musicBus); },
  bass(t, m, dist) {
    const f = midiHz(m), o = actx.createOscillator(), o2 = actx.createOscillator(), fl = actx.createBiquadFilter(), g = actx.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = f; o2.frequency.value = f / 2;
    fl.type = 'lowpass'; fl.Q.value = 7; fl.frequency.setValueAtTime(dist ? 1800 : 1100, t); fl.frequency.exponentialRampToValueAtTime(140, t + 0.11);
    env(g, t, 0.003, dist ? 0.2 : 0.26, 0.11); o.connect(fl); o2.connect(fl); fl.connect(g).connect(dist ? drive : musicBus);
    o.start(t); o2.start(t); o.stop(t + 0.2); o2.stop(t + 0.2);
  },
  pluck(t, m, vol = 0.07) { osc('square', midiHz(m), t, 0.16, vol, musicBus, 0.002); osc('triangle', midiHz(m + 12), t, 0.1, vol * 0.6, musicBus, 0.002); },
  lead(t, m, dur) { for (const d of [-14, 0, 13]) osc('sawtooth', midiHz(m), t, dur, 0.035, musicBus, 0.02, null, d); },
  pad(t, notes, dur) { for (const m of notes) for (const d of [-9, 9]) osc('sawtooth', midiHz(m), t, dur, 0.012, musicBus, dur * 0.35, null, d); },
  riser(t, dur) { noiseHit(t, dur, 0.09, 400, 2, 'bandpass', musicBus, 7000); },
};
// A minor: Am – F – C – G, one bar each
const ROOTS = [45, 41, 48, 43], CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
const ARP = [0, 7, 12, 15, 12, 7, 3, 7];
const MOTIF = [[0, 12, 2], [2, 15, 1], [3, 14, 1], [4, 12, 2], [6, 10, 1], [7, 12, 1]]; // [16th, semitone over root, length in 16ths]
/** Race music starts with its downbeat exactly on race time 0 (audio clock), compensated for output latency. */
function musicRace(secondsUntilGo) {
  if (!actx) return;
  AUDIO.mode = 'race'; AUDIO.t0 = actx.currentTime + secondsUntilGo - outLatency();
  AUDIO.step = Math.floor((actx.currentTime - AUDIO.t0) / (BEAT / 4)) + 1; AUDIO.next = AUDIO.t0 + AUDIO.step * (BEAT / 4);
}
function musicMenu() { if (!actx) return; AUDIO.mode = 'menu'; AUDIO.t0 = actx.currentTime + 0.05; AUDIO.step = 0; AUDIO.next = AUDIO.t0; }
function musicStop() { AUDIO.mode = 'off'; }
AUDIO.mode = 'menu';
function schedule() {
  if (!actx || AUDIO.mode === 'off') return;
  const st = BEAT / 4;
  while (AUDIO.next < actx.currentTime + 0.14) {
    const t = AUDIO.next, k = AUDIO.step, sixteenth = ((k % 16) + 16) % 16, bar = Math.floor(k / 16), chord = ((bar % 4) + 4) % 4;
    const rt = k * st; // race seconds (race mode)
    if (AUDIO.mode === 'menu') {
      if (sixteenth === 0) V.pad(t, CHORDS[chord], BEAT * 4);
      if (sixteenth % 8 === 0) V.kick(t, 0.45);
      if (sixteenth % 4 === 2) V.hat(t, false);
      if ([0, 3, 6, 10, 12].includes(sixteenth) && bar % 2 === 1) V.pluck(t, CHORDS[chord][[0, 1, 2, 1, 0][[0, 3, 6, 10, 12].indexOf(sixteenth)]] + 12, 0.03);
    } else if (AUDIO.mode === 'race' && k >= 0 && rt < RACE_SECONDS + 2) {
      const collapse = rt >= COLLAPSE_AT, lift = collapse ? 12 : 0;
      if (sixteenth % 4 === 0) V.kick(t);
      if (sixteenth % 4 !== 0) V.bass(t, ROOTS[chord] + (sixteenth % 4 === 2 ? 12 : 0) + (collapse && sixteenth % 4 === 3 ? 7 : 0), collapse);
      if (rt >= 4 && sixteenth % 8 === 4) V.clap(t);
      if (rt >= 12 && sixteenth % 2 === 1) V.hat(t, sixteenth % 4 === 2);
      if (rt >= 12 && sixteenth % 4 === 2) V.hat(t, true);
      if (rt >= 24) V.pluck(t, CHORDS[chord][0] + 12 + lift + ARP[sixteenth % 8], 0.045);
      if (rt >= 36 && bar % 2 === 0) for (const [s16, semi, len] of MOTIF) if (s16 === sixteenth % 8 && (sixteenth < 8 || bar % 4 === 0)) V.lead(t, ROOTS[chord] + 24 + semi + lift, len * st * 0.95);
      if (sixteenth === 0 && bar % 4 === 0) V.pad(t, CHORDS[chord].map((m) => m + lift), BEAT * 16);
      if (Math.abs(rt - (COLLAPSE_AT - 4 * BEAT * 4)) < st / 2) V.riser(t, BEAT * 16);
      if (collapse && sixteenth % 3 === 0) noiseHit(t, 0.05, 0.08, 2400, 3, 'bandpass', drive); // counter-rhythm
    }
    AUDIO.next += st; AUDIO.step++;
  }
}
const SFX = {
  ui() { if (actx) osc('triangle', 880, actx.currentTime, 0.05, 0.04, sfxBus); },
  lane(dir) { if (!actx) return; const t = actx.currentTime; osc('square', dir ? 1320 : 990, t, 0.045, 0.05, sfxBus, 0.001, dir ? 1760 : 1320); },
  near() { if (!actx) return; const t = actx.currentTime; for (const m of [76, 79, 83]) osc('triangle', midiHz(m), t, 0.12, 0.025, sfxBus, 0.002); },
  orb() { if (!actx) return; const t = actx.currentTime; [88, 92, 95, 100].forEach((m, k) => osc('sine', midiHz(m), t + k * 0.04, 0.14, 0.06, sfxBus, 0.002)); },
  crash(me) { if (!actx) return; const t = actx.currentTime; noiseHit(t, me ? 0.7 : 0.35, me ? 0.5 : 0.18, 1800, 0.6, 'bandpass', sfxBus, 120); osc('sawtooth', 300, t, 0.5, me ? 0.12 : 0.05, sfxBus, 0.002, 40); },
  pass() { if (!actx) return; noiseHit(actx.currentTime, 0.4, 0.05, 600, 1.2, 'bandpass', sfxBus, 3200); },
  power() { if (!actx) return; const t = actx.currentTime; [76, 83, 88, 95].forEach((m, k) => osc('triangle', midiHz(m), t + k * 0.05, 0.18, 0.06, sfxBus, 0.002)); },
  shieldPop() { if (!actx) return; const t = actx.currentTime; noiseHit(t, 0.3, 0.2, 4000, 0.8, 'highpass', sfxBus); osc('sine', 1400, t, 0.3, 0.08, sfxBus, 0.002, 300); },
  boost() { if (!actx) return; const t = actx.currentTime; noiseHit(t, 0.8, 0.12, 300, 1.5, 'bandpass', sfxBus, 6000); osc('sawtooth', 120, t, 0.7, 0.05, sfxBus, 0.02, 480); },
  zap() { if (!actx) return; const t = actx.currentTime; osc('sawtooth', 62, t, 0.16, 0.035, sfxBus, 0.004, 58); noiseHit(t, 0.12, 0.05, 2500, 2, 'highpass', sfxBus, 6000); },
  slow() { if (!actx) return; const t = actx.currentTime; noiseHit(t, 0.8, 0.1, 4000, 1.5, 'bandpass', sfxBus, 300); osc('sine', 500, t, 0.7, 0.06, sfxBus, 0.02, 140); },
  count(n) { if (!actx) return; osc('triangle', n > 0 ? 660 : 1320, actx.currentTime, n > 0 ? 0.14 : 0.4, 0.09, sfxBus); },
  win() { if (!actx) return; const t = actx.currentTime; [69, 73, 76, 81, 85].forEach((m, k) => osc('triangle', midiHz(m), t + k * 0.08, 0.3, 0.07, sfxBus)); },
  lose() { if (!actx) return; const t = actx.currentTime; [64, 60, 57].forEach((m, k) => osc('triangle', midiHz(m), t + k * 0.12, 0.25, 0.06, sfxBus)); },
};
