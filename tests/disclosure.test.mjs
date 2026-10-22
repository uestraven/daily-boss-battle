/** The difficulty policy.
 *
 * These tests exist because the policy was previously a single boolean in the screen,
 * which is a shape that cannot be audited: the action preview -- exact damage figures and
 * the boss's newly announced attack -- was never attached to it and showed in Normal for
 * as long as the mode existed. Enumerating the fields makes "what does Normal withhold?"
 * a question with a checkable answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCLOSURE_FIELDS, disclosureFor} from '../dist/src/disclosure.js';

/** Fields Normal deliberately shows. Every entry needs a reason, written here. */
const NORMAL_SHOWS = {
  // A status landing is a *result*, not a prediction. Gated with the badges, a boss could
  // buff itself in Normal with nothing on screen, no sound and no telegraph, and the
  // player's damage simply fell by a quarter with no stated cause -- the only outcome in
  // the game with no feedback at all. The badge, which carries the duration and is what
  // lets a player plan, stays hidden.
  statusEvents: 'a result, not a prediction; see src/disclosure.ts',
};

test('Normal withholds every prediction', () => {
  const normal = disclosureFor('normal');
  for (const field of DISCLOSURE_FIELDS) {
    if (field in NORMAL_SHOWS) {
      assert.equal(normal[field], true,
        `${field} is listed as shown in Normal but is withheld`);
      continue;
    }
    assert.equal(normal[field], false,
      `Normal must not show ${field}. If that is a deliberate change, add it to `
      + 'NORMAL_SHOWS above with the reason, so the exception is argued rather than assumed.');
  }
});

test('Easy reveals every disclosure', () => {
  const easy = disclosureFor('easy');
  for (const field of DISCLOSURE_FIELDS) {
    assert.equal(easy[field], true, `Easy should show ${field}`);
  }
});

test('every disclosure states a position for both modes', () => {
  // The property that makes the table worth having over a boolean: a new field cannot
  // default its way into the harder mode, because it is absent until someone writes it
  // down for both and this fails if either is left undefined.
  for (const mode of ['easy', 'normal']) {
    const disclosure = disclosureFor(mode);
    for (const field of DISCLOSURE_FIELDS) {
      assert.equal(typeof disclosure[field], 'boolean',
        `${mode} has no decision recorded for ${field}`);
    }
  }
});

test('the policy names the disclosures the interface actually has', () => {
  // A reminder in test form: these are the things the screen gates. If another piece of
  // information reaches the player, this list is where it goes, and this assertion is what
  // fails to say so.
  assert.deepEqual([...DISCLOSURE_FIELDS].sort(),
    ['actionPreview', 'affinities', 'noEffect', 'statusEvents', 'statuses', 'telegraph']);
});

test('the two modes differ on everything except the agreed exceptions', () => {
  const easy = disclosureFor('easy');
  const normal = disclosureFor('normal');
  for (const field of DISCLOSURE_FIELDS) {
    if (field in NORMAL_SHOWS) continue;
    assert.notEqual(easy[field], normal[field],
      `${field} is the same in both modes, so it is not a difficulty setting. If it should `
      + 'be the same, add it to NORMAL_SHOWS with the reason.');
  }
  // And the mode choice still has to mean something overall.
  const differing = DISCLOSURE_FIELDS.filter(f => easy[f] !== normal[f]);
  assert.ok(differing.length >= 4,
    `only ${differing.length} fields differ between the modes; the choice is losing meaning`);
});
