// End-to-end network test: starts the real server, connects headless racers over real WebSockets with simulated
// latency + jitter, plays full races with taps stamped by the shared clock, and checks that every client's
// replay agrees with the server exactly (winner + state fingerprint), including a racer who drops and reconnects.
//   node tools/nettest.mjs [matches=2] [size=4] [--lat 60] [--jitter 40] [--no-reconnect] [--humans n]
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const num = (f, d) => (args.includes(f) ? +args[args.indexOf(f) + 1] : d)
const MATCHES = +(args.find((a) => /^\d+$/.test(a)) || 2)
const SIZE = +(args.filter((a) => /^\d+$/.test(a))[1] || 4)
const LAT = num('--lat', 60), JIT = num('--jitter', 40), HUMANS = num('--humans', SIZE)
process.env.PORT = String(20000 + ((Math.random() * 20000) | 0))
const { createSim, createFollower } = require(path.join(here, '..', 'dist', 'sim.cjs'))
const { default: WebSocket } = await import('ws')
await import(path.join(here, '..', 'server', 'index.mjs'))
const URL_ = `ws://127.0.0.1:${process.env.PORT}/ws`
const TICK = 1000 / 60

const results = { healed: [], races: 0, agree: 0, desyncs: [], done: 0, reconnects: 0, taps: 0, late: 0 }
function racer(name) {
  const P = { name, token: null, me: -1, ws: null, F: null, done: false, at: 0, next: 0, sent: [] }
  const q = [] // in-order delivery after a simulated one-way delay (TCP never reorders)
  const deliver = (fn) => { const at = Math.max(q.length ? q.at(-1).at : 0, Date.now() + LAT / 2 + Math.random() * JIT); q.push({ at, fn }) }
  P.pump = setInterval(() => { const now = Date.now(); while (q.length && q[0].at <= now) q.shift().fn() }, 2)
  const send = (o) => { const s = JSON.stringify(o); deliver(() => { if (P.ws && P.ws.readyState === 1) P.ws.send(s) }) }
  function connect() {
    P.ws = new WebSocket(URL_)
    P.ws.on('open', () => send({ t: 'hello', name, token: P.token }))
    P.ws.on('message', (d) => { const m = JSON.parse(d); deliver(() => onMsg(m)) })
  }
  const follower = (me) => createFollower({ createSim, me, onDesync: (why) => { results.healed.push(`${name} ${why}`); send({ t: 'resync' }) } })
  function onMsg(m) {
    if (m.t === 'welcome') { P.token = m.token; if (P.me < 0) send({ t: 'queue', mode: 'free', size: SIZE }) }
    else if (m.t === 'match') { P.me = m.you; P.F = follower(P.me) }
    else if (m.t === 'round') { P.F.round(m); setTimeout(() => send({ t: 'ready' }), Math.random() * 1500) }
    else if (m.t === 'count') { P.at = m.at; P.next = 60 + Math.floor(Math.random() * 60) }
    else if (m.t === 'tk') { P.F.addFrames(m.k, m.f); P.F.step(Infinity) }
    else if (m.t === 'h') P.F.checkpoint(m.k, m.h)
    else if (m.t === 'end') { P.F.ended(m); P.F.step(Infinity); check(m) }
    else if (m.t === 'sync') { if (!P.F) P.F = follower(m.match.you); P.me = m.match.you; P.at = m.at || P.at; P.F.sync(m); results.reconnects++; if (m.end) check({ w: m.end.w, h: m.end.h }) }
    else if (m.t === 'closed') P.done = true
  }
  function check(m) {
    if (P.checked) return; P.checked = true; results.races++
    const F = P.F, ok = !F.desync && F.R.winner && F.R.winner.i === m.w && F.R.hash() === m.h
    // latency compensation: how many taps landed on exactly the tick they were stamped with
    const j = F.R.active.findIndex((b) => b.i === P.me), applied = []
    F.frames.forEach((fr, k) => { if (fr[0][j] & 1) applied.push(k + 1) })
    const sent = P.sent.filter((k) => k <= F.R.tick)
    for (const k of sent) { if (applied.includes(k)) results.onTime = (results.onTime || 0) + 1; else results.late++ }
    if (ok) results.agree++; else results.desyncs.push(`${name}: local winner ${F.R?.winner?.i} server ${m.w} desync=${F.desync}`)
    P.done = true
  }
  // tap every 0.15–0.5 s, stamped with the race tick on the (shared) clock, like the browser does
  P.loop = setInterval(() => {
    if (!P.at || P.done) return
    const k = Math.floor((Date.now() - P.at) / TICK) + 1
    if (k >= P.next) { send({ t: 'tap', k }); P.sent.push(k); results.taps++; P.next = k + 9 + Math.floor(Math.random() * 22) }
  }, 8)
  P.drop = () => { P.ws.terminate(); setTimeout(connect, 1200) }
  connect()
  return P
}

for (let m = 0; m < MATCHES; m++) {
  const ps = Array.from({ length: HUMANS }, (_, i) => racer(`T${m}_${i}`))
  if (!args.includes('--no-reconnect') && m === 0) setTimeout(() => ps[1].drop(), 30000) // mid-race drop + rejoin
  const t0 = Date.now()
  await new Promise((res) => { const iv = setInterval(() => { if (ps.every((p) => p.done) || Date.now() - t0 > 150e3) { clearInterval(iv); res() } }, 200) })
  ps.forEach((p) => { clearInterval(p.loop); clearInterval(p.pump); p.ws.close() })
  results.done += ps.every((p) => p.checked) ? 1 : 0
  console.log(`match ${m + 1}: ${((Date.now() - t0) / 1000).toFixed(0)} s, ${results.taps} taps sent so far`)
}
const pass = !results.desyncs.length && results.agree === results.races && results.done === MATCHES
console.log(`${pass ? 'PASS' : 'FAIL'} network: ${results.agree}/${results.races} client races matched the server exactly · ${results.reconnects} reconnect sync(s) · latency ${LAT}±${JIT} ms · taps on their stamped tick ${results.onTime || 0}/${(results.onTime || 0) + results.late}`)
if (results.desyncs.length) console.log(results.desyncs.slice(0, 10).join('\n'))
if (results.healed.length) console.log(`self-healed desyncs: ${results.healed.length}\n` + results.healed.slice(0, 8).join('\n'))
process.exit(pass ? 0 : 1)
