/**
 * Daily Boss Battle: non-authoritative balance diagnostics.
 * Does not mutate the encounter or implement a competing battle resolver.
 * All victory claims are independently replayed by the authoritative engine.
 */
import {replay,starsForResult} from './engine.js';
import {runBaselinePolicy,solveEncounter} from './solver.js';
import type {SearchOptions,PolicyResult,SearchSolution} from './solver.js';
import type {BattleEvent,BattleInput,EncounterDefinition} from './types.js';

export type BalanceOptions=Pick<SearchOptions,'beamWidth'|'maxHeroActions'|'maxExpansions'>;
export type WitnessAudit={
  result:'victory'|'defeat'|null;stars:number;tick:number;heroActions:number;bossActions:number;
  survivors:number;partyHP:number;partyMaxHP:number;remainingMP:Record<string,number>;
  itemUses:number;bossDamage:number;partyDamageReceived:number;partyHealing:number;
  heroDamageByActor:Record<string,number>;actionsByAbility:Record<string,number>;
  phaseChanges:number;statusApplications:number;fizzles:number;
  planTags:string[];
};
export type ProbeReport={
  id:string;description:string;forbiddenAbilities:string[];
  solutionsFound:number;bestStars:number|null;shortestWinningActions:number|null;
  searchedStates:number;expanded:number;beamPruned:boolean;budgetExhausted:boolean;
  depthLimitReached:boolean;truncated:boolean;
  verifiedWitness:WitnessAudit|null;
};
export type BalanceFinding={severity:'info'|'review';code:string;detail:string;evidence:string[]};
export type BalanceReport={
  schemaVersion:1;encounterId:string;engineVersion:string;contentVersion:string;
  searchParameters:Required<BalanceOptions>;
  golden:WitnessAudit;
  probes:ProbeReport[];
  baselinePolicies:PolicyResult[];
  findings:BalanceFinding[];
  interpretation:string[];
};

const TARGET_PROBES:{id:string;description:string;forbiddenAbilities:string[]}[]=[
  {id:'baseline',description:'Unrestricted search',forbiddenAbilities:[]},
  {id:'without_focus',description:'No Magus Focus',forbiddenAbilities:['focus']},
  {id:'without_brawler_specials',description:'No Brawler Combo Rush or Spin Kick',forbiddenAbilities:['combo_rush','spin_kick']},
  {id:'without_cover',description:'No Warden Cover',forbiddenAbilities:['cover']},
  {id:'without_healing',description:'No Cure or restorative items',forbiddenAbilities:['cure','potion','revive_tonic']},
  {id:'without_items',description:'No shared consumable items',forbiddenAbilities:['potion','mana_vial','revive_tonic']},
  {id:'without_special_setup',description:'No Focus or Brawler specials',forbiddenAbilities:['focus','combo_rush','spin_kick']},
];
function countsByAbility(actions:BattleInput[]):Record<string,number>{
  const res:Record<string,number>={};
  for(const a of actions)res[a.abilityId]=(res[a.abilityId]??0)+1;
  return Object.fromEntries(Object.entries(res).sort(([a],[b])=>a.localeCompare(b)));
}
function planTags(actions:BattleInput[]):string[]{
  const ids=new Set(actions.map(a=>a.abilityId));
  const tags:string[]=[];
  if(ids.has('cover'))tags.push('cover');
  if(ids.has('protect')||ids.has('defend'))tags.push('mitigation');
  if(ids.has('cure')||ids.has('potion')||ids.has('revive_tonic'))tags.push('healing');
  if(ids.has('focus'))tags.push('focus');
  if(ids.has('combo_rush')||ids.has('spin_kick'))tags.push('brawler_burst');
  if(ids.has('fire')||ids.has('blizzard')||ids.has('thunder'))tags.push('elemental_magic');
  if(ids.has('potion')||ids.has('mana_vial')||ids.has('revive_tonic'))tags.push('items');
  if(!tags.length)tags.push('basic_actions_only');
  return tags;
}
function sumEvents(events:BattleEvent[],predicate:(e:BattleEvent)=>boolean):number{
  return events.filter(predicate).reduce((n,e)=>n+(e.amount??0),0);
}
/**
 * Replays every input against the real reducer. Metrics never replace combat results.
 * Invalid, incomplete or altered witnesses throw rather than count as victories.
 */
