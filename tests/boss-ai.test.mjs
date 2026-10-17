import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceToDecision,applyPlayerAction,createEncounter,replay,starsForResult} from '../dist/src/engine.js';
import {selectBossTargets} from '../dist/src/boss-ai.js';
import {reference001} from '../dist/src/reference.js';
import {tyrantVariant007} from '../dist/src/variant.js';
import {tyrantAI008} from '../dist/src/ai-variant.js';
const copy=x=>structuredClone(x);
const start=(def=tyrantAI008)=>advanceToDecision(createEncounter(def),def);
const attack=(actorId='brawler',abilityId='attack')=>({actorId,abilityId,targetIds:['blade_tyrant']});

test('v0.8 opts into seeded target slots while v0.6/v0.7 continue targeting lowest Defense',()=>{
  assert.deepEqual(createEncounter(reference001).bossIntent.targetIds,['magus']);
  assert.deepEqual(createEncounter(tyrantVariant007).bossIntent.targetIds,['magus']);
  const candidate=createEncounter(tyrantAI008);
  assert.equal(candidate.bossIntent.abilityId,'heavy_slash');
  assert.deepEqual(candidate.bossIntent.targetIds,['brawler']);
  assert.match(candidate.bossIntent.targetDescription,/Seeded random living slot 2/);
  assert.equal(candidate.bossIntent.origin,'script');
});
test('same seed and timeline yield identical intent and event log through replay and JSON resume',()=>{
  const first=start();
  const action=attack();
  const a=applyPlayerAction(first.state,action,tyrantAI008);
  const b=applyPlayerAction(JSON.parse(JSON.stringify(first.state)),action,tyrantAI008);
  assert.deepEqual(a,b);
  assert.deepEqual(createEncounter(tyrantAI008).bossIntent,createEncounter(tyrantAI008).bossIntent);
  const changed=copy(tyrantAI008);changed.bossAI.seed=1;
  assert.equal(createEncounter(changed).bossIntent.targetIds.length,1);
});
test('random selection excludes KO slots at intent selection and never silently rerolls old locked targets',()=>{
  const s=createEncounter(tyrantAI008);
  s.actors.brawler.hp=0;
  const plan={abilityId:'heavy_slash',origin:'script',target:{kind:'random_slot'}};
  const selection=selectBossTargets(s,tyrantAI008,plan);
  assert.ok(selection.targetIds.length===1&&selection.targetIds[0]!=='brawler');
  const ready=start().state;
  ready.actors.brawler.hp=0; // Force a KO after telegraph. Lock must be honored.
  ready.actors.warden.ready=true;ready.actors.warden.atb=1000;
  const next=applyPlayerAction(ready,attack('warden'),tyrantAI008).state;
  const fizzle=next.events.find(e=>e.abilityId==='heavy_slash'&&e.type==='fizzle');
  assert.ok(fizzle);
  assert.equal(fizzle.targetId,'brawler');
});
test('fixed slots select literal positions, including fourth slot, and decline a KO without rerolling',()=>{
  const def=copy(tyrantAI008);
  def.party.push('guest');def.actors.guest={name:'Guest',stats:{hp:250,mp:0,attack:50,defense:45,magic:20,resistance:20,speed:75}};
  const s=createEncounter(def);
  const target={abilityId:'heavy_slash',origin:'script',target:{kind:'fixed_slot',slot:4}};
  assert.deepEqual(selectBossTargets(s,def,target).targetIds,['guest']);
  s.actors.guest.hp=0;
  assert.deepEqual(selectBossTargets(s,def,target).targetIds,[]);
});
test('sequential targeting advances at commitment, not when displaying/recomputing intent',()=>{
  const s=createEncounter(tyrantAI008);
  const plan={abilityId:'precision_thrust',origin:'script',target:{kind:'sequential_slots',slots:[1,2,3]}};
  assert.deepEqual(selectBossTargets(s,tyrantAI008,plan).targetIds,['warden']);
  assert.deepEqual(selectBossTargets(s,tyrantAI008,plan).targetIds,['warden']);
  s.bossAI.slotCursors.precision_thrust=1;
  assert.deepEqual(selectBossTargets(s,tyrantAI008,plan).targetIds,['brawler']);
  s.actors.brawler.hp=0;
  assert.deepEqual(selectBossTargets(s,tyrantAI008,plan).targetIds,['magus']);
  s.bossAI.slotCursors.precision_thrust=2;
  assert.deepEqual(selectBossTargets(s,tyrantAI008,plan).targetIds,['magus']);
});
test('a big hit in phase two queues a last-attacker counter and updates visible intent',()=>{
  const s=start().state;
  s.phase=2;s.actors.blade_tyrant.hp=690;s.actors.brawler.momentum=1;
  const after=applyPlayerAction(s,attack('brawler','combo_rush'),tyrantAI008).state;
  assert.equal(after.bossIntent.abilityId,'counter_slash');
  assert.deepEqual(after.bossIntent.targetIds,['brawler']);
  assert.equal(after.bossIntent.origin,'counter');
  assert.ok(after.events.some(e=>e.type==='boss_counter_queued'));
  assert.ok(after.events.some(e=>e.type==='boss_intent_changed'));
  assert.equal(after.bossActionCount,0,'reaction must await boss ATB');
  const acted=applyPlayerAction(after,attack('warden'),tyrantAI008).state;
  const counter=acted.events.find(e=>e.type==='action_committed'&&e.abilityId==='counter_slash');
  assert.equal(counter?.tick,12);
  assert.equal(acted.bossActionCount,1);
  assert.equal(acted.phaseTwoCount,0,'reaction must not consume a scripted action');
  assert.equal(acted.bossIntent.abilityId,'boss_haste');
  assert.equal(acted.bossAI.usedRules['retaliate-big-hit'],1);
});
test('status override has priority, removes Protect, costs one boss turn, then resumes script',()=>{
  const s=start().state;
  s.actors.warden.statuses.protect={expiresAt:40};
  const started=applyPlayerAction(s,attack(),tyrantAI008).state;
  assert.equal(started.bossIntent.abilityId,'shatter_guard');
  const after=applyPlayerAction(started,attack('warden'),tyrantAI008).state;
  assert.ok(after.events.some(e=>e.type==='boss_intent_changed'));
  assert.ok(after.events.some(e=>e.type==='status_removed'&&e.details==='protect'&&e.targetId==='warden'));
  assert.equal(after.actors.warden.statuses.protect,undefined);
  assert.equal(after.phaseOneCount,0);
  assert.equal(after.bossAI.usedRules['strip-protect'],1);
  assert.equal(after.bossIntent.abilityId,'heavy_slash');
});
test('status override precedes pending counter and queued counter executes later',()=>{
  const s=start().state;
  s.phase=2;s.actors.blade_tyrant.hp=690;s.actors.warden.statuses.protect={expiresAt:40};s.actors.brawler.momentum=1;
  const started=applyPlayerAction(s,attack('brawler','combo_rush'),tyrantAI008).state;
  assert.equal(started.bossIntent.abilityId,'shatter_guard');
  const after=applyPlayerAction(started,attack('warden'),tyrantAI008).state;
  assert.equal(after.bossActionCount,1);
  assert.equal(after.bossIntent.abilityId,'counter_slash');
  assert.deepEqual(after.bossIntent.targetIds,['brawler']);
  assert.equal(after.bossAI.pendingCounters.length,1);
  assert.equal(after.bossAI.usedRules['strip-protect'],1);
});
test('counter selection remains locked to trigger attacker after another hero damages boss',()=>{
  const s=start().state;s.phase=2;s.actors.blade_tyrant.hp=690;s.actors.brawler.momentum=1;
  // Keep counter pending while Warden acts, then ensure it still targets Brawler.
  const staging=start().state;staging.phase=2;staging.actors.blade_tyrant.hp=690;staging.actors.brawler.momentum=1;
  staging.actors.blade_tyrant.atb=0;
  staging.actors.blade_tyrant.stats.speed=60;
  let step=applyPlayerAction(staging,attack('brawler','combo_rush'),tyrantAI008);
  assert.equal(step.state.bossIntent.abilityId,'counter_slash');
  // Warden is ready next. Damage from Warden does not retarget the queued reaction.
  step=applyPlayerAction(step.state,attack('warden'),tyrantAI008);
  assert.deepEqual(step.state.events.find(e=>e.type==='boss_intent'&&e.abilityId==='counter_slash').details.includes('targets=brawler'),true);
  assert.equal(step.state.bossAI.lastAttackerId,'warden');
  assert.equal(step.state.bossAI.usedRules['retaliate-big-hit'],undefined,'boss counter has not acted yet');
});
test('periodic status expiration cancels an uncommitted conditional override',()=>{
  const def=copy(tyrantAI008);
  // Avoid brawler attack generating counter in this setup.
  let s=start(def).state;s.actors.warden.statuses.protect={expiresAt:9};
  const step=applyPlayerAction(s,attack(),def).state;
  assert.equal(step.actors.warden.statuses.protect,undefined);
  // By tick 10, the conditional override should be gone and original script restored.
  assert.equal(step.bossIntent.abilityId,'heavy_slash');
});
test('counter requires its configured minDamage, oncePerBattle and no hidden instant action',()=>{
  const state=start().state;state.phase=2;state.actors.blade_tyrant.hp=690;
  const started=applyPlayerAction(state,attack(),tyrantAI008).state;
  const after=applyPlayerAction(started,attack('warden'),tyrantAI008).state;
  assert.equal(after.bossActionCount,1);
  assert.equal(after.bossAI.usedRules['retaliate-big-hit'],undefined);
  assert.ok(!after.events.some(e=>e.abilityId==='counter_slash'&&e.type==='action_committed'));
});
test('v0.8 candidate remains a replayable three-star encounter, unchanged approved mastery rule',async()=>{
  const {readFileSync}=await import('node:fs');
  const fixture=JSON.parse(readFileSync(new URL('../fixtures/variant-v08-ai.json',import.meta.url),'utf8'));
  let step=start();
  for(const [i,input] of fixture.playerActions.entries()){
    assert.equal(step.state.tick,fixture.actionTicks[i]);
    step=applyPlayerAction(step.state,input,tyrantAI008);
  }
  assert.equal(step.state.result,'victory');
  assert.equal(starsForResult(step.state),3);
  assert.equal(step.state.heroActionCount,19);
  assert.equal(step.state.tick,65);
  assert.deepEqual(step.state,replay(tyrantAI008,fixture.playerActions).state);
});
