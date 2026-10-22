/** Static ability descriptions: the reference a Normal-mode player has no other way to get,
 * since `play-ui.ts`'s good descriptions live behind `disclosure.actionPreview`. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {MECHANIC_NOTES, abilityFacts, describeAbility} from '../dist/src/ability-reference.js';
import {signatureAbilities} from '../dist/src/draft.js';
import {reference001} from '../dist/src/reference.js';
import {heroAbilities} from '../dist/src/roster.js';

/** Every ability in the game, universal ones included.
 *
 * `signatureAbilities` deliberately drops `any_hero` abilities, because it exists to derive
 * which heroes are *distinct* from each other. Attack, Guard, Potion and Revive Tonic are
 * still abilities a player uses and reads about, and Guard's rule -- halves damage until
 * this hero next acts -- is exactly the kind no field expresses. So notes are validated
 * against the full set. */
const allAbilities = [...Object.values(reference001.abilities), ...heroAbilities];
import {STATUS_DISPLAY} from '../dist/src/status-display.js';
import {heroes} from '../dist/src/roster.js';

test('every ability in the game produces at least one fact', () => {
  // A card showing an ability name with nothing beside it is the state this replaces.
  for (const ability of allAbilities) {
    const facts = abilityFacts(ability);
    assert.ok(facts.length > 0, `${ability.id} describes itself with nothing`);
    assert.ok(facts[0].includes('·'), `${ability.id}: first fact should name kind and target`);
  }
});

test('an ability that applies a status says what the status does', () => {
  // "Applies surge for 24 ticks" tells a player nothing about whether to cast it.
  for (const ability of allAbilities.filter(a => a.status)) {
    const text = abilityFacts(ability).join(' ');
    const hint = STATUS_DISPLAY[ability.status]?.hint;
    assert.ok(hint, `${ability.status} has no hint in status-display.ts`);
    assert.ok(text.toLowerCase().includes(hint.toLowerCase()),
      `${ability.id} names the status but not its effect: ${text}`);
  }
});

test('no description states a damage figure, only a power value', () => {
  // Power is reference; damage depends on attacker, defender and day, and printing it would
  // be the action preview that Normal withholds. The distinction is the whole reason this
  // module is allowed to exist outside Easy.
  for (const ability of allAbilities) {
    const text = abilityFacts(ability).join(' ').toLowerCase();
    assert.ok(!/\d+\s*damage/.test(text),
      `${ability.id} states a damage figure: "${text}"`);
  }
});

test('every mechanic note belongs to an ability that exists', () => {
  // Hand-written text is the part that rots; this is what catches a note left behind after
  // its ability was renamed or removed.
  const ids = new Set(allAbilities.map(a => a.id));
  for (const id of Object.keys(MECHANIC_NOTES)) {
    assert.ok(ids.has(id), `MECHANIC_NOTES has "${id}", which is not an ability any more`);
  }
});

test('the abilities whose mechanic no field can express all carry a note', () => {
  // The ones a player cannot possibly infer from power and MP cost. If a new ability has a
  // bespoke rule, it belongs here too.
  for (const id of ['focus', 'nullify', 'steal', 'cover', 'defend']) {
    assert.ok(MECHANIC_NOTES[id], `${id} has a rule no field expresses and no note`);
  }
});

test('notes are prose and do not restate a derivable fact', () => {
  for (const [id, note] of Object.entries(MECHANIC_NOTES)) {
    assert.ok(/[.!]$/.test(note), `${id}: a note should be a sentence`);
    assert.ok(note.length > 20, `${id}: note too short to explain a mechanic`);
  }
});

test('every hero has at least one described ability or is honestly basics-only', () => {
  for (const h of heroes) {
    const owned = signatureAbilities.filter(a => a.owner === h.id);
    // All twelve own something; this is the assertion that would have caught the Codex
    // claiming the Warden had "Attack, Guard and items only" when it has Cover, Cure and
    // Protect -- that bug came from reading the wrong ability list.
    assert.ok(owned.length > 0, `${h.id} owns no signature ability`);
    for (const a of owned) assert.ok(describeAbility(a).facts.length > 0, `${h.id}/${a.id}`);
  }
});
