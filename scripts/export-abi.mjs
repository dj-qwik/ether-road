// Regenerates packages/shared/src/escrowAbi.ts and escrowBytecode.json from the Foundry build output.
//   cd contracts && forge build && cd .. && npm run abi
import { readFileSync, writeFileSync } from 'node:fs'
const out = JSON.parse(readFileSync('contracts/out/EtherRoadEscrow.sol/EtherRoadEscrow.json', 'utf8'))
writeFileSync(
  'packages/shared/src/escrowAbi.ts',
  `// Generated from contracts/out/EtherRoadEscrow.sol/EtherRoadEscrow.json — run \`npm run abi\` after contract changes.\nexport const escrowAbi = ${JSON.stringify(out.abi, null, 1)} as const\n`,
)
writeFileSync(
  'packages/shared/src/escrowBytecode.json',
  JSON.stringify({ contract: 'EtherRoadEscrow', solc: '0.8.28', optimizerRuns: 10000, evmVersion: 'cancun', bytecode: out.bytecode.object }) + '\n',
)
console.log('wrote packages/shared/src/escrowAbi.ts + escrowBytecode.json')
