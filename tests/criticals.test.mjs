/** Critical hits on the basic attack.
 *
 * The mechanic is one line of arithmetic; everything delicate about it is determinism.
 * A stored result is proved by replaying its action log, and a pool entry is proved
 * winnable by replaying a witness, so a critical that is not reproducible would quietly
 * invalidate both. These tests are mostly about that.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {CRITICAL_DEFAULT, advanceToDecision, applyPlayerAction, calculateDamage,
  createEncounter, replay} from '../dist/src/engine.js';
import {buildEncounter, bossIds, encounterIdFor} from '../dist/src/generate.js';
import {reference001} from '../dist/src/reference.js';
import {actionInput, availableActions} from '../dist/src/play-ui.js';

const PARTIES = [
  ['machinist', 'warden', 'monk'],
  ['brawler', 'magus', 'oracle'],
  ['lancer', 'thief', 'nullifier'],
  ['vanguard', 'blademage', 'channeler'],
];

/** Plays basic attacks until the battle ends or nobody can act, collecting damage events. */
function playBasicAttacks(def, turns = 120) {
  const inputs = [];
  const damage = [];
  let step = advanceToDecision(createEncounter(def), def);
  for (let turn = 0; turn < turns && !step.state.result; turn++) {
    const actorId = step.readyHeroIds[0];
    if (!actorId) break;
    const basic = availableActions(step.state, def, actorId)
      .filter(o => o.enabled).find(o => o.ability.id === 'attack');
    if (!basic) break;
    const source = step.state.actors[actorId];
    const target = step.state.actors[def.bossId];
    const plain = calculateDamage(def, source, target, basic.ability, step.state.tick);
    const input = actionInput(step.state, actorId, basic.ability, def.bossId);
    const before = step.state.events.length;
    inputs.push(input);
    try { step = applyPlayerAction(step.state, input, def); } catch { break; }
    for (const event of step.state.events.slice(before)) {
      if (event.type === 'damage' && event.actorId === actorId && event.abilityId === 'attack') {
        damage.push({...event, plain});
      }
    }
  }
  return {inputs, damage, step};
}

test('roughly one basic attack in 32 is a critical', () => {
  let attacks = 0;
  let criticals = 0;
  for (const bossId of bossIds) {
    for (const party of PARTIES) {
      const def = buildEncounter(bossId, party, {id: 'crit', contentVersion: 'crit'});
      for (const event of playBasicAttacks(def).damage) {
        attacks++;
        if (event.critical) criticals++;
      }
    }
  }
  // A wide band on purpose. The rate is a hash modulo, so the sample is not independent
  // draws and pinning it tighter would make this fail on an unrelated content change.
  assert.ok(attacks > 400, `expected a decent sample, saw ${attacks}`);
  const oneIn = attacks / criticals;
  assert.ok(oneIn > 20 && oneIn < 50,
    `observed 1 in ${oneIn.toFixed(1)} (${criticals}/${attacks}); expected near 1 in 32`);
});

test('a critical is exactly double, and nothing else is', () => {
  let checkedCritical = 0;
  let checkedPlain = 0;
  for (const bossId of bossIds) {
    for (const party of PARTIES) {
      const def = buildEncounter(bossId, party, {id: 'crit', contentVersion: 'crit'});
      for (const event of playBasicAttacks(def).damage) {
        // Skip the killing blow: damage is clamped to the target's remaining HP, so the
        // last hit of a fight is legitimately less than the formula says.
        if (event.hpAfter === 0) continue;
        if (event.critical) {
          assert.equal(event.amount, event.plain * CRITICAL_DEFAULT.multiplier,
            `${bossId}: critical ${event.amount} should be ${event.plain} doubled`);
          checkedCritical++;
        } else {
          assert.equal(event.amount, event.plain,
            `${bossId}: non-critical ${event.amount} should be exactly ${event.plain}`);
          checkedPlain++;
        }
      }
    }
  }
  assert.ok(checkedCritical > 5, `expected several criticals, saw ${checkedCritical}`);
  assert.ok(checkedPlain > 100, `expected many ordinary hits, saw ${checkedPlain}`);
});

