#!/usr/bin/env node
/** Behavior snapshot: a refactor guard for the simulation.
 *
 * Hashes the observable behavior of every encounter the repo ships — full event
 * logs, outcome-relevant state, and the complete cross-product damage table —
 * so a refactor can be proven behavior-neutral even when it changes types or
 * state shape. Deliberately separate from the unit tests: those assert intent,
 * this one asserts "nothing moved".
 *
 *   node tools/behavior-snapshot.mjs                   write a snapshot to stdout
 *   node tools/behavior-snapshot.mjs --write <file>    save a snapshot
 *   node tools/behavior-snapshot.mjs --check <file>    diff against a saved snapshot
 *
 * Run against dist/, so build first. Intentional behavior changes are recorded by
 * re-running --write and reviewing the diff in the commit.
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {load, repoPath, root} from './load.mjs';

const {reference001} = await load('dist/src/reference.js');
const {tyrantVariant007} = await load('dist/src/variant.js');
const {tyrantAI008} = await load('dist/src/ai-variant.js');
const {practiceEncounters, bossProfiles} = await load('dist/src/encounters.js');
const {createEncounter, advanceToDecision, applyPlayerAction, replay, starsForResult, calculateDamage} =
  await load('dist/src/engine.js');
const {dailyKeyFor} = await load('dist/src/daily.js');
const {balancedParties} = await load('dist/src/draft.js');

const h = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const fixture = name => JSON.parse(readFileSync(repoPath('fixtures', name), 'utf8'));

/** Outcome-relevant state only, so adding a struct field is not a false positive. */
const behavior = s => h({
  tick: s.tick, result: s.result, phase: s.phase, inventory: s.inventory, itemUses: s.itemUses,
  heroActionCount: s.heroActionCount, bossActionCount: s.bossActionCount, covers: s.covers,
  pending: s.pending.map(p => [p.at, p.actorId, p.abilityId, p.targetIds]),
  bossIntent: s.bossIntent && [s.bossIntent.abilityId, s.bossIntent.targetIds, s.bossIntent.phase],
  actors: Object.fromEntries(Object.entries(s.actors).map(([k, a]) => [k, [
    a.hp, a.mp, a.atb, a.ready, a.availableFrom, a.channelingUntil, a.momentum, a.steals,
    Object.entries(a.abilityUses).sort(), Object.keys(a.statuses).sort(),
  ]])),
});
/** Event stream minus presentation-only `details` text. */
const events = s => h(s.events.map(e => [e.tick, e.type, e.actorId, e.abilityId, e.targetId, e.amount, e.hpAfter]));
const record = step => ({
  behavior: behavior(step.state), events: events(step.state),
  tick: step.state.tick, result: step.state.result,
  stars: starsForResult(step.state), eventCount: step.state.events.length,
});

/** A scenario that throws has changed behavior: record it instead of crashing. */
function capture(out, key, produce) {
  try { out[key] = produce(); }
  catch (e) { out[key] = {error: e instanceof Error ? e.message : String(e)}; }
}

