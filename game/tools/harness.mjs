// Headless race harness: loads the deterministic simulation (dist/sim.cjs) and plays races.
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export function loadGame(file = process.env.SIM_JS || path.join(here, '..', 'dist', 'sim.cjs')) {
  const require = createRequire(import.meta.url)
  const { createSim } = require(path.resolve(file))
  return { createSim, sim: createSim({ seed: 1 }) }
}
const r32 = () => (Math.random() * 4294967296) >>> 0

/**
 * Profile of a player who reacts in `ms` milliseconds: slower players also tap less precisely, misread more
 * decoys and have more late reactions. Fed to the simulation's own driver (cfg.players[].ai).
 */
export function reactionProfile(ms) {
  const T = 1000 / 60
  return { react: Math.round(ms / T), jitter: (ms * 0.3) / T, lapse: 0.01 + ms / 8000, over: Math.max(0, Math.min(0.4, (ms - 120) / 900)), look: 1.5, greed: 0.6, items: 1 }
}

/**
 * Run one race. players: [{ ai?, skill? }]. controllers[i] (optional) plays seat i: (ctx) => input bits for this tick
 * (1 = step left, 2 = step right, 4 = use item; true means 2), where ctx = { tick, t, s, me, R }. Returns the finished round.
 */
let rot = 0
export function runRace(G, players, controllers = {}, key = null, debug = undefined) {
  if (!key) { const ks = Object.keys(G.sim.TRACKS); key = ks[rot++ % ks.length] } // rotate through every track
  const sim = G.createSim({ seed: r32() })
  const ps = players.map((p, i) => ({ i, name: 'P' + i, skill: p.skill ?? 0.85, ai: p.ai || null }))
  const R = sim.createRound({ key, seed: r32(), players: ps, active: ps.map((p) => p.i), botSalt: String(r32()), debug }, {})
  while (!R.winner) {
    const inputs = {}
    for (const [i, c] of Object.entries(controllers)) { const v = c({ tick: R.tick + 1, t: R.t + 1 / 60, s: R.s, me: R.spheres[+i], R }); inputs[i] = v === true ? 2 : v | 0 }
    R.step(inputs)
    if (R.t > 61) throw new Error('race ran past 61 s')
  }
  return R
}
