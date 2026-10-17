export type ActorId = string;
export type ItemId = 'potion' | 'mana_vial' | 'revive_tonic';
/** How much the interface tells the player. Deliberately *only* an interface setting:
 * the encounter, the engine and the action log are identical in both, so a replay still
 * verifies and the verified pool stays valid. Easy reveals information; it does not make
 * the fight weaker. */
export type BattleMode = 'easy' | 'normal';

export type StatusId = 'protect' | 'shell' | 'haste' | 'slow' | 'poison' | 'silence' | 'defend' | 'focus' | 'elemental_edge' | 'surge' | 'nullify' | 'airborne';
export type Element = 'neutral' | 'fire' | 'ice' | 'lightning' | 'holy' | 'dark';
export type Affinity = 'neutral' | 'weak' | 'resist' | 'immune';
export type TargetRule = 'self' | 'single_living_ally' | 'single_other_ally' | 'single_ko_ally' | 'all_living_allies' | 'single_living_enemy' | 'all_living_enemies';
export type AbilityKind = 'physical' | 'magical' | 'heal' | 'status' | 'cover' | 'focus' | 'item' | 'dispel' | 'steal' | 'nullify' | 'airborne';
export type Stats = { hp:number; mp:number; attack:number; defense:number; magic:number; resistance:number; speed:number };
export type Ability = {
  id:string; name:string; owner:'any_hero' | ActorId;
  kind:AbilityKind; target:TargetRule; power?:number; element?:Element;
  mpCost?:number; momentumCost?:number; momentumGain?:number;
  status?:StatusId; duration?:number; delayTicks?:number; item?:ItemId; removeStatus?:StatusId;
  // Optional, reusable command effects (absent for legacy encounters).
  pierceDefensePercent?:number; hits?:number; hpCost?:number; usesPerBattle?:number;
  interruptCast?:boolean; stealItem?:ItemId; stealsScalingPower?:number;
  groundOnly?:boolean; airborneDuringDelay?:boolean;
  /** For a status ability: the element its rider applies to later physical hits. */
  riderElement?:Element;
};
export type BossProgram = { phaseOne:string[]; phaseOneRepeat:string[]; phaseTwo:string[]; phaseTwoRepeat:string[]; transitionPercent:number;
  /** Used when the scripted ability is unaffordable. Content-owned; the engine has no default. */
  fallbackAbility?:string };
/** Pressure curve that makes stalling lose. Boss outgoing damage scales once `fromTick` passes.
 * Absent on an encounter means no enrage, so existing content is unaffected. */
export type EnrageConfig = { fromTick:number; stepTicks:number; percentPerStep:number; maxPercent:number };
export type BossTargetSelector =
  | {kind:'random_slot'}
  | {kind:'fixed_slot';slot:number}
  | {kind:'sequential_slots';slots:number[]}
  | {kind:'last_attacker'}
  | {kind:'lowest_defense'}
  | {kind:'lowest_hp'}
  | {kind:'highest_attack'}
  | {kind:'highest_magic'}
  | {kind:'all_party'}
  | {kind:'self'}
  | {kind:'status_holder';status:StatusId};
export type BossCounterRule = {
  id:string;when:'damaged';abilityId:string;target:BossTargetSelector;
  minDamage?:number;phase?:1|2;oncePerBattle?:boolean;cooldownBossActions?:number;
};
export type BossOverrideRule = {
  id:string;when:{kind:'status_present';status:StatusId;side:'heroes'|'boss'};
  abilityId:string;target:BossTargetSelector;phase?:1|2;
  oncePerBattle?:boolean;cooldownBossActions?:number;
};
export type BossAIConfig = {
  seed:number;defaultTarget:BossTargetSelector;fallbackAbility?:string;
  targetRules?:Record<string,BossTargetSelector>;
  counters?:BossCounterRule[];overrides?:BossOverrideRule[];
};
export type PendingBossCounter = {ruleId:string;attackerId:ActorId};
export type BossAIRuntime = {
  lastAttackerId:ActorId|null;pendingCounters:PendingBossCounter[];
  usedRules:Record<string,number>;slotCursors:Record<string,number>;
};
export type EncounterDefinition = {
  id:string; engineVersion:string; contentVersion:string;
  party:ActorId[]; bossId:ActorId;
  actors: Record<ActorId, {name:string; stats:Stats;
    /** Max momentum this actor can bank. 0/absent means it never gains momentum. */
    momentumCap?:number}>;
  abilities: Record<string, Ability>;
  inventory:Record<ItemId,number>;
  affinities?:Record<string,Partial<Record<Element,Affinity>>>;
  bossProgram:BossProgram;
  bossAI?:BossAIConfig;
  enrage?:EnrageConfig;
  maxTicks:number;
};
export type ActiveStatus = {expiresAt:number; nextPulseAt?:number; element?:Element};
export type ActorState = {
  id:ActorId; team:'heroes'|'boss'; stats:Stats; hp:number; mp:number;
  atb:number; ready:boolean; availableFrom:number; channelingUntil:number|null;
  momentum:number; steals:number; abilityUses:Record<string,number>; statuses:Partial<Record<StatusId,ActiveStatus>>;
};
export type BossIntent = { abilityId:string; targetIds:ActorId[]; selectedAt:number; phase:1|2;
  origin?:'script'|'counter'|'override';ruleId?:string;targetDescription?:string;selector?:BossTargetSelector;
};
export type PendingImpact = { at:number; sequence:number; actorId:ActorId; abilityId:string; targetIds:ActorId[] };
export type Cover = {guardianId:ActorId; protectedId:ActorId; expiresAt:number};
export type BattleEvent = {
  tick:number; type:string; actorId?:ActorId; abilityId?:string;
  targetId?:ActorId; amount?:number; details?:string; hpAfter?:number;
  /** Which status a status_applied / status_expired / status_removed event concerns.
   * `details` carries the human-readable form; this is the machine-readable one, so a
   * renderer can show the right badge without parsing prose. */
  status?:StatusId;
};
export type BattleState = {
  encounterId:string; engineVersion:string; contentVersion:string;
  tick:number; actors:Record<ActorId,ActorState>; party:ActorId[]; bossId:ActorId;
  inventory:Record<ItemId,number>; covers:Cover[];
  phase:1|2; phaseOneCount:number; phaseTwoCount:number;
  bossIntent:BossIntent|null; pending:PendingImpact[]; nextSequence:number;
  bossAI?:BossAIRuntime;
  result:'victory'|'defeat'|null; heroActionCount:number; bossActionCount:number;
  events:BattleEvent[]; itemUses:number;
};
export type BattleInput = {actorId:ActorId; abilityId:string; targetIds:ActorId[]};
export type BattleStep = {state:BattleState; events:BattleEvent[]; needsPlayerInput:boolean; readyHeroIds:ActorId[]; terminal:BattleState['result']};
export type ActionPreview = {actorId:string; abilityId:string; tick:number; resolvesAt:number;
  events:BattleEvent[]; mpCost:number; momentumCost:number; itemCost:ItemId|null;
  causesPhaseChange:boolean; possibleConditionalOutcome:boolean};
