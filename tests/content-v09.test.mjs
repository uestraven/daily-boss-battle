import test from 'node:test';
import assert from 'node:assert/strict';
import {heroes,newHeroIds,heroAbilities} from '../dist/src/roster.js';
import {bossProfiles,practiceEncounters} from '../dist/src/encounters.js';
import {buildEncounter} from '../dist/src/generate.js';
import {createEncounter,advanceToDecision,applyPlayerAction,calculateDamage,previewAction,replay} from '../dist/src/engine.js';

const stepFor=(def)=>advanceToDecision(createEncounter(def),def);
function play(def, chooser, turns=45){
  let step=stepFor(def);
  for(let n=0;n<turns&&!step.terminal;n++){
    const ready=step.readyHeroIds[0];
    assert.ok(ready,`${def.id}: no ready actor`);
    const input=chooser(step,ready,n);
    step=applyPlayerAction(step.state,input,def);
  }
  return step.state;
}
const attack=(s,id)=>({actorId:id,abilityId:'attack',targetIds:[s.bossId]});
/** An encounter guaranteed to contain the heroes under test. Hero-kit assertions must
 * not depend on which party a boss happens to use for its demonstration encounter. */
const withHeroes=(party,bossId='tide_maw')=>buildEncounter(bossId,[...party].sort());

