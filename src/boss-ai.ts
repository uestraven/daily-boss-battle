/** Opt-in, deterministic boss scripting helpers. Legacy encounters don't use these. */
import type {ActorId, BattleState, BossAIConfig, BossCounterRule, BossOverrideRule, BossTargetSelector, EncounterDefinition} from './types.js';

export type BossAIDecision = {
  abilityId:string; origin:'script'|'counter'|'override'; ruleId?:string;
  target:BossTargetSelector; lockedAttacker?:ActorId;
};

function mixSeed(seed:number,key:string):number {
  let h=(2166136261 ^ seed) >>> 0;
  for(let i=0;i<key.length;i++) h=Math.imul(h ^ key.charCodeAt(i),16777619)>>>0;
  h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;
  h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;
  return (h ^ (h>>>16))>>>0;
}
function readyForRule(s:BattleState,rule:{id:string;phase?:1|2;oncePerBattle?:boolean;cooldownBossActions?:number}):boolean {
  if(rule.phase!==undefined && rule.phase!==s.phase)return false;
  const at=s.bossAI?.usedRules[rule.id];
  if(at===undefined)return true;
  if(rule.oncePerBattle)return false;
  return s.bossActionCount-at >= (rule.cooldownBossActions??1);
}
function ruleById(def:EncounterDefinition,id:string):BossCounterRule|undefined {
  return def.bossAI?.counters?.find(x=>x.id===id);
}
export function markLastAttacker(s:BattleState,def:EncounterDefinition,attackerId:ActorId,damage:number):string[] {
  if(!def.bossAI || !s.bossAI || damage<=0 || s.result)return [];
  s.bossAI.lastAttackerId=attackerId;
  const queued:string[]=[];
  for(const rule of def.bossAI.counters??[]) {
    if(rule.when!=='damaged' || !readyForRule(s,rule) || damage<(rule.minDamage??1))continue;
    if(s.bossAI.pendingCounters.some(c=>c.ruleId===rule.id))continue;
    s.bossAI.pendingCounters.push({ruleId:rule.id,attackerId});queued.push(rule.id);
  }
  return queued;
}
export function peekNormalAbility(s:BattleState,def:EncounterDefinition):string {
  const p=def.bossProgram;
  if(s.phase===1){const i=s.phaseOneCount;
    return i<p.phaseOne.length?p.phaseOne[i]!:p.phaseOneRepeat[(i-p.phaseOne.length)%p.phaseOneRepeat.length]!;
  }
  const i=s.phaseTwoCount;
  return i<p.phaseTwo.length?p.phaseTwo[i]!:p.phaseTwoRepeat[(i-p.phaseTwo.length)%p.phaseTwoRepeat.length]!;
}
export function planBossAction(s:BattleState,def:EncounterDefinition):BossAIDecision {
  const config=def.bossAI!;
  for(const rule of config.overrides??[]){
    if(!readyForRule(s,rule))continue;
    const team=rule.when.side==='heroes'?s.party:[s.bossId];
    if(team.some(id=>s.actors[id]!.hp>0 && !!s.actors[id]!.statuses[rule.when.status])) {
      return {abilityId:rule.abilityId,origin:'override',ruleId:rule.id,target:rule.target};
    }
  }
  for(const counter of s.bossAI!.pendingCounters){
    const rule=ruleById(def,counter.ruleId);
    if(rule && readyForRule(s,rule))return {abilityId:rule.abilityId,origin:'counter',ruleId:rule.id,target:rule.target,lockedAttacker:counter.attackerId};
  }
  const abilityId=peekNormalAbility(s,def);
  return {abilityId,origin:'script',target:config.targetRules?.[abilityId]??config.defaultTarget};
}
export function selectBossTargets(s:BattleState,def:EncounterDefinition,plan:BossAIDecision):{targetIds:ActorId[];description:string}{
  const selector=plan.target;
  const alive=s.party.filter(id=>s.actors[id]!.hp>0);
  switch(selector.kind){
    case 'self':return {targetIds:[s.bossId],description:'Self'};
    case 'all_party':return {targetIds:alive,description:'All living party members'};
    case 'status_holder':{
      const id=alive.find(x=>!!s.actors[x]!.statuses[selector.status]);
      return {targetIds:id?[id]:[],description:`Hero with ${selector.status}`};
    }
    case 'last_attacker':{
      const id=plan.lockedAttacker??s.bossAI?.lastAttackerId;
      return {targetIds:id && s.party.includes(id)&&s.actors[id]!.hp>0?[id]:[],description:'Last attacker'};
    }
    case 'fixed_slot':{
      const id=s.party[selector.slot-1];
      return {targetIds:id&&s.actors[id]!.hp>0?[id]:[],description:`Fixed party slot ${selector.slot}`};
    }
    case 'sequential_slots':{
      const slots=selector.slots;
      if(!slots.length)return {targetIds:[],description:'Empty slot sequence'};
      const cursor=s.bossAI?.slotCursors[plan.abilityId]??0;
      for(let i=0;i<slots.length;i++){
        const slot=slots[(cursor+i)%slots.length]!;
        const id=s.party[slot-1];
        if(id&&s.actors[id]!.hp>0)return {targetIds:[id],description:`Sequential slot ${slot} (${slots.join(' → ')})`};
      }
      return {targetIds:[],description:'No available slot in sequence'};
    }
    case 'random_slot':{
      if(!alive.length)return {targetIds:[],description:'Seeded random living slot: none'};
      const key=`${s.bossActionCount}|${s.phase}|${plan.abilityId}|${plan.ruleId??''}`;
      const index=mixSeed(def.bossAI!.seed,key)%alive.length;
      const chosen=alive[index]!;
      return {targetIds:[chosen],description:`Seeded random living slot ${s.party.indexOf(chosen)+1}`};
    }
    case 'lowest_defense':
    case 'lowest_hp':
    case 'highest_attack':
    case 'highest_magic':{
      const stat=selector.kind==='lowest_defense'?'defense':selector.kind==='lowest_hp'?'hp':selector.kind==='highest_magic'?'magic':'attack';
      const ordered=[...alive].sort((a,b)=>{
        const av=stat==='hp'?s.actors[a]!.hp:s.actors[a]!.stats[stat];
        const bv=stat==='hp'?s.actors[b]!.hp:s.actors[b]!.stats[stat];
        return (['highest_attack','highest_magic'].includes(selector.kind)?bv-av:av-bv)||s.party.indexOf(a)-s.party.indexOf(b);
      });
      return {targetIds:ordered.length?[ordered[0]!]:[],description:selector.kind.replaceAll('_',' ')};
    }
  }
}
export function commitBossDecision(s:BattleState,def:EncounterDefinition,plan:BossAIDecision,intentPhase:1|2):void {
  if(!def.bossAI||!s.bossAI)return;
  if(plan.origin==='script'){
    if(intentPhase===1)s.phaseOneCount++;
    else s.phaseTwoCount++;
    if(plan.target.kind==='sequential_slots'){
      s.bossAI.slotCursors[plan.abilityId]=(s.bossAI.slotCursors[plan.abilityId]??0)+1;
    }
    return;
  }
  if(plan.ruleId){
    s.bossAI.usedRules[plan.ruleId]=s.bossActionCount;
    if(plan.origin==='counter')s.bossAI.pendingCounters=s.bossAI.pendingCounters.filter(x=>x.ruleId!==plan.ruleId);
  }
}
export function initBossAI(def:EncounterDefinition):BattleState['bossAI']{
  if(!def.bossAI)return undefined;
  if(!Number.isSafeInteger(def.bossAI.seed))throw new Error('Boss AI seed must be an integer');
  for(const rule of [...def.bossAI.counters??[],...def.bossAI.overrides??[]]){
    if(!def.abilities[rule.abilityId])throw new Error(`Missing Boss AI ability: ${rule.abilityId}`);
  }
  return {lastAttackerId:null,pendingCounters:[],usedRules:{},slotCursors:{}};
}
export function requiresBossIntentRefresh(s:BattleState,def:EncounterDefinition):boolean{
  if(!def.bossAI || !s.bossAI || !s.bossIntent || s.result || s.actors[s.bossId]!.channelingUntil!==null)return false;
  const plan=planBossAction(s,def);
  // Target rolls are sticky even when an unrelated hero action occurs.
  return plan.abilityId!==s.bossIntent.abilityId || plan.origin!==s.bossIntent.origin || plan.ruleId!==s.bossIntent.ruleId;
}
