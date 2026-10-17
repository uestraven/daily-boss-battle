import {writeFileSync,mkdirSync} from 'node:fs';
import {reference001} from '../dist/src/reference.js';
import {solveEncounter,runBaselinePolicy} from '../dist/src/solver.js';

const width=Number(process.argv[2]??96);
const budget=Number(process.argv[3]??18000);
const report=solveEncounter(reference001,{beamWidth:width,maxExpansions:budget,maxHeroActions:24,maxSolutions:8});
console.log(`Reference encounter: ${report.encounterId}`);
console.log(`Search: beam=${width}, budget=${budget}, max actions=${report.parameters.maxHeroActions}`);
console.log(`Expanded=${report.expanded}; evaluated=${report.explored}; losses=${report.endedInDefeat}; victories=${report.endedInVictory}; guard failures=${report.guardFailures}`);
console.log(`Unique tactical traces found: ${report.solutions.length}`);
for(const [i,sol] of report.solutions.entries()){
  console.log(`  #${i+1}: ${sol.stars} stars, ${sol.actions.length} actions, tick ${sol.tick}, ${sol.survivors} survivors, ${sol.itemUses} items`);
}
console.log(report.note);
console.log('Policy probes (not player win-rate estimates):');
const policies=['attack_only','defend_only','greedy_damage'].map(policy=>runBaselinePolicy(reference001,policy,90));
for(const policy of policies)console.log(`  ${policy.policy}: ${policy.result}, ${policy.heroActions} actions, ${policy.stars} stars`);
report.policyProbes=policies;
mkdirSync('reports',{recursive:true});
writeFileSync('reports/reference-001-search.json',JSON.stringify(report,null,2)+'\n');
console.log('Full search report: reports/reference-001-search.json');
if(!report.solutions.length)process.exitCode=2;
