import test from 'node:test';
import assert from 'node:assert/strict';
import {createEncounter,advanceToDecision,applyPlayerAction,replay,starsForResult} from '../dist/src/engine.js';
import {reference001} from '../dist/src/reference.js';
import {enumerateLegalActions,solveEncounter,runBaselinePolicy} from '../dist/src/solver.js';
const params={beamWidth:48,maxHeroActions:24,maxExpansions:5000,maxSolutions:5};

test('solver action enumeration is deterministic, legal and does not mutate the state',()=>{
  const state=advanceToDecision(createEncounter(reference001),reference001).state;
  const before=JSON.stringify(state);
  const actions=enumerateLegalActions(state,reference001);
  assert.deepEqual(actions,[
    {actorId:'brawler',abilityId:'attack',targetIds:['blade_tyrant']},
    {actorId:'brawler',abilityId:'defend',targetIds:['brawler']}
  ]);
  for(const action of actions)assert.doesNotThrow(()=>applyPlayerAction(state,action,reference001));
  assert.equal(JSON.stringify(state),before);
});

test('bounded beam search finds and independently replays a no-items three-star victory',()=>{
  const report=solveEncounter(reference001,params);
  const winner=report.solutions.find(s=>s.stars===3&&s.itemUses===0);
  assert.ok(winner,'Expected at least one no-items three-star witness in search budget');
  assert.ok(winner.actions.length<=19,'Search should find a witness not longer than the original golden');
  const played=replay(reference001,winner.actions).state;
  assert.equal(played.result,'victory');
  assert.equal(played.tick,winner.tick);
  assert.equal(played.heroActionCount,winner.actions.length);
  assert.equal(played.itemUses,0);
  assert.equal(starsForResult(played),3);
  assert.equal(JSON.stringify(solveEncounter(reference001,params)),JSON.stringify(report));
});

test('forbidding Focus still yields a winning line under the bounded search budget',()=>{
  const report=solveEncounter(reference001,{...params,forbiddenAbilities:['focus']});
  assert.ok(report.solutions.length>0);
  const win=report.solutions[0];
  assert.ok(win.actions.every(a=>a.abilityId!=='focus'));
  assert.equal(replay(reference001,win.actions).state.result,'victory');
});

test('forbidding both Brawler specials still yields a valid winning line',()=>{
  const report=solveEncounter(reference001,{...params,forbiddenAbilities:['combo_rush','spin_kick']});
  assert.ok(report.solutions.length>0);
  const win=report.solutions[0];
  assert.ok(win.actions.every(a=>!['combo_rush','spin_kick'].includes(a.abilityId)));
  assert.equal(replay(reference001,win.actions).state.result,'victory');
});

test('budget and depth limitations do not claim the battle is impossible',()=>{
  const tiny=solveEncounter(reference001,{beamWidth:2,maxHeroActions:1,maxExpansions:1,maxSolutions:2});
  assert.equal(tiny.solutions.length,0);
  assert.ok(tiny.truncated);
  assert.ok(/does NOT imply/.test(tiny.note));
  assert.throws(()=>solveEncounter(reference001,{beamWidth:0}),/Invalid beamWidth/);
});

test('baseline policy simulations are deterministic and action-capped',()=>{
  for(const policy of ['attack_only','defend_only','greedy_damage']){
    const a=runBaselinePolicy(reference001,policy,90);
    const b=runBaselinePolicy(reference001,policy,90);
    assert.deepEqual(a,b);
    assert.ok(['victory','defeat','action_cap','error'].includes(a.result));
    assert.ok(a.heroActions<=90);
  }
});
