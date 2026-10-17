import {writeFileSync,mkdirSync} from 'node:fs';
import {heroes,newHeroIds} from '../dist/src/roster.js';
import {bossProfiles,practiceEncounters} from '../dist/src/encounters.js';
import {solveEncounter,runBaselinePolicy} from '../dist/src/solver.js';
import {replay,starsForResult} from '../dist/src/engine.js';

const rows=[];
for(const profile of bossProfiles){
 const def=practiceEncounters[profile.id];
 const attackOnly=runBaselinePolicy(def,'attack_only');
 const search=solveEncounter(def,{beamWidth:48,maxHeroActions:32,maxExpansions:1650,maxSolutions:3});
 const best=search.solutions[0];
 if(best){const final=replay(def,best.actions).state;
   if(final.result!=='victory'||starsForResult(final)!==best.stars)throw new Error(`Invalid replay for ${profile.id}`);
 }
 rows.push({id:profile.id,boss:profile.name,party:profile.party,
  attackOnly:attackOnly.result,boundedSearch:{bestFound:best?{stars:best.stars,actions:best.actions.length,heroHP:best.remainingHP,tick:best.tick}:null,expanded:search.expanded,truncated:search.truncated,note:'No result is a proof of impossibility; encounters are practice-only pending curation.'}});
 console.log(`${profile.name.padEnd(20)} [${profile.party.join(', ')}] => ${best?`${best.stars}★ ${best.actions.length} actions`:'no win found in budget'}`);
}
mkdirSync('reports',{recursive:true});
writeFileSync('reports/roster-v09-smoke.json',JSON.stringify({version:'v0.9',heroes:heroes.length,newHeroes:[...newHeroIds],bosses:rows},null,2)+'\n');
console.log('Wrote reports/roster-v09-smoke.json');
