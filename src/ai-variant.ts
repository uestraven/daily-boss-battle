import {tyrantVariant007} from './variant.js';
import type {EncounterDefinition} from './types.js';

const copy=<T>(x:T):T=>JSON.parse(JSON.stringify(x)) as T;
/** Experimental targeting rules. Does not alter the approved v0.6 or v0.7 content. */
export const tyrantAI008:EncounterDefinition={
  ...copy(tyrantVariant007),
  id:'reference-001-v08-ai',
  engineVersion:'0.2.0-ai-opt-in',
  contentVersion:'0.8-ai-candidate',
  abilities:{
    ...copy(tyrantVariant007.abilities),
    counter_slash:{id:'counter_slash',name:'Counter Slash',owner:'blade_tyrant',kind:'physical',target:'single_living_enemy',power:95},
    shatter_guard:{id:'shatter_guard',name:'Shatter Guard',owner:'blade_tyrant',kind:'dispel',target:'single_living_enemy',removeStatus:'protect'},
    precision_thrust:{id:'precision_thrust',name:'Precision Thrust',owner:'blade_tyrant',kind:'physical',target:'single_living_enemy',power:125},
  },
  bossProgram:{
    ...copy(tyrantVariant007.bossProgram),
    phaseTwoRepeat:['precision_thrust','wind_slash','heavy_slash'],
  },
  bossAI:{
    seed:20261015,
    defaultTarget:{kind:'random_slot'},
    fallbackAbility:'heavy_slash',
    targetRules:{
      heavy_slash:{kind:'random_slot'},
      precision_thrust:{kind:'sequential_slots',slots:[1,2,3]},
      wind_slash:{kind:'all_party'},
      blade_storm:{kind:'all_party'},
      boss_protect:{kind:'self'},
      boss_haste:{kind:'self'},
    },
    counters:[
      {id:'retaliate-big-hit',when:'damaged',abilityId:'counter_slash',target:{kind:'last_attacker'},minDamage:95,phase:2,oncePerBattle:true},
    ],
    overrides:[
      {id:'strip-protect',when:{kind:'status_present',status:'protect',side:'heroes'},
        abilityId:'shatter_guard',target:{kind:'status_holder',status:'protect'},oncePerBattle:true},
    ],
  },
};
