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

// --- quitting to the title -------------------------------------------------------------

test('the mode is locked once the day has been acted on', () => {
  // The day is one recorded attempt at a fight everyone gets the same. Quitting a losing
  // battle, switching to Easy and starting again would re-roll it -- and `DailyRecord.mode`
  // is carried rather than verified, so nothing downstream could tell. This is the same rule
  // `showLanding`'s initial condition already states from the other side.
  const body = code(screen);
  const lock = body.match(/const modeLocked = ([^;]+);/)?.[1] ?? '';
  assert.ok(lock, 'modeLocked is gone; the mode choice may have been reopened mid-battle');
  assert.ok(/inputs\.length/.test(lock),
    `modeLocked is computed from "${lock}", which does not consult the day's action log`);
  // An unranked attempt has no record to protect, so it stays open.
  assert.ok(/unranked/.test(lock), 'modeLocked ignores unranked attempts, which have no '
    + 'record to protect and should stay free to switch');
});

test('the mode fieldset is actually disabled, not merely styled', () => {
  const body = code(screen);
  assert.ok(/<fieldset className="dbb-modes" disabled=\{modeLocked\}/.test(body),
    'the mode radios are not disabled when the mode is locked, so the lock is cosmetic');
});

test('quitting keeps the day rather than discarding it', () => {
  // Nothing is lost: the ledger holds the action log and Resume replays it. The quit path
  // must not clear the ledger or the step, or "quit to title" becomes "forfeit".
  const body = code(screen);
  const quit = body.slice(body.indexOf('const quitToTitle'), body.indexOf('const quitToTitle') + 500);
  assert.ok(/setShowLanding\(true\)/.test(quit), 'quitting does not return to the title');
  for (const destructive of ['clearLedger', 'setLedger', 'setStep', 'saveLedger']) {
    assert.ok(!new RegExp(destructive).test(quit),
      `quitToTitle calls ${destructive}; quitting must not touch the recorded day`);
  }
});

test('the matchup screen does not replay on a resume', () => {
  // An introduction, and 2.6 unskippable seconds that were a pleasure once are an obstacle
  // the third time.
  const body = code(screen);
  assert.ok(/const resuming = \(ledger\.records\[day\]\?\.inputs\.length \?\? 0\) > 0;/.test(body),
    'beginBattle does not work out whether it is resuming');
  assert.ok(/setShowVersus\(!resuming\)/.test(body),
    'the matchup screen plays again when resuming a fight already in progress');
  assert.ok(/startAudio\(resuming \? 'battle_main' : 'versus'\)/.test(body),
    'a resume would play the matchup sting with no matchup screen to go with it');
});

test('quitting asks first', () => {
  // One click from a battle to another screen. Nothing is lost, but a player cannot know
  // that at the moment they press it, and a confirm step is cheaper than the doubt.
  const body = code(menu);
  assert.ok(/confirmQuit/.test(body), 'quitting is not confirmed');
  // And the confirm must gate the call, not just render a warning beside it.
  assert.ok(/!confirmQuit \?/.test(body), 'the confirmation does not gate the quit action');
});

// --- the one-way switch to Easy --------------------------------------------------------

test('Easy can be switched to mid-fight, and Normal cannot be switched back to', () => {
  // A ratchet. Easy adds information and never changes a number -- disclosure.ts is explicit
  // that neither mode alters the fight, which is what keeps one winnability proof valid for
  // both -- so rescuing a player lost in Normal costs the day nothing. What must not be
  // possible is flipping to Easy to read the telegraph and back to Normal to keep the harder
  // badge, and only one direction being offered is what closes it.
  const body = code(menu);
  assert.ok(/mode === 'normal' &&/.test(body),
    'the reveal option is not gated on being in Normal, so Easy would be offered a way out');
  assert.ok(!/'normal'\)/.test(code(screen).slice(code(screen).indexOf('const revealMode'),
    code(screen).indexOf('const revealMode') + 900)),
    'revealMode can set the mode back to normal; the switch must be one-way');
});

test('switching rewrites the day record, so the result says what was used', () => {
  // Otherwise a Normal badge would be earned with Easy information, which is the only way
  // this could be an exploit rather than a kindness.
  const body = code(screen);
  const reveal = body.slice(body.indexOf('const revealMode'), body.indexOf('const revealMode') + 900);
  assert.ok(/setDayMode\(previous, day, 'easy'\)/.test(reveal),
    'revealMode does not record the switch against the day');
  assert.ok(/saveLedger/.test(reveal), 'the rewritten mode is never persisted');
  // And an unranked attempt has no record to rewrite.
  assert.ok(/if \(unranked\) return;/.test(reveal),
    'revealMode writes a ledger record for an unranked attempt');
});

test('switching does not change the remembered preference for tomorrow', () => {
  // What today turned out to need is a different question from what the player wants by
  // default. Writing MODE_KEY here would quietly make Easy their new normal.
  const body = code(screen);
  const reveal = body.slice(body.indexOf('const revealMode'), body.indexOf('const revealMode') + 900);
  assert.ok(!/MODE_KEY/.test(reveal),
    'revealMode writes the remembered mode preference, so one rescued battle would change '
    + 'every future day');
});

test('revealing asks first, because it cannot be undone today', () => {
  const body = code(menu);
  assert.ok(/confirmReveal/.test(body), 'the switch to Easy is not confirmed');
  assert.ok(/!confirmReveal \?/.test(body), 'the confirmation does not gate the switch');
});
