// Determinism proof: a "server" run (sim.cjs, computer drivers, recording every random draw) logs each sphere's
// input on every tick plus a state hash. A "browser" run (the full client bundle game.js loaded with a stub DOM,
// fed only the server's random draws, never the seed) replays those inputs and must produce the identical
// hash on every tick and the same winner.
//   node tools/determinism.mjs [races-per-theme=2]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(here, '..', 'dist')
const require = createRequire(import.meta.url)
const { createSim } = require(path.join(dist, 'sim.cjs'))
const PER = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 2)

function loadClient() {
  const js = fs.readFileSync(path.join(dist, 'game.js'), 'utf8')
  const noop = () => {}
  const el = () => new Proxy({ style: { setProperty: noop }, dataset: {}, classList: { toggle: noop, add: noop, remove: noop }, addEventListener: noop, setAttribute: noop, removeAttribute: noop, closest: () => null, focus: noop, getContext: () => null, appendChild: noop, querySelector: () => el() }, {
    get: (t, k) => (k in t ? t[k] : k === 'innerHTML' || k === 'textContent' ? '' : undefined), set: (t, k, v) => { t[k] = v; return true },
  })
  const cache = {}, g = {}
  Object.assign(g, {
    document: { body: el(), querySelector: (s) => (cache[s] ||= el()), getElementById: (s) => (cache['#' + s] ||= el()), createElement: () => el(), addEventListener: noop },
    addEventListener: noop, matchMedia: () => ({ matches: false }), requestAnimationFrame: noop, localStorage: { getItem: () => null, setItem: noop },
    navigator: { getGamepads: () => [] }, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, location: { hash: '', protocol: 'file:' }, setInterval: () => 0, setTimeout: () => 0,
  })
  g.window = g
  const names = Object.keys(g)
  return new Function(...names, js + ';return { createSim, createFollower }')(...names.map((n) => g[n]))
}
const C = loadClient()
const KEYS = Object.keys(createSim({ seed: 1 }).ARENAS)
let ok = 0, bad = 0, draws = 0, ticks = 0
for (const key of KEYS) for (let r = 0; r < PER; r++) {
  const n = [2, 3, 4][(r + key.length) % 3]
  const seed = (Math.random() * 4294967296) >>> 0
  const players = Array.from({ length: n }, (_, i) => ({ i, name: 'P' + i, skill: 0.6 + Math.random() * 0.35 }))
  const cfg = { key, seed, players, active: players.map((p) => p.i), botSalt: 'det' }
  const rec = [], S = createSim({ seed }).createRound(cfg, { record: rec })
  const init = rec.splice(0), inputs = [], hashes = [], stepDraws = []
  while (!S.winner) { const inp = {}; S.step(inp); inputs.push(players.map((p) => inp[p.i] ?? 0)); hashes.push(S.hash()); stepDraws.push(rec.splice(0)) }
  let q = init.slice()
  const B = C.createSim({ seed: 999 }).createRound({ ...cfg, seed: 0, players: players.map((p) => ({ ...p, human: p.i === 0 })) }, { feed: () => { if (!q.length) throw new Error('rng underflow'); return q.shift() } })
  let diverged = -1
  for (let k = 0; k < inputs.length; k++) {
    q = stepDraws[k].slice()
    const inp = {}; players.forEach((p, j) => { inp[p.i] = inputs[k][j] })
    B.step(inp)
    if (B.hash() !== hashes[k] || q.length) { diverged = k; break }
  }
  draws += init.length; ticks += inputs.length
  if (diverged < 0 && B.winner?.i === S.winner?.i) ok++
  else { bad++; console.log(`DIVERGED ${key} n=${n} seed=${seed} at tick ${diverged}/${inputs.length} winner server=${S.winner?.i} browser=${B.winner?.i}`) }
}
console.log(`${bad ? 'FAIL' : 'PASS'} determinism: ${ok}/${ok + bad} races identical on every tick (${KEYS.length} themes, 2–4 racers, ${ticks} ticks; seedless clients fed ${draws} random draws)`)
process.exit(bad ? 1 : 0)