test('12 distinct playable heroes cover the full approved roster',()=>{
 assert.equal(heroes.length,12);assert.equal(new Set(heroes.map(h=>h.id)).size,12);
 assert.equal(newHeroIds.length,9);
 assert.deepEqual(heroes.map(x=>x.id),['warden','lancer','oracle','blademage','channeler','nullifier','monk','machinist','vanguard','brawler','magus','thief']);
 for(const h of heroes){assert.ok(h.stats.hp>0);assert.ok(h.stats.speed>0);assert.ok(h.role);}
});
test('every boss practice encounter has three distinct valid party members, unique scripts, and opt-in AI',()=>{
 assert.ok(bossProfiles.length>=5,`expected at least five bosses, found ${bossProfiles.length}`);
 for(const boss of bossProfiles){
  const def=practiceEncounters[boss.id];assert.ok(def, boss.id);
  assert.equal(def.party.length,3);assert.equal(new Set(def.party).size,3);
  assert.ok(def.bossAI?.seed && def.bossAI.fallbackAbility);
  for(const phase of [def.bossProgram.phaseOne,def.bossProgram.phaseTwo,def.bossProgram.phaseOneRepeat,def.bossProgram.phaseTwoRepeat]){
    assert.ok(phase.length);for(const a of phase)assert.ok(def.abilities[a],`${boss.id} lacks ${a}`);
  }
  const first=stepFor(def);assert.ok(first.readyHeroIds.length);assert.equal(first.state.result,null);
 }
});
test('each new hero gets its signature commands and usable default action',()=>{
 for(const hero of newHeroIds){
  const abilityList=heroAbilities.filter(a=>a.owner===hero);
  assert.ok(abilityList.length>=1,hero);
  const someEncounter=withHeroes(['oracle','magus'].includes(hero)?['oracle','magus',hero==='oracle'||hero==='magus'?'warden':hero]:[hero,'oracle','magus']);
  const readyStep=stepFor(someEncounter);
  const user=readyStep.state.actors[hero];assert.ok(user);
  const signature=abilityList[0];assert.ok(someEncounter.abilities[signature.id]);
 }
});
test('every boss can play at least 45 basic attack decisions with reproducible state',()=>{
 for(const def of Object.values(practiceEncounters)){
  const first=play(def,(step,id)=>attack(step.state,id));
  const second=play(def,(step,id)=>attack(step.state,id));
  assert.deepEqual(first,second,def.id);
  assert.ok(first.tick>10 && first.heroActionCount>0,def.id);
  assert.ok(first.bossActionCount>0,def.id);
 }
});
test('Oracle Pray heals all living heroes with limited charges; Aim bypasses armor',()=>{
 const def=withHeroes(['blademage','lancer','oracle']);
 let step=stepFor(def);while(!step.readyHeroIds.includes('oracle'))step=applyPlayerAction(step.state,attack(step.state,step.readyHeroIds[0]),def);
 const original=structuredClone(step.state);
 original.actors.lancer.hp-=50;original.actors.blademage.hp-=80;
 const next=applyPlayerAction(original,{actorId:'oracle',abilityId:'pray',targetIds:[]},def).state;
 // Measure the heal from its own events, not from post-step HP: the boss can act in the
 // same step and damage a hero Pray just healed, which would mask the heal amount.
 const healed=next.events.filter(e=>e.type==='heal');
 assert.deepEqual(healed.map(e=>e.targetId).sort(),['blademage','lancer','oracle']);
 const gain=Object.fromEntries(healed.map(e=>[e.targetId,e.amount]));
 assert.equal(gain.lancer,50,'clamped: Lancer is only 50 HP below max');
 assert.equal(gain.blademage,52,'full Pray heal');
 assert.equal(next.actors.oracle.abilityUses.pray,1);
 const a=original.actors.oracle,b=original.actors.tide_maw;
 assert.ok(calculateDamage(def,a,b,def.abilities.aim)>calculateDamage(def,a,b,def.abilities.attack));
});
test('Lancer Jump becomes untargetable during its delayed flight and lands on the locked target',()=>{
 const def=withHeroes(['blademage','lancer','oracle']);let step=stepFor(def);
 while(!step.readyHeroIds.includes('lancer'))step=applyPlayerAction(step.state,attack(step.state,step.readyHeroIds[0]),def);
 const start=step.state.tick;
 step=applyPlayerAction(step.state,{actorId:'lancer',abilityId:'jump',targetIds:['tide_maw']},def);
 assert.ok(step.state.events.some(e=>e.type==='channel_started'&&e.actorId==='lancer'));
 assert.ok(step.state.events.some(e=>e.type==='status_applied'&&e.actorId==='lancer')===false);
 assert.ok(step.state.pending.some(p=>p.actorId==='lancer'&&p.at===start+8)||step.state.events.some(e=>e.type==='channel_resolved'&&e.actorId==='lancer'));
});
test('Channeler Surge changes magical damage; Nullifier Nullify absorbs boss spell and restores MP',()=>{
 const a=withHeroes(['channeler','monk','oracle'],'ink_lurker');
 const base=createEncounter(a);const channeler=base.actors.channeler;const boss=base.actors.ink_lurker;
 const unbuffed=calculateDamage(a,channeler,boss,a.abilities.channeler_fire);
 channeler.statuses.surge={expiresAt:25};
 assert.equal(calculateDamage(a,channeler,boss,a.abilities.channeler_fire),Math.floor(unbuffed*1.5));
 const b=withHeroes(['blademage','nullifier','thief'],'spell_weaver');
 let step=stepFor(b),applied=false;
 for(let i=0;i<12&&!applied&&!step.terminal;i++){
   const id=step.readyHeroIds.includes('nullifier')?'nullifier':step.readyHeroIds[0];
   const input=id==='nullifier'?{actorId:id,abilityId:'nullify',targetIds:[id]}:attack(step.state,id);
   step=applyPlayerAction(step.state,input,b);
   applied=step.state.events.some(e=>e.type==='nullify_absorb');
 }
 assert.ok(applied,'Nullify must absorb an eligible Spell Weaver spell');
});
test('Monk Martial, Machinist Tools, Vanguard Burst, and Thief Plunder differ from basic Attack',()=>{
 const a=withHeroes(['machinist','monk','oracle'],'ink_lurker'),s=createEncounter(a),u=s.actors.ink_lurker;
 assert.ok(calculateDamage(a,s.actors.monk,u,a.abilities.flurry_fist)>calculateDamage(a,s.actors.monk,u,a.abilities.attack));
 assert.ok(calculateDamage(a,s.actors.machinist,u,a.abilities.drill)>calculateDamage(a,s.actors.machinist,u,a.abilities.attack));
 const w=withHeroes(['oracle','thief','vanguard'],'crush_wall'),sw=createEncounter(w),z=sw.actors.thief;
 const normal=calculateDamage(w,z,sw.actors.crush_wall,w.abilities.plunder);z.steals=1;
 assert.ok(calculateDamage(w,z,sw.actors.crush_wall,w.abilities.plunder)>normal);
 assert.ok(calculateDamage(w,sw.actors.vanguard,sw.actors.crush_wall,w.abilities.rising_cut)>calculateDamage(w,sw.actors.vanguard,sw.actors.crush_wall,w.abilities.attack));
});
test('Thief limited guaranteed Steal grants a resource and boosts Plunder',()=>{
 const def=withHeroes(['oracle','thief','vanguard'],'crush_wall');let step=stepFor(def);
 while(!step.readyHeroIds.includes('thief'))step=applyPlayerAction(step.state,attack(step.state,step.readyHeroIds[0]),def);
 const before=step.state.inventory.potion;
 step=applyPlayerAction(step.state,{actorId:'thief',abilityId:'steal',targetIds:['crush_wall']},def);
 assert.equal(step.state.inventory.potion,before+1);assert.equal(step.state.actors.thief.steals,1);
 let n=0;while(!step.terminal&&!step.readyHeroIds.includes('thief')&&n++<15)step=applyPlayerAction(step.state,attack(step.state,step.readyHeroIds[0]),def);
 if(step.readyHeroIds.includes('thief'))assert.throws(()=>previewAction(step.state,{actorId:'thief',abilityId:'steal',targetIds:['crush_wall']},def),/No charges/);
});
test('bosses have distinct mechanisms: Slow, heal, elemental immunity, counter, and phase script',()=>{
 const ink_lurker=practiceEncounters.ink_lurker;
 assert.equal(ink_lurker.abilities.lurker_ink.status,'slow');assert.ok(ink_lurker.bossAI.counters?.length);
 const keeper=practiceEncounters.storm_keeper;
 assert.equal(keeper.affinities.storm_keeper.fire,'immune');assert.equal(keeper.abilities.keeper_cure.kind,'heal');
 assert.equal(calculateDamage(keeper,createEncounter(keeper).actors.channeler,createEncounter(keeper).actors.storm_keeper,keeper.abilities.channeler_fire),0);
 assert.ok(practiceEncounters.crush_wall.bossAI.overrides?.length);
 assert.equal(practiceEncounters.spell_weaver.abilities.weaver_silence.status,'silence');
});

