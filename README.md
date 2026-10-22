# Ether Road

A one-tap neon survival race for 2–4 players in the browser. Every racer rolls a glowing sphere down their own
two-lane road; the roads braid, cross and merge in a 3D void. One tap switches lanes. **Last sphere alive wins
90% of the pot**, escrowed in ETH on **Robinhood Chain** (testnet `46630` now, mainnet `4663` later). Wallets via
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
| Control | One tap (Space, any arrow, click, touch, controller button) toggles lanes. A lane change animates over 100 ms; collision uses the new lane from its 50% point. Taps within 65 ms are ignored; a tap during a change is held 80 ms. |
| Speed | The game's, never the player's: 20 u/s at the start, +0.25 u/s per second, 35 u/s at the cap. |
| Course | Built from the race seed (two committed random draws): prism spikes, mines, walls, laser shutters, echo blockers, falling pillars, pulse gates and rotating teeth on the 144 BPM beat, crushers, plus decoys that look solid but aren't while you pass. Every racer gets the same road, mirrored for half of them, so every road is exactly as hard. A flawless driver must be able to finish every course or it is rebuilt. |
| Pacing | Hazards one kind at a time for the first 15 s, then mixed; switch windows tighten from 0.65 s to 0.06 s. **Final collapse** at 48 s. |
| Result | Last sphere alive wins at once. Still two or more at 60 s, or everyone out on the same tick: most gold orbs, then fewest taps, then a draw fixed before the start. |

`node game/tools/accept.mjs` checks all of that with scripted drivers at 150 / 220 / 300 / 400 ms reactions:

```
PACING 4 × 220 ms: race length median 46 s · p90 58 s · first out median 29 s · reached the cap 3%
SOLVABLE flawless driver crashed in 0/60 courses
FAIR seat wins 32/30/32/26
EXPLOIT idle / mashing / metronome taps / random taps: 0% wins each
SKILL wins by reaction time 150 ms 56% · 220 ms 28% · 300 ms 13% · 400 ms 3%
```

## How it is built

```
game/src/sim/        deterministic race simulation (server, every browser, co-signers): course generator, lane controller, track-coordinate collisions, computer drivers
game/src/*.js        browser client: 00 input + synthesized 144 BPM soundtrack, 20 three.js world, 90 menus + HUD, 95 online play, 96 real-money UI
game/vendor/         three.js r170 (MIT) + bloom passes, served from the game's own origin
game/server/         Node + ws: matchmaking, the authoritative 60 Hz race, sign-in, cash lobbies, /status
contracts/           EtherRoadEscrow (Foundry, 49 tests): stakes, 2-of-n co-signed results, 90/10 payout in one transaction
packages/shared/     chain config, payout math, one-race match rules, EIP-712 types, replay verification
services/settlement/ lobby↔escrow bridge, indexer, co-signer (replays the race before signing), settlement worker
apps/web/            Privy bridge (`/wallet/wallet.js`, `window.ERWallet`)
```

**Netcode.** The server simulates race tick *k* nine ticks (150 ms) after tick *k*'s moment on the shared clock.
Browsers stamp each tap with the tick the player was looking at, so with up to 150 ms one-way latency a tap lands
on exactly that tick (`nettest` at 120 ± 60 ms: every tap on its stamped tick). Later taps land on the next open
tick; nothing can be applied to a tick that has already been simulated. Browsers replay the server's confirmed
stream and draw your own sphere ahead of it (confirmed state + your unconfirmed taps, re-predicted every frame).

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
