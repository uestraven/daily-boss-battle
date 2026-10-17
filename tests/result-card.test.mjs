/** Shareable result card. The layout, truncation and spoiler rules are asserted here so
 * the canvas exporter can stay a dumb executor. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {CARD, composeResultCard, fit, resultCardInputFrom, resultCardText} from '../dist/src/result-card.js';
import {advanceToDecision, applyPlayerAction, createEncounter, starsForResult} from '../dist/src/engine.js';
import {buildEncounter} from '../dist/src/generate.js';
import {balancedParties} from '../dist/src/draft.js';

const base = {
  day: '2026-10-17', bossName: 'Storm Keeper', partyNames: ['The Warden', 'The Oracle', 'The Magus'],
  result: 'victory', stars: 3, heroActions: 17, tick: 72,
  bossHealthRemoved: 1, survivors: 3, itemsUsed: 0, url: 'dailybossbattle.example',
};

test('the card is square and every command lands inside it', () => {
  assert.equal(CARD.width, CARD.height, 'square shares without being re-cropped');
  for (const result of ['victory', 'defeat']) {
    for (const command of composeResultCard({...base, result, bossHealthRemoved: result === 'victory' ? 1 : 0.62})) {
      if (command.kind === 'panel' || command.kind === 'meter') {
        assert.ok(command.x >= 0 && command.x + command.width <= CARD.width, `${command.kind} overflows x`);
        assert.ok(command.y >= 0 && command.y + command.height <= CARD.height, `${command.kind} overflows y`);
      } else {
        assert.ok(command.x >= 0 && command.x <= CARD.width, `${command.kind} x=${command.x} off-card`);
        assert.ok(command.y >= 0 && command.y <= CARD.height, `${command.kind} y=${command.y} off-card`);
      }
    }
  }
});

test('a win and a loss are unmistakable and differently coloured', () => {
  const win = composeResultCard({...base, result: 'victory'});
  const loss = composeResultCard({...base, result: 'defeat', stars: 0, bossHealthRemoved: 0.4});
  const headline = commands => commands.find(c => c.kind === 'text' && (c.palette === 'win' || c.palette === 'loss'));
  assert.equal(headline(win).text, 'VICTORY');
  assert.equal(headline(win).palette, 'win');
  assert.equal(headline(loss).text, 'DEFEAT');
  assert.equal(headline(loss).palette, 'loss');
});

test('a loss reports how close it was; a win reports mastery', () => {
  const loss = composeResultCard({...base, result: 'defeat', stars: 0, bossHealthRemoved: 0.62});
  const meter = loss.find(c => c.kind === 'meter');
  assert.ok(meter, 'a loss shows the boss health that remained');
  assert.ok(Math.abs(meter.fraction - 0.38) < 0.001);
  assert.ok(loss.some(c => c.kind === 'text' && c.text.includes('38%')));

  const win = composeResultCard({...base, result: 'victory'});
  assert.equal(win.find(c => c.kind === 'meter'), undefined, 'a win has no health left to report');
  assert.ok(win.some(c => c.kind === 'text' && c.text.includes('survived')));
  assert.ok(win.some(c => c.kind === 'text' && c.text.includes('items')));
});

test('stars are rendered as a count, never baked into a string', () => {
  for (const stars of [0, 1, 2, 3]) {
    const command = composeResultCard({...base, stars}).find(c => c.kind === 'stars');
    assert.ok(command, 'a stars command is always present');
    assert.equal(command.filled, stars);
    assert.equal(command.total, 3);
  }
});

test('the card names the boss, the day and the party', () => {
  const commands = composeResultCard(base);
  const texts = commands.filter(c => c.kind === 'text').map(c => c.text);
  assert.ok(texts.includes('DAILY BOSS BATTLE'));
  assert.ok(texts.includes('2026-10-17'));
  assert.ok(texts.some(t => t.includes('STORM KEEPER')));
  for (const name of base.partyNames) assert.ok(texts.includes(name), `${name} missing`);
  assert.ok(texts.includes(base.url));
});

test('the card never leaks the winning line', () => {
  // Sharing a result must not hand someone the solution.
  const commands = composeResultCard(base);
  const blob = commands.filter(c => c.kind === 'text').map(c => c.text).join(' ').toLowerCase();
  for (const term of ['attack', 'volley', 'jump', 'cure', 'protect', 'focus', 'abilityid']) {
    assert.ok(!blob.includes(term), `card text mentions "${term}", which spoils the solution`);
  }
});

/** Conservative width estimate for a proportional face: enough to catch text that would
 * actually overflow, without pinning the test to one font. */
