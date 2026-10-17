#!/usr/bin/env node
/** Playable terminal client. Zero dependencies — it needs only `npm run build`.
 *
 * This is a playtest harness for the real daily loop, not the shipping UI: it runs
 * the authoritative engine against the verified pool, shows the boss's announced
 * intent and countdown, and previews exact damage before you commit. Good enough to
 * answer "is this fight actually fun" long before the mobile client exists.
 *
 *   npm run play                 today's verified daily
 *   npm run play -- --day 2026-10-24
 *   npm run play -- --practice tide_maw
 *   npm run play -- --seed my-party     draft a party instead of using the pool
 */
import {createInterface} from 'node:readline/promises';
import {existsSync, readFileSync} from 'node:fs';
import {stdin, stdout} from 'node:process';
import {load, repoPath} from './load.mjs';

const {advanceToDecision, applyPlayerAction, createEncounter, nextBossCountdown, previewAction,
  replay, starsForResult} = await load('dist/src/engine.js');
const {availableActions, eligibleTargets, previewDisplay, actionInput} = await load('dist/src/play-ui.js');
const {choreograph, tweenValue} = await load('dist/src/presentation.js');
const {buildEncounter} = await load('dist/src/generate.js');
const {practiceEncounters} = await load('dist/src/encounters.js');
const {dailyEncounter, selectDaily, validatePool, targetTierFor} = await load('dist/src/pool.js');
const {draftParty} = await load('dist/src/draft.js');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const C = stdout.isTTY ? {
  dim: s => `\x1b[2m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m`,
  magenta: s => `\x1b[35m${s}\x1b[0m`,
} : Object.fromEntries(['dim', 'bold', 'red', 'green', 'yellow', 'cyan', 'magenta'].map(k => [k, s => s]));

// ---------------------------------------------------------------- encounter setup
const day = flag('--day', new Date().toISOString().slice(0, 10));
const practice = flag('--practice');
const seed = flag('--seed');
let def;
let header;

if (practice) {
  def = practiceEncounters[practice];
  if (!def) {
    console.error(`No practice encounter "${practice}". Available: ${Object.keys(practiceEncounters).join(', ')}`);
    process.exit(1);
  }
  header = `PRACTICE · ${practice}`;
} else if (seed) {
  const party = draftParty(seed);
  const bossId = flag('--boss', 'tide_maw');
  def = buildEncounter(bossId, party);
  header = `DRAFTED · seed "${seed}" · ${bossId}`;
} else {
  const poolPath = repoPath('dist-content/verified-pool.json');
  if (!existsSync(poolPath)) {
    console.error('No verified pool. Build one with:  npm run pool:build');
    console.error('Or play a practice encounter:       npm run play -- --practice tide_maw');
    process.exit(1);
  }
  const pool = validatePool(JSON.parse(readFileSync(poolPath, 'utf8')));
  const entry = selectDaily(day, pool);
  if (!entry) { console.error(`The pool has no encounter for ${day}.`); process.exit(1); }
  def = dailyEncounter(day, pool);
  header = `DAILY · ${day} · ${targetTierFor(day)} · verified ${entry.difficulty.bestActions} actions / `
    + `${entry.difficulty.distinctStrategies} strategies / ${entry.difficulty.marginPercent}% margin`;
}

// ---------------------------------------------------------------- rendering
const name = id => def.actors[id]?.name ?? id;
const bar = (value, max, width = 18) => {
  const filled = Math.max(0, Math.min(width, Math.round((width * value) / Math.max(1, max))));
  const ratio = value / Math.max(1, max);
  const paint = ratio <= 0.25 ? C.red : ratio <= 0.5 ? C.yellow : C.green;
  return paint('█'.repeat(filled)) + C.dim('░'.repeat(width - filled));
};
const statusList = actor => Object.keys(actor.statuses);

