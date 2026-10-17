/** Shareable result card composition.
 *
 * Produces a flat list of draw commands for a square image summarising a day's battle.
 * Pure and renderer-agnostic for the same reason as `stage.ts`: the layout, wrapping and
 * truncation are the fiddly parts, and they are testable without a canvas.
 *
 * Deliberately spoiler-light. It reports the outcome, mastery and effort, never the
 * winning line, so sharing a result cannot hand someone else the solution.
 */
import type {BattleState} from './types.js';

/** Square: shares cleanly to chat apps and social without being re-cropped. */
export const CARD = {width: 600, height: 600} as const;

export type CardCommand =
  | {kind: 'panel'; x: number; y: number; width: number; height: number; palette: 'frame' | 'inset'}
  | {kind: 'text'; x: number; y: number; text: string; size: number;
     align: 'left' | 'center' | 'right'; palette: 'title' | 'body' | 'muted' | 'win' | 'loss' | 'star'}
  | {kind: 'stars'; x: number; y: number; filled: number; total: number; size: number}
  | {kind: 'meter'; x: number; y: number; width: number; height: number; fraction: number};

export type ResultCardInput = {
  day: string;
  bossName: string;
  /** Hero display names, in party order. */
  partyNames: string[];
  result: 'victory' | 'defeat';
  stars: number;
  heroActions: number;
  tick: number;
  /** Fraction of the boss's health removed, 0..1. Shown when the battle was lost. */
  bossHealthRemoved: number;
  survivors: number;
  itemsUsed: number;
  /** Appears at the foot of the card. */
  url?: string;
};

/** Builds the input from a finished battle state, so callers cannot disagree on the
 * numbers that get shared. */
export function resultCardInputFrom(
  state: BattleState,
  options: {day: string; bossName: string; partyNames: string[]; stars: number; url?: string},
): ResultCardInput {
  const boss = state.actors[state.bossId];
  const maxHp = boss?.stats.hp ?? 1;
  const removed = Math.max(0, Math.min(1, (maxHp - (boss?.hp ?? 0)) / maxHp));
  return {
    day: options.day,
    bossName: options.bossName,
    partyNames: options.partyNames,
    result: state.result === 'victory' ? 'victory' : 'defeat',
    stars: options.stars,
    heroActions: state.heroActionCount,
    tick: state.tick,
    bossHealthRemoved: removed,
    survivors: state.party.filter(id => (state.actors[id]?.hp ?? 0) > 0).length,
    itemsUsed: state.itemUses,
    url: options.url,
  };
}

/** Truncates with an ellipsis so a long name can never overflow the card. */
export function fit(text: string, maxChars: number): string {
  if (maxChars <= 1) return text.slice(0, Math.max(0, maxChars));
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

export function composeResultCard(input: ResultCardInput): CardCommand[] {
  const commands: CardCommand[] = [];
  const centre = CARD.width / 2;
  const won = input.result === 'victory';

  commands.push({kind: 'panel', x: 0, y: 0, width: CARD.width, height: CARD.height, palette: 'frame'});

  commands.push({kind: 'text', x: centre, y: 72, text: 'DAILY BOSS BATTLE',
    size: 30, align: 'center', palette: 'title'});
  commands.push({kind: 'text', x: centre, y: 104, text: input.day,
    size: 18, align: 'center', palette: 'muted'});

  commands.push({kind: 'panel', x: 48, y: 140, width: CARD.width - 96, height: 150, palette: 'inset'});
  commands.push({kind: 'text', x: centre, y: 186, text: won ? 'VICTORY' : 'DEFEAT',
    size: 46, align: 'center', palette: won ? 'win' : 'loss'});
  commands.push({kind: 'text', x: centre, y: 224, text: fit(input.bossName.toUpperCase(), 28),
    size: 22, align: 'center', palette: 'body'});
  commands.push({kind: 'stars', x: centre, y: 262, filled: input.stars, total: 3, size: 30});

  // Lost battles report how close it was; won battles report mastery instead.
  let y = 334;
  if (won) {
    commands.push({kind: 'text', x: centre, y, text:
      `${input.heroActions} actions · ${input.survivors}/3 survived · ${input.itemsUsed} items`,
      size: 19, align: 'center', palette: 'body'});
  } else {
    const percent = Math.round(input.bossHealthRemoved * 100);
    commands.push({kind: 'text', x: centre, y, text: `boss brought to ${100 - percent}% in ${input.heroActions} actions`,
      size: 19, align: 'center', palette: 'body'});
    commands.push({kind: 'meter', x: 120, y: y + 18, width: CARD.width - 240, height: 14,
      fraction: 1 - input.bossHealthRemoved});
    y += 34;
  }

  y += 54;
  commands.push({kind: 'text', x: centre, y, text: 'PARTY', size: 15, align: 'center', palette: 'muted'});
  y += 30;
  for (const name of input.partyNames.slice(0, 3)) {
    commands.push({kind: 'text', x: centre, y, text: fit(name, 30), size: 20, align: 'center', palette: 'body'});
    y += 30;
  }

  if (input.url) {
    commands.push({kind: 'text', x: centre, y: CARD.height - 34, text: input.url,
      size: 16, align: 'center', palette: 'muted'});
  }
  return commands;
}

/** A compact text summary, for clipboards and chat apps that strip images.
 * Spoiler-free by the same rule as the card. */
export function resultCardText(input: ResultCardInput): string {
  const stars = '★'.repeat(input.stars) + '☆'.repeat(Math.max(0, 3 - input.stars));
  const headline = input.result === 'victory'
    ? `beat ${input.bossName} in ${input.heroActions} actions`
    : `fell to ${input.bossName}, brought it to ${100 - Math.round(input.bossHealthRemoved * 100)}%`;
  return [
    `Daily Boss Battle ${input.day}`,
    `${stars} ${headline}`,
    input.url ?? '',
  ].filter(Boolean).join('\n');
}
