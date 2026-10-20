import type {
  Ability, ActionPreview, ActorId, ActorState, Affinity, BattleEvent,
  BattleInput, BattleState, BattleStep, EncounterDefinition, Element, StatusId,
  TargetRule, ItemId,
} from './types.js';
import {commitBossDecision,initBossAI,markLastAttacker,mixSeed,planBossAction,requiresBossIntentRefresh,selectBossTargets} from './boss-ai.js';
export type { BattleInput, BattleState, BattleStep, EncounterDefinition, ActionPreview } from './types.js';

const copy = <T>(value:T):T => JSON.parse(JSON.stringify(value)) as T;
const ALLOW = 1000;
const fraction = (numerator:number, denominator:number):{n:number;d:number}=>({n:numerator,d:denominator});
function event(state:BattleState, type:string, data:Omit<BattleEvent,'tick'|'type'>={}):void{
  state.events.push({tick:state.tick,type,...data});
}
function active(a:ActorState,status:StatusId):boolean{return a.statuses[status]!==undefined;}
function living(a:ActorState):boolean{return a.hp>0;}
function airborne(s:BattleState,id:ActorId):boolean {return s.actors[id]?.channelingUntil!==null && !!s.actors[id]?.statuses.airborne;}

export function effectiveSpeed(a:ActorState):number{
  if(active(a,'haste')) return Math.floor(a.stats.speed*3/2);
  if(active(a,'slow')) return Math.floor(a.stats.speed*2/3);
  return a.stats.speed;
}
function affinity(def:EncounterDefinition,target:ActorId,element:Element|undefined):Affinity{
  if(!element || element==='neutral')return 'neutral';
  return def.affinities?.[target]?.[element] ?? 'neutral';
}
export function calculateDamage(def:EncounterDefinition,source:ActorState,target:ActorState,ability:Ability,tick?:number):number{
  if(ability.kind!=='physical' && ability.kind!=='magical')throw new Error('Not a damage ability');
  const affinityValue=affinity(def,target.id,ability.element);
  if(affinityValue==='immune')return 0;
  let n=(ability.power??0)*(ability.kind==='physical'?source.stats.attack:source.stats.magic);
  let defense=ability.kind==='physical'?target.stats.defense:target.stats.resistance;
  if(ability.pierceDefensePercent)defense=Math.floor(defense*(100-ability.pierceDefensePercent)/100);
  let d=50+defense;
  if(ability.stealsScalingPower && source.steals) n+=source.steals*ability.stealsScalingPower*source.stats.attack;
  const mult=(x:{n:number;d:number})=>{n*=x.n;d*=x.d;};
  if(affinityValue==='weak')mult(fraction(3,2));
  if(affinityValue==='resist')mult(fraction(1,2));
  if(ability.kind==='physical'&&active(target,'protect'))mult(fraction(3,4));
  if(ability.kind==='magical'&&active(target,'shell'))mult(fraction(3,4));
  if(active(target,'defend'))mult(fraction(1,2));
  if(ability.kind==='magical'&&active(source,'focus'))mult(fraction(2,1));
  if(ability.kind==='magical'&&active(source,'surge'))mult(fraction(3,2));
  const rider=source.statuses.elemental_edge?.element;
  if(ability.kind==='physical'&&rider){
    const riderAffinity=affinity(def,target.id,rider);
    if(riderAffinity==='immune')return 0;
    if(riderAffinity==='weak')mult(fraction(3,2));
    if(riderAffinity==='resist')mult(fraction(1,2));
  }
  // Enrage is a flat outgoing-damage scale on the boss, applied before the single final floor.
  if(source.team==='boss'&&def.enrage&&tick!==undefined){
    const e=def.enrage;
    if(tick>e.fromTick){
      const steps=Math.floor((tick-e.fromTick)/e.stepTicks)+1;
      const percent=Math.min(e.maxPercent,steps*e.percentPerStep);
      if(percent>0)mult(fraction(100+percent,100));
    }
  }
  return (ability.hits??1)*Math.max(1,Math.floor(n/d));
}

