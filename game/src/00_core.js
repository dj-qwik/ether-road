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

// ───────────────────────── AUDIO: the soundtrack (four songs) + synthesized effects ─────────────────────────
// Menus play the songs back to back, like a radio. Each race gets one song (dealt from a shuffled deck, so all four
// come up before any repeats) as a 66 s race cut that starts 3 s before the song's high-energy part, so it lands on
// GO. Everything the music plays also runs through an analyser: the neon pipes pulse to the song's bass and drums.
let actx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
const AUDIO = { muted: store.get('er_muted') === '1', mode: 'menu' };
const SONGS = [
  { key: 'carnage-protocol', title: 'Carnage Protocol' }, { key: 'crusher', title: 'Crusher' },
  { key: 'game-over', title: 'GAME OVER' }, { key: 'high-voltage', title: 'High Voltage' },
];
const RACE_LEAD = 3; // a race cut starts this long before the drop
const MUSIC = { menu: null, race: null, analyser: null, bins: null, deck: [], menuIdx: Math.floor(Math.random() * SONGS.length), slow: 0, fast: 0, pulse: 0, level: 0, raceSong: null };
const musicUrl = (file) => (typeof window !== 'undefined' && window.ER_ASSETS != null ? window.ER_ASSETS : './') + 'music/' + file;
function audioInit() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = actx.createGain(); master.gain.value = AUDIO.muted ? 0 : 0.85;
    const comp = actx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.12;
    master.connect(comp).connect(actx.destination);
    sfxBus = actx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    musicBus = actx.createGain(); musicBus.gain.value = 0.62; musicBus.connect(master);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // the analyser listens before the mute, so the pipes still pulse with the sound off
    // (bass: a 140 Hz low-pass into its own analyser; we read the raw waveform and measure its loudness)
    MUSIC.analyser = actx.createGain();
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 0.7;
    MUSIC.bass = actx.createAnalyser(); MUSIC.bass.fftSize = 1024; MUSIC.full = actx.createAnalyser(); MUSIC.full.fftSize = 1024;
    MUSIC.analyser.connect(lp).connect(MUSIC.bass); MUSIC.analyser.connect(MUSIC.full);
    MUSIC.buf = new Float32Array(1024);
    const player = () => { const el = new Audio(); el.preload = 'auto'; const src = actx.createMediaElementSource(el), g = actx.createGain(); g.gain.value = 0; src.connect(g); g.connect(musicBus); g.connect(MUSIC.analyser); return { el, g }; };
    MUSIC.menu = player(); MUSIC.race = player();
    MUSIC.menu.el.addEventListener('ended', () => { MUSIC.menuIdx = (MUSIC.menuIdx + 1) % SONGS.length; MUSIC.menu.el.src = musicUrl(SONGS[MUSIC.menuIdx].key + '.mp3'); if (AUDIO.mode === 'menu') playEl(MUSIC.menu); });
    MUSIC.menu.el.src = musicUrl(SONGS[MUSIC.menuIdx].key + '.mp3');
    if (actx.state === 'suspended') actx.resume();
    if (AUDIO.mode === 'menu') musicMenu();
    else if (AUDIO.mode === 'race' && AUDIO.raceAt != null) musicRace((AUDIO.raceAt - performance.now()) / 1000);
  } catch { actx = null; }
}
addEventListener('pointerdown', audioInit, { once: true });
addEventListener('keydown', audioInit, { once: true });
function setMuted(m) { AUDIO.muted = m; store.set('er_muted', m ? '1' : '0'); if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, actx.currentTime, 0.05); }
const outLatency = () => (actx ? (actx.outputLatency || actx.baseLatency || 0) : 0);
function playEl(p) { const r = p.el.play(); if (r && r.catch) r.catch(() => {}); }
function fade(p, to, sec) { if (!p) return; p.g.gain.cancelScheduledValues(actx.currentTime); p.g.gain.setTargetAtTime(to, actx.currentTime, Math.max(0.01, sec / 3)); }
/** Race music: the race song (chosen at the intro card, or now), its drop landing on GO, `secondsUntilGo` from now
 *  (negative = the race is already that far in, e.g. the test lab starting at 20 s). */