const estimatedWidth = command => command.text.length * command.size * 0.6;
const MARGIN = 24;

test('long names are truncated rather than overflowing', () => {
  // The ellipsis counts toward the budget, so the result is never longer than maxChars.
  assert.equal(fit('short', 10), 'short');
  assert.equal(fit('exceedingly long name', 8), 'exceedi…');
  assert.equal(fit('abc', 3), 'abc');
  assert.equal(fit('abcd', 3), 'ab…');
  for (const n of [1, 2, 3, 8, 20]) {
    assert.ok(fit('a'.repeat(50), n).length <= n, `fit overshot its budget at ${n}`);
  }

  const long = composeResultCard({
    ...base,
    bossName: 'The Extraordinarily Verbose Clockwork Emperor Of Considerable Length',
    partyNames: ['A Hero With An Unreasonably Long Name Indeed', 'B', 'C'],
  });
  for (const command of long.filter(c => c.kind === 'text')) {
    assert.ok(estimatedWidth(command) <= CARD.width - MARGIN,
      `"${command.text}" at ${command.size}px needs ~${Math.round(estimatedWidth(command))}px of ${CARD.width}`);
  }
});

test('every text command fits the card width at its own size', () => {
  for (const result of ['victory', 'defeat']) {
    const commands = composeResultCard({...base, result, stars: result === 'victory' ? 3 : 0,
      bossHealthRemoved: result === 'victory' ? 1 : 0.62, itemsUsed: 2, heroActions: 128, tick: 9999});
    for (const command of commands.filter(c => c.kind === 'text')) {
      assert.ok(estimatedWidth(command) <= CARD.width - MARGIN,
        `${result}: "${command.text}" needs ~${Math.round(estimatedWidth(command))}px`);
    }
  }
});

test('more than three party members cannot push content off the card', () => {
  const commands = composeResultCard({...base, partyNames: ['A', 'B', 'C', 'D', 'E', 'F']});
  const names = commands.filter(c => c.kind === 'text' && ['A', 'B', 'C', 'D', 'E', 'F'].includes(c.text));
  assert.equal(names.length, 3, 'only the party of three is drawn');
  for (const command of commands) assert.ok(command.y <= CARD.height);
});

test('composition is pure', () => {
  assert.deepEqual(composeResultCard(base), composeResultCard(base));
});

test('the url is optional', () => {
  const commands = composeResultCard({...base, url: undefined});
  assert.ok(commands.length > 0);
  assert.ok(!commands.some(c => c.kind === 'text' && c.text.includes('example')));
});

test('the text summary is short, spoiler-free and reflects the outcome', () => {
  const win = resultCardText(base);
  assert.ok(win.includes('2026-10-17'));
  assert.ok(win.includes('★★★'));
  assert.ok(win.includes('Storm Keeper'));
  assert.ok(win.split('\n').length <= 3, 'short enough to paste anywhere');

  const loss = resultCardText({...base, result: 'defeat', stars: 0, bossHealthRemoved: 0.62});
  assert.ok(loss.includes('☆☆☆'));
  assert.ok(loss.includes('38%'));
  for (const term of ['attack', 'volley', 'cure']) {
    assert.ok(!loss.toLowerCase().includes(term), `summary mentions "${term}"`);
  }
});

test('input is derived from a real finished battle', () => {
  const def = buildEncounter('tide_maw', balancedParties()[0]);
  let step = advanceToDecision(createEncounter(def), def);
  for (let n = 0; n < 80 && !step.terminal; n++) {
    step = applyPlayerAction(step.state,
      {actorId: step.readyHeroIds[0], abilityId: 'attack', targetIds: [def.bossId]}, def);
  }
  assert.ok(step.terminal, 'the battle finished');

  const input = resultCardInputFrom(step.state, {
    day: '2026-10-17',
    bossName: def.actors[def.bossId].name,
    partyNames: def.party.map(id => def.actors[id].name),
    stars: starsForResult(step.state),
  });
  assert.equal(input.result, step.terminal);
  assert.equal(input.heroActions, step.state.heroActionCount);
  assert.equal(input.tick, step.state.tick);
  assert.ok(input.bossHealthRemoved >= 0 && input.bossHealthRemoved <= 1);
  assert.ok(input.survivors >= 0 && input.survivors <= 3);
  assert.equal(input.url, undefined);
  // And it composes without overflowing.
  for (const command of composeResultCard(input)) assert.ok(command.y <= CARD.height);
});
