/** Static, player-facing descriptions of what an ability does.
 *
 * The game already describes abilities well -- `play-ui.ts` produces lines like "Next
 * offensive spell x2 (24 ticks)" and "Absorb the next eligible enemy spell and recover up
 * to 8 MP" -- but those live in the action preview, which `disclosure.actionPreview` turns
 * **off in Normal**. So a Normal player could never learn what Tri-Bolt or Nullify does,
 * in a battle or out of one, and the Codex listed ability *names* with nothing beside them.
 *
 * This is the reference half: identical on every day, in every mode, derived from the
 * ability record rather than written out, which is the property that keeps it from rotting
 * when a power value is tuned. It is reference, not prediction -- "150 power, 12 MP" is
 * manual-grade content, where "this will deal 143 to today's boss" is the preview Normal
 * withholds. See the header of `src/lore.ts` for where that line sits.
 *
 * A handful of mechanics cannot be read off the fields at all: that Nullify absorbs one
 * spell, that Focus doubles the next one, that Steal strengthens Plunder. Those get a
 * written `note`, and `MECHANIC_NOTES` is the complete list of them, so the derived text
 * stays derived and the exceptions stay visible.
 */
import type {Ability, AbilityKind} from './types.js';
import {STATUS_DISPLAY} from './status-display.js';

/** What each ability kind *is*, in a word a player can use. */
const KIND_WORD: Record<AbilityKind, string> = {
  physical: 'Weapon attack',
  magical: 'Spell',
  heal: 'Healing',
  status: 'Support',
  cover: 'Guard',
  focus: 'Preparation',
  item: 'Item',
  dispel: 'Dispel',
  steal: 'Theft',
  nullify: 'Ward',
  airborne: 'Leap',
};

/** Who an ability reaches, in the same phrasing the menu uses. */
const TARGET_WORD: Record<string, string> = {
  self: 'self',
  single_living_enemy: 'one enemy',
  all_living_enemies: 'all enemies',
  single_living_ally: 'one ally',
  all_living_allies: 'all allies',
  single_downed_ally: 'one fallen ally',
  any_single_ally: 'any ally',
};

/** Mechanics no field can express.
 *
 * Kept as an explicit table rather than scattered through the builder so the exceptions are
 * countable: everything else in a description is derived, and a reader can see at a glance
 * exactly how much of this file is hand-written. A test asserts every id here still exists.
 */
export const MECHANIC_NOTES: Record<string, string> = {
  focus: 'Doubles the damage of your next spell.',
  nullify: 'Absorbs the next enemy spell entirely and returns up to 8 MP.',
  steal: 'Takes one item, once per battle, and makes Plunder stronger.',
  plunder: 'Hits harder for every item stolen so far.',
  cover: 'Takes hits aimed at the protected ally until it expires.',
  defend: 'Halves incoming damage until this hero next acts.',
  combo_rush: 'Spends momentum, which builds as the Brawler acts.',
  jump: 'Leaves the ground: nothing aimed at the floor can reach the Lancer mid-air.',
  aim: 'Raises the accuracy and force of the shot that follows.',
  pray: 'Restores a little health to the whole party.',
};

/** Facts about one ability, each derived from a field.
 *
 * Returned as a list rather than a sentence so a renderer can lay them out as tags, a line,
 * or a table without this module deciding. */
export function abilityFacts(ability: Ability): string[] {
  const facts: string[] = [];
  const target = TARGET_WORD[ability.target] ?? ability.target;
  facts.push(`${KIND_WORD[ability.kind]} · ${target}`);
  if (ability.element) facts.push(`${ability.element} element`);
  if (ability.power !== undefined) {
    // Power, not damage. Damage depends on the attacker, the defender and the day, and
    // printing a number that looks like damage would be the preview Normal withholds.
    facts.push(`${ability.power} power${ability.hits && ability.hits > 1 ? ` x${ability.hits}` : ''}`);
  }
  if (ability.pierceDefensePercent) facts.push(`ignores ${ability.pierceDefensePercent}% defence`);
  if (ability.status) {
    // The status's own hint, not just its name. "Applies surge for 24 ticks" tells a player
    // nothing; "Surge for 24 ticks -- magical damage increased" tells them whether to cast
    // it. Taken from `status-display.ts` so the badge on the stage and the line in the
    // Codex cannot describe the same status differently.
    const display = STATUS_DISPLAY[ability.status];
    const label = display?.label ?? ability.status;
    const when = ability.duration ? ` for ${ability.duration} ticks` : '';
    facts.push(display ? `${label}${when} — ${display.hint.toLowerCase()}` : `${label}${when}`);
  }
  if (ability.removeStatus) {
    facts.push(`removes ${STATUS_DISPLAY[ability.removeStatus]?.label ?? ability.removeStatus}`);
  }
  if (ability.riderElement) facts.push(`adds ${ability.riderElement} to physical hits`);
  if (ability.delayTicks) facts.push(`lands ${ability.delayTicks} ticks later`);
  if (ability.mpCost) facts.push(`${ability.mpCost} MP`);
  if (ability.momentumCost) facts.push(`${ability.momentumCost} momentum`);
  if (ability.hpCost) facts.push(`costs ${ability.hpCost} HP`);
  if (ability.usesPerBattle) facts.push(`${ability.usesPerBattle} use per battle`);
  if (ability.interruptCast) facts.push('interrupts a boss cast');
  return facts;
}

/** The full reference entry: derived facts, plus a note when the mechanic needs one. */
export function describeAbility(ability: Ability): {facts: string[]; note?: string} {
  const note = MECHANIC_NOTES[ability.id];
  return note ? {facts: abilityFacts(ability), note} : {facts: abilityFacts(ability)};
}