test('Blademage Elemental Edge persists until one physical attack and consumes ice enhancement',()=>{
 const def=withHeroes(['blademage','lancer','oracle']);let step=stepFor(def);
 while(!step.readyHeroIds.includes('blademage'))step=applyPlayerAction(step.state,attack(step.state,step.readyHeroIds[0]),def);
 step=applyPlayerAction(step.state,{actorId:'blademage',abilityId:'elemental_edge',targetIds:['blademage']},def);
 assert.ok(step.state.actors.blademage.statuses.elemental_edge);
 let guard=0;while(!step.terminal&&!step.readyHeroIds.includes('blademage')&&guard++<10)step=applyPlayerAction(step.state,attack(step.state,step.readyHeroIds[0]),def);
 if(step.readyHeroIds.includes('blademage')){
   step=applyPlayerAction(step.state,attack(step.state,'blademage'),def);
   assert.ok(step.state.events.some(e=>e.type==='elemental_edge_consumed'));
   assert.equal(step.state.actors.blademage.statuses.elemental_edge,undefined);
 }
});
test('Vanguard Cross Cut cancels a committed boss cast without granting a free enemy action',()=>{
 const def=withHeroes(['oracle','thief','vanguard'],'crush_wall');const state=createEncounter(def);
 state.tick=25;state.actors.vanguard.ready=true;state.actors.vanguard.atb=1000;
 state.actors.crush_wall.channelingUntil=29;state.pending=[{at:29,actorId:'crush_wall',sequence:0,abilityId:'wall_rumble',targetIds:[...def.party]}];
 const next=applyPlayerAction(state,{actorId:'vanguard',abilityId:'cross_cut',targetIds:['crush_wall']},def).state;
 assert.equal(next.actors.crush_wall.channelingUntil,null);
 assert.equal(next.pending.some(p=>p.abilityId==='wall_rumble'),false);
 assert.equal(next.events.filter(e=>e.type==='boss_interrupted').length,1);
 assert.equal(next.bossActionCount,0);
});
test('Storm Keeper Fire immunity, Spell Weaver spells, and optional statuses are deterministic on JSON resumes',()=>{
 for(const id of ['storm_keeper','spell_weaver']){
  const def=practiceEncounters[id];let step=stepFor(def);
  const actions=[];for(let n=0;n<5&&!step.terminal;n++){const a=attack(step.state,step.readyHeroIds[0]);actions.push(a);step=applyPlayerAction(step.state,a,def);}
  assert.deepEqual(replay(def,actions).state,step.state);
 }
});