function snapshot() {
  const out = {};

  // 1. Approved witness replays.
  const witnessReplays = [
    ['reference001', reference001, fixture('witness-v06.json').playerActions],
    ['variant007-focus', tyrantVariant007, fixture('variant-v07-focus.json').playerActions],
    ['variant007-nofocus', tyrantVariant007, fixture('variant-v07-no_focus.json').playerActions],
    ['ai008', tyrantAI008, fixture('variant-v08-ai.json').playerActions],
  ];
  for (const [name, def, actions] of witnessReplays) capture(out, name, () => record(replay(def, actions)));

  // 2. Daily witnesses, one per boss.
  const dailyWitnesses = fixture('daily-witnesses-v10.json');
  const defFor = key => (key === 'blade_tyrant' ? tyrantAI008 : practiceEncounters[key]);
  for (const [key, witness] of Object.entries(dailyWitnesses)) {
    if (!witness?.actions) continue;
    capture(out, `witness-${key}`, () => ({...record(replay(defFor(key), witness.actions)), actions: witness.actions.length}));
  }

  // 3. Attack-only drive per practice encounter: exercises boss AI, counters and overrides.
  for (const profile of bossProfiles) {
    capture(out, `practice-${profile.id}`, () => {
      const def = practiceEncounters[profile.id];
      let step = advanceToDecision(createEncounter(def), def);
      for (let n = 0; n < 45 && !step.terminal; n++) {
        step = applyPlayerAction(step.state,
          {actorId: step.readyHeroIds[0], abilityId: 'attack', targetIds: [step.state.bossId]}, def);
      }
      return record(step);
    });
  }

  // 3b. Mixed-command drive: exercises Defend, Cover and items, which no witness uses.
  // Each ready hero takes the first legal command from a fixed preference order, so the
  // run stays deterministic while touching far more of the engine than attack-only does.
  const PREFERENCE = ['defend', 'cover', 'potion', 'mana_vial', 'attack'];
  for (const [name, def] of [['ref', reference001], ...bossProfiles.map(p => [p.id, practiceEncounters[p.id]])]) {
    capture(out, `mixed-${name}`, () => {
      let step = advanceToDecision(createEncounter(def), def);
      for (let n = 0; n < 40 && !step.terminal; n++) {
        const actorId = step.readyHeroIds[0];
        let applied = null;
        for (const abilityId of PREFERENCE) {
          const ability = def.abilities[abilityId];
          if (!ability) continue;
          if (ability.owner !== 'any_hero' && ability.owner !== actorId) continue;
          // Pick the first target the rule admits; illegal choices simply throw and are skipped.
          const candidates = ability.target === 'single_living_enemy' ? [step.state.bossId]
            : ability.target === 'single_other_ally' ? step.state.party.filter(id => id !== actorId)
            : ability.target === 'self' ? [actorId]
            : step.state.party;
          for (const targetId of candidates) {
            try {
              applied = applyPlayerAction(step.state, {actorId, abilityId, targetIds: [targetId]}, def);
              break;
            } catch { /* try the next target, then the next ability */ }
          }
          if (applied) break;
        }
        if (!applied) break;
        step = applied;
      }
      return record(step);
    });
  }

  // 4. Full damage table: pins calculateDamage for every ability and actor pairing.
  const damage = {};
  const allDefs = [['ref', reference001], ['v07', tyrantVariant007], ['ai08', tyrantAI008],
    ...bossProfiles.map(p => [p.id, practiceEncounters[p.id]])];
  for (const [name, def] of allDefs) {
    const s = createEncounter(def);
    for (const ability of Object.values(def.abilities)) {
      if (ability.kind !== 'physical' && ability.kind !== 'magical') continue;
      for (const src of [...s.party, s.bossId]) for (const tgt of [...s.party, s.bossId]) {
        try {
          damage[`${name}|${ability.id}|${src}->${tgt}`] = calculateDamage(def, s.actors[src], s.actors[tgt], ability, 0);
        } catch { /* ability not usable by this pairing */ }
      }
    }
  }
  out.__damageTable = {hash: h(damage), entries: Object.keys(damage).length};

  // 5. Daily rotation and draft pool: content-selection determinism.
  const rotation = {};
  for (let i = 0; i < 60; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    rotation[day] = dailyKeyFor(day);
  }
  out.__rotation = {hash: h(rotation)};
  const pool = balancedParties();
  out.__draftPool = {hash: h(pool), count: pool.length};

  return out;
}

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const current = snapshot();

const writeTo = flag('--write');
const checkAgainst = flag('--check');

if (checkAgainst) {
  const saved = JSON.parse(readFileSync(checkAgainst, 'utf8'));
  const keys = [...new Set([...Object.keys(saved), ...Object.keys(current)])].sort();
  const diffs = [];
  for (const key of keys) {
    const a = saved[key], b = current[key];
    if (!a) { diffs.push(`+ ${key} (new entry)`); continue; }
    if (!b) { diffs.push(`- ${key} (entry disappeared)`); continue; }
    for (const field of Object.keys(a)) {
      if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) {
        diffs.push(`~ ${key}.${field}: ${JSON.stringify(a[field])} -> ${JSON.stringify(b[field])}`);
      }
    }
  }
  if (diffs.length) {
    console.error(`Behavior changed in ${diffs.length} place(s):\n`);
    for (const d of diffs) console.error(`  ${d}`);
    console.error(`\nIf this change is intended, re-record with:\n  npm run behavior:record\n`);
    process.exit(1);
  }
  console.log(`Behavior unchanged across ${keys.length} snapshot entries.`);
} else if (writeTo) {
  writeFileSync(writeTo, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(current).length} snapshot entries to ${path.relative(root, writeTo)}`);
} else {
  console.log(JSON.stringify(current, null, 2));
}
