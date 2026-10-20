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

test('Normal withholds every disclosure', () => {
  const normal = disclosureFor('normal');
  for (const field of DISCLOSURE_FIELDS) {
    assert.equal(normal[field], false, `Normal must not show ${field}`);
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
  // A reminder in test form: these are the five things the screen gates. If a sixth piece
  // of fight-derived information appears on screen, this list is where it goes, and this
  // assertion is what fails to say so.
  assert.deepEqual([...DISCLOSURE_FIELDS].sort(),
    ['actionPreview', 'affinities', 'noEffect', 'statuses', 'telegraph']);
});

test('the two modes differ on everything, so the choice always matters', () => {
  const easy = disclosureFor('easy');
  const normal = disclosureFor('normal');
  for (const field of DISCLOSURE_FIELDS) {
    assert.notEqual(easy[field], normal[field],
      `${field} is the same in both modes, so it is not a difficulty setting`);
  }
});
