// Every racer's rail must be exactly as long as everyone else's, chunk by chunk, on every track.
//   node tools/tracks.mjs [races-per-track=3]
import { loadClient } from './client.mjs'
const C = loadClient(), PER = +(process.argv[2] || 3)
let worst = 0, worstTotal = 0, fails = 0
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
  }
  console.log(`${key.padEnd(10)} rail length ${total.toFixed(0)} u · tallest equalizing hill ${bump.toFixed(2)} u`)
}
const ok = worstTotal < 0.001 && worst < 0.01
console.log(`${ok ? 'PASS' : 'FAIL'} equal rails: worst per-chunk mismatch ${(worst * 100).toFixed(3)}% · worst whole-race mismatch ${(worstTotal * 100).toFixed(4)}%`)
process.exit(ok ? 0 : 1)
