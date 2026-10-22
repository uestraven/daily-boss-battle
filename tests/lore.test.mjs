/** Codex content: that every hero has a biography, and that the id list it is keyed on
 * cannot drift from the roster. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {HERO_LORE, loreFor} from '../dist/src/lore.js';
import {heroIds, heroes} from '../dist/src/roster.js';
import {CAPABILITY_LABEL, capabilityLabels} from '../dist/src/lore.js';
import {heroCapabilities, signatureAbilities} from '../dist/src/draft.js';

test('heroIds matches the roster exactly', () => {
  // `heroes` types its id as string, so the literal union in `heroIds` is declared by hand
  // and this is what stops the two drifting. Without it, a new hero would be absent from
  // every record keyed on HeroId -- including the biographies -- and nothing would complain.
  assert.deepEqual([...heroIds].sort(), heroes.map(h => h.id).sort());
});

test('every hero has a biography', () => {
  for (const id of heroIds) {
    const lore = loreFor(id);
    assert.ok(lore, `${id} has no lore entry`);
    assert.ok(lore.biography.trim().length > 0, `${id} has an empty biography`);
  }
});

test('biographies fit the card they are displayed in', () => {
  // Two or three sentences. A card carries a portrait, a stat block and an ability line as
  // well, so prose much longer than this wants a detail view -- a second screen that does
  // not exist. The bound is generous; it exists to catch an essay, not to police style.
  for (const id of heroIds) {
    const words = loreFor(id).biography.trim().split(/\s+/).length;
    assert.ok(words >= 20 && words <= 110,
      `${id}: ${words} words, outside the 20-110 a card can hold`);
  }
});

test('biographies are prose, not a stat dump', () => {
  // Static reference is fine in the Codex; numbers derived from a fight are not. Digits in
  // a biography are the first sign of balance values being copied into flavour text, where
  // they would silently rot the next time the roster is tuned.
  for (const id of heroIds) {
    assert.ok(!/\d/.test(loreFor(id).biography),
      `${id}: biography contains a number; stats belong in the stat block, which is read `
      + 'from the roster and cannot go stale');
  }
});

test('the three heroes who are not "he" are recorded as such', () => {
  // Carried as data because neither the name nor the art implies it, and getting it wrong
  // in generated prose misgenders a character in a way the neutral default never would.
  assert.equal(loreFor('channeler').pronoun, 'they');
  assert.equal(loreFor('warden').pronoun, 'it');
  assert.equal(loreFor('oracle').pronoun, 'she');
});

test('every pronoun is one of the four the type allows', () => {
  const allowed = new Set(['he', 'she', 'they', 'it']);
  for (const id of heroIds) {
    assert.ok(allowed.has(loreFor(id).pronoun), `${id}: ${loreFor(id).pronoun}`);
  }
});

test('the lore record has no entries for heroes that do not exist', () => {
  const real = new Set(heroes.map(h => h.id));
  for (const id of Object.keys(HERO_LORE)) {
    assert.ok(real.has(id), `${id} has a biography but is not in the roster`);
  }
});

// --- capability labels -----------------------------------------------------------------

test('every capability has a player-facing label and hint', () => {
  // Total over Capability, so a seventh capability cannot reach the Codex unnamed. The
  // compiler enforces the record; this catches an entry filled in with a placeholder.
  for (const [cap, entry] of Object.entries(CAPABILITY_LABEL)) {
    assert.ok(entry.label.length > 0 && entry.label.length <= 16,
      `${cap}: "${entry.label}" must be short enough for a tag on a card`);
    assert.ok(entry.hint.length > 20, `${cap}: hint is too short to explain anything`);
    assert.ok(!/\bTODO\b/i.test(entry.hint), `${cap}: hint is a placeholder`);
  }
});

test('capability labels list in declaration order, not the order given', () => {
  // So two cards can be compared without re-reading. Passing the same set in a different
  // order must produce the same line.
  const a = capabilityLabels(['pierce', 'sustain', 'physical']);
  const b = capabilityLabels(['physical', 'pierce', 'sustain']);
  assert.deepEqual(a, b);
  // And that order is the one CAPABILITY_LABEL declares.
  assert.deepEqual(a, ['Heals', 'Weapon damage', 'Pierces armour']);
});

test('every hero produces at least one tag, so no card reads "basics only"', () => {
  for (const id of heroIds) {
    assert.ok(capabilityLabels(heroCapabilities[id] ?? []).length > 0,
      `${id} would render as "Basics only" in the Codex`);
  }
});

test('the labels say what a capability does, not which ability grants it', () => {
  // A hint naming an ability goes stale the moment that ability is renamed or moved, and
  // the Codex is read by someone who has not seen the ability list yet.
  const abilityNames = new Set(signatureAbilities.map(a => a.name));
  for (const [cap, entry] of Object.entries(CAPABILITY_LABEL)) {
    for (const name of abilityNames) {
      // Protect, Shell and Haste are named in the support hint as examples, deliberately:
      // "applies a lasting effect" is meaningless without one.
      if (cap === 'support') continue;
      assert.ok(!new RegExp(`\\b${name}\\b`).test(entry.hint),
        `${cap}: hint names the ability "${name}", which will rot if it is renamed`);
    }
  }
});