function render(state) {
  const boss = state.actors[state.bossId];
  const countdown = nextBossCountdown(state);
  console.log(`\n${C.dim('─'.repeat(74))}`);
  console.log(`${C.bold(name(state.bossId).toUpperCase())}   ${bar(boss.hp, boss.stats.hp, 28)} ` +
    `${boss.hp}/${boss.stats.hp}   ${C.dim(`phase ${state.phase}`)}`);
  const bossStatuses = statusList(boss);
  if (bossStatuses.length) console.log(`  ${C.dim('status:')} ${bossStatuses.join(', ')}`);

  if (countdown) {
    const ability = def.abilities[countdown.abilityId];
    const targets = (state.bossIntent?.targetIds ?? []).map(name).join(', ') || '—';
    const when = countdown.impactIn !== undefined
      ? C.red(`IMPACT in ${countdown.impactIn} ticks`)
      : countdown.readyIn === 0 ? C.red('ACTING NOW') : `ready in ${countdown.readyIn} ticks`;
    console.log(`  ${C.magenta('▶ ' + (ability?.name ?? countdown.abilityId))} → ${C.cyan(targets)}   ${when}`);
  }
  console.log(C.dim('─'.repeat(74)));
  for (const id of state.party) {
    const a = state.actors[id];
    const dead = a.hp === 0;
    const label = dead ? C.dim(`${name(id)} (KO)`) : name(id);
    const atb = a.ready ? C.green('READY') : a.channelingUntil !== null ? C.yellow('casting')
      : C.dim(`${Math.floor((100 * a.atb) / 1000)}%`);
    const extras = [
      a.stats.mp ? `MP ${a.mp}/${a.stats.mp}` : null,
      a.momentum ? `momentum ${a.momentum}` : null,
      statusList(a).length ? statusList(a).join('/') : null,
    ].filter(Boolean).join('  ');
    console.log(`  ${label.padEnd(24)} ${bar(a.hp, a.stats.hp)} ${String(a.hp).padStart(4)}/${a.stats.hp}` +
      `  ${atb.padEnd(16)} ${C.dim(extras)}`);
  }
  const inv = Object.entries(state.inventory).filter(([, n]) => n > 0).map(([k, n]) => `${k}×${n}`).join('  ');
  console.log(`  ${C.dim(`tick ${state.tick}   items: ${inv || 'none'}   actions taken: ${state.heroActionCount}`)}`);
}

// Choreography context: names and max HP let the shared presentation layer scale
// shake intensity and write readable text.
const names = Object.fromEntries(Object.entries(def.actors).map(([id, a]) => [id, a.name]));
const maxHp = Object.fromEntries(Object.entries(def.actors).map(([id, a]) => [id, a.stats.hp]));
const abilityNames = Object.fromEntries(Object.values(def.abilities).map(a => [a.id, a.name]));
const speed = Number(flag('--speed', '1')) || 1;
const instant = args.includes('--instant');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Plays a batch of engine events through the shared choreography layer, so the
 * terminal sees the same pacing a canvas renderer will. */
async function playBatch(events) {
  const script = choreograph(events, {names, maxHp, abilityNames, speed});
  if (!script.beats.length) return;
  // Attach each shake's intensity to the damage number it accompanies.
  for (const shake of script.beats.filter(b => b.kind === 'shake')) {
    const number = script.beats.find(b => b.kind === 'damage_number' && b.targetId === shake.targetId
      && Math.abs(b.at - shake.at) <= 1);
    if (number) number.intensity = shake.intensity;
  }
  if (instant) { for (const beat of script.beats) renderBeat(beat); return; }
  let elapsed = 0;
  for (const beat of script.beats) {
    if (beat.at > elapsed) { await sleep(beat.at - elapsed); elapsed = beat.at; }
    renderBeat(beat);
  }
  // Let the final beat breathe before the next menu appears.
  const tail = script.totalMs - elapsed;
  if (tail > 0) await sleep(Math.min(tail, 600));
}

function renderBeat(beat) {
  const who = name(beat.actorId ?? '');
  const target = name(beat.targetId ?? '');
  switch (beat.kind) {
    case 'actor_step': console.log(`   ${C.dim(`${who} steps forward`)}`); break;
    case 'cast': console.log(`   ${C.yellow(beat.text ?? `${who} begins casting`)}`); break;
    case 'telegraph': console.log(`   ${C.magenta(beat.text ?? '')}`); break;
    case 'damage_number': {
      // Shake is expressed as how far the number is kicked across the line.
      const kick = ' '.repeat(Math.round(6 * (beat.intensity ?? 0)));
      console.log(`   ${kick}${C.red(`-${beat.amount}`)} ${C.dim(`to ${target}`)}`);
      break;
    }
    case 'heal_number': console.log(`   ${C.green(`+${beat.amount}`)} ${C.dim(`to ${target}`)}`); break;
    case 'mp_change': console.log(`   ${C.cyan(`+${beat.amount} MP`)} ${C.dim(target)}`); break;
    case 'hp_change': {
      // Sample the eased tween so the drain is visible rather than instantaneous.
      const steps = instant ? 1 : 4;
      const frames = [];
      for (let i = 1; i <= steps; i++) {
        frames.push(Math.round(tweenValue(beat, beat.at + (beat.duration * i) / steps)));
      }
      console.log(`   ${C.dim(`${target}  ${beat.from} → ${frames.join(' → ')}`)}`);
      break;
    }
    case 'shake': break; // folded into the damage number's kick
    case 'flash': console.log(`   ${C.bold('*** FLASH ***')}`); break;
    case 'ko': console.log(`   ${C.red(beat.text ?? `${who} is down`)}`); break;
    case 'revive': console.log(`   ${C.green(beat.text ?? `${target} revives`)}`); break;
    case 'status_on': console.log(`   ${C.dim(beat.text ?? 'status applied')}`); break;
    case 'status_off': console.log(`   ${C.dim(beat.text ?? 'status ended')}`); break;
    case 'phase': console.log(`\n   ${C.magenta(C.bold(`** ${beat.text ?? 'the boss changes form'} **`))}\n`); break;
    case 'message': console.log(`   ${C.dim(beat.text ?? '')}`); break;
    case 'victory': console.log(`   ${C.green(C.bold('VICTORY'))}`); break;
    case 'defeat': console.log(`   ${C.red(C.bold('DEFEAT'))}`); break;
    default: break;
  }
}

