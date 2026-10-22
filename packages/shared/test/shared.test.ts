import { test } from 'node:test'
import assert from 'node:assert/strict'
import { type Address, type Hex, concat, keccak256 } from 'viem'
import {
  matchLengthMinutes,
  splitPot,
  formatEthExact,
  parseEthExact,
  formatFiatApprox,
  maxRounds,
  championFromRounds,
  finalistsFor,
  WINS_TO_CHAMPION,
  RoundLedgerError,
  buildAllowlist,
  allowlistLeaf,
  rosterHash,
  sortAddresses,
  computeResultHash,
  verifyEvidence,
  EvidenceError,
  type MatchEvidence,
} from '../src/index.ts'

const addr = (i: number) => `0x${(i + 1).toString(16).padStart(40, '0')}` as Address

test('spec §2 example: 8 x 0.01 ETH', () => {
  const s = splitPot(parseEthExact('0.01'), 8)
  assert.equal(formatEthExact(s.pot), '0.08')
  assert.equal(formatEthExact(s.champion), '0.072')
  assert.equal(formatEthExact(s.house), '0.008')
})

test('dust goes to champion, house never exceeds 10%', () => {
  const s = splitPot(7n, 3)
  assert.deepEqual(s, { pot: 21n, champion: 19n, house: 2n })
  for (let n = 2; n <= 16; n++) {
    for (const e of [1n, 3n, 999n, 10n ** 15n + 7n]) {
      const { pot, champion, house } = splitPot(e, n)
      assert.equal(champion + house, pot)
      assert.ok(house * 10n <= pot)
      assert.ok(champion * 10n >= pot * 9n)
    }
  }
})

test('splitPot rejects invalid input', () => {
  assert.throws(() => splitPot(0n, 4))
  assert.throws(() => splitPot(1n, 1))
  assert.throws(() => splitPot(1n, 17))
})

test('exact ETH formatting round-trips', () => {
  for (const s of ['0', '1', '0.000000000000000001', '0.072', '123.456']) {
    assert.equal(formatEthExact(parseEthExact(s)), s)
  }
  assert.throws(() => parseEthExact('0.0000000000000000001'))
  assert.throws(() => parseEthExact('-1'))
  assert.throws(() => parseEthExact('1e18'))
})

test('fiat label is approximate and optional', () => {
  assert.equal(formatFiatApprox(parseEthExact('0.072'), null), null)
  assert.equal(formatFiatApprox(parseEthExact('0.072'), 2500), '≈ $180.00 USD')
})

test('one race per match: the ledger is exactly one race won by a roster member', () => {
  const [a, b, c, d] = [addr(0), addr(1), addr(2), addr(3)]
  const r4 = [a, b, c, d]
  assert.equal(WINS_TO_CHAMPION, 1)
  for (let n = 2; n <= 4; n++) assert.equal(maxRounds(n), 1)
  assert.equal(finalistsFor([a]), null)
  for (const w of r4) assert.equal(championFromRounds([w], r4), w)
  assert.throws(() => championFromRounds([], r4), RoundLedgerError) // no race
  assert.throws(() => championFromRounds([a, a], r4), RoundLedgerError) // extra race
  assert.throws(() => championFromRounds([addr(9)], r4), RoundLedgerError) // non-roster winner
  assert.throws(() => championFromRounds([a], [a, a]), RoundLedgerError) // duplicate roster
})

test('allowlist proofs verify with OZ sorted-pair semantics', () => {
  const members = Array.from({ length: 7 }, (_, i) => addr(i))
  const list = buildAllowlist(members)
  const verify = (leaf: Hex, proof: Hex[]) =>
    proof.reduce((h, p) => (BigInt(h) < BigInt(p) ? keccak256(concat([h, p])) : keccak256(concat([p, h]))), leaf) ===
    list.root
  for (const m of members) assert.ok(verify(allowlistLeaf(m), list.proofFor(m)))
  assert.throws(() => list.proofFor(addr(99)))
  assert.ok(!verify(allowlistLeaf(addr(99)), list.proofFor(members[0])))
})

test('evidence verification', () => {
  const roster = sortAddresses([addr(3), addr(1), addr(2)])
  const seed = (i: number) => `0x${i.toString(16).padStart(64, '0')}` as Hex
  const rounds = [roster[2]].map((winner, i) => ({
    round: i + 1,
    stageId: 10 + i,
    stageRevision: 1,
    seedReveal: seed(i + 100),
    seedCommitment: keccak256(seed(i + 100)),
    winner,
    scoreEvidenceHash: seed(i + 500),
  }))
  const ev: MatchEvidence = {
    chainId: 46630,
    escrow: addr(500),
    matchId: seed(1),
    rosterHash: rosterHash(roster),
    configHash: seed(2),
    rounds,
  }
  assert.equal(verifyEvidence(ev, roster), roster[2])
  const h = computeResultHash(ev)
  assert.match(h, /^0x[0-9a-f]{64}$/)
  assert.notEqual(computeResultHash({ ...ev, rounds: [{ ...rounds[0], stageId: 99 }] }), h)

  const badSeed = { ...ev, rounds: rounds.map((r, i) => (i === 0 ? { ...r, seedReveal: seed(1) } : r)) }
  assert.throws(() => verifyEvidence(badSeed, roster), EvidenceError)
  assert.throws(() => verifyEvidence(ev, [addr(1), addr(2)]), EvidenceError)
})

test('match length disclosure: one race, 60-second hard cap', () => {
  assert.deepEqual(matchLengthMinutes(4), { typical: 1, worstCase: 2 })
  for (let n = 2; n <= 16; n++) assert.ok(matchLengthMinutes(n).worstCase * 60 < 3 * 3600, 'fits on-chain result deadline')
})
