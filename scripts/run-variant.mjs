/** Candidate v0.7 comparison. This script never overwrites Reference 001. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {reference001} from '../dist/src/reference.js';
import {tyrantVariant007} from '../dist/src/variant.js';
import {analyzeEncounter,auditWitness} from '../dist/src/balance.js';
import {advanceToDecision,applyPlayerAction,createEncounter,starsForResult} from '../dist/src/engine.js';

const readWitness = file => JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
const old = readWitness('../fixtures/witness-v06.json');
const focus = readWitness('../fixtures/variant-v07-focus.json');
const noFocus = readWitness('../fixtures/variant-v07-no_focus.json');
const options={beamWidth:Number(process.argv[2]??48),maxExpansions:Number(process.argv[3]??5000),maxHeroActions:Number(process.argv[4]??32)};

function verifyTicks(def,fixture){
  if(fixture.encounterId!==def.id)throw new Error('Fixture encounter ID mismatch');
  let step=advanceToDecision(createEncounter(def),def);
  for(const [index,input] of fixture.playerActions.entries()){
    if(step.state.tick!==input.expectedTick)throw new Error(`Witness tick mismatch at action ${index+1}: expected ${input.expectedTick}, got ${step.state.tick}`);
    step=applyPlayerAction(step.state,input,def);
  }
  const s=step.state;
  if(s.result!=='victory'||starsForResult(s)!==3)throw new Error(`Witness not a three-star victory: ${def.id}`);
  if(fixture.contentVersion===def.contentVersion&&fixture.expected){for(const [key,value] of Object.entries(fixture.expected)){
    const actual={result:s.result,stars:starsForResult(s),tick:s.tick,heroActions:s.heroActionCount,bossActions:s.bossActionCount,partyHP: s.party.reduce((n,id)=>n+s.actors[id].hp,0),itemUses:s.itemUses}[key];
    if(actual!==value)throw new Error(`Unexpected fixture ${key}: ${actual} !== ${value}`);
  }}
  return s;
}
verifyTicks(reference001,old);
verifyTicks(tyrantVariant007,focus);
verifyTicks(tyrantVariant007,noFocus);

console.log('Reference 001 and variant witnesses verified against authoritative reducer.');
const reference=analyzeEncounter(reference001,old.playerActions,options);
const variant=analyzeEncounter(tyrantVariant007,focus.playerActions,options);
const result={
  schemaVersion:1,createdBy:'scripts/run-variant.mjs',
  options,reference,variant,
  alternative: {focus:auditWitness(tyrantVariant007,focus.playerActions),withoutFocus:auditWitness(tyrantVariant007,noFocus.playerActions)},
  caveats:[
    'New content is a proposal, not a locked revision of approved Reference 001.',
    'All comparisons use the same bounded beam search settings; absent witnesses do not prove impossibility.',
    'Solver deduplicates Fire, Blizzard and Thunder into a generic elemental action signature; solution counts underrepresent elemental alternatives.',
    'The solver does not measure human difficulty or subjective gameplay fun.',
    'Brawler specials benefit the variant strongly; Focus is an MP-saving option but not required for a three-star win.',
    'Only two reference witnesses have been explicitly persisted for variant v0.7; further playtesting is required.',
  ],
};
const probes = (r) => Object.fromEntries(r.probes.map(p=>[p.id, {stars:p.bestStars,actions:p.shortestWinningActions,cutoff:p.truncated}]));
console.log('                 v0.6            v0.7');
const a=probes(reference),b=probes(variant);
for(const id of Object.keys(a)){
  const display=x=>x.stars===null?'no witness':`${x.stars} stars / ${x.actions} actions`;
  console.log(id.padEnd(22),display(a[id]).padEnd(20),display(b[id]));
}
console.log(`Variant Focus witness: ${result.alternative.focus.heroActions} actions, ${result.alternative.focus.tick} ticks, ${result.alternative.focus.remainingMP.magus} MP left`);
console.log(`Variant no-Focus witness: ${result.alternative.withoutFocus.heroActions} actions, ${result.alternative.withoutFocus.tick} ticks, ${result.alternative.withoutFocus.remainingMP.magus} MP left`);
mkdirSync('reports',{recursive:true});
writeFileSync('reports/encounter-v07-comparison.json',JSON.stringify(result,null,2)+'\n');
console.log('Wrote reports/encounter-v07-comparison.json');