function status(state:BattleState,actor:ActorState,name:StatusId,duration:number,element?:Element):void{
  if(name==='haste')clearStatus(state,actor,'slow');
  if(name==='slow')clearStatus(state,actor,'haste');
  actor.statuses[name]={expiresAt:state.tick+duration,...(name==='poison'?{nextPulseAt:state.tick+12}:{}),...(element?{element}:{})};
  event(state,'status_applied',{actorId:actor.id,status:name,details:`${name}; expires at ${state.tick+duration}`});
}
/** Ends a status early, as opposed to letting it expire.
 *
 * Every removal goes through here so each one leaves a `status_removed` event carrying the
 * status id. Removals used to be bare deletes, which meant a consumed or cancelled status
 * vanished with no record on the timeline -- so a renderer had no way to know when during a
 * batch the badge should disappear, and showed it dropping at the wrong moment. */
function clearStatus(state:BattleState,actor:ActorState,name:StatusId):void{
  if(actor.statuses[name]===undefined)return;
  delete actor.statuses[name];
  event(state,'status_removed',{actorId:actor.id,status:name,details:name});
}
function checkTerminal(s:BattleState):void{
  if(s.result!==null)return;
  if(s.actors[s.bossId]!.hp===0){s.result='victory';event(s,'victory');return;}
  if(s.party.every(id=>!living(s.actors[id]!))){s.result='defeat';event(s,'defeat');}
}
function phaseCheck(s:BattleState,def:EncounterDefinition):void{
  if(s.phase===1&&s.actors[s.bossId]!.hp*100<=def.actors[s.bossId]!.stats.hp*def.bossProgram.transitionPercent){
    s.phase=2;event(s,'phase_change',{actorId:s.bossId,details:'Phase 2; previously selected boss intent retained'});
  }
}
/** The ability that can land a critical hit: the basic Attack command, nothing else.
 *
 * Deliberately narrow. Every special ability's damage was tuned and then *verified* --
 * the pool proves each encounter winnable by replaying a witness -- so widening this
 * perturbs numbers that have a proof attached to them. The basic attack is the one action
 * every hero shares and the one a player falls back on, which is where a reward lands
 * best anyway. */
const CRITICAL_ABILITY='attack';
/** The rate and multiplier generated encounters use. Content, not engine policy: the
 * engine reads whatever the definition declares, and declares nothing itself. */
export const CRITICAL_DEFAULT={oneIn:32,multiplier:2} as const;

/** Whether this particular attack crits.
 *
 * Deterministic, which is not a compromise here but the requirement. The ledger proves a
 * result by replaying its action log, and the verified pool proves an encounter winnable
 * by replaying a witness; a `Math.random()` crit would invalidate both on the spot. Keyed
 * the same way seeded boss targeting already is -- a hash of the encounter's own seed and
 * the exact circumstances of the blow -- so it is unpredictable to the player, identical
 * on every replay, and visible to the solver, which is what keeps the winnability proof
 * exact rather than optimistic.
 *
 * The key includes the tick and both actor ids, so two heroes striking on the same tick
 * do not share a verdict and the same hero striking twice does not repeat one. */
/** The seed crits are keyed to, stable across every name an encounter is built under.
 *
 * It has to be `bossAI.seed`, which is `encounterSeed(bossSeed, party)`. The obvious
 * choice -- hashing `def.id` -- would have been a silent trap: the pool builds its
 * witnesses as `gen-<boss>-<party>` and the game plays the same fight as
 * `daily-<date>-<boss>`, so the crit sequence would differ between proving an encounter
 * winnable and playing it, and the proof would not transfer. This value is identical
 * under both names. The fallback covers legacy encounters that predate opt-in boss AI;
 * those are practice-only and never served as a daily. */
function criticalSeed(def:EncounterDefinition):number{
  if(def.bossAI)return def.bossAI.seed;
  return mixSeed(0,`${def.bossId}|${def.party.join(',')}`);
}