test('the same action log produces the same criticals every time', () => {
  // The property the ledger depends on: a recorded day replays to the result it recorded.
  for (const bossId of bossIds) {
    const def = buildEncounter(bossId, PARTIES[1], {id: 'crit', contentVersion: 'crit'});
    const {inputs} = playBasicAttacks(def);
    const fingerprint = state => state.events
      .filter(e => e.type === 'damage')
      .map(e => `${e.tick}:${e.actorId}:${e.amount}:${e.critical ? 'C' : '-'}`)
      .join('|');
    const first = replay(def, inputs).state;
    const second = replay(def, inputs).state;
    assert.equal(fingerprint(first), fingerprint(second), `${bossId} replayed differently`);
    assert.equal(first.actors[def.bossId].hp, second.actors[def.bossId].hp);
  }
});

test('criticals do not depend on the name the encounter was built under', () => {
  // The trap this pins: the pool builds its witnesses as `gen-<boss>-<party>` and the app
  // plays the very same fight as `daily-<date>-<boss>`. Keying criticals on the
  // definition's id -- the obvious choice -- would give the two different crit sequences,
  // so an encounter proven winnable would not play out as proven. The seed is derived
  // from the boss seed and party instead, which both names share.
  for (const bossId of bossIds) {
    const party = PARTIES[0];
    const asPool = buildEncounter(bossId, party,
      {id: encounterIdFor(bossId, party), contentVersion: 'pool'});
    const asDaily = buildEncounter(bossId, party,
      {id: `daily-2026-12-25-${bossId}`, contentVersion: 'pool'});
    const {inputs, damage} = playBasicAttacks(asPool);
    const crits = state => state.events
      .filter(e => e.type === 'damage' && e.critical)
      .map(e => `${e.tick}:${e.actorId}:${e.amount}`).join('|');
    assert.equal(crits(replay(asDaily, inputs).state), crits(replay(asPool, inputs).state),
      `${bossId}: crit sequence differs between the pool's name and the daily's`);
    assert.ok(damage.length > 0, `${bossId}: nothing was played`);
  }
});

test('only the basic attack crits', () => {
  // Deliberately narrow: every special ability's damage was tuned and then verified, so
  // widening this would perturb numbers that have a winnability proof attached.
  for (const bossId of bossIds) {
    const def = buildEncounter(bossId, PARTIES[2], {id: 'crit', contentVersion: 'crit'});
    let step = advanceToDecision(createEncounter(def), def);
    for (let turn = 0; turn < 60 && !step.state.result; turn++) {
      const actorId = step.readyHeroIds[0];
      if (!actorId) break;
      const offered = availableActions(step.state, def, actorId).filter(o => o.enabled);
      // Prefer anything that is not the basic attack, to exercise the specials.
      const choice = offered.find(o => o.ability.id !== 'attack' && (o.ability.power ?? 0) > 0)
        ?? offered.find(o => o.ability.id === 'attack');
      if (!choice) break;
      const before = step.state.events.length;
      try {
        step = applyPlayerAction(step.state,
          actionInput(step.state, actorId, choice.ability, def.bossId), def);
      } catch { break; }
      for (const event of step.state.events.slice(before)) {
        if (event.type === 'damage' && event.critical) {
          assert.equal(event.abilityId, 'attack',
            `${bossId}: ${event.abilityId} landed a critical; only the basic attack may`);
        }
      }
    }
  }
});

test('the boss never crits', () => {
  // A critical is a reward. Doubling the boss's output would make encounters the pool has
  // already proven winnable harder, which is both unfair and a gate failure waiting to
  // happen on the next rebuild.
  for (const bossId of bossIds) {
    for (const party of PARTIES) {
      const def = buildEncounter(bossId, party, {id: 'crit', contentVersion: 'crit'});
      const {step} = playBasicAttacks(def);
      for (const event of step.state.events) {
        if (event.type === 'damage' && event.critical) {
          assert.notEqual(event.actorId, def.bossId, `${bossId} landed a critical`);
        }
      }
    }
  }
});

test('an encounter that does not declare criticals never produces one', () => {
  // This is what keeps the frozen v0.6 reference corpus and its approved witnesses
  // reproducing exactly, and it is why the mechanic is opt-in per encounter rather than
  // an engine-wide rule -- the same shape as boss AI and enrage.
  assert.equal(reference001.criticals, undefined,
    'the reference encounter must not opt in, or its approved witness stops reproducing');
  const {damage} = playBasicAttacks(reference001);
  assert.ok(damage.length > 0, 'the reference encounter played some basic attacks');
  assert.ok(!damage.some(e => e.critical), 'the reference encounter produced a critical');
});

test('generated encounters declare the documented rate', () => {
  const def = buildEncounter('tide_maw', PARTIES[0], {id: 'crit', contentVersion: 'crit'});
  assert.deepEqual(def.criticals, {oneIn: 32, multiplier: 2});
});
