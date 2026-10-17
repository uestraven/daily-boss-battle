/** Milestone 0 guarantees: the engine is content-agnostic, battles can be lost,
 * softlocks surface, and the enrage curve punishes stalling. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {reference001} from '../dist/src/reference.js';
import {practiceEncounters} from '../dist/src/encounters.js';
import {advanceToDecision, applyPlayerAction, calculateDamage, createEncounter, replay} from '../dist/src/engine.js';

const copy = v => JSON.parse(JSON.stringify(v));
const attack = (s, id) => ({actorId: id, abilityId: 'attack', targetIds: [s.bossId]});

function driveAttacksOnly(def, limit = 80) {
  let step = advanceToDecision(createEncounter(def), def);
  const inputs = [];
  for (let n = 0; n < limit && !step.terminal; n++) {
    const input = attack(step.state, step.readyHeroIds[0]);
    inputs.push(input);
    step = applyPlayerAction(step.state, input, def);
  }
  return {step, inputs};
}

test('a battle can actually be lost: attack-only against Crush Wall wipes the party', () => {
  const def = practiceEncounters.crush_wall;
  const {step, inputs} = driveAttacksOnly(def);
  assert.equal(step.terminal, 'defeat');
  assert.equal(step.state.result, 'defeat');
  // Every hero is down and the boss survived.
  for (const id of step.state.party) assert.equal(step.state.actors[id].hp, 0, id);
  assert.ok(step.state.actors[step.state.bossId].hp > 0);
  assert.ok(step.state.events.some(e => e.type === 'defeat'));
  assert.equal(step.state.events.filter(e => e.type === 'ko').length >= 3, true);
  // A defeat is terminal: no further action is accepted.
  assert.throws(() => applyPlayerAction(step.state, attack(step.state, step.state.party[0]), def), /ended/);
  // And the loss is reproducible from its action log.
  assert.deepEqual(replay(def, inputs).state, step.state);
});

test('a defeat is reported through the same stars contract as a win', async () => {
  const {starsForResult} = await import('../dist/src/engine.js');
  const {step} = driveAttacksOnly(practiceEncounters.crush_wall);
  assert.equal(step.state.result, 'defeat');
  assert.equal(starsForResult(step.state), 0);
});

test('exceeding maxTicks raises a softlock error instead of hanging', () => {
  const def = {...copy(reference001), maxTicks: 5};
  // The first hero decision lands at tick 8, so a 5-tick budget cannot be satisfied.
  assert.throws(() => advanceToDecision(createEncounter(def), def), /exceeded 5 ticks|softlock/);
});

test('maxTicks is enforced mid-battle, not only at setup', () => {
  const def = {...copy(reference001), maxTicks: 30};
  assert.throws(() => driveAttacksOnly(def, 40), /exceeded 30 ticks|softlock/);
});

test('enrage scales boss damage over time, caps, and never touches hero damage', () => {
  const plain = copy(reference001);
  const enraged = {...copy(reference001), enrage: {fromTick: 10, stepTicks: 10, percentPerStep: 25, maxPercent: 100}};
  const s = createEncounter(enraged);
  const boss = s.actors[s.bossId];
  const hero = s.actors.warden;
  const slash = enraged.abilities.heavy_slash;

  const at = tick => calculateDamage(enraged, boss, hero, slash, tick);
  const base = calculateDamage(plain, boss, hero, slash, 999);
  assert.equal(at(5), base, 'before fromTick: unscaled');
  assert.equal(at(10), base, 'at fromTick: still unscaled');
  assert.ok(at(11) > base, 'first step applies');
  assert.ok(at(21) > at(11), 'scaling increases per step');
  assert.equal(at(100), at(200), 'scaling is capped by maxPercent');
  assert.ok(at(100) <= base * 2 + 1, 'cap of 100% means at most double');

  // Hero damage is unaffected by the boss enrage curve.
  const heroHit = tick => calculateDamage(enraged, hero, boss, enraged.abilities.attack, tick);
  assert.equal(heroHit(5), heroHit(500));
});

test('an encounter with no enrage config is unaffected by tick position', () => {
  const def = copy(reference001);
  assert.ok(def.enrage === undefined);
  const s = createEncounter(def);
  const d = tick => calculateDamage(def, s.actors[s.bossId], s.actors.warden, def.abilities.heavy_slash, tick);
  assert.equal(d(1), d(10_000));
});

test('CONTENT DECOUPLING: a new hero with momentum and an element rider needs no engine change', () => {
  // Defined entirely as data. If the engine still branched on hero ids, this would fail.
  const def = copy(reference001);
  def.id = 'decoupling-probe';
  def.party = ['warden', 'newcomer', 'magus'];
  def.actors.newcomer = {
    name: 'The Newcomer',
    stats: {hp: 300, mp: 20, attack: 90, defense: 55, magic: 30, resistance: 45, speed: 125},
    momentumCap: 3,
  };
  delete def.actors.brawler;
  def.abilities.flame_edge = {
    id: 'flame_edge', name: 'Flame Edge', owner: 'newcomer', kind: 'status', target: 'self',
    status: 'elemental_edge', duration: 24, riderElement: 'fire',
  };
  def.abilities.surge_strike = {
    id: 'surge_strike', name: 'Surge Strike', owner: 'newcomer', kind: 'physical',
    target: 'single_living_enemy', power: 200, momentumCost: 3,
  };
  def.affinities = {...(def.affinities ?? {}), blade_tyrant: {fire: 'weak'}};

  let step = advanceToDecision(createEncounter(def), def);
  const readyWith = id => {
    let guard = 0;
    while (!step.readyHeroIds.includes(id)) {
      step = applyPlayerAction(step.state, attack(step.state, step.readyHeroIds[0]), def);
      if (++guard > 40) throw new Error(`${id} never became ready`);
    }
  };

  // 1. Momentum accrues from the ability's own momentumGain, capped by the actor definition.
  readyWith('newcomer');
  step = applyPlayerAction(step.state, attack(step.state, 'newcomer'), def);
  assert.equal(step.state.actors.newcomer.momentum, 1, 'momentumGain honoured for a brand-new hero');
  assert.ok(step.state.events.some(e => e.type === 'momentum' && e.actorId === 'newcomer'));

  // 2. A hero with no momentumCap still banks nothing.
  assert.equal(step.state.actors.warden.momentum, 0);
  assert.equal(step.state.actors.magus.momentum, 0);

  // 3. The element rider uses the element the ability declares, not a hardcoded one.
  readyWith('newcomer');
  step = applyPlayerAction(step.state, {actorId: 'newcomer', abilityId: 'flame_edge', targetIds: ['newcomer']}, def);
  assert.equal(step.state.actors.newcomer.statuses.elemental_edge.element, 'fire');

  const withRider = step.state;
  const plainDef = copy(def);
  const bare = createEncounter(plainDef);
  const unridden = calculateDamage(plainDef, bare.actors.newcomer, bare.actors.blade_tyrant, def.abilities.attack, 0);
  const ridden = calculateDamage(def, withRider.actors.newcomer, withRider.actors.blade_tyrant, def.abilities.attack, 0);
  assert.ok(ridden > unridden, 'fire rider exploits the boss fire weakness');

  // 4. The rider is consumed by the next physical hit, for any holder.
  readyWith('newcomer');
  step = applyPlayerAction(step.state, attack(step.state, 'newcomer'), def);
  assert.equal(step.state.actors.newcomer.statuses.elemental_edge, undefined);
  assert.ok(step.state.events.some(e => e.type === 'elemental_edge_consumed' && e.actorId === 'newcomer'));
});

test('a boss with no configured fallback fails loudly rather than using a hidden default', () => {
  const def = copy(reference001);
  delete def.bossProgram.fallbackAbility;
  // Drain the boss so the scripted Protect (8 MP) is unaffordable and a fallback is required.
  def.actors.blade_tyrant.stats.mp = 0;
  assert.throws(() => driveAttacksOnly(def, 40), /fallbackAbility/);
});

test('the configured fallback ability is the one actually used', () => {
  const def = copy(reference001);
  def.abilities.desperate_swing = {
    id: 'desperate_swing', name: 'Desperate Swing', owner: 'blade_tyrant',
    kind: 'physical', target: 'single_living_enemy', power: 50,
  };
  def.bossProgram.fallbackAbility = 'desperate_swing';
  def.actors.blade_tyrant.stats.mp = 0;
  const {step} = driveAttacksOnly(def, 40);
  assert.ok(step.state.events.some(e => e.type === 'boss_fallback'));
  assert.ok(step.state.events.some(e => e.abilityId === 'desperate_swing'),
    'the content-declared fallback was used, not a built-in id');
});
