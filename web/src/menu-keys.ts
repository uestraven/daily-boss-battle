/** Arrow-key navigation for the command menu, the way a 16-bit JRPG works.
 *
 * The menu was already operable by keyboard -- every entry is a real `<button>`, so Tab
 * reaches it and Enter presses it, and `style.css` gives it a visible `:focus-visible`
 * ring. What it lacked was the *expected* keyboard: arrows to move, Escape to back out.
 * Tabbing through nine ability buttons to reach the ninth is nobody's idea of a battle
 * menu, and a player who grew up on this genre reaches for the arrow keys first.
 *
 * Roving DOM focus rather than a JS-tracked index. Two reasons: a screen reader follows
 * real focus and announces each entry as it is reached, which a tracked index would leave
 * silent; and Enter then needs no handling of its own, because the focused button is the
 * one the browser already activates.
 *
 * Items opt in with `data-menu-item`, so a panel decides what is navigable without this
 * module knowing anything about abilities or targets.
 */

/** The navigable entries of a panel, in document order, skipping disabled ones.
 *
 * Disabled entries are skipped rather than focused-and-announced: an unaffordable ability
 * is already dimmed and carries its reason, and stopping on five of them to reach the sixth
 * is the problem this is solving, not a feature. */
const itemsOf = (container: any): any[] =>
  Array.prototype.slice.call(
    container.querySelectorAll('[data-menu-item]:not([disabled]):not([aria-disabled="true"])'),
  );

export type MenuKeyOptions = {
  /** Escape, or Left/Backspace at the top level. Omitted, Escape does nothing. */
  onBack?: () => void;
  /** Treat Left and Right as movement too. Off for a vertical list, on for a filter row. */
  horizontal?: boolean;
};

/** Handles one keydown for a panel. Returns true when the key was consumed.
 *
 * Pure apart from the focus call, so the wiring below stays a one-liner and the behaviour
 * can be reasoned about -- and so a test could drive it with a fake container. */
export function handleMenuKey(event: any, container: any, options: MenuKeyOptions = {}): boolean {
  if (!container) return false;
  // Never swallow a modified key: Ctrl+Left is "back" in a browser and Cmd+Arrow is
  // line-start on a Mac. A game menu has no business claiming either.
  if (event.ctrlKey || event.metaKey || event.altKey) return false;

  const key = event.key;
  if (key === 'Escape' && options.onBack) {
    options.onBack();
    return true;
  }

  const forward = key === 'ArrowDown' || (options.horizontal && key === 'ArrowRight');
  const back = key === 'ArrowUp' || (options.horizontal && key === 'ArrowLeft');
  const first = key === 'Home';
  const last = key === 'End';
  if (!forward && !back && !first && !last) return false;

  const items = itemsOf(container);
  if (items.length === 0) return false;

  const current = items.indexOf(container.ownerDocument?.activeElement);
  let next: number;
  if (first) next = 0;
  else if (last) next = items.length - 1;
  // Wrapping, because a fixed list of commands has no edges worth hitting: pressing down on
  // the last ability should land on the first, as it does in the games this imitates.
  else if (current < 0) next = forward ? 0 : items.length - 1;
  else next = (current + (forward ? 1 : -1) + items.length) % items.length;

  items[next]?.focus();
  return true;
}

/** Moves focus to a panel's first entry, but only if focus was already inside it.
 *
 * The guard is the whole point. Focusing on every panel change would hijack a mouse user
 * mid-click and scroll a phone to the menu, so this only acts for someone already
 * navigating by keyboard: when a group opens, their focus should follow into it rather than
 * being dropped back to the top of the document. */
export function focusFirstItemIfNavigating(container: any): void {
  if (!container) return;
  const active = container.ownerDocument?.activeElement;
  // `contains` covers the case that matters: the button just pressed to open this panel was
  // itself inside it, so focus is still here and should follow the player inward.
  if (!active || !container.contains?.(active)) return;
  itemsOf(container)[0]?.focus();
}
