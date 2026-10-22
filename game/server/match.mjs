// One match on the server: lobby → ready check → countdown → ONE race → result.
// The server is the only authority: it runs the deterministic race simulation, decides the winner, and streams
// every tick's inputs (and the random draws the tick consumed) so browsers can replay it exactly.
//
// Latency: race tick k belongs to the moment at + k·TICK on the shared clock, but the server simulates it D ticks
// later. A tap stamped with the tick the player was looking at therefore arrives in time and lands on exactly
// that tick (up to D·TICK ≈ 150 ms of one-way latency). Later taps land on the next tick still open. A tap can
// never be applied to a tick that has already been simulated, so nobody can rewrite the past.
import crypto from 'node:crypto'
import { keccak256 } from 'viem'

export const T = {
  INTRO_MS: 8000, // ready card
  INTRO_READY_MS: 1500, // everyone pressed Ready → start sooner
  COUNT_MS: 3000,
  DELAY_TICKS: 9, // D: latency allowance (150 ms)
  LINGER_MS: 30000, // result screen before the match closes
  FILL_MS: 12000, // free play: fill empty seats with bots after this long
  TICK_MS: 1000 / 60,
  FRAME_EVERY: 2, // ticks per network frame (30 Hz)
  HASH_EVERY: 60, // state fingerprint once a second for desync detection
  MAX_CATCHUP: 12,
}
const TAP = 1
// Race seeds come from 32 random bytes: the commitment keccak256(reveal) can't be brute-forced, and the
// simulation seed is derived from the reveal so anyone holding the replay can re-run the race.
const DECK = []
function drawTheme(keys) {
  if (!DECK.length) { const fresh = [...keys]; for (let j = fresh.length - 1; j > 0; j--) { const r = crypto.randomInt(j + 1); [fresh[j], fresh[r]] = [fresh[r], fresh[j]] } DECK.push(...fresh) }
  return DECK.shift()
}
const newSeedReveal = () => '0x' + crypto.randomBytes(32).toString('hex')
const simSeed = (reveal) => Number.parseInt(keccak256(reveal).slice(2, 10), 16) >>> 0
const BOT_SKILL = [0.55, 0.82] // keep in sync with src/sim/01_base.js
const BOT_NAMES = ['Vex', 'Nyx', 'Ion', 'Kilo', 'Rune', 'Zed', 'Halo', 'Pulse', 'Echo', 'Flux']

export class Match {
  /**
   * @param {object} o
   * @param {string} o.id
   * @param {'free'|'cash'} o.mode
   * @param {number} o.size seats (2–4)
   * @param {string} [o.stake] decimal ETH string (cash)
   * @param {(env:object)=>any} o.createSim
   * @param {(m:Match, ev:string, data?:any)=>void} [o.hook] lifecycle hook (settlement, metrics)
   */
  constructor(o) {
    Object.assign(this, { id: o.id, mode: o.mode, size: o.size, stake: o.stake || null, createSim: o.createSim, hook: o.hook || (() => {}) })
    this.seats = []
    this.state = 'lobby'
    this.createdAt = Date.now()
    this.fillAt = 0
    this.wins = []; this.roundWinners = []; this.history = []; this.roundNo = 0; this.champion = null
    this.round = null; this.frames = []; this.pending = []; this.init = []; this.rec = []
    this.audit = [] // { n, key, seedReveal, active, players, inputs } — enough for anyone to replay and verify
    this.themes = Object.keys(o.createSim({}).ARENAS)
    this.names = BOT_NAMES.slice().sort(() => 0.5 - Math.random())
    this.at = 0
  }

  // ───────────── seats / lobby
  get humans() { return this.seats.filter((s) => s.kind === 'human') }
  get open() { return this.state === 'lobby' && this.seats.length < this.size }
  join(conn, profile) {
    if (!this.open) return null
    const seat = { i: this.seats.length, kind: 'human', name: profile.name, skin: profile.skin | 0, user: profile.user, wallet: profile.wallet || null, conn, connected: true, taps: [], ready: false }
    this.seats.push(seat)
    if (this.mode === 'free' && !this.fillAt) this.fillAt = Date.now() + T.FILL_MS
    this.broadcastLobby()
    if (this.seats.length === this.size) this.start()
    return seat
  }
  leaveLobby(seat) {
    if (this.state !== 'lobby') return
    this.seats.splice(this.seats.indexOf(seat), 1)
    this.seats.forEach((s, k) => { s.i = k })
    if (!this.humans.length) this.close('empty')
    else this.broadcastLobby()
  }
  lobbyMsg(forSeat) {
    return { t: 'lobby', id: this.id, mode: this.mode, size: this.size, stake: this.stake, you: forSeat ? forSeat.i : -1,
      seats: this.seats.map((s) => ({ i: s.i, name: s.name, bot: s.kind === 'bot' })), fillInMs: this.fillAt ? Math.max(0, this.fillAt - Date.now()) : null }
  }
  broadcastLobby() { for (const s of this.humans) this.send(s, this.lobbyMsg(s)) }

