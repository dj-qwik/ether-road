// ───────────────────────── TEST LAB (owner's debug menu) ─────────────────────────
// Unlock once by opening the site with #lab (or #debug) in the address; it's remembered on that browser only.
// Everything here is local practice: it never talks to the server and can't touch a paid race.
//   Track · theme · seed · start time · speed · racers · computer level · invincible · autopilot
//   In a lab race: R restart same seed · N new seed · T next track · J skip 5 s · F speed · G invincible · P autopilot · Esc lab
const LAB = (() => {
  if (/#(lab|debug)/.test(location.hash)) store.set('er_lab', '1');
  const unlocked = () => store.get('er_lab') === '1';
  const S = { track: 'random', theme: 'track', seed: '', start: 0, speed: 1, n: 4, bots: 'normal', kind: 'all', god: true, auto: false };
  try { Object.assign(S, JSON.parse(store.get('er_lab_cfg') || '{}')); } catch {}
  const save = () => store.set('er_lab_cfg', JSON.stringify(S));
  const TRACK_KEYS = () => Object.keys(SIM0.TRACKS);
  const seg = (name, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button class="${String(v) === String(cur) ? 'sel' : ''}" data-lab="${name}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const field = (label, html) => `<div style="display:grid;gap:6px"><span class="label">${label}</span>${html}</div>`;
  function card() {
    return `<div class="card lab">
      <h2>Test lab</h2>
      <p>Local practice with every knob. Only this browser sees this menu.</p>
      <div class="grid2">
        ${field('Track', seg('track', [['random', 'Random'], ...TRACK_KEYS().map((k) => [k, SIM0.TRACKS[k].name])], S.track))}
        ${field('Look', seg('theme', [['track', 'Track’s own'], ...Object.keys(THEMES).map((k) => [k, k[0].toUpperCase() + k.slice(1)])], S.theme))}
        ${field('Start at', seg('start', [0, 10, 20, 30, 40, 48, 55].map((v) => [v, v + ' s']), S.start))}
        ${field('Speed', seg('speed', [0.25, 0.5, 1, 2, 4].map((v) => [v, v + '×']), S.speed))}
        ${field('Racers', seg('n', [1, 2, 3, 4].map((v) => [v, v === 1 ? 'Solo' : v]), S.n))}
        ${field('Computer players', seg('bots', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Sharp'], ['flawless', 'Flawless']], S.bots))}
        ${field('You', seg('god', [[true, 'Invincible'], [false, 'Can crash']], S.god) + seg('auto', [[false, 'You drive'], [true, 'Autopilot']], S.auto))}
      </div>
      <label style="display:grid;gap:6px"><span class="label">Seed (blank = new road every time)</span><input id="labSeed" class="field" inputmode="numeric" placeholder="random" value="${esc(S.seed)}"></label>
      <div class="row"><button class="btn primary big" id="labGo">Start</button><button class="btn ghost" id="dbgClose">Back</button></div>
      <p class="fine" style="padding:0">In the race: <kbd>R</kbd> restart · <kbd>N</kbd> new seed · <kbd>T</kbd> next track · <kbd>J</kbd> skip 5 s · <kbd>F</kbd> speed · <kbd>G</kbd> invincible · <kbd>P</kbd> autopilot · <kbd>Esc</kbd> lab. Controller: <kbd>Back</kbd> opens the lab.</p>
    </div>`;
  }
  function start(sameSeed) {
    const key = S.track === 'random' ? TRACK_KEYS()[Math.floor(Math.random() * TRACK_KEYS().length)] : S.track;
    const seed = sameSeed && game.lab ? game.lab.seed : S.seed !== '' && /^\d+$/.test(S.seed) ? +S.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    const players = practicePlayers(S.n, BOT_LEVELS[S.bots]);
    localRace(players, 0, 'practice', { key, seed, theme: S.theme === 'track' ? null : S.theme, debug: { god: S.god ? [0] : [] } });
    game.lab = { seed, key, auto: S.auto };
    game.speed = S.speed; game.screen = 'match'; document.body.classList.add('playing'); $('#hud').hidden = false;
    showOverlay(''); callout('');
    // skip ahead to the chosen start time (your sphere invincible and driven by the autopilot meanwhile)
    const R = game.R, hadGod = R.god.has(0);
    R.god.add(0);
    while (R.tick < S.start * 60 && !R.winner) R.step({});
    if (!hadGod) R.god.delete(0);
    game.phase = R.winner ? 'done' : 'play'; game.clock = R.tick * TICK_MS; game.outSeen = new Set(R.active.filter((b) => !b.alive).map((b) => b.i));
    INPUT.taps.length = 0; INPUT.enabled = true; musicRace(-R.t);
    hud(true); renderHud(true);
  }
  function skip(sec) {
    const R = game.R; if (!R || R.winner) return;
    const had = R.god.has(0); R.god.add(0);
    const to = Math.min(RACE_TICKS, R.tick + sec * 60);
    while (R.tick < to && !R.winner) R.step(game.lab.auto ? {} : { 0: 0 });
    if (!had) R.god.delete(0);
    game.clock = R.tick * TICK_MS; musicRace(-R.t);
    if (R.winner) raceOver();
  }
  let hudEl = null;
  function hud(on) {
    if (!hudEl) { hudEl = document.createElement('div'); hudEl.id = 'labhud'; document.body.appendChild(hudEl); }
    hudEl.hidden = !on;
  }
  function frame() {
    if (!hudEl || hudEl.hidden || !game.R) return;
    const R = game.R, me = R.spheres[0];
    hudEl.innerHTML = `LAB · ${esc(SIM0.TRACKS[game.lab.key].name)} · seed ${game.lab.seed} · ${R.t.toFixed(1)} s · s ${R.s.toFixed(0)} · ${game.speed}× · ${R.god.has(0) ? 'invincible' : 'can crash'} · ${game.lab.auto ? 'autopilot' : 'you drive'}${me ? ` · lane ${me.cl}${me.shield ? ' · shield' : ''}` : ''}<br><kbd>R</kbd> restart <kbd>N</kbd> new <kbd>T</kbd> track <kbd>J</kbd> +5 s <kbd>F</kbd> speed <kbd>G</kbd> god <kbd>P</kbd> auto <kbd>Esc</kbd> lab`;
  }
  function resultCard() {
    const R = game.R, w = R.winner;
    return `<div class="card lab"><h2>${w.i === 0 ? 'You won' : esc(w.name) + ' won'} at ${R.t.toFixed(1)} s</h2>
      <p>${esc(SIM0.TRACKS[game.lab.key].name)} · seed ${game.lab.seed} · decided by ${esc(R.decidedBy || 'last alive')}</p>
      <div class="row"><button class="btn primary" id="labAgain">Same road again</button><button class="btn" id="labNew">New road</button><button class="btn ghost" id="labOpen">Lab</button><button class="btn ghost" id="home">Home</button></div></div>`;
  }
  function open() { game.screen = 'lab'; game.lab = null; hud(false); INPUT.enabled = false; showOverlay(card()); }
  $('#ov').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'goLab' || t.id === 'labOpen') open();
    else if (t.dataset.lab) { const k = t.dataset.lab, v = t.dataset.v; S[k] = v === 'true' ? true : v === 'false' ? false : /^[\d.]+$/.test(v) ? +v : v; save(); showOverlay(card()); }
    else if (t.id === 'labGo') { S.seed = ($('#labSeed')?.value || '').trim(); save(); start(false); }
    else if (t.id === 'labAgain') start(true);
    else if (t.id === 'labNew') { S.seed = ''; save(); start(false); }
    else if (t.id === 'dbgClose') goHome();
  });
  $('#ov').addEventListener('input', (e) => { if (e.target.id === 'labSeed') { S.seed = e.target.value.trim(); save(); } });
  addEventListener('keydown', (e) => {
    if (!game.lab || e.target.closest?.('input')) return;
    const k = e.key.toLowerCase();
    if (k === 'r') start(true);
    else if (k === 'n') { S.seed = ''; start(false); }
    else if (k === 't') { const ks = TRACK_KEYS(); S.track = ks[(ks.indexOf(game.lab.key) + 1) % ks.length]; save(); start(false); }
    else if (k === 'j') skip(5);
    else if (k === 'f') { const sp = [0.25, 0.5, 1, 2, 4]; game.speed = S.speed = sp[(sp.indexOf(game.speed) + 1) % sp.length]; save(); }
    else if (k === 'g') { const R = game.R; if (R.god.has(0)) R.god.delete(0); else R.god.add(0); S.god = R.god.has(0); save(); }
    else if (k === 'p') { game.lab.auto = S.auto = !game.lab.auto; save(); }
    else if (k === 'escape') open();
    else return;
    e.preventDefault();
  });
  // controller: Back/Select opens the lab (when unlocked)
  let backPrev = false;
  setInterval(() => { if (!unlocked()) return; const p = (navigator.getGamepads ? [...navigator.getGamepads()] : []).find(Boolean); const b = !!(p && p.buttons[8] && p.buttons[8].pressed); if (b && !backPrev && game.mode !== 'online') open(); backPrev = b; }, 50);
  return { unlocked, card, open, frame, hud, resultCard, configure(o) { Object.assign(S, o); save(); } };
})();