/** Shake intensity lives on its own beat; fold it onto the matching number so the
 * terminal can express it as horizontal kick. */
function foldShake(script) { return script; }

// ---------------------------------------------------------------- game loop
const rl = createInterface({input: stdin, output: stdout});
// Treat end-of-input as "quit" so piped or scripted sessions exit cleanly.
let inputClosed = false;
rl.on('close', () => { inputClosed = true; });
const ask = async prompt => {
  if (inputClosed) return null;
  try {
    const line = await rl.question(prompt);
    return line === undefined ? null : line.trim();
  } catch { return null; }
};
let step = advanceToDecision(createEncounter(def), def);
const log = [];

console.log(`\n${C.bold('DAILY BOSS BATTLE')}   ${C.dim(header)}`);
console.log(C.dim(`party: ${def.party.map(name).join(' · ')}`));
if (def.enrage) console.log(C.dim(`enrage: boss damage rises after tick ${def.enrage.fromTick}`));

while (!step.terminal) {
  render(step.state);
  const actorId = step.readyHeroIds[0];
  const offered = availableActions(step.state, def, actorId).filter(o => o.enabled);
  console.log(`\n${C.bold(name(actorId))} is ready. Choose:`);
  offered.forEach((o, i) => {
    const cost = [o.ability.mpCost ? `${o.ability.mpCost} MP` : null,
      o.ability.momentumCost ? `${o.ability.momentumCost} momentum` : null,
      o.ability.usesPerBattle ? `${o.ability.usesPerBattle - (step.state.actors[actorId].abilityUses[o.ability.id] ?? 0)} left` : null,
    ].filter(Boolean).join(', ');
    console.log(`  ${String(i + 1).padStart(2)}. ${o.ability.name.padEnd(22)} ${C.dim(`${o.group}${cost ? ` · ${cost}` : ''}`)}`);
  });
  console.log(`   ${C.dim('p <n> = preview, q = quit')}`);

  const answer = await ask('> ');
  if (answer === null || answer === 'q') { console.log('\nAbandoned. No result recorded.'); break; }

  const previewMatch = answer.match(/^p\s*(\d+)$/);
  const index = Number(previewMatch ? previewMatch[1] : answer) - 1;
  const chosen = offered[index];
  if (!chosen) { console.log(C.yellow('  not a valid choice')); continue; }

  // Pick a target when the ability admits more than one.
  let targetId;
  const choices = eligibleTargets(step.state, actorId, chosen.ability);
  const isGroup = chosen.ability.target.startsWith('all_');
  if (!isGroup && choices.length > 1) {
    console.log(`  target: ${choices.map((id, i) => `${i + 1}=${name(id)}`).join('  ')}`);
    const reply = await ask('  target > ');
    if (reply === null) { console.log('\nAbandoned. No result recorded.'); break; }
    targetId = choices[Number(reply) - 1] ?? choices[0];
  }
  const input = actionInput(step.state, actorId, chosen.ability, targetId);

  if (previewMatch) {
    const preview = previewAction(step.state, input, def);
    const shown = previewDisplay(step.state, def, input, preview);
    console.log(`  ${C.cyan('preview')} → ${shown.targetNames.join(', ') || 'self'}`);
    for (const line of shown.lines) console.log(`    ${line}`);
    continue;
  }

  log.push(input);
  const before = step.state.events.length;
  step = applyPlayerAction(step.state, input, def);
  await playBatch(step.state.events.slice(before));
}

rl.close();

if (step.terminal) {
  render(step.state);
  const stars = starsForResult(step.state);
  console.log(`\n${step.terminal === 'victory' ? C.green(C.bold('VICTORY')) : C.red(C.bold('DEFEAT'))}` +
    `   ${'★'.repeat(stars)}${C.dim('☆'.repeat(3 - stars))}   ` +
    `${step.state.heroActionCount} actions, tick ${step.state.tick}, ${step.state.itemUses} items used`);
  // The action log is the authoritative record, so prove it reproduces this exact result.
  const verified = replay(def, log).state;
  const ok = verified.result === step.state.result && verified.tick === step.state.tick;
  console.log(C.dim(`  action log replays identically: ${ok ? 'yes' : 'NO — this is a bug'}`));
  if (!ok) process.exitCode = 1;
}
