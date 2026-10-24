/** The party menu's constraints. Like the matchup screen it cannot be driven here, so these
 * read the source for the properties that would be expensive to get wrong. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const menu = readFileSync(new URL('../web/src/PauseMenu.tsx', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../web/src/DailyBattle.tsx', import.meta.url), 'utf8');

/** Source with comments stripped, so a rule explained in prose is not read as code. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('status badges in the menu are gated on disclosure', () => {
  // The one real leak risk. Normal withholds the badges deliberately -- they carry durations
  // and are what let a player plan -- and a menu is exactly where someone would go looking
  // for the list the stage refuses to draw.
  const body = code(menu);
  assert.ok(/disclosure\.statuses/.test(body),
    'the party menu renders statuses without consulting disclosure.statuses');
  // And the gate has to wrap the rendering, not merely be computed somewhere.
  assert.ok(/disclosure\.statuses\s*&&/.test(body),
    'disclosure.statuses is read but does not guard the badge markup');
});

test('the menu shows nothing about the boss', () => {
  // Its HP bar is on the stage; stats, affinities and its program are what
  // disclosure.affinities withholds and what the bestiary makes you earn.
  const body = code(menu);
  for (const forbidden of ['bossId', 'affinit', 'bossProgram', 'bossIntent']) {
    assert.ok(!new RegExp(forbidden, 'i').test(body),
      `the party menu reads "${forbidden}"; it is a party menu`);
  }
});

test('the menu cannot be opened while a batch is playing', () => {
  // Not a style choice. Sound cues are scheduled ahead on the AudioContext against
  // context.currentTime, so freezing the visual clock would not stop them and hits would
  // land audibly over a frozen picture.
  const button = code(screen).match(/<button\s[^>]*className="dbb-menu-button"[\s\S]*?\/?>/)?.[0]
    ?? code(screen).match(/className="dbb-menu-button"[\s\S]{0,400}?>/)?.[0] ?? '';
  assert.ok(button, 'could not find the menu button');
  assert.ok(/disabled=\{phase\.kind === 'playing'\}/.test(button),
    'the menu button is not disabled during playback, so it would pause the picture while '
    + 'its already-scheduled sound cues kept firing');
});

test('nothing freezes the battle clock, because there is nothing to freeze', () => {
  // The engine halts between turns and consults no wall clock, so a pause needs no clock
  // surgery. If someone later adds some, this is the test that asks them to explain why.
  const body = code(screen);
  assert.ok(!/pausedRef|setPaused\(|isPaused/.test(body),
    'something is tracking a paused clock; the menu is only openable when nothing advances, '
    + 'so a clock flag means the design has changed and PauseMenu.tsx needs rereading');
});

test('the close callback is read through a ref, so the menu cannot trap the player', () => {
  // The matchup screen locked the game because a timer captured a callback that went stale
  // as the parent re-rendered twenty times a second. Here the same mistake would make the
  // menu uncloseable over a battle that cannot be advanced behind it -- a soft lock again.
  const body = code(menu);
  assert.ok(/useRef\(onClose\)/.test(body), 'onClose is not held in a ref');
  assert.ok(/close\.current/.test(body), 'the handlers do not call through the ref');
  const usage = code(screen).match(/<PauseMenu[\s\S]*?\/>/)?.[0] ?? '';
  assert.ok(!/onClose=\{\(\)\s*=>/.test(usage),
    'onClose is an inline arrow at the call site, a new identity on every render');
});

test('it is a modal dialog and takes focus, so Escape reaches it', () => {
  assert.ok(/role="dialog"/.test(menu) && /aria-modal="true"/.test(menu),
    'the overlay is not announced as a modal dialog');
  assert.ok(/aria-label="Party menu"/.test(menu), 'the dialog is unnamed');
  assert.ok(/\.focus\?\.\(\)|\.focus\(\)/.test(code(menu)),
    'nothing moves focus into the menu, so Escape and the arrow keys need a click first');
});

test('ability text comes from the shared reference, not written again', () => {
  // The Codex and the menu must not be able to describe the same ability differently.
  assert.ok(/describeAbility/.test(code(menu)),
    'the menu describes abilities without using src/ability-reference.ts');
});
