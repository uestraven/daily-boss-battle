import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {advanceToDecision,createEncounter,previewAction,replay,starsForResult} from '../dist/src/engine.js';
import {reference001} from '../dist/src/reference.js';
import {tyrantVariant007} from '../dist/src/variant.js';
import {abilityGroup,actionInput,availableActions,eligibleTargets,previewDisplay} from '../dist/src/play-ui.js';

const start = def=>advanceToDecision(createEncounter(def),def);

test('web action palette exposes only playable owned abilities',()=>{
  const step=start(reference001);
  assert.equal(step.state.tick,8);
  assert.deepEqual(step.readyHeroIds,['brawler']);
  const actions=availableActions(step.state,reference001,'brawler');
  assert.equal(actions.find(a=>a.ability.id==='attack')?.enabled,true);
  assert.equal(actions.find(a=>a.ability.id==='combo_rush')?.enabled,false);
  assert.equal(actions.find(a=>a.ability.id==='spin_kick')?.enabled,false);
  assert.equal(actions.some(a=>a.ability.id==='cover'),false);
  assert.equal(actions.find(a=>a.ability.id==='potion')?.enabled,true);
});
test('target picker respects KO eligibility, self, and all-target effect conventions',()=>{
  const step=start(reference001);
  const state=step.state;
  assert.deepEqual(eligibleTargets(state,'brawler',reference001.abilities.attack),['blade_tyrant']);
  assert.deepEqual(eligibleTargets(state,'brawler',reference001.abilities.defend),['brawler']);
  assert.deepEqual(actionInput(state,'brawler',reference001.abilities.defend).targetIds,['brawler']);
  assert.deepEqual(eligibleTargets(state,'brawler',reference001.abilities.revive_tonic),[]);
  assert.deepEqual(actionInput(state,'brawler',reference001.abilities.attack).targetIds,['blade_tyrant']);
  assert.deepEqual(actionInput(state,'brawler',reference001.abilities.potion,'warden').targetIds,['warden']);
});
test('prediction is exact for an immediate physical action and does not mutate state',()=>{
 const step=start(reference001);
 const before=JSON.stringify(step.state);
 const input=actionInput(step.state,'brawler',reference001.abilities.attack);
 const preview=previewAction(step.state,input,reference001);
 const display=previewDisplay(step.state,reference001,input,preview);
 assert.equal(preview.resolvesAt,8);
 assert.ok(display.lines.some(s=>s.includes('−87 HP')));
 assert.equal(display.approximate,false);
 assert.equal(JSON.stringify(step.state),before);
});
test('candidate variant previews reflect fire resistance and ice weakness',()=>{
 const step=start(tyrantVariant007);
 const state=structuredClone(step.state);
 state.actors.magus.ready=true;
 state.actors.magus.atb=1000;
 const ice={actorId:'magus',abilityId:'blizzard',targetIds:['blade_tyrant']};
 const fire={actorId:'magus',abilityId:'fire',targetIds:['blade_tyrant']};
 const damage = input => previewAction(state,input,tyrantVariant007).events.find(e=>e.type==='damage')?.amount;
 assert.ok(damage(ice)>damage(fire));
});
test('approved no-items mastery gives three stars for both reference and candidate replay',()=>{
 for(const [def,name] of [[reference001,'witness-v06.json'],[tyrantVariant007,'variant-v07-focus.json']]){
  const fixture=JSON.parse(readFileSync(new URL(`../fixtures/${name}`,import.meta.url)));
  const actions=fixture.playerActions.map(({actorId,abilityId,targetIds})=>({actorId,abilityId,targetIds}));
  const step=replay(def,actions);
  assert.equal(step.terminal,'victory');
  assert.equal(starsForResult(step.state),3);
  assert.equal(step.state.itemUses,0);
 }
});
test('command classification groups personal actions and universal commands consistently',()=>{
 assert.equal(abilityGroup(reference001.abilities.attack),'Attack');
 assert.equal(abilityGroup(reference001.abilities.defend),'Defend');
 assert.equal(abilityGroup(reference001.abilities.cover),'Special');
 assert.equal(abilityGroup(reference001.abilities.focus),'Special');
 assert.equal(abilityGroup(reference001.abilities.cure),'Magic');
 assert.equal(abilityGroup(reference001.abilities.potion),'Item');
});

test('new boss AI variant exposes target rationale without changing legal player commands',async()=>{
  const {tyrantAI008}=await import('../dist/src/ai-variant.js');
  const step=start(tyrantAI008);
  assert.deepEqual(step.state.bossIntent.targetIds,['brawler']);
  assert.equal(step.state.bossIntent.targetDescription,'Seeded random living slot 2');
  assert.equal(availableActions(step.state,tyrantAI008,'brawler').find(x=>x.ability.id==='attack')?.enabled,true);
});
test('a Protect preview announces its conditional boss AI reaction before committing',async()=>{
  const {tyrantAI008}=await import('../dist/src/ai-variant.js');
  const step=start(tyrantAI008);
  const s=structuredClone(step.state);
  s.actors.warden.ready=true;s.actors.warden.atb=1000;
  const input={actorId:'warden',abilityId:'protect',targetIds:['warden']};
  const preview=previewAction(s,input,tyrantAI008);
  const display=previewDisplay(s,tyrantAI008,input,preview);
  assert.ok(display.lines.some(line=>line.includes('Boss reacts: Shatter Guard')));
  assert.equal(s.bossIntent.abilityId,'heavy_slash','forecast must be pure');
});
