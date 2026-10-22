/** Every buff and debuff, measured rather than asserted from the code.
 *
 * Each status was mentioned somewhere in the suite before this file, but a mention is not a
 * verification: `airborne` had no coverage at all, and nothing checked that a modifier's
 * multiplier was the documented one rather than merely non-zero. These measure the effect
 * end to end through the engine and compare against the specified number.
 *
 * Ratios are compared with a tolerance instead of exact totals, so tuning a hero's attack
 * does not break a test about Protect. The ratio is the contract; the damage is not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceToDecision, applyPlayerAction, createEncounter, previewAction} from '../dist/src/engine.js';
import {reference001 as def} from '../dist/src/reference.js';
import {buildEncounter} from '../dist/src/generate.js';

const clone = s => JSON.parse(JSON.stringify(s));
const fresh = (d = def) => advanceToDecision(createEncounter(d), d).state;
const ready = (s, id) => { s.actors[id].ready = true; s.actors[id].atb = 100; return s; };

/** Total damage one action would deal. `previewAction` so nothing is mutated. */
const damageOf = (s, input, d = def) =>
  previewAction(s, input, d).events
    .filter(e => e.type === 'damage')
    .reduce((a, e) => a + (e.amount ?? 0), 0);

/** Damage with a status applied to `on`, over damage without it. */
const ratioWith = (actor, abilityId, targetIds, on, status, extra = {}, d = def) => {
  const input = {actorId: actor, abilityId, targetIds};
  const plain = damageOf(ready(clone(fresh(d)), actor), input, d);
  const buffed = (() => {
    const s = ready(clone(fresh(d)), actor);
    s.actors[on].statuses[status] = {expiresAt: s.tick + 50, ...extra};
    return damageOf(s, input, d);
  })();
  assert.ok(plain > 0, `${abilityId} dealt no damage at all, so the ratio means nothing`);
  return buffed / plain;
};

const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 0.08,
    `${label}: measured x${actual.toFixed(2)}, specified x${expected}`);

const BOSS = def.bossId;

test('Focus doubles magical damage', () => {
  near(ratioWith('magus', 'fire', [BOSS], 'magus', 'focus'), 2, 'Focus');
});

test('Surge raises magical damage by half', () => {
  near(ratioWith('magus', 'fire', [BOSS], 'magus', 'surge'), 1.5, 'Surge');
});

test('Shell cuts magical damage to three quarters, and leaves physical alone', () => {
  near(ratioWith('magus', 'fire', [BOSS], BOSS, 'shell'), 0.75, 'Shell vs magical');
  // The pair of negative checks matter as much as the positive ones: a modifier applied to
  // the wrong damage kind is the easiest way for this to be subtly wrong.
  near(ratioWith('brawler', 'attack', [BOSS], BOSS, 'shell'), 1, 'Shell vs physical');
});

test('Protect cuts physical damage to three quarters, and leaves magical alone', () => {
  near(ratioWith('brawler', 'attack', [BOSS], BOSS, 'protect'), 0.75, 'Protect vs physical');
  near(ratioWith('magus', 'fire', [BOSS], BOSS, 'protect'), 1, 'Protect vs magical');
});

test('Defend halves damage of either kind', () => {
  near(ratioWith('magus', 'fire', [BOSS], BOSS, 'defend'), 0.5, 'Defend vs magical');
  near(ratioWith('brawler', 'attack', [BOSS], BOSS, 'defend'), 0.5, 'Defend vs physical');
});

test('Haste and Slow change how long an actor takes to act', () => {
  // Everyone else frozen, so the measurement is of one actor's charge rate and not a race.
  const ticks = status => {
    const s = clone(fresh());
    for (const id of [...s.party, s.bossId]) {
      s.actors[id].ready = false;
      s.actors[id].atb = 0;
      if (id !== 'brawler') s.actors[id].stats.speed = 0;
    }
    if (status) s.actors.brawler.statuses[status] = {expiresAt: 9999};
    const step = advanceToDecision(s, def);
    assert.ok(step.state.actors.brawler.ready, 'the brawler never became ready');
    return step.state.tick - s.tick;
  };
  const normal = ticks(null);
  assert.ok(ticks('haste') < normal, 'Haste did not shorten the wait');
  assert.ok(ticks('slow') > normal, 'Slow did not lengthen the wait');
});

test('Poison pulses 5% of max HP, capped at 30, every 12 ticks', () => {
  let cur = advanceToDecision(createEncounter(def), def);
  const s = clone(cur.state);
  s.actors.brawler.statuses.poison = {expiresAt: 9999, nextPulseAt: s.tick + 1};
  cur = advanceToDecision(s, def);
  for (let t = 0; t < 30 && !cur.terminal; t++) {
    const hero = cur.readyHeroIds?.[0];
    if (!hero) break;
    try {
      cur = applyPlayerAction(cur.state, {actorId: hero, abilityId: 'attack', targetIds: [BOSS]}, def);
    } catch { break; }
  }
  const pulses = cur.state.events.filter(e => e.type === 'poison_pulse' && e.actorId === 'brawler');
  // At least two, or the interval check below would pass on an empty array -- which is
  // exactly how a first attempt at this measurement reported success while finding nothing.
  assert.ok(pulses.length >= 2, `expected several pulses, saw ${pulses.length}`);
  const max = def.actors.brawler.stats.hp;
  const expected = Math.min(30, Math.max(1, Math.floor(max / 20)));
  for (const p of pulses) assert.equal(p.amount, expected, `pulse at tick ${p.tick}`);
  const gaps = pulses.slice(1).map((p, i) => p.tick - pulses[i].tick);
  for (const g of gaps) assert.equal(g, 12, `interval between pulses: ${gaps.join(', ')}`);
});

