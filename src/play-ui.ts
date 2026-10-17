import {calculateDamage, previewAction} from './engine.js';
import type {Ability, ActorId, BattleInput, BattleState, EncounterDefinition, ActionPreview, BattleEvent} from './types.js';

export type AbilityGroup = 'Attack' | 'Special' | 'Magic' | 'Item' | 'Defend';
export type OfferedAction = {
  ability: Ability;
  group: AbilityGroup;
  choices: ActorId[];
  targetIds: ActorId[];
  enabled: boolean;
  unavailableReason: string | null;
};

export function abilityGroup(ability: Ability): AbilityGroup {
  if (ability.id === 'attack') return 'Attack';
  if (ability.id === 'defend') return 'Defend';
  if (['pray','elemental_edge'].includes(ability.id)) return 'Special';
  if (ability.kind === 'item') return 'Item';
  if (['magical', 'heal'].includes(ability.kind) || (ability.kind === 'status' && ability.mpCost)) return 'Magic';
  return 'Special';
}
export function eligibleTargets(state: BattleState, actorId: ActorId, ability: Ability): ActorId[] {
  const actor = state.actors[actorId];
  if (!actor) return [];
  const allies = actor.team === 'heroes' ? state.party : [state.bossId];
  const opponents = actor.team === 'heroes' ? [state.bossId] : state.party;
  const living = (id: string) => (state.actors[id]?.hp ?? 0) > 0;
  switch (ability.target) {
    case 'self': return [actorId];
    case 'single_living_ally': return allies.filter(living);
    case 'single_other_ally': return allies.filter(id => id !== actorId && living(id));
    case 'single_ko_ally': return allies.filter(id => !living(id));
    case 'single_living_enemy': return opponents.filter(living);
    case 'all_living_allies': return allies.filter(living);
    case 'all_living_enemies': return opponents.filter(living);
  }
}
export function actionInput(state: BattleState, actorId: ActorId, ability: Ability, selected?: ActorId): BattleInput {
  const choices = eligibleTargets(state, actorId, ability);
  const isGroup = ability.target === 'all_living_allies' || ability.target === 'all_living_enemies';
  if (isGroup) return {actorId, abilityId: ability.id, targetIds: []};
  const target = choices.includes(selected ?? '') ? selected! : choices[0];
  return {actorId, abilityId: ability.id, targetIds: target ? [target] : []};
}
export function availableActions(state: BattleState, def: EncounterDefinition, heroId: ActorId): OfferedAction[] {
  const result: OfferedAction[] = [];
  for (const ability of Object.values(def.abilities)) {
    if (ability.owner !== heroId && ability.owner !== 'any_hero') continue;
    const choices = eligibleTargets(state, heroId, ability);
    const input = actionInput(state, heroId, ability);
    let reason: string | null = null;
    try {previewAction(state, input, def);} catch (error) {
      reason = error instanceof Error ? error.message : 'Action unavailable';
    }
    result.push({ability, group: abilityGroup(ability), choices, targetIds: input.targetIds, enabled: reason === null, unavailableReason: reason});
  }
  const order: AbilityGroup[] = ['Attack', 'Special', 'Magic', 'Item', 'Defend'];
  return result.sort((a,b) => order.indexOf(a.group) - order.indexOf(b.group));
}
export type PreviewDisplay = {lines: string[]; targetNames: string[]; approximate: boolean};
export function previewDisplay(state: BattleState, def: EncounterDefinition, input: BattleInput, preview: ActionPreview): PreviewDisplay {
  const ability = def.abilities[input.abilityId]!;
  const resolvedTargetIds = (ability.target === 'all_living_enemies' || ability.target === 'all_living_allies')
    ? eligibleTargets(state, input.actorId, ability) : input.targetIds;
  const targetNames = resolvedTargetIds.map(id => def.actors[id]?.name ?? id);
  const lines: string[] = [];
  const effects: BattleEvent[] = preview.events.filter(e => ['damage','heal','mp_restored','revived','cover_set','status_applied','steal_success','nullify_absorb','boss_interrupted'].includes(e.type));
  for (const e of effects) {
    const target = def.actors[e.targetId ?? e.actorId ?? '']?.name ?? 'Target';
    if (e.type === 'damage') lines.push(`${target}: −${e.amount} HP`);
    else if (e.type === 'heal') lines.push(`${target}: +${e.amount} HP`);
    else if (e.type === 'mp_restored') lines.push(`${target}: +${e.amount} MP`);
    else if (e.type === 'revived') lines.push(`${target}: revived`);
    else if (e.type === 'cover_set') lines.push(`Cover ${target}`);
    else if (e.type === 'status_applied') lines.push(`${e.details ?? 'Status applied'}`);
    else if (e.type === 'steal_success') lines.push(`Steal ${e.details} — +1 item`);
    else if (e.type === 'nullify_absorb') lines.push(`Nullify absorbed spell; +${e.amount} MP`);
    else if (e.type === 'boss_interrupted') lines.push('Boss cast interrupted');
  }
  if (ability.delayTicks && (ability.kind === 'physical' || ability.kind === 'magical')) {
    lines.push(...resolvedTargetIds.map(id => `Up to ${Math.min(state.actors[id]!.hp,calculateDamage(def,state.actors[input.actorId]!,state.actors[id]!,ability))} damage to ${def.actors[id]!.name} (current-state estimate)`));
    lines.push(`Lands at tick ${preview.resolvesAt}; target/state may change`);
  }
  const changed=preview.events.find(e=>e.type==='boss_intent_changed');
  if(changed)lines.push(`Boss reacts: ${def.abilities[changed.abilityId??'']?.name??changed.abilityId} now announced`);
  if (!lines.length) {
    if (ability.id === 'focus') lines.push('Next offensive spell ×2 (24 ticks)');
    else if (ability.id === 'defend') lines.push('Incoming damage ×0.5 until next action');
    else if (ability.id === 'nullify') lines.push('Absorb the next eligible enemy spell and recover up to 8 MP');
    else if (ability.id === 'steal') lines.push('Gain one Potion (once per battle); strengthen Plunder');
    else lines.push('Effect resolves immediately');
  }
  return {lines, targetNames, approximate: !!ability.delayTicks};
}
