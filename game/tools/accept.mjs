// Acceptance suite for the race rules. Usage: node tools/accept.mjs [--quick]
//   LENGTH    every race ends by the 60 s cap with exactly one winner, no exceptions (2, 3, 4 players)
//   SOLVABLE  every course is finished by a flawless driver (the generator rebuilds any it can't finish)
//   FAIR      identical drivers: no seat wins significantly more (chi-square, p > 0.01)
//   EXPLOIT   lazy play (idle, mashing, metronome taps at several tempos, random taps) never beats good players
//   SKILL     players who react faster win more: 150 ms > 220 ms > 300 ms > 400 ms (spec §21 survival curves)
//   PACING    first elimination typically 20–45 s; the race is rarely still undecided at the cap
import { loadGame, runRace, reactionProfile } from './harness.mjs'

const quick = process.argv.includes('--quick')
const G = loadGame()
const N = quick ? 60 : 200
const fails = []
const pct = (x) => `${Math.round(x * 100)}%`
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))] }
const t0 = Date.now()

// LENGTH + PACING (good players)
const lens = [], firstOut = [], why = {}
for (const n of [2, 3, 4]) for (let k = 0; k < N / 2; k++) {
  const R = runRace(G, Array.from({ length: n }, () => ({ ai: reactionProfile(220) })))
  if (!R.winner || R.t > 60.0001) fails.push(`LENGTH ${n}p race ended at ${R.t.toFixed(2)} s winner ${R.winner?.i}`)
  if (n === 4) {
    lens.push(R.t); why[R.decidedBy] = (why[R.decidedBy] || 0) + 1
    const d = R.active.filter((b) => !b.alive).map((b) => b.deathTick / 60); if (d.length) firstOut.push(Math.min(...d))
  }
}
const atCap = lens.filter((x) => x >= 60).length / lens.length
console.log(`PACING 4 × 220 ms: race length p10 ${q(lens, 0.1).toFixed(0)} s · median ${q(lens, 0.5).toFixed(0)} s · p90 ${q(lens, 0.9).toFixed(0)} s · first out median ${q(firstOut, 0.5).toFixed(0)} s · reached the cap ${pct(atCap)} · decided by ${JSON.stringify(why)}`)
if (q(firstOut, 0.5) < 18 || q(firstOut, 0.5) > 45) fails.push(`PACING first elimination median ${q(firstOut, 0.5).toFixed(1)} s (want 18–45)`)
if (atCap > 0.35) fails.push(`PACING ${pct(atCap)} of races reach the 60 s cap`)

// SOLVABLE: a flawless driver (σ = 0, instant reactions, no misreads) never crashes
{
  let crashes = 0
  const flawless = { react: 0, sigma: 0, fool: 0, lapse: 0, greed: 0, aim: 0 }
  for (let k = 0; k < N; k++) { const R = runRace(G, [{ ai: flawless }]); if (!R.spheres[0].alive) crashes++ }
  console.log(`SOLVABLE flawless driver crashed in ${crashes}/${N} courses`)
  if (crashes) fails.push(`SOLVABLE ${crashes} unsolvable courses`)
}

// FAIR: four identical drivers
{
  const wins = [0, 0, 0, 0]
  for (let k = 0; k < N * 2; k++) wins[runRace(G, Array.from({ length: 4 }, () => ({ ai: reactionProfile(220) }))).winner.i]++
  const e = (N * 2) / 4, chi = wins.reduce((a, w) => a + (w - e) ** 2 / e, 0)
  console.log(`FAIR seat wins ${wins.join('/')} (chi² ${chi.toFixed(1)})`)
  if (chi > 11.34) fails.push(`FAIR seat wins ${wins.join('/')}`)
}

// EXPLOIT: seat 0 plays lazily against three good players
const good = () => [{ ai: reactionProfile(220) }, { ai: reactionProfile(220) }, { ai: reactionProfile(220) }, { ai: reactionProfile(220) }]
const LAZY = {
  idle: () => false,
  'mash (every 4 ticks)': ({ tick }) => tick % 4 === 0,
  'metronome 0.25 s': ({ tick }) => tick % 15 === 0,
  'metronome 0.42 s (on the beat)': ({ tick }) => tick % 25 === 0,
  'metronome 1 s': ({ tick }) => tick % 60 === 0,
  'random taps': () => Math.random() < 0.06,
}
for (const [name, ctl] of Object.entries(LAZY)) {
  let w = 0, alive = 0
  for (let k = 0; k < N / 2; k++) { const R = runRace(G, good(), { 0: ctl }); if (R.winner.i === 0) w++; alive += R.spheres[0].deathTick ? R.spheres[0].deathTick / 60 : R.t }
  console.log(`EXPLOIT ${name.padEnd(30)} wins ${pct(w / (N / 2)).padStart(4)} · survives ${(alive / (N / 2)).toFixed(1)} s on average`)
  if (w / (N / 2) > 0.02) fails.push(`EXPLOIT "${name}" wins ${pct(w / (N / 2))}`)
}

// SKILL: one player each at 150 / 220 / 300 / 400 ms reactions
{
  const ms = [150, 220, 300, 400], wins = [0, 0, 0, 0], surv = [0, 0, 0, 0]
  for (let k = 0; k < N * 2; k++) {
    const R = runRace(G, ms.map((m) => ({ ai: reactionProfile(m) })))
    wins[R.winner.i]++
    R.spheres.forEach((b, j) => { surv[j] += b.alive ? R.t : b.deathTick / 60 })
  }
  console.log(`SKILL wins by reaction time ${ms.map((m, j) => `${m} ms ${pct(wins[j] / (N * 2))} (lives ${(surv[j] / (N * 2)).toFixed(0)} s)`).join(' · ')}`)
  for (let j = 1; j < 4; j++) if (wins[j] > wins[j - 1] * 1.1 + 4) fails.push(`SKILL ${ms[j]} ms wins more than ${ms[j - 1]} ms`)
}

// TRACKS: every track paces within the same envelope; power-ups show up and get used
for (const key of Object.keys(G.sim.TRACKS)) {
  const L = [], F = []; let powers = 0, shieldSaves = 0, races = quick ? 30 : 80
  for (let k = 0; k < races; k++) {
    const R = runRace(G, Array.from({ length: 4 }, () => ({ ai: reactionProfile(220) })), {}, key)
    L.push(R.t); const d = R.active.filter((b) => !b.alive).map((b) => b.deathTick / 60); if (d.length) F.push(Math.min(...d))
    powers += R.course.orbs.filter((o) => o.power).length; shieldSaves += R.active.filter((b) => b.shieldUsedTick).length
  }
  console.log(`TRACK ${key.padEnd(10)} median ${q(L, 0.5).toFixed(0)} s · p90 ${q(L, 0.9).toFixed(0)} s · first out ${q(F, 0.5).toFixed(0)} s · ${(powers / races).toFixed(1)} power-ups per race · shields saved a racer ${shieldSaves}×`)
  if (q(L, 0.9) > 60.0001 || q(F, 0.5) < 15 || q(F, 0.5) > 48) fails.push(`TRACK ${key} pacing out of range`)
  if (powers / races < 2.5) fails.push(`TRACK ${key} too few power-ups`)
}

console.log(`${fails.length ? 'FAIL' : 'PASS'} acceptance (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f)
process.exit(fails.length ? 1 : 0)
