import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {advanceToDecision,applyPlayerAction,createEncounter,starsForResult} from '../dist/src/engine.js';
import {tyrantAI008} from '../dist/src/ai-variant.js';
import {tyrantVariant007} from '../dist/src/variant.js';
import {solveEncounter} from '../dist/src/solver.js';

const def=tyrantAI008;
const fixture=JSON.parse(readFileSync(new URL('../fixtures/variant-v08-ai.json',import.meta.url),'utf8'));
let step=advanceToDecision(createEncounter(def),def);
for(let i=0;i<fixture.playerActions.length;i++){
  if(step.state.tick!==fixture.actionTicks[i])throw new Error(`Bad witness tick ${i}: ${step.state.tick} != ${fixture.actionTicks[i]}`);
  step=applyPlayerAction(step.state,fixture.playerActions[i],def);
}
const s=step.state;
if(s.result!==fixture.expected.result || starsForResult(s)!==fixture.expected.stars || s.tick!==fixture.expected.tick ||
   s.heroActionCount!==fixture.expected.heroActions || s.itemUses!==fixture.expected.items)throw new Error('Candidate golden witness mismatch');

const options={beamWidth:42,maxHeroActions:32,maxExpansions:4000,maxSolutions:8};
const compare=(definition)=>{
  const r=solveEncounter(definition,options);
  const winning=r.solutions.filter(x=>x.stars===3);
  return {encounterId:definition.id,explored:r.explored,expanded:r.expanded,budgetExhausted:r.budgetExhausted,
    threeStarSolutionsFound:winning.length,bestActions:winning.length?Math.min(...winning.map(x=>x.actions.length)):null,
    caveat:'Bounded beam search; witness count and best count are not exhaustive optimality proofs'};
};
const report={schemaVersion:1,algorithm:'seeded-slot-boss-ai-v0.8',seed:def.bossAI.seed,
  witness:{tick:s.tick,stars:starsForResult(s),heroActions:s.heroActionCount,bossActions:s.bossActionCount,
    livingHeroes:s.party.filter(id=>s.actors[id].hp>0),remainingHP:Object.fromEntries(s.party.map(id=>[id,s.actors[id].hp])),
    itemsUsed:s.itemUses,selectedBossIntents:s.events.filter(x=>x.type==='boss_intent').map(x=>({tick:x.tick,abilityId:x.abilityId,details:x.details})),
    countersTriggered:s.events.filter(x=>x.type==='boss_counter_queued').length,
    conditionalOverrides:s.events.filter(x=>x.type==='action_committed'&&x.abilityId==='shatter_guard').length},
  sameBudgetSearch:{originalCandidate:compare(tyrantVariant007),newAI:compare(def)},
  notes:[
    'Reference v0.6 and v0.7 content are unchanged.',
    'Every random target is drawn at intent selection from a versioned integer seed and boss action index; no random damage, hit, or critical rolls.',
    'Counters and status overrides consume a normal boss ATB action, never a free attack.',
    'The optional Protect-reactive dispel is one-shot and may not trigger in every player strategy.',
    'Reflect is not an available initial status. The generic status-present trigger can support Reflect after the status roster is expanded.',
    'Encounter v0.8 remains a playtest candidate pending human difficulty feedback.'
  ]};
mkdirSync('reports',{recursive:true});
writeFileSync('reports/encounter-v08-ai-comparison.json',JSON.stringify(report,null,2)+'\n');
console.log('Verified v0.8 AI witness:',`${s.result}, ${starsForResult(s)} stars, ${s.heroActionCount} actions, tick ${s.tick}`);
console.log('Target intent history:');
for(const e of report.witness.selectedBossIntents)console.log(`  tick ${e.tick}: ${e.abilityId} — ${e.details}`);
console.log('Bounded balance comparison:');
for(const x of Object.values(report.sameBudgetSearch))console.log(`  ${x.encounterId}: best ${x.bestActions ?? 'none found'} hero actions, explored ${x.explored}`);
console.log('Wrote reports/encounter-v08-ai-comparison.json');
