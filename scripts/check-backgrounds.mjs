import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const names=['blade_tyrant','tide_maw','ink_lurker','crush_wall','storm_keeper','spell_weaver'];
const folder=path.join(root,'web','public','battle-backgrounds');
let ok=0;let invalid=0;
console.log('\nBATTLE BACKGROUND ASSET CHECK\n');
for(const name of names){
  const file=path.join(folder,`${name}.png`);
  try {
    const buffer=await readFile(file);
    const png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const width=png?buffer.readUInt32BE(16):0,height=png?buffer.readUInt32BE(20):0;
    const good=png&&width>=160&&height>=90&&width<=8192&&height<=8192;
    console.log(`${good?'OK    ':'INVALID'} ${name.padEnd(17)} ${good?`${width} x ${height} (${(buffer.length/1024).toFixed(1)} KiB)`:'Expected a PNG image'}`);
    good?ok++:invalid++;
  } catch(e){if(e?.code==='ENOENT')console.log(`MISSING ${name.padEnd(17)} Upload via browser, or place ${name}.png here`);else throw e;}
}
console.log(`\n${ok}/${names.length} backgrounds bundled in ${path.relative(root,folder)}`);
console.log('Browser-imported backgrounds are stored separately in IndexedDB and are not counted here.');
if(invalid)process.exitCode=1;
