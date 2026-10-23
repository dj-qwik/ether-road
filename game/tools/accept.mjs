// Acceptance suite for the race rules. Usage: node tools/accept.mjs [--quick]
//   LENGTH    every race ends by the 60 s cap with exactly one winner, no exceptions (2, 3, 4 players)
//   SOLVABLE  every course is finished by a flawless driver along its safe line
//   FAIR      identical drivers: no seat wins significantly more (chi-square, p > 0.01)
//   EXPLOIT   lazy play (idle, holding a direction, wiggling, random presses, spamming Use) never beats good players
//   SKILL     players who react faster win more: 150 ms > 220 ms > 300 ms > 400 ms
//   PICKUPS   random caches of 2–3 items (take one, the rest vanish for you) + 2 boost/2 slow strips, same spots for everyone, never under spikes
//   PLATES    electrified plates: same state for every racer on the game's pace; bluffs dead and live plates live
//             the whole time such a racer is on them (with margin), never during the final collapse
//   ITEMS     cannon / burst / EMP / ether boost all get used and do what they say
//   PACING    first elimination typically 18–45 s; the race is rarely still undecided at the cap
import { loadGame, runRace, reactionProfile } from './harness.mjs'

const quick = process.argv.includes('--quick')
const G = loadGame(), S = G.sim
const N = quick ? 60 : 200
const fails = []
const pct = (x) => `${Math.round(x * 100)}%`
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : 0 }
const t0 = Date.now()
const good = (n = 4, ms = 220) => Array.from({ length: n }, () => ({ ai: reactionProfile(ms) }))

// LENGTH + PACING
const lens = [], firstOut = [], why = {}
for (const n of [2, 3, 4]) for (let k = 0; k < N / 2; k++) {
  const R = runRace(G, good(n))
  if (!R.winner || R.t > 60.0001) fails.push(`LENGTH ${n}p race ended at ${R.t.toFixed(2)} s winner ${R.winner?.i}`)
  if (n === 4) {
    lens.push(R.t); why[R.decidedBy] = (why[R.decidedBy] || 0) + 1
    const d = R.active.filter((b) => !b.alive).map((b) => b.deathTick / 60); if (d.length) firstOut.push(Math.min(...d))
  }
}
const atCap = lens.filter((x) => x >= 60).length / lens.length
console.log(`PACING 4 × 220 ms: race length p10 ${q(lens, 0.1).toFixed(0)} s · median ${q(lens, 0.5).toFixed(0)} s · p90 ${q(lens, 0.9).toFixed(0)} s · first out median ${q(firstOut, 0.5).toFixed(0)} s · reached the cap ${pct(atCap)} · decided by ${JSON.stringify(why)}`)
if (q(firstOut, 0.5) < 18 || q(firstOut, 0.5) > 45) fails.push(`PACING first elimination median ${q(firstOut, 0.5).toFixed(1)} s (want 18–45)`)
if (atCap > 0.4) fails.push(`PACING ${pct(atCap)} of races reach the 60 s cap`)

// SOLVABLE: a flawless driver following each course's safe line never crashes (the race only ever uses such courses)
{
  let crashes = 0
  for (let k = 0; k < N; k++) { const R = runRace(G, good(2)); if (!S.pilotSurvives(R.course)) crashes++ }
  console.log(`SOLVABLE flawless driver crashed in ${crashes}/${N} courses`)
  if (crashes) fails.push(`SOLVABLE ${crashes} courses a flawless driver couldn't finish`)
}

// FAIR: four identical drivers
{
  const wins = [0, 0, 0, 0]
  for (let k = 0; k < N * 2; k++) wins[runRace(G, good()).winner.i]++
  const e = (N * 2) / 4, chi = wins.reduce((a, w) => a + (w - e) ** 2 / e, 0)
  console.log(`FAIR seat wins ${wins.join('/')} (chi² ${chi.toFixed(1)})`)
  if (chi > 11.34) fails.push(`FAIR seat wins ${wins.join('/')}`)
}

