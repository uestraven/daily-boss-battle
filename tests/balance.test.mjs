import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reference001} from '../dist/src/reference.js';
import {auditWitness,analyzeEncounter} from '../dist/src/balance.js';
import {replay} from '../dist/src/engine.js';
const witness=JSON.parse(readFileSync(new URL('../fixtures/witness-v06.json',import.meta.url),'utf8'));
const actions=witness.playerActions;
const params={beamWidth:24,maxHeroActions:24,maxExpansions:2200};

test('audits approved golden without changing underlying battle or encounter fixture',()=>{
  const before=JSON.stringify(reference001);
  const x=auditWitness(reference001,actions);
  assert.equal(x.result,'victory');assert.equal(x.stars,3);assert.equal(x.tick,65);
  assert.equal(x.heroActions,19);assert.equal(x.bossActions,5);assert.equal(x.itemUses,0);
  assert.equal(x.survivors,3);assert.equal(x.partyHP,247+160+116);
  assert.equal(x.bossDamage,1400);assert.equal(x.partyHealing,150);
  assert.equal(x.phaseChanges,1);
  assert.equal(x.partyHP,x.partyMaxHP-x.partyDamageReceived+x.partyHealing);
  assert.equal(JSON.stringify(reference001),before);
  assert.equal(replay(reference001,actions).state.result,'victory');
});

test('balance suite replays counterfactual witnesses and distinguishes unsupported necessity claims',()=>{
  const result=analyzeEncounter(reference001,actions,params);
  assert.equal(result.schemaVersion,1);
  assert.equal(result.golden.stars,3);
  assert.equal(result.probes.length,7);
  assert.ok(result.probes.find(p=>p.id==='baseline').bestStars===3);
  for(const p of result.probes){
    assert.ok(p.expanded<=params.maxExpansions);
    assert.equal(typeof p.truncated,'boolean');
    if(p.verifiedWitness){
      assert.equal(p.verifiedWitness.result,'victory');
      assert.equal(p.verifiedWitness.stars,p.bestStars);
      assert.ok(p.shortestWinningActions>0);
    }else assert.equal(p.bestStars,null);
  }
  assert.ok(result.interpretation.some(s=>s.includes('NOT proof')));
  assert.ok(result.findings.some(x=>x.code==='redundant_elemental_choices'));
});

test('analysis is deterministic for same encounter and bounded parameters',()=>{
  const first=analyzeEncounter(reference001,actions,{...params,maxHeroActions:17});
  const second=analyzeEncounter(reference001,actions,{...params,maxHeroActions:17});
  assert.deepEqual(first,second);
});

test('invalid or incomplete golden witness is rejected',()=>{
  assert.throws(()=>analyzeEncounter(reference001,actions.slice(0,1),params),/three-star/);
  const invalid=[...actions,{actorId:'brawler',abilityId:'spin_kick',targetIds:['warden']}];
  assert.throws(()=>auditWitness(reference001,invalid));
});

test('analysis reports parameters and refuses invalid search budgets',()=>{
  assert.throws(()=>analyzeEncounter(reference001,actions,{beamWidth:0}),/Invalid beamWidth/);
  assert.throws(()=>analyzeEncounter(reference001,actions,{maxHeroActions:0}),/Invalid maxHeroActions/);
  assert.throws(()=>analyzeEncounter(reference001,actions,{maxExpansions:0}),/Invalid maxExpansions/);
});
