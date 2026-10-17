import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reference001} from '../dist/src/reference.js';
import {tyrantVariant007 as candidate} from '../dist/src/variant.js';
import {advanceToDecision,applyPlayerAction,calculateDamage,createEncounter,previewAction,replay,starsForResult} from '../dist/src/engine.js';
import {analyzeEncounter,auditWitness} from '../dist/src/balance.js';

const load=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const approvedWitness=load('../fixtures/witness-v06.json');
const focusWitness=load('../fixtures/variant-v07-focus.json');
const noFocusWitness=load('../fixtures/variant-v07-no_focus.json');
const verifyFixture=(fixture,def)=>{
  assert.equal(fixture.encounterId,def.id);
  let step=advanceToDecision(createEncounter(def),def);
  for(const input of fixture.playerActions){
    assert.equal(step.state.tick,input.expectedTick,`wrong tick before ${input.actorId}:${input.abilityId}`);
    step=applyPlayerAction(step.state,input,def);
  }
  return step.state;
};

test('v0.7 has independent ID and cloned data; approved Reference 001 is untouched',()=>{
  assert.equal(reference001.id,'reference-001');
  assert.equal(reference001.actors.blade_tyrant.stats.hp,1400);
  assert.equal(reference001.actors.blade_tyrant.stats.defense,55);
  assert.equal(reference001.actors.blade_tyrant.stats.resistance,60);
  assert.equal(reference001.actors.magus.stats.mp,54);
  assert.equal(reference001.bossProgram.phaseOne.join(','),'heavy_slash,wind_slash,boss_protect');
  assert.ok(!reference001.affinities?.blade_tyrant?.ice);
  assert.equal(candidate.id,'reference-001-v07');
  assert.equal(candidate.contentVersion,'0.7-candidate');
  assert.notStrictEqual(candidate.abilities,reference001.abilities);
  assert.notStrictEqual(candidate.actors,reference001.actors);
  assert.equal(candidate.actors.blade_tyrant.stats.hp,1400);
  assert.equal(candidate.actors.magus.stats.mp,35);
  assert.equal(candidate.abilities.focus.duration,24);
  assert.equal(candidate.abilities.blade_storm.delayTicks,4);
});

test('elemental affinity produces distinct previews with exact floor rounding',()=>{
  const s=advanceToDecision(createEncounter(candidate),candidate).state;
  const caster=s.actors.magus,boss=s.actors.blade_tyrant;
  assert.equal(calculateDamage(candidate,caster,boss,candidate.abilities.fire),35);
  assert.equal(calculateDamage(candidate,caster,boss,candidate.abilities.blizzard),105);
  assert.equal(calculateDamage(candidate,caster,boss,candidate.abilities.thunder),70);
  assert.equal(calculateDamage(reference001,createEncounter(reference001).actors.magus,createEncounter(reference001).actors.blade_tyrant,reference001.abilities.blizzard),95);
  // At the first Magus decision, the preview must tell the truth without spending MP.
  let w=s;while(!w.actors.magus.ready){const ready=w.party.find(id=>w.actors[id].ready);if(!ready)break;
    const action=ready==='warden'?{actorId:'warden',abilityId:'cover',targetIds:['magus']}:{actorId:'brawler',abilityId:'attack',targetIds:['blade_tyrant']};
    w=applyPlayerAction(w,action,candidate).state;
  }
  assert.equal(w.actors.magus.ready,true);
  for(const [id,expected] of [['fire',35],['blizzard',105],['thunder',70]]){
    const preview=previewAction(w,{actorId:'magus',abilityId:id,targetIds:['blade_tyrant']},candidate);
    assert.equal(preview.events.filter(e=>e.type==='damage'&&e.targetId==='blade_tyrant').reduce((n,e)=>n+e.amount,0),expected);
  }
  assert.equal(w.actors.magus.mp,35);
});

test('early boss Protect is telegraphed and preserves symmetric ATB timing',()=>{
  const s=verifyFixture(focusWitness,candidate);
  const bossAbilities=s.events.filter(e=>e.type==='action_committed'&&e.actorId==='blade_tyrant').map(e=>e.abilityId);
  assert.equal(bossAbilities[0],'heavy_slash');
  assert.equal(bossAbilities[1],'boss_protect');
  assert.equal(bossAbilities[2],'wind_slash');
  assert.equal(s.events.some(e=>e.type==='status_applied'&&e.actorId==='blade_tyrant'&&e.details?.startsWith('protect')),true);
});

test('approved golden reference remains unchanged and three stars',()=>{
  const s=verifyFixture(approvedWitness,reference001);
  assert.equal(s.tick,65);assert.equal(s.heroActionCount,19);assert.equal(starsForResult(s),3);
  assert.deepEqual([s.actors.warden.hp,s.actors.brawler.hp,s.actors.magus.hp],[247,160,116]);
});

test('v0.7 Focus witness is replayable, needs burst and conserves items',()=>{
  const s=verifyFixture(focusWitness,candidate);
  assert.equal(s.result,'victory');assert.equal(starsForResult(s),3);
  assert.equal(s.heroActionCount,21);assert.equal(s.tick,72);assert.equal(s.itemUses,0);
  const audit=auditWitness(candidate,focusWitness.playerActions);
  assert.equal(audit.stars,3);
  assert.ok(audit.actionsByAbility.focus>=1);
  assert.ok((audit.actionsByAbility.combo_rush??0)+(audit.actionsByAbility.spin_kick??0)>=1);
  assert.deepEqual(replay(candidate,focusWitness.playerActions).state,s);
});

test('v0.7 supports a distinct no-Focus three-star witness',()=>{
  const a=verifyFixture(focusWitness,candidate);
  const b=verifyFixture(noFocusWitness,candidate);
  assert.equal(starsForResult(a),3);assert.equal(starsForResult(b),3);
  assert.equal(b.heroActionCount,21);
  const x=auditWitness(candidate,focusWitness.playerActions),y=auditWitness(candidate,noFocusWitness.playerActions);
  assert.equal(x.remainingMP.magus>y.remainingMP.magus,true);
  assert.equal((x.actionsByAbility.focus??0),1);
  assert.equal(y.actionsByAbility.focus??0,0);
  assert.ok((y.actionsByAbility.blizzard??0)>(x.actionsByAbility.blizzard??0));
});

test('comparison uses bounded equal budgets and does not mutate either encounter',()=>{
  const original=JSON.stringify(reference001),variant=JSON.stringify(candidate);
  const p={beamWidth:24,maxExpansions:1400,maxHeroActions:30};
  const a=analyzeEncounter(reference001,approvedWitness.playerActions,p);
  const b=analyzeEncounter(candidate,focusWitness.playerActions,p);
  assert.equal(a.searchParameters.beamWidth,b.searchParameters.beamWidth);
  assert.equal(a.probes.length,7);assert.equal(b.probes.length,7);
  assert.ok(!b.findings.some(f=>f.code==='redundant_elemental_choices'));
  assert.equal(a.golden.stars,3);assert.equal(b.golden.stars,3);
  assert.equal(JSON.stringify(reference001),original);
  assert.equal(JSON.stringify(candidate),variant);
});