  start() {
    // free play tops up with bots so nobody waits forever; cash matches never contain bots
    if (this.mode === 'free') while (this.seats.length < this.size) {
      this.seats.push({ i: this.seats.length, kind: 'bot', name: this.names[this.seats.length % this.names.length], skin: crypto.randomInt(24), skill: BOT_SKILL[0] + Math.random() * (BOT_SKILL[1] - BOT_SKILL[0]), connected: true, taps: [] })
    }
    this.wins = this.seats.map(() => 0)
    this.hook(this, 'start')
    for (const s of this.humans) this.send(s, this.matchMsg(s))
    this.nextRound()
  }
  matchMsg(s) {
    return { t: 'match', id: this.id, mode: this.mode, size: this.size, stake: this.stake, you: s.i,
      seats: this.seats.map((x) => ({ i: x.i, name: x.name, bot: x.kind === 'bot' })) }
  }

  // ───────────── the race
  playersCfg() { return this.seats.map((s) => ({ i: s.i, name: s.name, skin: s.skin | 0, skill: s.kind === 'bot' ? s.skill : 0.85 })) } // skin: cosmetic, never affects the race
  nextRound() {
    this.roundNo++
    const key = drawTheme(this.themes); this.history.push(key) // a random track (shuffled deck: all six before any repeat)
    const active = this.seats.map((s) => s.i)
    const seedReveal = newSeedReveal(), seed = simSeed(seedReveal)
    this.rec = []
    this.round = this.createSim({ seed: 1 }).createRound({ key, seed, players: this.playersCfg(), active, botSalt: this.id }, { record: this.rec })
    this.init = this.rec.splice(0)
    this.frames = []; this.pending = []
    this.audit.push({ n: this.roundNo, key, seedReveal, active, players: this.playersCfg().map((p) => ({ i: p.i, speedMul: 1 })), inputs: [] })
    for (const s of this.humans) { s.ready = false; s.taps = [] }
    this.phase('intro', T.INTRO_MS)
    this.broadcast(this.roundMsg())
  }
  roundMsg() {
    return { t: 'round', n: this.roundNo, key: this.round.key, isFinal: false, active: this.round.active.map((b) => b.i),
      players: this.playersCfg().map(({ skill, ...p }) => p), init: this.init, wins: this.wins, rw: this.roundWinners, introMs: Math.max(0, this.until - Date.now()) }
  }
  phase(state, ms = 0) { this.state = state; this.until = Date.now() + ms; this.phaseAt = Date.now() }
  ready(seat) {
    if (this.state !== 'intro') return
    seat.ready = true
    const waiting = this.humans.filter((s) => s.connected && !s.ready)
    if (!waiting.length && this.until - Date.now() > T.INTRO_READY_MS) { this.until = Date.now() + T.INTRO_READY_MS; this.broadcast({ t: 'intro', ms: T.INTRO_READY_MS }) }
  }

