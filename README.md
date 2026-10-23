# Ether Road

A neon survival race for 2–4 players in the browser, somewhere between Tempest and S.T.U.N. Runner. Every racer
rolls a glowing sphere down the inside of their own see-through pipe; the pipes braid round each other in a 3D
void, so you always see where the others are. Slide left and right round the pipe wall to dodge the spikes, grab a
weapon from the pickup caches, and use it. **Last sphere alive wins 90% of the pot**, escrowed in ETH on **Robinhood Chain** (testnet `46630` now, mainnet `4663` later). Wallets via
**Privy** (Google or email sign-in only), multiplayer on **Render**. A race lasts **at most 60 seconds**.

Built on the Hot Shots stack: the same escrow, co-signers, Privy bridge and server-authoritative netcode, with a
new deterministic race simulation and a three.js renderer.

## Running it live (Render)

`render.yaml` is a Render Blueprint (testnet, branch `main`; every push redeploys).

1. Render → **New → Blueprint** → this repo. It creates `ether-road-game` (web service) and `ether-road-db`
   (Postgres). Render generates every secret; nobody ever sees a private key.
2. `OWNER_ADDRESS` is already set to `0x9944…1a1D` in `render.yaml`: it receives the 10% house fee and is the
   escrow's guardian (can pause or veto a result).
