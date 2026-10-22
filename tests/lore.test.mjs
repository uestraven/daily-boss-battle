/** Codex content: that every hero has a biography, and that the id list it is keyed on
 * cannot drift from the roster. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {HERO_LORE, loreFor} from '../dist/src/lore.js';
import {heroIds, heroes} from '../dist/src/roster.js';

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
