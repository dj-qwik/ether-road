// The pipes, on every track: equal length, never touching, smooth enough to ride.
//   equal    every racer's pipe exactly as long as everyone else's, over the whole race and over every 96 u stretch
//            (pipes are resampled evenly by arc length, so equal track distance = equal pipe length everywhere)
//   apart    centre lines at least 2 × radius + 0.5 u apart, anywhere within 150 u of each other
//   smooth   no pipe turns more than 15° over any 4 u (the camera rides these; tight wiggles make people sick)
//   node tools/tracks.mjs [races-per-track=3]
import { loadClient } from './client.mjs'
const C = loadClient(), PER = +(process.argv[2] || 3), STEP = C.RAILGEO.STEP
let worst = 0, worstTotal = 0, closest = 1e9, maxTurn = 0
const turns = []
for (const key of Object.keys(C.SIM0.TRACKS)) {
  let bump = 0, total = 0, trackTurn = 0
  for (let r = 0; r < PER; r++) {
    const n = 2 + (r % 3), seed = (Math.random() * 4294967296) >>> 0
    const R = C.createSim({ seed }).createRound({ key, seed, players: Array.from({ length: n }, (_, i) => ({ i })), active: Array.from({ length: n }, (_, i) => i) })
    const rails = C.RAILGEO.build(R.course, n, R.course.tl.sAtT, key)
    const W = Math.round(96 / STEP), chunks = Math.floor((rails[0].N - 1) / W)
    const seg = (rl, i) => Math.hypot(rl.pos[i * 3 + 3] - rl.pos[i * 3], rl.pos[i * 3 + 4] - rl.pos[i * 3 + 1], rl.pos[i * 3 + 5] - rl.pos[i * 3 + 2])
    const drawn = rails.map((rl) => { const L = new Float64Array(chunks); for (let c = 0; c < chunks; c++) for (let i = c * W; i < (c + 1) * W; i++) L[c] += seg(rl, i); return L })
    for (let c = 0; c < chunks; c++) { const d = drawn.map((L) => L[c]); worst = Math.max(worst, (Math.max(...d) - Math.min(...d)) / Math.max(...d)) }
    const tot = rails.map((rl) => { let l = 0; for (let i = 0; i < rl.N - 1; i++) l += seg(rl, i); return l }); total = tot[0]
    worstTotal = Math.max(worstTotal, (Math.max(...tot) - Math.min(...tot)) / Math.max(...tot))
    bump = Math.max(bump, ...rails.map((rl) => rl.bump))
    // smoothness: turn over 4 u
    const K = Math.round(4 / STEP)
    for (const rl of rails) { const p = rl.pos
      for (let i = K; i < rl.N - K - 1; i += 2) {
        const ax = p[i * 3] - p[(i - K) * 3], ay = p[i * 3 + 1] - p[(i - K) * 3 + 1], az = p[i * 3 + 2] - p[(i - K) * 3 + 2], bx = p[(i + K) * 3] - p[i * 3], by = p[(i + K) * 3 + 1] - p[i * 3 + 1], bz = p[(i + K) * 3 + 2] - p[i * 3 + 2]
        const d = Math.acos(Math.min(1, (ax * bx + ay * by + az * bz) / Math.hypot(ax, ay, az) / Math.hypot(bx, by, bz))) * 180 / Math.PI
        turns.push(d); if (d > trackTurn) trackTurn = d
      } }
    // separation: every 1 u of each pipe against every 1 u of every other pipe within 150 u
    const SK = Math.round(1 / STEP), WS = 150 * SK
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const A = rails[a].pos, B = rails[b].pos, N = rails[a].N
      for (let i = 0; i < N; i += SK) for (let j = Math.max(0, i - WS); j < Math.min(N, i + WS); j += SK) {
        const d = Math.hypot(A[i * 3] - B[j * 3], A[i * 3 + 1] - B[j * 3 + 1], A[i * 3 + 2] - B[j * 3 + 2]); if (d < closest) closest = d
      }
    }
  }
  maxTurn = Math.max(maxTurn, trackTurn)
  console.log(`${key.padEnd(10)} pipe length ${total.toFixed(0)} u · tallest equalizing swell ${bump.toFixed(1)} u · sharpest turn ${trackTurn.toFixed(1)}° per 4 u`)
}
turns.sort((a, b) => a - b)
const minSep = 2 * C.SIM0.TUBE_R + 0.5, ok = worstTotal < 0.001 && worst < 0.005 && closest >= minSep && maxTurn <= 15
console.log(`${ok ? 'PASS' : 'FAIL'} pipes: equal length (worst whole-race ${(worstTotal * 100).toFixed(4)}%, worst 96 u stretch ${(worst * 100).toFixed(3)}%) · never touch (closest ${closest.toFixed(2)} u, need ≥ ${minSep.toFixed(1)}) · smooth (turn per 4 u: p99 ${turns[Math.floor(turns.length * 0.99)].toFixed(1)}°, max ${maxTurn.toFixed(1)}°, limit 15°)`)
process.exit(ok ? 0 : 1)
