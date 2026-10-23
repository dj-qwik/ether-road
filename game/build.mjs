#!/usr/bin/env node
// Build Ether Road (no dependencies; Node ≥ 22).
//   dist/sim.cjs            deterministic race simulation only (server, co-signers, tests): createSim(env), createFollower()
//   dist/game.js            browser bundle: simulation + 3D renderer + audio + menus (plain script; three.js arrives as window.THREE)
//   dist/etherroad.html     offline page (practice only) that loads ./vendor/three
//   dist-web/index.html     page served by the game server, with online play switched on
//   dist-web/vendor/…       three.js r170 + the post-processing passes it uses (vendored in game/vendor)
// Simulation code (src/sim/*) is wrapped in createSim(): inside it Math.random becomes a seeded RNG and
// Math.sin/cos/atan2/atan/exp/hypot become DET_MATH, so every JS engine computes identical results.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const S = path.join(ROOT, 'src')
const args = process.argv.slice(2)
const outDir = path.join(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist')

const rd = (...p) => fs.readFileSync(path.join(S, ...p), 'utf8')
const detTransform = (js) => js.replaceAll('Math.random()', 'RNG()').replace(/\bMath\.(sin|cos|atan2|atan|exp|hypot)\(/g, 'DM.$1(')

const det = rd('sim', '00_det.js'), base = rd('sim', '01_base.js'), follow = rd('sim', '99_follow.js')
const body = ['01_base.js', '10_race.js'].map((f) => `// ═════ sim/${f} ═════\n` + detTransform(rd('sim', f)))
const EXPORTS = ['ARENAS', 'TRACKS', 'POWERS', 'ITEM_CODE', 'createRound', 'buildCourse', 'packInput', 'unpackInput', 'IDLE_INPUT', 'TAP', 'IN_L', 'IN_R', 'IN_USE',
  'DT', 'RACE_SECONDS', 'RACE_TICKS', 'BEAT', 'SEGS', 'TUBE_R', 'SPHERE_R', 'STEP_TICKS', 'STEP_MID', 'ORB_R', 'speedAt', 'sAtTick', 'sAtT', 'tOfS', 'tickAtS',
  'KIND', 'COLLAPSE_AT', 'ROSTER', 'STRIP', 'TL0', 'moveSphere', 'fxMul', 'firstBlock', 'pushStep', 'stepCtl', 'spikeHit', 'blockedAt', 'segWrap', 'segDist',
  'racerSpeed', 'qSum', 'pilotSurvives', 'nearestFree', 'SLOW_FX', 'EMP_FX', 'WAVE_SPEED', 'EMP_SPEED', 'SHOT_SPEED', 'SHOT_RANGE']
const createSimSrc = `// ═════════════════ createSim(env) — one isolated, deterministic simulation instance ═════════════════
// env = { seed }. Create a fresh instance per race so no state leaks between races.
function createSim(env = {}) {
  const DM = DET_MATH;
  let RNG = makeRng(env.seed == null ? 1 : env.seed);
${body.join('\n')}
  return { ${EXPORTS.join(', ')}, reseed(s) { RNG = makeRng(s); }, random: () => RNG() };
}
`
fs.mkdirSync(outDir, { recursive: true })
const sim = `'use strict';\n${det}\n${createSimSrc}\n${follow}\nif (typeof module === 'object' && module.exports) module.exports = { createSim, createFollower, DET_MATH, makeRng, hashNums, shuffleWith };\n`
fs.writeFileSync(path.join(outDir, 'sim.cjs'), sim)

// ── browser bundle (plain script; waits for three.js, which a tiny module script puts on window.THREE)
const client = fs.readdirSync(S).filter((f) => f.endsWith('.js') && /^\d\d/.test(f)).sort()
const js = ["'use strict';", det,
  '// browser global scope: real randomness + native maths (visuals only); the simulation scope rebinds both',
  'const DM = Math;\nconst RNG = Math.random;',
  "const ONLINE = !!(typeof window !== 'undefined' && window.ER_ONLINE); // set by the server-hosted page",
  '// ═════ sim/01_base.js (global copy) ═════\n' + base, createSimSrc, follow,
  'const SIM0 = createSim({ seed: 1 }); // menus, attract mode, prediction maths',
  ...client.map((f) => `// ═════ ${f} ═════\n` + rd(f)),
].join('\n')
fs.writeFileSync(path.join(outDir, 'game.js'), js)

// three.js loader: an import map + one module that exposes the bits the game uses, then boots the game
const THREE_LOADER = (prefix) => `<script type="importmap">{ "imports": { "three": "${prefix}vendor/three.module.min.js", "three/addons/": "${prefix}vendor/addons/" } }</script>
<script type="module">
import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
window.THREE = Object.assign({}, T, { EffectComposer, RenderPass, UnrealBloomPass, OutputPass });
window.dispatchEvent(new Event('three-ready'));
</script>`
const head = rd('head.html')
const page = (online, prefix) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="theme-color" content="#04030c">
<meta name="description" content="Ether Road: a one-tap neon survival race for 2–4 players. Last sphere alive takes 90% of the pot.">
<title>Ether Road</title>
</head>
<body>
${head}
${online ? '<script>window.ER_ONLINE = true;</script>\n<script type="module" src="/wallet/wallet.js"></script>' : ''}
${THREE_LOADER(prefix)}
<script>
${js}</script>
</body>
</html>
`
fs.writeFileSync(path.join(outDir, 'etherroad.html'), page(false, './'))
const webDir = path.join(ROOT, 'dist-web')
fs.mkdirSync(webDir, { recursive: true })
fs.writeFileSync(path.join(webDir, 'index.html'), page(true, '/'))
// vendored three.js
const V = path.join(ROOT, 'vendor')
for (const dir of [path.join(outDir, 'vendor'), path.join(webDir, 'vendor')]) fs.cpSync(V, dir, { recursive: true })
for (const f of ['sim.cjs', 'game.js']) execFileSync(process.execPath, ['--check', path.join(outDir, f)], { stdio: 'inherit' })
console.log(`built ${path.relative(ROOT, outDir)}: sim.cjs ${(sim.length / 1024) | 0} KB, game.js ${(js.length / 1024) | 0} KB; + dist-web/index.html + vendor; syntax ok`)
