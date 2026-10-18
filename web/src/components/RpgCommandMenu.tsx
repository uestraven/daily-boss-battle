import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { AbilityGroup, OfferedAction } from '../../../src/play-ui.js';
import type { ActorId, BattleState } from '../../../src/types.js';

const groups: AbilityGroup[] = ['Attack', 'Ability', 'Magic', 'Item', 'Defend'];

type Props = {
  actorId: ActorId;
  actions: OfferedAction[];
  state: BattleState;
  selectedAbilityId?: string;
  onChooseAbility: (abilityId: string) => void;
};

export function RpgCommandMenu({ actorId, actions, state, selectedAbilityId, onChooseAbility }: Props) {
  const [openGroup, setOpenGroup] = useState<AbilityGroup | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusAfterSwitch = useRef(false);

  // A new actor or completed turn always begins at the top-level command menu.
  useEffect(() => {
    setOpenGroup(null);
  }, [actorId, state.heroActionCount]);

  useEffect(() => {
    if (!focusAfterSwitch.current) return;
    focusAfterSwitch.current = false;
    menuRef.current?.querySelector<HTMLButtonElement>('[data-rpg-choice]:not(:disabled)')?.focus();
  }, [openGroup]);

  const visibleGroups = groups.filter(group => actions.some(action => action.group === group));
  const submenuActions = openGroup ? actions.filter(action => action.group === openGroup) : [];

  function switchMenu(nextGroup: AbilityGroup | null) {
    focusAfterSwitch.current = true;
    setOpenGroup(nextGroup);
  }

  function selectGroup(group: AbilityGroup) {
    const choices = actions.filter(action => action.group === group);
    const firstAvailable = choices.find(action => action.enabled);
    if (group === 'Attack' || group === 'Defend') {
      if (firstAvailable) onChooseAbility(firstAvailable.ability.id);
      return;
    }
    switchMenu(group);
    // Selecting a submenu also updates the existing forecast to its first usable action.
    if (firstAvailable) onChooseAbility(firstAvailable.ability.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.key === 'Escape' || event.key === 'Backspace') && openGroup) {
      event.preventDefault();
      switchMenu(null);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const choices = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-rpg-choice]:not(:disabled)') ?? []);
    if (!choices.length) return;
    event.preventDefault();
    const current = choices.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next = current < 0 ? 0 : (current + delta + choices.length) % choices.length;
    choices[next]?.focus();
  }

  function costText(action: OfferedAction): string {
    const ability = action.ability;
    if (ability.mpCost) return `${ability.mpCost} MP`;
    if (ability.momentumCost) return `${ability.momentumCost} MOM`;
    if (ability.item) return `×${state.inventory[ability.item] ?? 0}`;
    if (ability.usesPerBattle) {
      const used = state.actors[actorId]?.abilityUses[ability.id] ?? 0;
      return `${Math.max(0, ability.usesPerBattle - used)} LEFT`;
    }
    return '';
  }

  return (
    <div className="rpg-command-menu" ref={menuRef} onKeyDown={handleKeyDown} role="group" aria-label="Battle commands">
      <div className="rpg-menu-title" aria-live="polite">
        {openGroup ? `${openGroup.toUpperCase()} COMMANDS` : 'COMMAND'}
      </div>
      {openGroup === null ? (
        <div className="rpg-menu-list">
          {visibleGroups.map(group => {
            const active = actions.some(a => a.group === group && a.ability.id === selectedAbilityId);
            return (
              <button key={group} type="button" data-rpg-choice className={`rpg-menu-entry ${active ? 'is-active' : ''}`}
                onClick={() => selectGroup(group)} aria-pressed={active}>
                <span className="rpg-menu-pointer" aria-hidden="true">{active ? '▶' : ''}</span>
                <span>{group}</span>
                {group !== 'Attack' && group !== 'Defend' && <span className="rpg-menu-end" aria-hidden="true">▸</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rpg-menu-list" aria-label={`${openGroup} abilities`}>
          {submenuActions.map(action => {
            const active = action.ability.id === selectedAbilityId;
            return (
              <button key={action.ability.id} type="button" data-rpg-choice
                className={`rpg-menu-entry ${active ? 'is-active' : ''}`}
                disabled={!action.enabled} title={action.unavailableReason ?? undefined}
                aria-pressed={active} onClick={() => onChooseAbility(action.ability.id)}>
                <span className="rpg-menu-pointer" aria-hidden="true">{active ? '▶' : ''}</span>
                <span className="rpg-menu-name">{action.ability.name}</span>
                <span className="rpg-menu-cost">{costText(action)}</span>
              </button>
            );
          })}
          <button type="button" data-rpg-choice className="rpg-menu-entry rpg-menu-back" onClick={() => switchMenu(null)}>
            <span className="rpg-menu-pointer" aria-hidden="true">◀</span><span>Back</span>
          </button>
        </div>
      )}
      <p className="rpg-menu-help">↑ ↓ Move · Enter Select · Esc Back</p>
    </div>
  );
}
