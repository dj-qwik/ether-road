// Every racer's pipe must be exactly as long as everyone else's, chunk by chunk, on every track, and no two pipes
// may ever touch (centre lines at least 2 × radius + a gap apart).
//   node tools/tracks.mjs [races-per-track=3]
import { loadClient } from './client.mjs'
const C = loadClient(), PER = +(process.argv[2] || 3)
let worst = 0, worstTotal = 0, fails = 0, closest = 1e9
for (const key of Object.keys(C.SIM0.TRACKS)) {
  let bump = 0, total = 0
  for (let r = 0; r < PER; r++) {
    const n = 2 + (r % 3), seed = (Math.random() * 4294967296) >>> 0
    const R = C.createSim({ seed }).createRound({ key, seed, players: Array.from({ length: n }, (_, i) => ({ i })), active: Array.from({ length: n }, (_, i) => i) })
    const rails = C.RAILGEO.build(R.course, n, R.course.tl.sAtT, key)
    const chunks = rails[0].len.length, CH = C.RAILGEO.CH / C.RAILGEO.STEP
    // arc length of the drawn (resampled) rail per chunk, compared across rails
    const drawn = rails.map((rl) => { const L = new Float64Array(chunks); for (let c = 0; c < chunks; c++) for (let i = c * CH; i < (c + 1) * CH; i++) L[c] += Math.hypot(rl.pos[i * 3 + 3] - rl.pos[i * 3], rl.pos[i * 3 + 4] - rl.pos[i * 3 + 1], rl.pos[i * 3 + 5] - rl.pos[i * 3 + 2]); return L })
    for (let c = 0; c < chunks; c++) {
      const exact = rails.map((rl) => rl.len[c]), d = drawn.map((L) => L[c])
      worst = Math.max(worst, Math.max(...exact) - Math.min(...exact), (Math.max(...d) - Math.min(...d)) / Math.max(...d))
    }
    const tot = drawn.map((L) => L.reduce((a, b) => a + b, 0)); total = tot[0]
    worstTotal = Math.max(worstTotal, (Math.max(...tot) - Math.min(...tot)) / Math.max(...tot))
    bump = Math.max(bump, ...rails.map((rl) => rl.bump))
    // separation: every 1 u of each pipe against every 1 u of every other pipe within 150 u
    const SK = Math.round(1 / C.RAILGEO.STEP), W = 150 * SK
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const A = rails[a].pos, B = rails[b].pos, N = rails[a].N
      for (let i = 0; i < N; i += SK) for (let j = Math.max(0, i - W); j < Math.min(N, i + W); j += SK) {
        const d = Math.hypot(A[i * 3] - B[j * 3], A[i * 3 + 1] - B[j * 3 + 1], A[i * 3 + 2] - B[j * 3 + 2]); if (d < closest) closest = d
      }
    }
  }
  console.log(`${key.padEnd(10)} pipe length ${total.toFixed(0)} u · biggest equalizing bulge ${bump.toFixed(2)} u · closest pipes so far ${closest.toFixed(2)} u apart`)
}
const minSep = 2 * C.SIM0.TUBE_R + 0.5, ok = worstTotal < 0.001 && worst < 0.01 && closest >= minSep
console.log(`${ok ? 'PASS' : 'FAIL'} pipes never touch: closest centre lines ${closest.toFixed(2)} u (need ≥ ${minSep.toFixed(1)}) · equal pipes: worst per-chunk mismatch ${(worst * 100).toFixed(3)}% · worst whole-race mismatch ${(worstTotal * 100).toFixed(4)}%`)
process.exit(ok ? 0 : 1)