// EXPLOIT: seat 0 plays lazily against three good players
const LAZY = {
  idle: () => 0,
  'hold right': ({ tick }) => (tick % 4 === 0 ? 2 : 0),
  'hold left': ({ tick }) => (tick % 4 === 0 ? 1 : 0),
  'wiggle left/right': ({ tick }) => (tick % 8 === 0 ? 1 : tick % 8 === 4 ? 2 : 0),
  'random presses': () => { const x = Math.random(); return x < 0.06 ? 1 : x < 0.12 ? 2 : 0 },
  'spam use, else idle': ({ tick }) => (tick % 8 === 0 ? 4 : 0),
}
for (const [name, ctl] of Object.entries(LAZY)) {
  let w = 0, alive = 0
  for (let k = 0; k < N / 2; k++) { const R = runRace(G, good(), { 0: ctl }); if (R.winner.i === 0) w++; alive += R.spheres[0].deathTick ? R.spheres[0].deathTick / 60 : R.t }
  console.log(`EXPLOIT ${name.padEnd(22)} wins ${pct(w / (N / 2)).padStart(4)} · survives ${(alive / (N / 2)).toFixed(1)} s on average`)
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

// PICKUPS: random caches of 2–3 different items, same spots for everyone, off the safe line, never under spikes;
// taking one item takes the whole cache away for that racer. 2 boost + 2 slow strips.
{
  let bad = 0, caches = 0, mixes = new Set(), split = 0
  for (let k = 0; k < N; k++) {
    const R = runRace(G, good(2))
    const c = R.course, C = new Map()
    for (const o of c.orbs) if (o.power) { if (o.cache == null) bad++; else (C.get(o.cache) || C.set(o.cache, []).get(o.cache)).push(o) }
    const boosts = c.strips.filter((x) => x.kind === 'boost').length, slows = c.strips.filter((x) => x.kind === 'slow').length
    const covered = c.orbs.some((o) => c.blocks.some((g) => (g.mask >> o.seg) & 1 && g.s0 - 0.8 < o.s && g.s1 + 0.8 > o.s)) ||
      c.strips.some((x) => c.blocks.some((g) => (g.mask >> x.seg) & 1 && g.s0 - 0.8 < x.s1 && g.s1 + 0.8 > x.s0))
    const badCache = [...C.values()].some((g) => g.length < 2 || new Set(g.map((o) => o.power)).size !== g.length || new Set(g.map((o) => o.seg)).size !== g.length)
    // nobody took two items from one cache
    const greedy = R.active.some((b) => [...C.values()].some((g) => g.filter((o) => b.got.includes(o.id)).length !== 0 && g.some((o) => !b.got.includes(o.id))))
    if (covered || badCache || greedy || C.size < 4 || boosts !== 2 || slows !== 2) bad++
    caches += C.size; for (const g of C.values()) mixes.add(g.map((o) => o.power).sort().join('+'))
    const hands = R.active.map((b) => R.events.filter((e) => e.kind === 'pickup' && e.i === b.i).map((e) => e.item).join(','))
    if (new Set(hands).size > 1) split++
  }
  console.log(`PICKUPS ${N - bad}/${N} courses ok · ${(caches / N).toFixed(1)} caches per course · ${mixes.size} different cache mixes seen · racers picked different items in ${split}/${N} races`)
  if (bad) fails.push(`PICKUPS ${bad} courses with bad, missing or covered caches`)
}

// PLATES: every plate's pulse checked against a racer rolling at the game's pace
{
  let plates = 0, live = 0, bad = 0
  for (let k = 0; k < N; k++) {
    const R = runRace(G, good(2)), C = R.course, tl = C.tl
    for (const g of C.blocks) {
      if (g.ph == null) continue
      plates++; if (g.live) live++
      const k0 = Math.floor(tl.tickAtS(g.s0 - S.SPHERE_R)) - 6, k1 = Math.ceil(tl.tickAtS(g.s1 + S.SPHERE_R)) + 6
      for (let q = k0; q <= k1; q++) if (S.zapOn(g, q) !== !!g.live) { bad++; break }
      if (tl.tOfS(g.s0) >= S.COLLAPSE_AT) bad++
    }
  }
  console.log(`PLATES ${(plates / N).toFixed(1)} per course (${Math.round((live / Math.max(1, plates)) * 100)}% live, the rest bluffs) · ${bad} with the wrong state while a racer on pace is on them`)
  if (bad || plates < N * 2) fails.push(`PLATES ${bad} plates with the wrong state, ${(plates / N).toFixed(1)} per course`)
}

// ITEMS: each held item gets used, and its effect shows up
{
  const tally = {}
  for (let k = 0; k < N; k++) { const R = runRace(G, good()); for (const e of R.events) tally[e.kind + ':' + e.item] = (tally[e.kind + ':' + e.item] || 0) + 1 }
  const line = ['use:cannon', 'blast:undefined', 'use:burst', 'hit:burst', 'use:emp', 'hit:emp', 'use:ether', 'blocked:spike', 'blocked:burst', 'blocked:emp', 'immune:emp', 'immune:burst']
  console.log(`ITEMS over ${N} races: ` + line.map((k) => `${k.replace(':undefined', '')} ${tally[k] || 0}`).join(' · '))
  for (const k of ['use:cannon', 'blast:undefined', 'use:burst', 'hit:burst', 'use:emp', 'hit:emp', 'use:ether']) if (!tally[k]) fails.push(`ITEMS never saw ${k}`)
}
// direct checks of the rules, with items handed out at the start (lab "give" option)
{
  // ether: invincible for 3 s
  let etherOk = 0, n = 0
  for (let k = 0; k < 30; k++) {
    const R = runRace(G, [{ ai: reactionProfile(220) }, { ai: reactionProfile(220) }], { 0: ({ tick }) => (tick === 600 ? 4 : 0) }, null, { give: 'ether' })
    const me = R.spheres[0]; n++
    if (!me.alive && me.deathTick > 600 && me.deathTick <= 780) continue // died while invincible: wrong
    etherOk++
  }
  console.log(`ITEMS ether boost: ${etherOk}/${n} idle racers never died during their 3 s of invincibility`)
  if (etherOk !== n) fails.push('ITEMS ether boost did not protect')
}

// TRACKS: every track paces within the same envelope
for (const key of Object.keys(S.TRACKS)) {
  const L = [], F = []; const races = quick ? 30 : 80
  for (let k = 0; k < races; k++) {
    const R = runRace(G, good(), {}, key)
    L.push(R.t); const d = R.active.filter((b) => !b.alive).map((b) => b.deathTick / 60); if (d.length) F.push(Math.min(...d))
  }
  console.log(`TRACK ${key.padEnd(10)} median ${q(L, 0.5).toFixed(0)} s · p90 ${q(L, 0.9).toFixed(0)} s · first out ${q(F, 0.5).toFixed(0)} s`)
  if (q(L, 0.9) > 60.0001 || q(F, 0.5) < 14 || q(F, 0.5) > 48) fails.push(`TRACK ${key} pacing out of range`)
}

console.log(`${fails.length ? 'FAIL' : 'PASS'} acceptance (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f)
process.exit(fails.length ? 1 : 0)