test('Silence blocks magic but not a weapon', () => {
  const s = ready(clone(fresh()), 'magus');
  s.actors.magus.statuses.silence = {expiresAt: 9999};
  assert.throws(
    () => applyPlayerAction(s, {actorId: 'magus', abilityId: 'fire', targetIds: [BOSS]}, def),
    /Silenced/, 'a silenced caster cast a spell');
  // The same actor must still be able to swing, or Silence is a stun.
  assert.doesNotThrow(
    () => applyPlayerAction(s, {actorId: 'magus', abilityId: 'attack', targetIds: [BOSS]}, def));
});

test('Elemental Edge puts a real element on a physical hit', () => {
  // Blade Tyrant is weak to ice and resists fire, so one rider should raise the number and
  // the other lower it. A boss with no affinities would make this vacuous.
  const d = buildEncounter('blade_tyrant', ['blademage', 'oracle', 'brawler'].sort());
  const aff = d.affinities?.[d.bossId] ?? {};
  assert.equal(aff.ice, 'weak', 'this test needs a boss weak to ice');
  assert.equal(aff.fire, 'resist', 'this test needs a boss that resists fire');
  const ice = ratioWith('brawler', 'attack', [d.bossId], 'brawler', 'elemental_edge',
    {element: 'ice'}, d);
  const fire = ratioWith('brawler', 'attack', [d.bossId], 'brawler', 'elemental_edge',
    {element: 'fire'}, d);
  assert.ok(ice > 1.2, `an ice rider on a boss weak to ice only managed x${ice.toFixed(2)}`);
  assert.ok(fire < 0.8, `a fire rider on a boss that resists fire managed x${fire.toFixed(2)}`);
});

test('Nullify absorbs an enemy spell, recovers MP, and is spent', () => {
  const d = buildEncounter('spell_weaver', ['nullifier', 'oracle', 'magus'].sort());
  const s = clone(fresh(d));
  s.actors.nullifier.statuses.nullify = {expiresAt: 9999};
  // Drained, so the recovery is limited by the ability rather than by the MP ceiling: at
  // full MP the absorb correctly returns 0 and the test would prove nothing.
  s.actors.nullifier.mp = 0;
  let cur = advanceToDecision(s, d);
  for (let t = 0; t < 40 && !cur.terminal; t++) {
    const hero = cur.readyHeroIds?.[0];
    if (!hero) break;
    try {
      cur = applyPlayerAction(cur.state, {actorId: hero, abilityId: 'attack', targetIds: [d.bossId]}, d);
    } catch { break; }
    if (cur.state.events.some(e => e.type === 'nullify_absorb')) break;
  }
  const absorbed = cur.state.events.filter(e => e.type === 'nullify_absorb');
  assert.equal(absorbed.length, 1, 'the Spell Weaver cast nothing that Nullify caught');
  assert.equal(absorbed[0].amount, 8, 'Nullify should return the full 8 MP from empty');
  assert.ok(!cur.state.actors.nullifier.statuses.nullify,
    'Nullify survived being used, so it would absorb every spell in the fight');
});

test('Airborne takes the Lancer out of reach of a ground attack', () => {
  const d = buildEncounter('crush_wall', ['lancer', 'oracle', 'magus'].sort());
  const s = ready(clone(fresh(d)), 'lancer');
  let cur = applyPlayerAction(s, {actorId: 'lancer', abilityId: 'jump', targetIds: [d.bossId]}, d);
  assert.ok(cur.state.actors.lancer.statuses.airborne,
    'Jump did not put the Lancer in the air');
  assert.ok(cur.state.actors.lancer.channelingUntil !== null,
    'Jump did not start a channel, so there is no window to be airborne in');

  // Play on with the grounded heroes and watch what the boss does while the Lancer is up.
  for (let t = 0; t < 12 && !cur.terminal; t++) {
    const hero = cur.readyHeroIds?.find(h => h !== 'lancer');
    if (!hero) break;
    try {
      cur = applyPlayerAction(cur.state, {actorId: hero, abilityId: 'attack', targetIds: [d.bossId]}, d);
    } catch { break; }
  }
  const dodged = cur.state.events.filter(e =>
    e.type === 'fizzle' && /locked target no longer valid/.test(e.details ?? ''));
  assert.ok(dodged.length >= 1,
    'no boss attack fizzled while the Lancer was airborne. Either the dodge has stopped '
    + 'working, or this encounter no longer happens to aim a ground attack at the Lancer '
    + 'during the jump window -- check which before changing the assertion.');
});
