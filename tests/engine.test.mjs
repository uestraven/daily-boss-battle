import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  advanceToDecision,applyPlayerAction,createEncounter,previewAction,replay,calculateDamage,
  effectiveSpeed,starsForResult,nextBossCountdown
} from '../dist/src/engine.js';
import {reference001} from '../dist/src/reference.js';
const witness=JSON.parse(readFileSync(new URL('../fixtures/witness-v06.json',import.meta.url),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));
function run(n=witness.playerActions.length){
  let step=advanceToDecision(createEncounter(reference001),reference001);
  for(const action of witness.playerActions.slice(0,n)){
    assert.equal(step.state.tick,action.expectedTick,`before ${action.actorId}:${action.abilityId}`);
    assert.ok(step.readyHeroIds.includes(action.actorId));
    step=applyPlayerAction(step.state,action,reference001);
  }
  return step;
}
const actor=(id)=>createEncounter(reference001).actors[id];
const ev=(s,t,type,pred=()=>true)=>s.events.filter(e=>e.tick===t&&e.type===type&&pred(e));

test('golden 19 actions: exact tick 65 victory, HP, MP, inventories, stars',()=>{
  const s=run().state,e=witness.expected;
  assert.equal(s.result,e.result);assert.equal(s.tick,e.terminalTick);
  assert.equal(s.heroActionCount,e.heroActionCount);assert.equal(s.bossActionCount,e.bossCommittedActionCount);
  for(const [id,x] of Object.entries(e.finalHeroes))for(const [k,v] of Object.entries(x))assert.equal(s.actors[id][k],v,`${id}.${k}`);
  assert.equal(s.actors.blade_tyrant.hp,e.boss.hp);assert.equal(s.actors.blade_tyrant.mp,e.boss.mp);
  assert.deepEqual(s.inventory,e.inventory);assert.equal(starsForResult(s),3);assert.equal(s.itemUses,0);
});
test('identical action logs yield byte-identical state and event logs',()=>{
  const actions=witness.playerActions.map(({actorId,abilityId,targetIds})=>({actorId,abilityId,targetIds}));
  assert.equal(JSON.stringify(replay(reference001,actions).state),JSON.stringify(replay(reference001,actions).state));
});
test('save/resume JSON round-trip is identical to uninterrupted replay',()=>{
  const actions=witness.playerActions;
  let step=run(9);
  const saved=JSON.parse(JSON.stringify(step.state));
  for(const action of actions.slice(9))step=applyPlayerAction(step.state,action,reference001);
  let restored=advanceToDecision(saved,reference001);
  for(const action of actions.slice(9))restored=applyPlayerAction(restored.state,action,reference001);
  assert.deepEqual(restored.state,step.state);
});
test('invalid moves are rejected without mutation or time advancement',()=>{
  const initial=run(1).state;
  const before=JSON.stringify(initial);
  assert.throws(()=>applyPlayerAction(initial,{actorId:'warden',abilityId:'spin_kick',targetIds:['blade_tyrant']},reference001),/Ability unavailable/);
  assert.throws(()=>applyPlayerAction(initial,{actorId:'warden',abilityId:'cure',targetIds:['blade_tyrant']},reference001),/Invalid/);
  assert.throws(()=>applyPlayerAction(initial,{actorId:'brawler',abilityId:'attack',targetIds:['blade_tyrant']},reference001),/not ready/);
  assert.equal(JSON.stringify(initial),before);
  const at8=advanceToDecision(createEncounter(reference001),reference001).state;
  assert.throws(()=>applyPlayerAction(at8,{actorId:'brawler',abilityId:'combo_rush',targetIds:['blade_tyrant']},reference001),/Momentum/);
});
test('damage round down once, immunity, weaknesses, Shell/Protect/Defend/Focus',()=>{
  const a=actor('brawler'),b=actor('blade_tyrant');
  const physical=reference001.abilities.attack;
  assert.equal(calculateDamage(reference001,a,b,physical),87);
  b.statuses.protect={expiresAt:24};assert.equal(calculateDamage(reference001,a,b,physical),65);
  b.statuses.defend={expiresAt:-1};assert.equal(calculateDamage(reference001,a,b,physical),32);
  const v=actor('magus'),m=reference001.abilities.fire;
  assert.equal(calculateDamage(reference001,v,actor('blade_tyrant'),m),95);
  v.statuses.focus={expiresAt:24};assert.equal(calculateDamage(reference001,v,actor('blade_tyrant'),m),190);
  const elemDef=clone(reference001);elemDef.affinities={blade_tyrant:{fire:'weak'}};
  assert.equal(calculateDamage(elemDef,v,actor('blade_tyrant'),m),286);
  elemDef.affinities.blade_tyrant.fire='immune';assert.equal(calculateDamage(elemDef,v,actor('blade_tyrant'),m),0);
  const enemy=actor('blade_tyrant');enemy.statuses.shell={expiresAt:24};
  assert.equal(calculateDamage(reference001,v,enemy,m),143);
});
test('tick 24 hero priority; at tick 40 either hero can be chosen first',()=>{
  const s=run(5).state;
  assert.equal(s.tick,24);
  const p=applyPlayerAction(s,witness.playerActions[5],reference001).state;
  const actor24=ev(p,24,'action_committed');
  assert.equal(actor24[0].actorId,'brawler');assert.equal(actor24[1].actorId,'blade_tyrant');
  const step=run(10);assert.equal(step.state.tick,40);assert.deepEqual(step.readyHeroIds,['warden','brawler']);
  const first=applyPlayerAction(step.state,{actorId:'warden',abilityId:'cure',targetIds:['warden']},reference001);
  assert.equal(first.state.tick,40);assert.deepEqual(first.readyHeroIds,['brawler']);
});
test('boss telegraph is preserved at phase change; Protect expires before impact on tick 60',()=>{
  const s=run(9).state;
  assert.equal(s.phase,2);
  assert.equal(ev(s,24,'boss_intent',e=>e.abilityId==='boss_protect').length,1);
  assert.equal(ev(s,36,'action_committed',e=>e.abilityId==='boss_protect').length,1);
  assert.equal(ev(s,32,'phase_change').length,1);
  const ending=run().state;
  const at60=ending.events.filter(e=>e.tick===60);
  const expires=at60.findIndex(e=>e.type==='status_expired'&&e.actorId==='blade_tyrant'&&e.details==='protect');
  const impact=at60.findIndex(e=>e.type==='channel_resolved'&&e.abilityId==='blade_storm');
  const cure=at60.findIndex(e=>e.type==='action_committed'&&e.actorId==='warden');
  assert.ok(expires>=0&&impact>expires&&cure>impact);
  assert.equal(ev(ending,64,'damage',e=>e.actorId==='brawler'&&e.amount===148).length,1);
});
test('boss Haste increases speed; Blade Storm channels four ticks and does not charge during channel',()=>{
  const after48=run(13).state;
  assert.equal(after48.tick,50);assert.equal(effectiveSpeed(after48.actors.blade_tyrant),135);
  const at56=run(16).state;
  assert.equal(at56.tick,60); // Advance stops at Warden ready, after resolving impact.
  const committed=ev(at56,56,'channel_started',e=>e.abilityId==='blade_storm');
  const impact=ev(at56,60,'channel_resolved',e=>e.abilityId==='blade_storm');
  assert.equal(committed.length,1);assert.equal(impact.length,1);
  assert.equal(at56.actors.blade_tyrant.atb,0);
  assert.equal(nextBossCountdown(at56).readyIn,8);
});
test('previews are exact and pure, with clear costs/phase consequences',()=>{
  const s=advanceToDecision(createEncounter(reference001),reference001).state;
  const original=JSON.stringify(s);
  const p=previewAction(s,{actorId:'brawler',abilityId:'attack',targetIds:['blade_tyrant']},reference001);
  assert.equal(p.resolvesAt,8);assert.equal(p.mpCost,0);
  assert.equal(p.events.find(e=>e.type==='damage').amount,87);
  assert.equal(JSON.stringify(s),original);
  const magus=run(2).state;
  assert.equal(magus.tick,13);
  const focus=previewAction(magus,{actorId:'magus',abilityId:'focus',targetIds:['magus']},reference001);
  assert.equal(focus.resolvesAt,13);
});
test('fixed item stock; revival returns 25% max HP and zero ATB',()=>{
  const step=advanceToDecision(createEncounter(reference001),reference001);
  const s=clone(step.state);
  s.actors.warden.hp=0;s.actors.warden.atb=0;
  const next=applyPlayerAction(s,{actorId:'brawler',abilityId:'revive_tonic',targetIds:['warden']},reference001).state;
  assert.equal(next.actors.warden.hp,100);
  assert.equal(ev(next,8,'revived',e=>e.targetId==='warden').length,1);
  assert.equal(next.actors.warden.atb,800); // After eight subsequent ticks of charging at Speed 100.
  assert.equal(next.inventory.revive_tonic,0);assert.equal(next.itemUses,1);
  assert.throws(()=>applyPlayerAction(next,{actorId:'warden',abilityId:'revive_tonic',targetIds:['warden']},reference001));
});
test('poison pulse occurs before expiry on the same tick; silence is deterministic',()=>{
  let s=advanceToDecision(createEncounter(reference001),reference001).state;
  s=clone(s);s.actors.magus.statuses.poison={expiresAt:20,nextPulseAt:20};
  s=applyPlayerAction(s,witness.playerActions[0],reference001).state;
  s.actors.warden.statuses.silence={expiresAt:30};
  assert.throws(()=>applyPlayerAction(s,{actorId:'warden',abilityId:'protect',targetIds:['warden']},reference001),/Silenced/);
  s=applyPlayerAction(s,witness.playerActions[1],reference001).state;
  s=applyPlayerAction(s,witness.playerActions[2],reference001).state;
  s=applyPlayerAction(s,witness.playerActions[3],reference001).state;
  assert.equal(s.tick,20);
  assert.deepEqual(s.events.filter(e=>e.tick===20&&['poison_pulse','status_expired'].includes(e.type)).map(e=>e.type),['poison_pulse','status_expired']);
  assert.equal(s.actors.magus.hp,209);
});
test('boss MP exhaustion announces deterministic fallback intent',()=>{
  const def=clone(reference001);def.actors.blade_tyrant.stats.mp=0;
  let step=advanceToDecision(createEncounter(def),def);
  const scripts=[{actorId:'brawler',abilityId:'attack',targetIds:['blade_tyrant']},{actorId:'warden',abilityId:'cover',targetIds:['magus']},{actorId:'magus',abilityId:'focus',targetIds:['magus']},{actorId:'brawler',abilityId:'attack',targetIds:['blade_tyrant']},{actorId:'warden',abilityId:'attack',targetIds:['blade_tyrant']},{actorId:'brawler',abilityId:'attack',targetIds:['blade_tyrant']}];
  for(const a of scripts)step=applyPlayerAction(step.state,a,def);
  assert.ok(step.state.events.some(e=>e.type==='boss_fallback'));
  assert.equal(step.state.bossIntent.abilityId,'heavy_slash');
});
test('boss group attack does not divide its power',()=>{
  const s=run(6).state; // boss Wind Slash resolved at 24
  const wind=ev(s,24,'damage',e=>e.actorId==='blade_tyrant');
  assert.deepEqual(wind.map(e=>e.amount),[50,70,54]);
});
test('locked KO target fizzles instead of silently retargeting',()=>{
  const s=clone(run(1).state); // Warden ready, boss Heavy Slash locked on Magus
  assert.equal(s.tick,10);
  s.actors.magus.hp=0;s.actors.magus.atb=0;s.actors.magus.ready=false;
  const next=applyPlayerAction(s,{actorId:'warden',abilityId:'attack',targetIds:['blade_tyrant']},reference001).state;
  assert.equal(ev(next,12,'fizzle',e=>e.targetId==='magus').length,1);
  assert.equal(next.actors.warden.hp,400);
});
test('version mismatch rejected; terminal replay cannot take another action',()=>{
  const step=advanceToDecision(createEncounter(reference001),reference001);
  const changed=clone(reference001);changed.engineVersion='9';
  assert.throws(()=>advanceToDecision(step.state,changed),/version mismatch/);
  const finished=run().state;
  assert.throws(()=>applyPlayerAction(finished,witness.playerActions[0],reference001),/ended/);
});
test('Defend halves damage and clears when defender next commits an action',()=>{
  const s=advanceToDecision(createEncounter(reference001),reference001).state;
  const next=applyPlayerAction(s,{actorId:'brawler',abilityId:'defend',targetIds:['brawler']},reference001).state;
  assert.ok(next.actors.brawler.statuses.defend);
  const before=calculateDamage(reference001,next.actors.blade_tyrant,next.actors.brawler,reference001.abilities.blade_storm);
  assert.equal(before,42);
  // Move through one full rotation to Brawler's next action without injecting wall-clock time.
  let step={state:next};
  step=applyPlayerAction(step.state,{actorId:'warden',abilityId:'cover',targetIds:['magus']},reference001);
  step=applyPlayerAction(step.state,{actorId:'magus',abilityId:'focus',targetIds:['magus']},reference001);
  assert.equal(step.state.tick,16);
  step=applyPlayerAction(step.state,{actorId:'brawler',abilityId:'attack',targetIds:['blade_tyrant']},reference001);
  assert.equal(step.state.actors.brawler.statuses.defend,undefined);
});
test('Slow and Haste are mutually exclusive by contract and change integer tick gain',()=>{
  const a=actor('warden');
  assert.equal(effectiveSpeed(a),100);
  a.statuses.haste={expiresAt:24};assert.equal(effectiveSpeed(a),150);
  delete a.statuses.haste;a.statuses.slow={expiresAt:24};assert.equal(effectiveSpeed(a),66);
});
test('insufficient MP and invalid inventory counts never change the input snapshot',()=>{
  const s=clone(run(2).state); // Magus ready tick 13
  s.actors.magus.mp=0;
  const before=JSON.stringify(s);
  assert.throws(()=>applyPlayerAction(s,{actorId:'magus',abilityId:'fire',targetIds:['blade_tyrant']},reference001),/Insufficient MP/);
  assert.equal(JSON.stringify(s),before);
  assert.throws(()=>applyPlayerAction(s,{actorId:'magus',abilityId:'mana_vial',targetIds:['warden']},reference001),/MP already full/);
  assert.equal(JSON.stringify(s),before);
});