export function auditWitness(def:EncounterDefinition,actions:BattleInput[]):WitnessAudit{
  const result=replay(def,actions).state;
  const events=result.events;
  const heroDamageByActor:Record<string,number>={};
  const remainingMP:Record<string,number>={};
  for(const id of def.party){
    heroDamageByActor[id]=sumEvents(events,e=>e.type==='damage'&&e.actorId===id&&e.targetId===def.bossId);
    remainingMP[id]=result.actors[id]!.mp;
  }
  const bossDamage=sumEvents(events,e=>e.type==='damage'&&e.targetId===def.bossId&&def.party.includes(e.actorId??''));
  const partyDamageReceived=sumEvents(events,e=>e.type==='damage'&&e.actorId===def.bossId&&def.party.includes(e.targetId??''))
    +sumEvents(events,e=>e.type==='poison_pulse'&&def.party.includes(e.actorId??''));
  const partyHealing=sumEvents(events,e=>e.type==='heal'&&def.party.includes(e.targetId??''));
  return {
    result:result.result,stars:starsForResult(result),tick:result.tick,
    heroActions:result.heroActionCount,bossActions:result.bossActionCount,
    survivors:def.party.filter(id=>result.actors[id]!.hp>0).length,
    partyHP:def.party.reduce((n,id)=>n+result.actors[id]!.hp,0),
    partyMaxHP:def.party.reduce((n,id)=>n+result.actors[id]!.stats.hp,0),
    remainingMP,itemUses:result.itemUses,bossDamage,partyDamageReceived,partyHealing,
    heroDamageByActor,actionsByAbility:countsByAbility(actions),
    phaseChanges:events.filter(e=>e.type==='phase_change').length,
    statusApplications:events.filter(e=>e.type==='status_applied').length,
    fizzles:events.filter(e=>e.type==='fizzle').length,planTags:planTags(actions),
  };
}
function verifiedBest(def:EncounterDefinition,solutions:SearchSolution[]):{audit:WitnessAudit|null;stars:number|null;length:number|null}{
  let best:WitnessAudit|null=null;
  let bestLen:number|null=null;
  for(const s of solutions){
    const witness=auditWitness(def,s.actions);
    if(witness.result!=='victory')throw new Error('Solver reported a victory that failed reducer replay');
    if(witness.tick!==s.tick||witness.stars!==s.stars||witness.itemUses!==s.itemUses||witness.heroActions!==s.actions.length){
      throw new Error('Solver and reducer disagree on witness outcome');
    }
    if(!best||witness.stars>best.stars||witness.stars===best.stars&&witness.heroActions<best.heroActions){
      best=witness;bestLen=witness.heroActions;
    }
  }
  return {audit:best,stars:best?.stars??null,length:bestLen};
}
/** Bounded, reproducible counterfactual probes; never labels absent search results impossible. */
export function analyzeEncounter(def:EncounterDefinition,goldenActions:BattleInput[],opts:BalanceOptions={}):BalanceReport{
  const p:Required<BalanceOptions>={beamWidth:opts.beamWidth??48,maxHeroActions:opts.maxHeroActions??24,maxExpansions:opts.maxExpansions??5000};
  const golden=auditWitness(def,goldenActions);
  if(golden.result!=='victory'||golden.stars!==3)throw new Error('Approved reference witness must replay to a three-star victory');
  const probes:ProbeReport[]=TARGET_PROBES.map(probe=>{
    const run=solveEncounter(def,{...p,maxSolutions:8,forbiddenAbilities:probe.forbiddenAbilities});
    const best=verifiedBest(def,run.solutions);
    return {id:probe.id,description:probe.description,forbiddenAbilities:probe.forbiddenAbilities,
      solutionsFound:run.solutions.length,bestStars:best.stars,shortestWinningActions:best.length,
      searchedStates:run.explored,expanded:run.expanded,beamPruned:run.beamPruned,
      budgetExhausted:run.budgetExhausted,depthLimitReached:run.depthLimitReached,
      truncated:run.truncated,verifiedWitness:best.audit};
  });
  const policies:PolicyResult[]=['attack_only','defend_only','greedy_damage'].map(
    name=>runBaselinePolicy(def,name as 'attack_only'|'defend_only'|'greedy_damage',90));
  const get=(id:string):ProbeReport=>probes.find(x=>x.id===id)!;
  const findings:BalanceFinding[]=[];
  const reference=get('baseline');
  if(reference.bestStars===3){
    findings.push({severity:'info',code:'three_star_alternative',detail:'A separate verified three-star sequence was found by bounded search.',evidence:[`Actions: ${reference.shortestWinningActions}`,`Original golden: ${golden.heroActions}`]});
  }
  if(get('without_special_setup').bestStars===3){
    findings.push({severity:'review',code:'signature_abilities_optional',detail:'A three-star winner exists without Magus Focus or Brawler specials; their puzzle value should be reviewed.',evidence:[`Witness actions: ${get('without_special_setup').shortestWinningActions}`]});
  }
  if(get('without_focus').bestStars===3){
    findings.push({severity:'review',code:'focus_optional',detail:'A verified three-star route does not use Focus; this is not evidence that Focus is always weak.',evidence:['Focus forbidden in this probe']});
  }
  if(get('without_brawler_specials').bestStars===3){
    findings.push({severity:'review',code:'brawler_specials_optional',detail:'A verified three-star route does not use Combo Rush or Spin Kick.',evidence:['Both specials forbidden in this probe']});
  }
  if(get('without_healing').bestStars===3){
    findings.push({severity:'review',code:'healing_not_required_for_three_stars',detail:'A three-star route exists without Cure, Potion or Revive Tonic.',evidence:['Healing actions forbidden; other defenses still available']});
  }
  if(get('without_cover').bestStars===null||get('without_cover').bestStars!<3){
    findings.push({severity:'info',code:'cover_promising_counterplay',detail:'The fixed-budget no-Cover search found no three-star witness. This is a bounded-search observation, NOT proof Cover is mandatory.',evidence:[`Best found: ${get('without_cover').bestStars??'none'}`,`Search truncated: ${get('without_cover').truncated}`]});
  }
  const damageIds=['fire','blizzard','thunder'];
  const mage=def.party.find(id=>damageIds.some(spell=>def.abilities[spell]?.owner===id));
  if(mage){
    const magics=damageIds.map(id=>def.abilities[id]).filter((v):v is NonNullable<typeof v>=>Boolean(v));
    if(magics.length===3&&magics.every(m=>m.kind==='magical'&&m.power===magics[0]!.power&&m.mpCost===magics[0]!.mpCost)&&
      !def.affinities?.[def.bossId]?.fire&&!def.affinities?.[def.bossId]?.ice&&!def.affinities?.[def.bossId]?.lightning){
      findings.push({severity:'review',code:'redundant_elemental_choices',detail:'Fire, Blizzard and Thunder currently share power/cost and have no distinct boss affinity; they provide equivalent tactical results in this encounter.',evidence:['Equal power and MP costs','No elemental affinity on boss']});
    }
  }
  return {schemaVersion:1,encounterId:def.id,engineVersion:def.engineVersion,contentVersion:def.contentVersion,
    searchParameters:p,golden,probes,baselinePolicies:policies,findings,
    interpretation:[
      'Search is a bounded beam heuristic. Missing three-star witnesses are NOT proof that a strategy is impossible.',
      'The number of solutions and their action traces are not estimates of player win rates or a proof of strategic diversity.',
      'Heuristic findings are review suggestions. This report makes no unapproved changes to game balance or combat rules.'
    ]};
}