function musicRace(secondsUntilGo) {
  AUDIO.mode = 'race'; AUDIO.raceAt = performance.now() + secondsUntilGo * 1000;
  if (!actx) return;
  if (!MUSIC.keepSong || !MUSIC.raceSong) { if (!MUSIC.deck.length) MUSIC.deck = SONGS.map((_, i) => i).sort(() => Math.random() - 0.5); MUSIC.raceSong = SONGS[MUSIC.deck.pop()]; }
  MUSIC.keepSong = false;
  const p = MUSIC.race, file = MUSIC.raceSong.key + '-race.mp3';
  if (!p.el.src.endsWith(file)) p.el.src = musicUrl(file);
  fade(MUSIC.menu, 0, 0.4); setTimeout(() => { if (AUDIO.mode === 'race') MUSIC.menu.el.pause(); }, 600);
  const raceAt = AUDIO.raceAt;
  const start = () => {
    const pos = () => RACE_LEAD - (raceAt - performance.now()) / 1000 + outLatency(); // where in the cut "now" is
    setTimeout(() => {
      if (AUDIO.mode !== 'race' || AUDIO.raceAt !== raceAt) return;
      try { p.el.currentTime = Math.max(0, pos()); } catch {}
      p.g.gain.cancelScheduledValues(actx.currentTime); p.g.gain.setValueAtTime(1, actx.currentTime); playEl(p);
    }, Math.max(0, -pos()) * 1000);
  };
  if (p.el.readyState >= 1) start(); else p.el.addEventListener('loadedmetadata', start, { once: true });
}
/** Back to the menu radio: the race song fades out, the menu song carries on where it left off. */
function musicMenu() {
  AUDIO.mode = 'menu'; MUSIC.keepSong = false;
  if (!actx) return;
  fade(MUSIC.race, 0, 1.2); setTimeout(() => { if (AUDIO.mode !== 'race') MUSIC.race.el.pause(); }, 1500);
  playEl(MUSIC.menu); fade(MUSIC.menu, 0.8, 1.5);
}
/** Quiet before a race (the intro card): the menu song fades down. The race song is chosen now so it can load. */
function musicStop() {
  AUDIO.mode = 'off';
  if (!actx) return;
  fade(MUSIC.menu, 0.18, 1); fade(MUSIC.race, 0, 0.5);
  if (!MUSIC.deck.length) MUSIC.deck = SONGS.map((_, i) => i).sort(() => Math.random() - 0.5);
  MUSIC.raceSong = SONGS[MUSIC.deck.pop()]; MUSIC.keepSong = true; AUDIO.raceFresh = null;
  MUSIC.race.el.src = musicUrl(MUSIC.raceSong.key + '-race.mp3'); MUSIC.race.el.load();
}
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
/** How hard the music is hitting right now: pulse (0–1, jumps on kicks/bass hits and decays in ~0.2 s) and level (0–1). */
function musicPulse() {
  if (!MUSIC.bass) return null;
  const rms = (an) => { an.getFloatTimeDomainData(MUSIC.buf); let q = 0; for (let i = 0; i < MUSIC.buf.length; i++) q += MUSIC.buf[i] * MUSIC.buf[i]; return Math.sqrt(q / MUSIC.buf.length); };
  const now = performance.now(), dt = Math.min(0.1, (now - (MUSIC.at || now)) / 1000); MUSIC.at = now;
  const e = rms(MUSIC.bass), all = rms(MUSIC.full);
  if (!(MUSIC.slow > 1e-4)) MUSIC.slow = e;
  MUSIC.slow += (e - MUSIC.slow) * Math.min(1, dt * 1.5);          // ~0.7 s running average of the bass
  MUSIC.level += (Math.min(1, all * 3) - MUSIC.level) * Math.min(1, dt * 4);
  const hit = clamp((e / Math.max(1e-4, MUSIC.slow) - 1.05) / 0.5, 0, 1); // how far above its average the bass is
  MUSIC.pulse = Math.max(hit, MUSIC.pulse * Math.exp(-dt * 9));
  return { pulse: MUSIC.pulse, level: MUSIC.level, playing: all > 0.003 };
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
