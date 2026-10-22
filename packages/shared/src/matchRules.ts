import type { Address } from 'viem'

/**
 * Match format (Ether Road, Oct 2026): ONE race per match.
 *  - Every player in the locked roster races once on the same seeded track graph.
 *  - The last sphere alive is champion. The race has a hard cap of RACE_SECONDS; the simulation's
 *    published tie-breaks always produce exactly one winner (see game/src/sim/10_race.js).
 * Kept in the "rounds" shape the escrow evidence uses, so the ledger is always exactly one round.
 */
export const WINS_TO_CHAMPION = 1
export const OPEN_ROUNDS = 1
export const MIN_ROUNDS = 1

export function maxRounds(_playerCount: number): number {
  return 1
}

/** Single-race format: there is never a finalists-only round. Kept for API compatibility. */
export function finalistsFor(_roundWinners: readonly Address[]): Address[] | null {
  return null
}

export class RoundLedgerError extends Error {}

/**
 * Validates the round ledger against the locked roster and returns the champion:
 * exactly one race, won by a roster member, roster without duplicates.
 */
export function championFromRounds(roundWinners: readonly Address[], roster: readonly Address[]): Address {
  const members = new Set(roster.map((a) => a.toLowerCase()))
  if (members.size !== roster.length) throw new RoundLedgerError('roster has duplicates')
  if (roundWinners.length !== 1) throw new RoundLedgerError(`expected exactly 1 race, got ${roundWinners.length}`)
  const w = roundWinners[0]
  if (!members.has(w.toLowerCase())) throw new RoundLedgerError(`race winner ${w} not on roster`)
  return w
}

/** Race length: hard cap in seconds (the final collapse guarantees a result by then). */
export const ROUND_SECONDS = 60
export const RACE_SECONDS = ROUND_SECONDS
/** Ready check + countdown + result screen around the race. */
export const TRANSITION_SECONDS = 12

/** Typical and worst-case match length in minutes. */
export function matchLengthMinutes(_playerCount: number): { typical: number; worstCase: number } {
  return { typical: 1, worstCase: Math.ceil((ROUND_SECONDS + TRANSITION_SECONDS) / 60) }
}
