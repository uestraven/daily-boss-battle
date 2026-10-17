import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'web/src/sprite-manifest.json'), 'utf8'));
const strict = process.argv.includes('--strict');
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
let found = 0, invalid = 0, total = 0;

for (const [kind, entries] of [['heroes',manifest.heroes], ['bosses',manifest.bosses]]) {
  console.log(`\n${kind.toUpperCase()}`);
  for (const [id, entry] of Object.entries(entries)) {
    total += 1;
    const file = join(root,'web/public/battle-sprites',entry.file);
    if (!existsSync(file)) {
      console.log(`  [ ] ${id.padEnd(17)} ${entry.file}`);
      continue;
    }
    const bytes = readFileSync(file);
    if (bytes.length < 24 || !bytes.subarray(0,8).equals(signature)) {
      invalid += 1;
      console.error(`  [!] ${id.padEnd(17)} Not a valid PNG header: ${entry.file}`);
      continue;
    }
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width === 0 || height === 0 || width > 16384 || height > 16384) {
      invalid += 1;
      console.error(`  [!] ${id.padEnd(17)} Invalid dimensions: ${width}x${height}`);
      continue;
    }
    found += 1;
    console.log(`  [✓] ${id.padEnd(17)} ${width}x${height}`);
  }
}
console.log(`\nBattle sprite assets: ${found}/${total} present; ${invalid} invalid`);
if (invalid || (strict && found !== total)) process.exitCode = 1;
