/** Which heroes the player has fielded. The counterpart to the bestiary, and the tests that
 * matter are about where the locking *stops*. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyHeroDiscovery, isMet, metHeroes, normalizeRosterProgress, observeParty}
  from '../dist/src/roster-progress.js';
import {heroIds} from '../dist/src/roster.js';

test('nobody is met before anything is played', () => {
  assert.equal(isMet(emptyHeroDiscovery()), false);
  assert.equal(isMet(undefined), false);
});

test('a concluded battle records its whole party', () => {
  const after = observeParty({}, ['warden', 'monk', 'magus'], 'victory');
  for (const id of ['warden', 'monk', 'magus']) {
    assert.equal(after[id].fielded, 1, id);
    assert.equal(after[id].victories, 1, id);
  }
  const again = observeParty(after, ['warden', 'monk', 'magus'], 'defeat');
  assert.equal(again.warden.fielded, 2);
  assert.equal(again.warden.victories, 1, 'a loss must not count as a win');
});

test("today's party counts as met without being written to the store", () => {
  // The distinction that keeps the record honest *and* the screen legible: the three heroes
  // on screen are never locked, but an abandoned day leaves no trace, because the entry
  // means "fought alongside" and loading a screen is not that.
  const party = ['oracle', 'thief', 'brawler'];
  const met = metHeroes({}, party);
  for (const id of party) assert.ok(met.has(id), id);
  assert.equal(met.has('magus'), false, 'a hero not in the party is still unmet');
  // And nothing was persisted by asking.
  assert.deepEqual(normalizeRosterProgress({}, heroIds), {});
});

test('met includes both the record and the current party', () => {
  const stored = observeParty({}, ['magus', 'monk', 'warden'], 'victory');
  const met = metHeroes(stored, ['oracle', 'thief', 'brawler']);
  assert.equal(met.size, 6);
});

test('a forged store cannot invent progress', () => {
  const clean = normalizeRosterProgress({
    warden: {fielded: 2, victories: 99},
    monk: {fielded: -5, victories: 3},
    nobody: {fielded: 40, victories: 40},
    magus: 'not an object',
  }, heroIds);
  assert.equal(clean.warden.victories, 2, 'victories cannot exceed battles fought');
  assert.equal(clean.monk.fielded, 0, 'a negative count should floor at zero');
  assert.equal(clean.monk.victories, 0, 'and its victories cannot survive it');
  assert.equal(clean.nobody, undefined, 'an unknown hero id should be dropped');
  assert.equal(clean.magus, undefined, 'a malformed entry should be dropped');
});

test('normalising junk yields nothing rather than throwing', () => {
  for (const junk of [null, undefined, 7, 'no', []]) {
    assert.doesNotThrow(() => normalizeRosterProgress(junk, heroIds));
  }
});

test('locking is per hero, never per ability', () => {
  // The limit that matters most. The Codex is the only place a Normal-mode player can learn
  // what an ability does, since disclosure.actionPreview hides the in-battle description --
  // so requiring someone to cast Fire II before being told what Fire II does would be
  // backwards. There is deliberately no per-ability state to lock.
  const source = readFileSync(new URL('../src/roster-progress.ts', import.meta.url), 'utf8');
  assert.ok(!/abilit/i.test(source.replace(/^\s*\*.*$/gm, '')),
    'roster-progress.ts has grown per-ability state; see the note in its header about why '
    + 'unlocking stops at the hero');
});

test('a hero can be met without ever being won with', () => {
  const after = observeParty({}, ['magus'], 'defeat');
  assert.ok(isMet(after.magus), 'losing with a hero is still meeting them');
  assert.equal(after.magus.victories, 0);
});