function criticalHit(s:BattleState,def:EncounterDefinition,source:ActorState,target:ActorState,ability:Ability):boolean{
  // Absent on an encounter means no criticals at all, which is what keeps the frozen
  // reference corpus and its approved witnesses reproducing exactly.
  if(!def.criticals)return false;
  if(ability.id!==CRITICAL_ABILITY)return false;
  // Heroes only: a crit is a reward. Doubling the boss's output would make encounters the
  // pool has already proven winnable harder, for no gain in how the fight reads.
  if(source.team!=='heroes')return false;
  const key=`crit|${source.id}|${target.id}|${ability.id}|${s.tick}|${s.nextSequence}`;
  return mixSeed(criticalSeed(def),key)%Math.max(1,def.criticals.oneIn)===0;
}

function harm(s:BattleState,def:EncounterDefinition,source:ActorState,target:ActorState,ability:Ability):number{
  if(!living(target))return 0;
  const critical=criticalHit(s,def,source,target,ability);
  // Doubled after the single final floor inside calculateDamage, so a crit is exactly
  // twice what the blow would otherwise have been -- not a second rounding of its own.
  const raw=calculateDamage(def,source,target,ability,s.tick);
  const amount=Math.min(target.hp,critical?raw*(def.criticals?.multiplier??1):raw);
  target.hp-=amount;
  event(s,'damage',{actorId:source.id,targetId:target.id,abilityId:ability.id,amount,hpAfter:target.hp,
    ...(critical?{critical:true}:{})});
  if(target.hp===0){target.ready=false;target.atb=0;target.statuses={};s.covers=s.covers.filter(c=>c.guardianId!==target.id&&c.protectedId!==target.id);event(s,'ko',{actorId:target.id});}
  checkTerminal(s);
  if(!s.result){
    phaseCheck(s,def);
    if(source.team==='heroes'&&target.id===s.bossId && amount>0){
      const queued=markLastAttacker(s,def,source.id,amount);
      for(const ruleId of queued)event(s,'boss_counter_queued',{actorId:s.bossId,targetId:source.id,details:ruleId});
      refreshBossIntent(s,def);
    }
  }
  return amount;
}
function heal(s:BattleState,source:ActorState,target:ActorState,power:number):void{
  const gain=Math.min(target.stats.hp-target.hp,Math.floor(power*source.stats.magic/100));
  target.hp+=gain;event(s,'heal',{actorId:source.id,targetId:target.id,amount:gain,hpAfter:target.hp});
}
function restoreHp(s:BattleState,source:ActorState,target:ActorState,value:number):void{
  const amount=Math.min(value,target.stats.hp-target.hp);target.hp+=amount;
  event(s,'heal',{actorId:source.id,targetId:target.id,amount,hpAfter:target.hp});
}
function resolveDamage(s:BattleState,def:EncounterDefinition,source:ActorState,ability:Ability,targets:ActorId[]):void{
  if(source.team==='boss' && ability.kind==='magical'){
    const nullifyHero=s.party.map(id=>s.actors[id]!).find(x=>living(x)&&active(x,'nullify'));
    if(nullifyHero){clearStatus(s,nullifyHero,'nullify');const gained=Math.min(8,nullifyHero.stats.mp-nullifyHero.mp);nullifyHero.mp+=gained;
      event(s,'nullify_absorb',{actorId:nullifyHero.id,abilityId:ability.id,amount:gained});return;}
  }
  if(!targets.length && ability.target==='single_living_enemy'){
    event(s,'fizzle',{actorId:source.id,abilityId:ability.id,details:'no valid locked target'});
  }
  for(const targetId of targets){
    if(s.result)break;
    let target=s.actors[targetId];
    if(!target || !living(target) || (source.team==='boss' && airborne(s,targetId) && ability.groundOnly!==false)){event(s,'fizzle',{actorId:source.id,abilityId:ability.id,targetId,details:'locked target no longer valid'});continue;}
    if(source.team==='boss'&&ability.kind==='physical'&&ability.target==='single_living_enemy'){
      const c=s.covers.find(x=>x.protectedId===targetId && s.tick<x.expiresAt && living(s.actors[x.guardianId]!));
      if(c){target=s.actors[c.guardianId]!;s.covers=s.covers.filter(x=>x!==c);event(s,'cover_redirect',{actorId:target.id,targetId:targetId,abilityId:ability.id});}
    }
    let damage=0;
    // Volley and other multi-hit moves resolve separately; rounding and KO apply per hit.
    for(let hit=0;hit<(ability.hits??1)&&living(target)&&!s.result;hit++) {
      damage+=harm(s,def,source,target,{...ability,hits:undefined});
    }
    const momentumCap=def.actors[source.id]?.momentumCap??0;
    const momentumGain=ability.momentumGain??0;
    if(momentumGain>0&&momentumCap>0&&damage>0){
      source.momentum=Math.min(momentumCap,source.momentum+momentumGain);
      event(s,'momentum',{actorId:source.id,amount:source.momentum});
    }
  }
  if(ability.kind==='physical' && active(source,'elemental_edge')){
    clearStatus(s,source,'elemental_edge');event(s,'elemental_edge_consumed',{actorId:source.id});
  }
  if(ability.kind==='magical'&&active(source,'focus')){
    clearStatus(s,source,'focus');event(s,'focus_consumed',{actorId:source.id,abilityId:ability.id});
  }
}
function resolveEffect(s:BattleState,def:EncounterDefinition,source:ActorState,ability:Ability,targets:ActorId[]):void{
  if(ability.kind==='physical'||ability.kind==='magical'){
    resolveDamage(s,def,source,ability,targets);return;
  }
  if(ability.kind==='heal'){
    for(const id of targets){const target=s.actors[id]!;
      if(living(target))heal(s,source,target,ability.power??0);
      else event(s,'fizzle',{actorId:source.id,abilityId:ability.id,targetId:id});
    }
  }else if(ability.kind==='status'){
    for(const id of targets){const target=s.actors[id]!;
      if(living(target)){
        if(ability.status==='defend'){
          target.statuses.defend={expiresAt:-1};event(s,'status_applied',{actorId:id,status:'defend',details:'defend until next action'});
        }else status(s,target,ability.status!,ability.duration??24,ability.riderElement);
      }
    }
  }else if(ability.kind==='nullify'){
    status(s,source,'nullify',ability.duration??24);
  }else if(ability.kind==='steal'){
    const item=ability.stealItem??'potion';s.inventory[item]++;source.steals++;
    event(s,'steal_success',{actorId:source.id,targetId:targets[0],amount:source.steals,details:item});
  }else if(ability.kind==='dispel'){
    for(const id of targets){const target=s.actors[id]!;
      if(ability.removeStatus&&target.statuses[ability.removeStatus]){
        delete target.statuses[ability.removeStatus];
        event(s,'status_removed',{actorId:source.id,targetId:id,abilityId:ability.id,details:ability.removeStatus});
      }else event(s,'fizzle',{actorId:source.id,targetId:id,abilityId:ability.id,details:'status not active'});
    }
  }else if(ability.kind==='cover'){
    const protectedId=targets[0]!;
    s.covers=s.covers.filter(c=>c.guardianId!==source.id);
    s.covers.push({guardianId:source.id,protectedId,expiresAt:s.tick+(ability.duration??24)});
    event(s,'cover_set',{actorId:source.id,targetId:protectedId});
  }else if(ability.kind==='focus'){
    status(s,source,'focus',ability.duration??24);
  }else if(ability.kind==='item'){
    const target=s.actors[targets[0]!]!;
    switch(ability.item){
      case 'potion':restoreHp(s,source,target,100);break;
      case 'mana_vial':{const amount=Math.min(15,target.stats.mp-target.mp);target.mp+=amount;
        event(s,'mp_restored',{actorId:source.id,targetId:target.id,amount});break;}
      case 'revive_tonic':{
        target.hp=Math.ceil(target.stats.hp/4);target.atb=0;target.ready=false;target.availableFrom=s.tick+1;target.statuses={};
        event(s,'revived',{actorId:source.id,targetId:target.id,hpAfter:target.hp});break;
      }
    }
  }
}
function targetsFor(s:BattleState,ability:Ability,actorId:ActorId,targetIds:ActorId[]):ActorId[]{
  const source=s.actors[actorId];if(!source)throw new Error('Unknown actor');
  const allied=source.team==='heroes'?s.party:[s.bossId];
  const opposing=source.team==='heroes'?[s.bossId]:s.party;
  let allowed:ActorId[];
  switch(ability.target){
    case 'self': allowed=[actorId];break;
    case 'single_living_ally':allowed=allied.filter(id=>living(s.actors[id]!));break;
    case 'single_other_ally':allowed=allied.filter(id=>id!==actorId&&living(s.actors[id]!));break;
    case 'single_ko_ally':allowed=allied.filter(id=>!living(s.actors[id]!));break;
    case 'all_living_allies':return allied.filter(id=>living(s.actors[id]!));
    case 'single_living_enemy':allowed=opposing.filter(id=>living(s.actors[id]!));break;
    case 'all_living_enemies':return opposing.filter(id=>living(s.actors[id]!));
  }
  if(targetIds.length!==1||!allowed.includes(targetIds[0]!))throw new Error(`Invalid ${ability.target} target`);
  return [targetIds[0]!];
}
function validateHero(s:BattleState,def:EncounterDefinition,input:BattleInput):{actor:ActorState;ability:Ability;targets:ActorId[]}{
  if(s.result)throw new Error('Encounter has ended');
  if(!s.party.includes(input.actorId))throw new Error('Unknown hero');
  const actor=s.actors[input.actorId]!;
  if(!living(actor)||!actor.ready||actor.channelingUntil!==null)throw new Error('Hero is not ready');
  const ability=def.abilities[input.abilityId];
  if(!ability||!(ability.owner==='any_hero'||ability.owner===input.actorId))throw new Error('Ability unavailable to hero');
  if(actor.mp<(ability.mpCost??0))throw new Error('Insufficient MP');
  if(actor.hp<=(ability.hpCost??0))throw new Error('Insufficient HP');
  if(ability.usesPerBattle!==undefined && (actor.abilityUses[ability.id]??0)>=ability.usesPerBattle)throw new Error('No charges remaining');
  if(actor.momentum<(ability.momentumCost??0))throw new Error('Insufficient Momentum');
  if(ability.item && s.inventory[ability.item]<=0)throw new Error('Item unavailable');
  if(active(actor,'silence')&&(ability.kind==='magical'||ability.kind==='heal'||(ability.kind==='status'&&ability.status!=='defend')))throw new Error('Silenced');
  const targets=targetsFor(s,ability,input.actorId,input.targetIds);
  if(ability.item==='mana_vial' && s.actors[targets[0]!]!.mp>=s.actors[targets[0]!]!.stats.mp)throw new Error('MP already full');
  return {actor,ability,targets};
}
function commit(s:BattleState,def:EncounterDefinition,actor:ActorState,ability:Ability,targets:ActorId[],isHero:boolean):void{
  actor.mp-=(ability.mpCost??0);actor.hp-=(ability.hpCost??0);actor.momentum-=(ability.momentumCost??0);
  actor.abilityUses[ability.id]=(actor.abilityUses[ability.id]??0)+1;
  if(ability.item){s.inventory[ability.item]--;s.itemUses++;}
  actor.ready=false;actor.atb=0;actor.availableFrom=s.tick+1;
  clearStatus(s,actor,'defend'); // Defend ends exactly when this actor starts its next action.
  if(isHero)s.heroActionCount++;else s.bossActionCount++;
  event(s,'action_committed',{actorId:actor.id,abilityId:ability.id,details:`targets=${targets.join(',')}`});
  if(ability.interruptCast && actor.team==='heroes'){
    const boss=s.actors[s.bossId]!;
    if(boss.channelingUntil!==null){
      s.pending=s.pending.filter(p=>p.actorId!==boss.id);boss.channelingUntil=null;boss.availableFrom=s.tick+1;
      event(s,'boss_interrupted',{actorId:actor.id,targetId:boss.id,abilityId:ability.id});
      selectBossIntent(s,def);
    }
  }
  if((ability.delayTicks??0)>0){
    const at=s.tick+ability.delayTicks!;
    actor.channelingUntil=at;
    // Deliberately silent, and deliberately not routed through clearStatus below either.
    // `airborne` is an internal marker for "mid-channel, so untargetable"; channel_started
    // already tells the player the lancer is in the air, and content-v09 asserts that Jump
    // applies no player-facing status. It is hidden from the status badges for the same
    // reason.
    if(ability.airborneDuringDelay)actor.statuses.airborne={expiresAt:at};
    s.pending.push({at,sequence:s.nextSequence++,actorId:actor.id,abilityId:ability.id,targetIds:targets});
    event(s,'channel_started',{actorId:actor.id,abilityId:ability.id,details:`impact tick ${at}`});
  }else resolveEffect(s,def,actor,ability,targets);
  if(isHero)refreshBossIntent(s,def);
}
function bossNextAbility(s:BattleState,def:EncounterDefinition):string{
  const p=def.bossProgram;
  if(s.phase===1){const i=s.phaseOneCount++;
    return i<p.phaseOne.length?p.phaseOne[i]!:p.phaseOneRepeat[(i-p.phaseOne.length)%p.phaseOneRepeat.length]!;
  }
  const i=s.phaseTwoCount++;
  return i<p.phaseTwo.length?p.phaseTwo[i]!:p.phaseTwoRepeat[(i-p.phaseTwo.length)%p.phaseTwoRepeat.length]!;
}
function selectBossIntent(s:BattleState,def:EncounterDefinition):void{
  if(s.result)return;
  const boss=s.actors[s.bossId]!;
  if(def.bossAI){
    const plan=planBossAction(s,def);
    let abilityId=plan.abilityId;
    if(boss.mp<(def.abilities[abilityId]?.mpCost??0)){
      abilityId=def.bossAI.fallbackAbility??def.bossProgram.fallbackAbility??'';
      if(!abilityId)throw new Error('Boss cannot afford its planned ability and no fallbackAbility is configured');
      event(s,'boss_fallback',{actorId:boss.id,details:'Insufficient MP for planned ability'});
    }
    const ability=def.abilities[abilityId];
    if(!ability)throw new Error(`Missing boss ability: ${abilityId}`);
    const actual={...plan,abilityId,target:abilityId===plan.abilityId?plan.target:def.bossAI.defaultTarget};
    const resolved=ability.target==='self'?{targetIds:[s.bossId],description:'Self'}
      :ability.target==='all_living_enemies'?{targetIds:s.party.filter(id=>living(s.actors[id]!)),description:'All living party members'}
      :selectBossTargets(s,def,actual);
    s.bossIntent={abilityId,targetIds:resolved.targetIds,selectedAt:s.tick,phase:s.phase,
      origin:plan.origin,ruleId:plan.ruleId,selector:actual.target,targetDescription:resolved.description};
    event(s,'boss_intent',{actorId:boss.id,abilityId,
      details:`targets=${resolved.targetIds.join(',')}; ${resolved.description}; source=${plan.origin}${plan.ruleId?'; '+plan.ruleId:''}`});
    return;
  }
  let abilityId=bossNextAbility(s,def);
  let ability=def.abilities[abilityId]!;
  if(boss.mp<(ability.mpCost??0)){
    const fallback=def.bossProgram.fallbackAbility;
    if(!fallback)throw new Error('Boss cannot afford its planned ability and no fallbackAbility is configured');
    abilityId=fallback;ability=def.abilities[abilityId]!;
    event(s,'boss_fallback',{actorId:boss.id,details:'Insufficient MP for planned ability'});
  }
  let targetIds:ActorId[];
  if(ability.target==='single_living_enemy'){
    const candidates=s.party.filter(id=>living(s.actors[id]!));
    candidates.sort((a,b)=>s.actors[a]!.stats.defense-s.actors[b]!.stats.defense||s.party.indexOf(a)-s.party.indexOf(b));
    targetIds=candidates.length?[candidates[0]!]:[];
  }else targetIds=targetsFor(s,ability,boss.id,[boss.id]);
  s.bossIntent={abilityId,targetIds,selectedAt:s.tick,phase:s.phase};
  event(s,'boss_intent',{actorId:boss.id,abilityId,details:`targets=${targetIds.join(',')}; phase=${s.phase}`});
}
function refreshBossIntent(s:BattleState,def:EncounterDefinition):void{
  if(!requiresBossIntentRefresh(s,def))return;
  const prior=s.bossIntent;
  selectBossIntent(s,def);
  event(s,'boss_intent_changed',{actorId:s.bossId,abilityId:s.bossIntent?.abilityId,
    details:`${prior?.abilityId??'none'} → ${s.bossIntent?.abilityId??'none'}; triggered reaction or status change`});
}
function bossAct(s:BattleState,def:EncounterDefinition):void{
  const boss=s.actors[s.bossId]!;const intent=s.bossIntent!;
  if(!living(boss)||s.result)return;
  const ability=def.abilities[intent.abilityId]!;
  // Telegraphed targets remain locked even if a target becomes unavailable before resolution.
  commit(s,def,boss,ability,intent.targetIds,false);
  if(def.bossAI && intent.selector){
    commitBossDecision(s,def,{abilityId:intent.abilityId,origin:intent.origin??'script',ruleId:intent.ruleId,
      target:intent.selector},intent.phase);
  }
  if(boss.channelingUntil===null&&!s.result)selectBossIntent(s,def);
}
function tickOnce(s:BattleState,def:EncounterDefinition):void{
  s.tick++;
  // Periodic effects precede expiry. Poison uses 5% max HP, capped at 30, every 12 ticks.
  for(const id of [...s.party,s.bossId]){
    const a=s.actors[id]!;const poison=a.statuses.poison;
    if(living(a)&&poison&&poison.nextPulseAt!==undefined&&poison.nextPulseAt<=s.tick){
      const amount=Math.min(a.hp,Math.min(30,Math.max(1,Math.floor(a.stats.hp/20))));a.hp-=amount;
      event(s,'poison_pulse',{actorId:id,amount,hpAfter:a.hp});poison.nextPulseAt+=12;
      if(a.hp===0){a.ready=false;a.atb=0;a.statuses={};event(s,'ko',{actorId:id});}
      checkTerminal(s);if(s.result)return;
    }
  }
  for(const id of [...s.party,s.bossId]){
    const a=s.actors[id]!;
    for(const [key,value] of Object.entries(a.statuses)){
      if(value.expiresAt>=0&&value.expiresAt<=s.tick){delete a.statuses[key as StatusId];event(s,'status_expired',{actorId:id,status:key as StatusId,details:key});}
    }
  }
  s.covers=s.covers.filter(c=>c.expiresAt>s.tick&&living(s.actors[c.guardianId]!));
  refreshBossIntent(s,def); // An expiring conditional status may restore the announced script.
  // Previously committed effects, sorted by tick/sequence, occur before new readiness.
  const due=s.pending.filter(p=>p.at<=s.tick).sort((a,b)=>a.at-b.at||(a.actorId<b.actorId?-1:a.actorId>b.actorId?1:0)||a.sequence-b.sequence);
  s.pending=s.pending.filter(p=>p.at>s.tick);
  for(const pending of due){
    if(s.result)break;
    const source=s.actors[pending.actorId]!;source.channelingUntil=null;delete source.statuses.airborne;source.availableFrom=s.tick+1;
    event(s,'channel_resolved',{actorId:source.id,abilityId:pending.abilityId});
    if(living(source))resolveEffect(s,def,source,def.abilities[pending.abilityId]!,pending.targetIds);
    if(source.team==='boss'&&!s.result)selectBossIntent(s,def);
  }
  if(s.result)return;
  for(const id of [...s.party,s.bossId]){
    const a=s.actors[id]!;
    if(!living(a)||a.channelingUntil!==null||a.ready||a.availableFrom>s.tick)continue;
    a.atb=Math.min(ALLOW,a.atb+effectiveSpeed(a));
    if(a.atb>=ALLOW){a.ready=true;event(s,'ready',{actorId:id});}
  }
}
function toStep(state:BattleState,from:number):BattleStep{
  const readyHeroIds=state.party.filter(id=>state.actors[id]!.ready&&living(state.actors[id]!));
  return {state,events:state.events.slice(from),needsPlayerInput:!state.result&&readyHeroIds.length>0,readyHeroIds,terminal:state.result};
}
function drive(s:BattleState,def:EncounterDefinition,from:number):BattleStep{
  for(let guard=0;guard<def.maxTicks+1000;guard++){
    if(s.result)return toStep(s,from);
    if(s.party.some(id=>s.actors[id]!.ready&&living(s.actors[id]!)))return toStep(s,from);
    if(s.actors[s.bossId]!.ready){bossAct(s,def);continue;}
    if(s.tick>=def.maxTicks)throw new Error(`Encounter exceeded ${def.maxTicks} ticks; possible softlock`);
    tickOnce(s,def);
  }
  throw new Error('Simulation progress guard exceeded');
}
export function createEncounter(def:EncounterDefinition):BattleState{
  const actors:Record<string,ActorState>={};
  for(const [id,a] of Object.entries(def.actors))actors[id]={id,team:id===def.bossId?'boss':'heroes',stats:copy(a.stats),hp:a.stats.hp,mp:a.stats.mp,atb:0,ready:false,availableFrom:1,channelingUntil:null,momentum:0,steals:0,abilityUses:{},statuses:{}};
  const s:BattleState={encounterId:def.id,engineVersion:def.engineVersion,contentVersion:def.contentVersion,tick:0,actors,
    party:[...def.party],bossId:def.bossId,inventory:copy(def.inventory),covers:[],phase:1,phaseOneCount:0,phaseTwoCount:0,bossIntent:null,pending:[],nextSequence:0,bossAI:initBossAI(def),result:null,heroActionCount:0,bossActionCount:0,events:[],itemUses:0};
  selectBossIntent(s,def);
  return s;
}
export function advanceToDecision(state:BattleState,def:EncounterDefinition):BattleStep{
  if(state.encounterId!==def.id||state.engineVersion!==def.engineVersion||state.contentVersion!==def.contentVersion)throw new Error('Encounter version mismatch');
  const from=state.events.length;return drive(copy(state),def,from);
}
export function applyPlayerAction(state:BattleState,input:BattleInput,def:EncounterDefinition):BattleStep{
  if(state.encounterId!==def.id||state.engineVersion!==def.engineVersion||state.contentVersion!==def.contentVersion)throw new Error('Encounter version mismatch');
  const next=copy(state);
  const {actor,ability,targets}=validateHero(next,def,input);
  const from=state.events.length;
  commit(next,def,actor,ability,targets,true);
  return drive(next,def,from);
}
export function previewAction(state:BattleState,input:BattleInput,def:EncounterDefinition):ActionPreview{
  const next=copy(state);
  const {actor,ability,targets}=validateHero(next,def,input);
  const from=next.events.length;const oldPhase=next.phase;
  commit(next,def,actor,ability,targets,true);
  return {actorId:input.actorId,abilityId:input.abilityId,tick:state.tick,resolvesAt:state.tick+(ability.delayTicks??0),
    events:next.events.slice(from),mpCost:ability.mpCost??0,momentumCost:ability.momentumCost??0,itemCost:ability.item??null,
    causesPhaseChange:next.phase!==oldPhase,possibleConditionalOutcome:(ability.delayTicks??0)>0};
}
export function replay(def:EncounterDefinition,inputs:BattleInput[]):BattleStep{
  let step=advanceToDecision(createEncounter(def),def);
  for(const input of inputs){
    if(!step.needsPlayerInput)throw new Error('Replay attempted action when no hero ready');
    step=applyPlayerAction(step.state,input,def);
  }
  return step;
}
export function starsForResult(state:BattleState):number{
  if(state.result!=='victory')return 0;
  const survivors=state.party.filter(id=>living(state.actors[id]!)).length;
  return 1+(survivors>=2?1:0)+(survivors===3&&state.itemUses===0?1:0);
}
export function nextBossCountdown(s:BattleState):{abilityId:string;readyIn:number;impactIn?:number}|null{
  if(!s.bossIntent||s.result)return null;
  const b=s.actors[s.bossId]!;
  if(b.channelingUntil!==null)return {abilityId:s.bossIntent.abilityId,readyIn:0,impactIn:b.channelingUntil-s.tick};
  if(b.ready)return {abilityId:s.bossIntent.abilityId,readyIn:0};
  return {abilityId:s.bossIntent.abilityId,readyIn:Math.ceil((1000-b.atb)/effectiveSpeed(b))};
}
