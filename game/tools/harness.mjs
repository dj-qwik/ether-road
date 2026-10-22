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
  return { react: Math.round(ms / (1000 / 60) * 0.55), sigma: (ms * 0.12) / (1000 / 60), fool: Math.max(0, (ms - 120) / 1000), lapse: 0.01 + ms / 10000, greed: 0.7, aim: 0.15 }
}

/**
 * Run one race. players: [{ ai?, skill? }]. controllers[i] (optional) plays seat i: (ctx) => true to tap this tick,
 * where ctx = { tick, t, s, me, R }. Returns the finished round.
 */
export function runRace(G, players, controllers = {}, key = 'void') {
  const sim = G.createSim({ seed: r32() })
  const ps = players.map((p, i) => ({ i, name: 'P' + i, skill: p.skill ?? 0.85, ai: p.ai || null }))
  const R = sim.createRound({ key, seed: r32(), players: ps, active: ps.map((p) => p.i), botSalt: String(r32()) }, {})
  while (!R.winner) {
    const inputs = {}
    for (const [i, c] of Object.entries(controllers)) inputs[i] = c({ tick: R.tick + 1, t: R.t + 1 / 60, s: R.s, me: R.spheres[+i], R }) ? 1 : 0
    R.step(inputs)
    if (R.t > 61) throw new Error('race ran past 61 s')
  }
  return R
}