  // ───────────── the clock: called every few ms by the server loop
  pump(now) {
    if (this.state === 'lobby') { if (this.mode === 'free' && this.fillAt && now >= this.fillAt) this.start(); return }
    if (this.state === 'intro' && now >= this.until) {
      this.at = now + T.COUNT_MS; this.phase('count', T.COUNT_MS)
      this.broadcast({ t: 'count', ms: T.COUNT_MS, at: this.at, D: T.DELAY_TICKS }); return
    }
    if (this.state === 'count' && now >= this.until) { this.phase('play'); return }
    if (this.state === 'play') {
      const due = Math.floor((now - this.at) / T.TICK_MS) - T.DELAY_TICKS
      let n = 0
      while (this.state === 'play' && this.round.tick < due && n++ < T.MAX_CATCHUP) this.stepTick()
      return
    }
    if (this.state === 'champ' && now >= this.until) this.close('finished')
  }
  stepTick() {
    const R = this.round, inputs = {}, k = R.tick + 1
    for (const b of R.active) {
      const s = this.seats[b.i]
      if (s.kind === 'bot') continue // the race's own driver plays it (server-side RNG stream); result is broadcast
      let p = 0
      if (s.taps.length && s.taps[0] <= k) { s.taps.shift(); p = TAP } // one tap per tick; the rest wait their turn
      inputs[b.i] = p
    }
    const w = R.step(inputs)
    const row = R.active.map((b) => inputs[b.i])
    const frame = [row, this.rec.splice(0)]
    this.frames.push(frame); this.pending.push(frame); this.audit.at(-1).inputs.push(row)
    if (R.tick % T.FRAME_EVERY === 0 || w) this.flush()
    if (R.tick % T.HASH_EVERY === 0) this.broadcast({ t: 'h', k: R.tick, h: R.hash() })
    if (w) this.endRound(w)
  }
  flush() {
    if (!this.pending.length) return
    this.broadcast({ t: 'tk', k: this.round.tick - this.pending.length + 1, f: this.pending })
    this.pending = []
  }
  endRound(w) {
    this.flush()
    this.wins[w.i]++; this.roundWinners.push(w.i); this.champion = w.i
    const places = [...this.round.active].sort((a, b) => a.place - b.place).map((b) => b.i)
    this.broadcast({ t: 'end', n: this.roundNo, k: this.round.tick, w: w.i, h: this.round.hash(), wins: this.wins, rw: this.roundWinners, champ: w.i, places, by: this.round.decidedBy })
    this.hook(this, 'round', { n: this.roundNo, winner: w.i })
    this.phase('champ', T.LINGER_MS)
    this.hook(this, 'champion', { winner: w.i })
    this.broadcast({ t: 'champ', w: w.i, wins: this.wins, rw: this.roundWinners, rounds: this.roundNo })
  }
  close(reason) {
    if (this.state === 'closed') return
    this.state = 'closed'
    for (const s of this.humans) { this.send(s, { t: 'closed', reason }); if (s.conn) s.conn.match = null }
    this.hook(this, 'closed', { reason })
  }

  // ───────────── players' messages
  /** A tap stamped with race tick k. Ticks already simulated are closed: the tap waits for the next open one. */
  tap(seat, k) {
    k = Math.floor(Number(k))
    if (!(k >= 1) || this.state === 'lobby' || this.state === 'champ' || this.state === 'closed') return
    const R = this.round; if (!R || R.winner) return
    if (k > R.tick + T.DELAY_TICKS + 240) return // stamped far in the future (clock nonsense): drop
    if (seat.taps.length >= 16) return
    seat.taps.push(Math.max(k, R.tick + 1)); seat.taps.sort((a, b) => a - b)
  }
  disconnect(seat) {
    if (this.state === 'lobby') return this.leaveLobby(seat)
    // a dropped player's sphere keeps rolling in its lane (no taps); it reconnects into the same seat
    seat.connected = false; seat.conn = null
    this.broadcast({ t: 'presence', i: seat.i, on: false })
    if (!this.humans.some((s) => s.connected) && this.mode === 'free') this.close('abandoned')
  }
  reconnect(seat, conn) {
    seat.conn = conn; seat.connected = true
    this.send(seat, this.syncMsg(seat))
    this.broadcast({ t: 'presence', i: seat.i, on: true })
  }
  /** Everything a browser needs to rebuild the current moment exactly (reconnect or desync repair). */
  syncMsg(seat) {
    const base = { t: 'sync', match: this.matchMsg(seat), wins: this.wins, rw: this.roundWinners, state: this.state, msLeft: Math.max(0, this.until - Date.now()), at: this.at, D: T.DELAY_TICKS }
    if (this.state === 'lobby') return { ...base, lobby: this.lobbyMsg(seat) }
    return { ...base, round: this.roundMsg(), k0: 1, frames: this.frames, end: this.round.winner ? { w: this.round.winner.i, k: this.round.tick, h: this.round.hash() } : null }
  }

  send(seat, msg) { if (seat.conn && seat.connected) seat.conn.sendJson(msg) }
  broadcast(msg) { const s = JSON.stringify(msg); for (const x of this.humans) if (x.conn && x.connected) x.conn.sendRaw(s) }
}