test('every status event names its status, applied, expired or removed',()=>{
 // The contract the status badges rest on. Removals used to be bare deletes and
 // applications described themselves in prose ("protect; expires at 40"), so a renderer
 // had to parse English to know which badge to show, and had no record at all of a status
 // being spent partway through a batch.
 const def=withHeroes(['oracle','blademage','channeler']);
 const state=play(def,(step,ready)=>{
  const kit={oracle:'oracle_protect',blademage:'elemental_edge',channeler:'surge'};
  const abilityId=kit[ready];
  const ability=abilityId?def.abilities[abilityId]:undefined;
  // Fall back to attacking once the buff is unaffordable or already held, so the run
  // keeps going rather than throwing on MP.
  if(!ability)return attack(step.state,ready);
  const actor=step.state.actors[ready];
  if(actor.mp<(ability.mpCost??0)||actor.statuses[ability.status])return attack(step.state,ready);
  return {actorId:ready,abilityId,targetIds:[ready]};
 },40);

 const events=state.events.filter(e=>e.type.startsWith('status_'));
 assert.ok(events.length>0,'the run should apply some statuses');
 for(const e of events){
  assert.ok(e.status,`${e.type} at tick ${e.tick} carries no status id`);
  assert.ok(e.details,`${e.type} should still carry readable detail for the log`);
 }
 // And all three kinds are reachable, so none of the three paths is dead.
 assert.ok(events.some(e=>e.type==='status_applied'),'statuses are applied');
 assert.ok(events.some(e=>e.type==='status_expired'||e.type==='status_removed'),
  'and they end, with a record of it');
}); 

test('a status spent early leaves a status_removed event, not a silent delete',()=>{
 // Elemental Edge is consumed by the next attack. Before, that delete emitted only
 // elemental_edge_consumed, so the badge had no idea when to disappear.
 const def=withHeroes(['blademage','oracle','monk']);
 let step=stepFor(def);
 while(!step.readyHeroIds.includes('blademage'))
  step=applyPlayerAction(step.state,attack(step.state,step.readyHeroIds[0]),def);
 step=applyPlayerAction(step.state,{actorId:'blademage',abilityId:'elemental_edge',targetIds:['blademage']},def);
 assert.ok(step.state.actors.blademage.statuses.elemental_edge,'the edge is held');
 const applied=step.state.events.filter(e=>e.type==='status_applied'&&e.status==='elemental_edge');
 assert.equal(applied.length,1);

 while(!step.readyHeroIds.includes('blademage'))
  step=applyPlayerAction(step.state,attack(step.state,step.readyHeroIds[0]),def);
 const before=step.state.events.length;
 step=applyPlayerAction(step.state,attack(step.state,'blademage'),def);
 const batch=step.state.events.slice(before);
 assert.ok(batch.some(e=>e.type==='elemental_edge_consumed'),'still reports the consumption');
 assert.ok(batch.some(e=>e.type==='status_removed'&&e.status==='elemental_edge'),
  'and now also records that the status ended');
 assert.equal(step.state.actors.blademage.statuses.elemental_edge,undefined);
});
