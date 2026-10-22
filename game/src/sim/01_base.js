// ───────────────────────── shared constants + pure helpers (in the simulation AND the client) ─────────────────────────
// RNG / DM are bound per scope: seeded + deterministic inside createSim(), Math.random / Math in the browser's global scope.
const DT = 1 / 60;                 // fixed 60 Hz simulation tick
const RACE_SECONDS = 60;           // hard cap: the final collapse guarantees a result by then
const RACE_TICKS = RACE_SECONDS * 60;
const BEAT = 60 / 144;             // the soundtrack's beat (144 BPM): gates and crushers move on it

// Sphere + lanes (world units)
const SPHERE_R = 0.38;
const LANE_X = 0.8;                // lane centres at ±LANE_X from the rail centre
const SWAP_TICKS = 6;              // a lane change animates over 100 ms…
const SWAP_MID = 3;                // …and collision uses the destination lane from its 50% point (50 ms)
const DEBOUNCE_TICKS = 4;          // taps closer than ~65 ms to the last accepted tap are ignored
const BUFFER_TICKS = 5;            // a tap during a lane change is held ~80 ms and runs when the change ends
const ORB_R = 0.32;

// Forward speed is the game's, never the player's: 20 u/s at the start, +0.25 u/s every second, 35 at the cap.
const speedAt = (t) => Math.min(35, 20 + 0.25 * t);

// One input = one integer per sphere per tick: bit 0 = a tap this tick. Nothing else exists.
const TAP = 1;
const IDLE_INPUT = 0;
function packInput(inp) { return inp && inp.tap ? TAP : 0; }
function unpackInput(p) { return { tap: ((p >>> 0) & TAP) === TAP }; }

const ROSTER = [
  ['Cyan', '#22E6FF', '●'], ['Magenta', '#FF3DCB', '▲'], ['Acid', '#B6FF3B', '■'], ['Solar', '#FF9F1C', '◆'],
];
const BOT_NAMES = ['Vex', 'Nyx', 'Ion', 'Kilo', 'Rune', 'Zed', 'Halo', 'Pulse', 'Echo', 'Flux'];
// Computer players: skill = timing precision + reading of decoys. Kept a notch below a good human.
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
