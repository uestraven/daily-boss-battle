/** The matchup screen's constraints, which are about what it must *not* do.
 *
 * It cannot be driven in the suite -- it is a React component with a timer and no DOM here
 * -- so these assert the properties that make an unskippable timed interstitial defensible,
 * read from the source. Crude, and they would have caught every version of this I would
 * have been tempted to write.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const versus = readFileSync(new URL('../web/src/VersusScreen.tsx', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../web/src/DailyBattle.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/src/dbb-portrait.css', import.meta.url), 'utf8');

/** Source with comments stripped, so a rule explained in prose is not mistaken for code. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the matchup screen shows no numbers', () => {
  // The constraint that keeps it out of the disclosure argument. A versus screen is a very
  // tempting place for a stat block, and boss HP or affinities here would hand Normal mode
  // exactly what `disclosure.affinities` and `actionPreview` exist to withhold.
  const body = code(versus);
  for (const forbidden of ['stats', 'affinit', 'power', 'mpCost', 'maxHp']) {
    assert.ok(!new RegExp(forbidden, 'i').test(body),
      `VersusScreen reads "${forbidden}"; the screen is names and portraits only`);
  }
});

test('nothing on it is exclusive to it', () => {
  // What makes unskippable defensible rather than merely tolerated: a screen reader cut off
  // mid-announcement, or a player who looked away, must lose nothing. Every name and
  // portrait is on the battle screen and in the Codex seconds later. If this screen ever
  // grows a fact of its own, the skip argument comes back.
  const props = code(versus).match(/VersusScreen\(\{([^}]*)\}/)?.[1] ?? '';
  const allowed = ['boss', 'party', 'onDone'];
  for (const prop of props.split(',').map(p => p.trim()).filter(Boolean)) {
    assert.ok(allowed.includes(prop),
      `VersusScreen takes "${prop}", which may be information available nowhere else`);
  }
});

test('it is reachable only by pressing Begin', () => {
  // A replay must not play it again, and neither must reloading a day in progress: nobody
  // wants the same two seconds twice.
  const setters = code(screen).match(/setShowVersus\([^)]*\)/g) ?? [];
  assert.deepEqual([...new Set(setters)].sort(),
    ['setShowVersus(false)', 'setShowVersus(true)'],
    'showVersus is set from more places than Begin and its own dismissal');
  // And the one that turns it on sits in beginBattle rather than in a render path.
  const begin = code(screen).slice(code(screen).indexOf('const beginBattle'));
  assert.ok(begin.slice(0, 1200).includes('setShowVersus(true)'),
    'the matchup screen is not started by beginBattle');
});

test('the animation finishes before the screen does', () => {
  // An animation still running when the battle replaces the screen reads as a cut rather
  // than a transition.
  const hold = Number(versus.match(/VERSUS_MS\s*=\s*(\d+)/)?.[1]);
  assert.ok(hold >= 1200 && hold <= 3000, `${hold}ms is outside a sensible hold`);
  let latest = 0;
  for (const m of css.matchAll(/animation:\s*dbb-versus-[\w-]+\s+(\d+)ms[^;]*?(?:\s(\d+)ms)?\s*both/g)) {
    latest = Math.max(latest, Number(m[1]) + Number(m[2] ?? 0));
  }
  assert.ok(latest > 0, 'found no versus animations to check');
  assert.ok(latest < hold - 300,
    `the last animation ends at ${latest}ms of a ${hold}ms screen, leaving no hold`);
});

test('reduced motion is honoured', () => {
  // The OS setting is respected everywhere else on this screen; a zoom-in is exactly the
  // sort of thing it exists for. The screen still lasts its two seconds and says the same
  // thing -- it arrives rather than flies.
  const block = css.slice(css.lastIndexOf('prefers-reduced-motion'));
  assert.ok(/\.dbb-versus/.test(block) && /animation:\s*none/.test(block),
    'the versus animations are not disabled under prefers-reduced-motion');
});

test('it announces itself as a status, not an alert', () => {
  // An announcement, not an interruption: assertive would talk over whatever the reader was
  // already saying, and the whole screen is one sentence so it is announced as a unit
  // rather than as four disconnected names.
  assert.ok(/role="status"/.test(versus), 'no live-region role on the matchup screen');
  assert.ok(!/role="alert"/.test(versus), 'alert would interrupt the screen reader');
  assert.ok(/aria-label=/.test(versus), 'the matchup is not announced as a whole');
});
