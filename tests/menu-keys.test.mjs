/** Arrow-key navigation for the command menu.
 *
 * Driven with a fake container rather than a DOM, which is why `handleMenuKey` takes the
 * container as an argument instead of reaching for one: the suite has no browser, and a
 * behaviour this easy to get subtly wrong -- wrapping, disabled entries, modifier keys --
 * is worth testing rather than eyeballing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMenuKey} from '../web/src/menu-keys.ts';

/** A container of fake buttons that records which one has focus. */
const fakeMenu = (labels, {focused = null} = {}) => {
  const doc = {activeElement: null, body: {}};
  const items = labels.map(label => {
    const disabled = label.startsWith('!');
    const el = {
      label: disabled ? label.slice(1) : label,
      disabled,
      focus() { doc.activeElement = el; },
    };
    return el;
  });
  doc.activeElement = focused === null ? null : items[focused];
  return {
    ownerDocument: doc,
    items,
    get focusedLabel() { return doc.activeElement?.label ?? null; },
    // Mirrors `[data-menu-item]:not([disabled])`.
    querySelectorAll: () => items.filter(i => !i.disabled),
  };
};

const press = (menu, key, options) => handleMenuKey({key, ...options?.event}, menu, options);

test('ArrowDown moves to the next entry and ArrowUp to the previous', () => {
  const menu = fakeMenu(['Attack', 'Magic', 'Item'], {focused: 0});
  assert.equal(press(menu, 'ArrowDown'), true, 'the key should be consumed');
  assert.equal(menu.focusedLabel, 'Magic');
  press(menu, 'ArrowDown');
  assert.equal(menu.focusedLabel, 'Item');
  press(menu, 'ArrowUp');
  assert.equal(menu.focusedLabel, 'Magic');
});

test('movement wraps at both ends', () => {
  // A fixed list of commands has no edges worth hitting, which is how the genre behaves.
  const menu = fakeMenu(['Attack', 'Magic', 'Item'], {focused: 2});
  press(menu, 'ArrowDown');
  assert.equal(menu.focusedLabel, 'Attack');
  press(menu, 'ArrowUp');
  assert.equal(menu.focusedLabel, 'Item');
});

test('disabled entries are skipped, not stopped on', () => {
  // Stopping on five unaffordable abilities to reach the sixth is the problem being solved.
  const menu = fakeMenu(['Attack', '!Magic', '!Item', 'Guard'], {focused: 0});
  press(menu, 'ArrowDown');
  assert.equal(menu.focusedLabel, 'Guard');
});

test('Home and End jump to the ends', () => {
  const menu = fakeMenu(['Attack', 'Magic', 'Item'], {focused: 1});
  press(menu, 'End');
  assert.equal(menu.focusedLabel, 'Item');
  press(menu, 'Home');
  assert.equal(menu.focusedLabel, 'Attack');
});

test('with nothing focused, down enters at the top and up at the bottom', () => {
  const down = fakeMenu(['Attack', 'Magic'], {focused: null});
  press(down, 'ArrowDown');
  assert.equal(down.focusedLabel, 'Attack');
  const up = fakeMenu(['Attack', 'Magic'], {focused: null});
  press(up, 'ArrowUp');
  assert.equal(up.focusedLabel, 'Magic');
});

test('Left and Right move only when the panel is horizontal', () => {
  const vertical = fakeMenu(['Attack', 'Magic'], {focused: 0});
  assert.equal(press(vertical, 'ArrowRight'), false, 'a vertical list must not claim Right');
  assert.equal(vertical.focusedLabel, 'Attack');
  const row = fakeMenu(['All', 'Heals'], {focused: 0});
  assert.equal(press(row, 'ArrowRight', {horizontal: true}), true);
  assert.equal(row.focusedLabel, 'Heals');
});

test('Escape calls back, and does nothing when there is nowhere to go', () => {
  let backs = 0;
  const menu = fakeMenu(['Attack'], {focused: 0});
  assert.equal(press(menu, 'Escape', {onBack: () => { backs++; }}), true);
  assert.equal(backs, 1);
  assert.equal(press(menu, 'Escape'), false, 'Escape with no handler must not be swallowed');
});

test('a modified arrow key is left to the browser', () => {
  // Ctrl+Left is "back" and Cmd+Arrow is line-start on a Mac. A game menu has no business
  // claiming either, and swallowing them is the kind of thing that is only noticed as a
  // vague sense that the page is broken.
  const menu = fakeMenu(['Attack', 'Magic'], {focused: 0});
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(press(menu, 'ArrowDown', {event: {[modifier]: true}}), false, modifier);
    assert.equal(menu.focusedLabel, 'Attack', `${modifier} moved the cursor`);
  }
});

test('keys the menu does not handle are not consumed', () => {
  // Enter and Space are the browser's job on a real <button>, and typing must reach inputs.
  const menu = fakeMenu(['Attack'], {focused: 0});
  for (const key of ['Enter', ' ', 'Tab', 'a', 'PageDown']) {
    assert.equal(press(menu, key), false, `${key} should pass through`);
  }
});

test('an empty or absent panel is handled without throwing', () => {
  assert.equal(handleMenuKey({key: 'ArrowDown'}, null), false);
  assert.equal(press(fakeMenu([], {focused: null}), 'ArrowDown'), false);
});