3. Open **`/status`** on the deployed site. Send ~0.05 testnet ETH to the server wallet shown there
   ([Robinhood faucet](https://faucet.testnet.chain.robinhood.com/)). The server deploys the escrow, registers its
   two result co-signers, and opens paid races.
4. Privy dashboard (app `cmvjh7ag7002t0gidfxh6eq57`): production app, **Allowed origins** = the Render URL,
   login methods **Google + email** only.

### Switching to mainnet after testing
Set `CHAIN_ID=4663` and add `ALLOW_RAW_KEYS_ON_MAINNET=i-understand` (the "lean launch" Hot Shots runs: the server
deploys the instant-payout escrow, makes `OWNER_ADDRESS` guardian + treasury and starts handing it the admin role;
accept with `acceptDefaultAdminTransfer()` after 2 days). The server wallet has the same address on both chains;
fund it with ~0.005 ETH. After the first boot pin `ESCROW_ADDRESS` + `ESCROW_DEPLOY_BLOCK`, and move Postgres to a
paid plan. With this setup whoever controls the Render account controls results of races in progress; the hardened
path (Safe admin, KMS keys, co-signers on separate infrastructure, an audit) is described in `contracts/README.md`.

## The race

| | |
|---|---|
| Control | Your ball rides the inside wall of a pipe with 16 positions round it. **← / → or A / D** step one position (67 ms per step; hold to keep sliding all the way round). **Space** fires the cannon or uses whatever you are holding. Controller: d-pad, left stick or L1/R1 step, **✕ (PlayStation) / A (Xbox)** uses. Touch: hold the left or right half of the screen, USE button for items. |
| Speed | The game's, never the player's: 20 u/s at the start, +0.25 u/s per second, 35 u/s at the cap. Only strips you choose and items change it. |
| Course | Built from the race seed (two committed random draws). One hazard: **red spikes** on the pipe wall: rings with one opening, twin rings with two, rows of spike clusters to weave through, and long spiral sleeves with a glowing channel that twists round the pipe. Openings tighten and jump further as the race goes on. Every racer gets the same course in their own pipe. A flawless driver must be able to finish every course or it is rebuilt. |
| Pacing | First elimination typically around 30 s; **final collapse** at 48 s narrows the openings to one or two positions. |
| Tracks | Six, dealt from a shuffled deck: **Nebula Run**, **Ion Helix**, **Solar Canyon**, **Prism Cathedral**, **Vector Storm**, **Signal Ghost**. Each has its own pipe shapes, look and mix of spike patterns; the difficulty schedule is the same on all of them. |
| Equal pipes | Every racer's pipe has its own curves, but all pipes are exactly as long as each other over every 96-unit stretch and over the whole race (a pipe that comes out shorter gets gentle waves, at most 3.5 u high, solved to match). The pipes never touch: the closest any two get is 5.9 u between centre lines (pipes are 4.4 u wide). `tools/tracks.mjs` checks both. |
| Pickups | Come in **caches**: 2–3 different items side by side round the pipe, about six caches a race. Roll over the one you want; the rest of that cache vanishes for you, so racers end up carrying different things by choice. What's in each cache and when caches come up are drawn at random from the race seed, and every racer meets the same caches at the same spots. |
| Items | **Cannon** (2 shots: blows away the next spike group on your position, for you) · **Burst** (an energy shell spreads across the map; every ball it reaches is slowed to 60% for 2 s) · **EMP** (a shockwave runs up all four pipes; every ball ahead it reaches is lifted off the track, shaking, for 1.5 s, then drops onto a free position and rolls on) · **Ether boost** (above top speed and invincible for 3 s) · **Shield** (the next hit, spike, burst or EMP, passes through you) · **Magnet** (orbs 3 positions either side for 4 s) · **Double** (orbs count ×2 for 6 s). You hold one item at a time. |
| Speed strips | Two **boost** strips (×1.4 for 2.2 s) and two **slow** strips (×0.65 for 2.2 s) per course, each one position wide, off the safe line and never under spikes, at the same spot on every racer's pipe. Taking one is a choice. |
| Result | Last sphere alive wins at once. Still two or more alive at 60 s, or out on the same tick: furthest along wins, then most gold orbs, then fewest steps, then a draw fixed before the start. |

`node game/tools/accept.mjs` checks all of that with scripted drivers at 150 / 220 / 300 / 400 ms reactions:

```
SOLVABLE flawless driver crashed in 0/200 courses
FAIR seat wins 98/101/99/102 (chi² 0.1)
EXPLOIT idle / hold right / hold left / wiggle / random presses / spam use: 0% wins each
SKILL wins by reaction time 150 ms 74% · 220 ms 24% · 300 ms 2% · 400 ms 1%
PICKUPS 200/200 courses ok · 6.3 caches per course · racers picked different items in 169/200 races
ITEMS cannon, burst, EMP, ether boost all used and landing; ether boost: 30/30 never died while invincible
```

## Practice, test lab, controllers, skins

- **Practice** races computer players (Easy / Normal / Sharp / Flawless) on a fresh road, entirely in the browser.
- **Test lab** (yours): open the site once with `#lab` at the end of the address (e.g. `https://…onrender.com/#lab`);
  a *Test lab* button then stays on that browser's home screen. Pick track, look, seed, start time (0–55 s),
  speed (0.25–4×), racers, computer level, start holding an item, invincible, autopilot. In a lab race: `R` restart
  same course · `N` new course · `T` next track · `J` skip 5 s · `F` speed · `G` invincible · `P` autopilot ·
  `I` give yourself the next item · `Esc` lab.
  It is local only and can't touch online or paid races.
- **Controllers** (Xbox, PlayStation, Switch Pro, most others): d-pad, left stick or L1/R1 step round the pipe,
  ✕ / A fires or uses your item; in menus the d-pad/left stick moves, ✕ / A picks, ○ / B goes back, Start presses
  the main button, Back/Select opens the test lab. Rumble on crashes, hits and pickups where the browser supports it.
- **Sphere skins**: 24 looks, all the same size and handling. Saved per browser and shown to everyone online;
  your racer colour still marks your rail, halo and name tag.

## Keeping your ball in sight

- The camera rides inside your pipe and rolls with your ball, so your ball always sits at the bottom of the screen.
- Your own pipe, its spikes and pickups and your ball are drawn last, on top of everything; nothing from another
  pipe can cover them. The other pipes glow through your pipe's glass so you can see where they are.
- Rivals' spikes and pickups aren't drawn (they can't hurt you); you see their pipes and balls only.
- A rival ball that would appear on screen over the floor of your pipe around your ball isn't drawn, so no other
  ball can ever seem to be in your pipe. It reappears once it has been clear for 0.35 s.
- A ring of your colour sits on the wall under your ball. When you're out, all of this follows the racer you're watching.

## How it is built

```
game/src/sim/        deterministic race simulation (server, every browser, co-signers): course generator, pipe stepping, items, track-coordinate collisions, computer drivers
game/src/*.js        browser client: 00 input + synthesized 144 BPM soundtrack, 20 three.js world, 90 menus + HUD, 95 online play, 96 real-money UI
game/vendor/         three.js r170 (MIT) + bloom passes, served from the game's own origin
game/server/         Node + ws: matchmaking, the authoritative 60 Hz race, sign-in, cash lobbies, /status
contracts/           EtherRoadEscrow (Foundry, 49 tests): stakes, 2-of-n co-signed results, 90/10 payout in one transaction
packages/shared/     chain config, payout math, one-race match rules, EIP-712 types, replay verification
services/settlement/ lobby↔escrow bridge, indexer, co-signer (replays the race before signing), settlement worker
apps/web/            Privy bridge (`/wallet/wallet.js`, `window.ERWallet`)
```

**Netcode.** The server simulates race tick *k* nine ticks (150 ms) after tick *k*'s moment on the shared clock.
Browsers stamp each action (step left, step right, use) with the tick the player was looking at, so with up to
150 ms one-way latency it lands on exactly that tick. Later actions land on the next open tick; nothing can be
applied to a tick that has already been simulated. Browsers replay the server's confirmed stream and draw your own
sphere ahead of it (confirmed state + your unconfirmed steps, re-predicted every frame).

**Money.** Lobbies are on-chain matches: open → deposits → lock → race → evidence + full input replay published →
two co-signers re-run the race simulation from the inputs and sign only if they get the same winner → the escrow
pays the winner in the same transaction that records the result. Unfilled lobbies are refunded after 10 minutes;
players can leave for a full refund until the roster locks.

## Tests

```bash
cd game && node build.mjs
node tools/determinism.mjs 2      # browser bundle vs server: identical on every tick, all themes
node tools/nettest.mjs 1 4 --humans 2   # real server, real WebSockets, latency + jitter, mid-race reconnect
node tools/accept.mjs             # race rules suite (above)
node tools/cash_e2e.mjs           # needs anvil: deploy → deposit → race → replay-verified co-sign → payout
cd ../contracts && forge test
python3 game/tools/shot.py out practice   # screenshots in headless Chromium (Playwright)
```

CI runs all of these (plus the mainnet-settings cash test and a check that the committed escrow bytecode matches
the source) on every push.

## Before real money

- **Legality of paid-entry contests** varies by country and US state; some treat them as gambling. Get a gaming
  lawyer's advice, plus geofencing and age checks, before mainnet. Players confirm 21+ and entertainment-only at
  first sign-in (signed and stored per wallet).
- Get written confirmation from Privy that this non-custodial escrow use fits their acceptable-use policy, and
  confirm Robinhood Chain is available where your players are.
- Turn on 2FA for Render and GitHub.
