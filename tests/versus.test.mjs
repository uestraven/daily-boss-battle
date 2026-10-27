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
  // Three call sites and no more, each a deliberate way into or out of a battle: pressing
  // Begin, reaching the dungeon's boss door, and the screen's own dismissal. Counted and
  // named rather than matched exactly, because the opening call decides between a fresh
  // start and a resume and will keep changing shape -- but a fourth means the screen has
  // become reachable from somewhere nobody chose, which is what this guards.
  const setters = code(screen).match(/setShowVersus\([^)]*\)/g) ?? [];
  assert.ok(setters.length <= 3,
    `showVersus is set from ${setters.length} places: ${setters.join(', ')}. Every one should `
    + 'be a deliberate entry to or exit from a battle; a new one needs a reason here.');
  assert.ok(setters.some(c => /false/.test(c)), 'nothing turns the matchup screen off');
  assert.ok(setters.some(c => /true|!resuming/.test(c)), 'nothing turns it on');
  // And the one that turns it on sits in beginBattle rather than in a render path.
  const begin = code(screen).slice(code(screen).indexOf('const beginBattle'));
  assert.ok(/setShowVersus\((?:true|!resuming)\)/.test(begin.slice(0, 1600)),
    'the matchup screen is not started by beginBattle, so it is reachable from somewhere '
    + 'that is not the player pressing Begin');
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

// --- the bug that locked the game ------------------------------------------------------
//
// The timer effect originally depended on `onDone`, which the parent passed as an inline
// arrow: a new function identity on every render. `DailyBattle` re-renders every 70ms from
// the interval driving idle animation, so the effect re-ran twenty times a second, each run
// clearing its own timer and starting a fresh one. It never fired, and the matchup screen
// trapped the player with no way past it.
//
// None of the six tests above caught that. They checked what the screen *shows*; this
// checks that it ever stops showing it.

test('the dismissal timer is set once and cannot be restarted by a re-render', () => {
  const effect = code(versus).match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[([^\]]*)\]\)/);
  assert.ok(effect, 'could not find the timer effect');
  assert.equal(effect[1].trim(), '',
    `the timer effect depends on [${effect[1].trim()}]. Anything in that list restarts the `
    + 'timer when it changes, and a parent re-rendering twenty times a second then means it '
    + 'never fires at all -- which locked the game on this screen.');
});

test('the callback is held in a ref, so the component is correct whatever it is handed', () => {
  // Making the parent's callback stable also fixes it, and that is done -- but a screen that
  // traps the player if its parent re-renders is too sharp an edge to leave pointing
  // outward.
  const body = code(versus);
  assert.ok(/useRef\(onDone\)/.test(body),
    'onDone is not kept in a ref, so the empty dependency list above would capture a stale '
    + 'callback instead');
  assert.ok(/done\.current/.test(body), 'the timer does not call through the ref');
});

test('the parent passes a stable callback, not an inline arrow', () => {
  // Belt and braces, and the thing that was actually wrong at the call site.
  const usage = code(screen).match(/<VersusScreen[\s\S]*?\/>/)?.[0] ?? '';
  assert.ok(usage, 'could not find the VersusScreen call site');
  assert.ok(!/onDone=\{\(\)\s*=>/.test(usage),
    'onDone is an inline arrow, which is a new identity on every render of a component that '
    + 're-renders twenty times a second');
  assert.ok(/onDone=\{\w+\}/.test(usage), 'onDone should be a named, stable callback');
});

test('the hold leaves real still time after the motion', () => {
  // "Flew in too fast" was the other half of the report. The motion should occupy well under
  // half the screen, so what is left is a held matchup rather than a blur.
  const hold = Number(versus.match(/VERSUS_MS\s*=\s*(\d+)/)?.[1]);
  let latest = 0;
  for (const m of css.matchAll(/animation:\s*dbb-versus-[\w-]+\s+(\d+)ms[^;]*?(?:\s(\d+)ms)?\s*both/g)) {
    latest = Math.max(latest, Number(m[1]) + Number(m[2] ?? 0));
  }
  assert.ok(latest <= hold * 0.6,
    `motion runs to ${latest}ms of a ${hold}ms screen, leaving only ${hold - latest}ms held`);
  // And no single move should be so quick it reads as a snap.
  for (const m of css.matchAll(/animation:\s*dbb-versus-in-\w+\s+(\d+)ms/g)) {
    assert.ok(Number(m[1]) >= 500, `a ${m[1]}ms entrance is too fast to follow`);
  }
});

test('the matchup screen is scored by the sting, and the theme follows it', () => {
  // The sting does not loop, so something has to start the battle theme when the screen
  // gives way. Tying that to the audio's own length would drift out of step with the
  // screen, which is what the player actually sees -- so it hangs off the dismissal.
  const body = code(screen);
  assert.ok(/startAudio\((?:'versus'|resuming \? '[a-z_]+' : 'versus')\)/.test(body),
    'beginBattle does not open on the matchup sting for a fresh battle');
  const dismiss = body.slice(body.indexOf('const dismissVersus'));
  assert.ok(/playMusic\('battle_main'\)/.test(dismiss.slice(0, 600)),
    'nothing starts the battle theme when the matchup screen ends, so a non-looping sting '
    + 'would leave the fight silent');
});
