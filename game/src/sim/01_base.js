// ───────────────────────── shared constants + pure helpers (in the simulation AND the client) ─────────────────────────
// RNG / DM are bound per scope: seeded + deterministic inside createSim(), Math.random / Math in the browser's global scope.
const DT = 1 / 60;                 // fixed 60 Hz simulation tick
const RACE_SECONDS = 60;           // hard cap: the final collapse guarantees a result by then
const RACE_TICKS = RACE_SECONDS * 60;
const BEAT = 60 / 144;             // the race's rhythm (144 BPM): electrified plates pulse on it

// The pipe: every racer rides the inside wall of their own pipe, split into SEGS positions around it (like Tempest).
// Position 0 is where everyone starts; +1 is one step to the right.
const SEGS = 16;
const TUBE_R = 2.2;                // pipe radius (world units): one position is about 0.86 u wide
const SPHERE_R = 0.38;
const STEP_TICKS = 4;              // one step to the next position takes 67 ms…
const STEP_MID = 2;                // …and collision uses the new position from its midpoint (33 ms in)
const QUEUE_MAX = 3;               // steps pressed while moving are queued (up to 3) and run back to back
const ORB_R = 0.32;
const segWrap = (k) => ((k % SEGS) + SEGS) % SEGS;
const segDist = (a, b) => { const d = segWrap(b - a); return d > SEGS / 2 ? d - SEGS : d; }; // signed shortest steps a → b

// Forward speed is the game's: 20 u/s at the start, +0.25 u/s every second, 35 at the cap. Only strips you choose
// to take, and items (yours, or one fired at you), change a racer's speed.
const speedAt = (t) => Math.min(35, 20 + 0.25 * t);

// One input = one integer per sphere per tick: bit 0 = step left, bit 1 = step right, bit 2 = use the held item.
const IN_L = 1, IN_R = 2, IN_USE = 4;
const TAP = IN_R; // (old name, kept for tools)
const IDLE_INPUT = 0;
function packInput(inp) { return (inp && inp.left ? IN_L : 0) | (inp && inp.right ? IN_R : 0) | (inp && inp.use ? IN_USE : 0); }
function unpackInput(p) { p >>>= 0; return { left: !!(p & IN_L), right: !!(p & IN_R), use: !!(p & IN_USE) }; }

const ROSTER = [
  ['Cyan', '#22E6FF', '●'], ['Magenta', '#FF3DCB', '▲'], ['Acid', '#B6FF3B', '■'], ['Solar', '#FF9F1C', '◆'],
];
const BOT_NAMES = ['Vex', 'Nyx', 'Ion', 'Kilo', 'Rune', 'Zed', 'Halo', 'Pulse', 'Echo', 'Flux'];
// Computer players: skill = reaction time, precision and judgement. Kept a notch below a good human.
const BOT_SKILL = [0.55, 0.82];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
// piecewise-linear lookup over [[x, y], …] sorted by x
function pwl(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return pts[pts.length - 1][1];
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
