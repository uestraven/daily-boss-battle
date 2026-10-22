/** v0.9 baseline roster. All names, abilities and combat numbers are original to this game. */
import type {Ability, Stats} from './types.js';
export type Role = 'Guardian' | 'Healer' | 'Striker' | 'Caster' | 'Controller' | 'Support';
export type HeroProfile={id:string; name:string; role:Role; secondary?:Role;stats:Stats; description:string;
  /** Max momentum this hero banks; omitted means the hero never gains momentum. */
  momentumCap?:number};
export const heroes:HeroProfile[]=[
  {id:'warden',name:'The Warden',role:'Guardian',secondary:'Healer',stats:{hp:400,mp:26,attack:65,defense:85,magic:50,resistance:75,speed:100},description:'Cover and emergency healing magic'},
  {id:'lancer',name:'The Lancer',role:'Striker',stats:{hp:365,mp:0,attack:95,defense:60,magic:20,resistance:45,speed:110},description:'Delayed Jump that avoids ground attacks'},
  {id:'oracle',name:'The Oracle',role:'Healer',secondary:'Support',stats:{hp:245,mp:65,attack:42,defense:42,magic:96,resistance:80,speed:90},description:'Healing, buffs and precision archery'},
  {id:'blademage',name:'The Blademage',role:'Striker',secondary:'Support',stats:{hp:330,mp:28,attack:78,defense:62,magic:60,resistance:58,speed:105},description:'Versatile Elemental Edge and Volley'},
  {id:'channeler',name:'The Channeler',role:'Caster',secondary:'Healer',stats:{hp:275,mp:55,attack:50,defense:50,magic:95,resistance:70,speed:95},description:'Surge-powered elemental and healing magic'},
  {id:'nullifier',name:'The Nullifier',role:'Controller',secondary:'Caster',stats:{hp:300,mp:48,attack:67,defense:62,magic:80,resistance:83,speed:98},description:'Nullify interception and efficient magic'},
  {id:'monk',name:'The Monk',role:'Striker',stats:{hp:360,mp:0,attack:93,defense:55,magic:65,resistance:45,speed:112},description:'Martial focus, defense piercing and Holy attacks'},
  {id:'machinist',name:'The Machinist',role:'Striker',stats:{hp:325,mp:0,attack:85,defense:65,magic:30,resistance:53,speed:98},description:'Tools for group pressure and piercing armor'},
  {id:'vanguard',name:'The Vanguard',role:'Striker',stats:{hp:350,mp:0,attack:96,defense:65,magic:25,resistance:54,speed:98},description:'Rising Cut and a timed Cross Cut interrupt'},
  {id:'brawler',name:'The Brawler',role:'Striker',stats:{hp:315,mp:0,attack:92,defense:50,magic:30,resistance:40,speed:125},description:'Momentum-backed burst damage',momentumCap:2},
  {id:'magus',name:'The Magus',role:'Caster',stats:{hp:220,mp:54,attack:30,defense:35,magic:105,resistance:65,speed:80},description:'Elemental attack magic and Focus'},
  {id:'thief',name:'The Thief',role:'Controller',secondary:'Striker',stats:{hp:290,mp:16,attack:75,defense:48,magic:38,resistance:50,speed:130},description:'Guaranteed limited Steal powering Plunder'},
];
export const newHeroIds=['lancer','oracle','blademage','channeler','nullifier','monk','machinist','vanguard','thief'] as const;

/** Every hero id as a literal union, so a record over the roster can be *total*.
 *
 * `heroes` types its `id` as `string`, which cannot produce a union, so anything keyed by
 * hero -- the Codex biographies, for one -- would otherwise be a partial map that silently
 * tolerates a missing entry. Declared as a tuple and asserted against `heroes` by a test,
 * which is what keeps the two from drifting.
 *
 * Deliberately not part of `contentHash`: that hashes named fields of each hero, so adding
 * a derived id list changes no content and leaves the verified pool valid. */
export const heroIds=['warden','lancer','oracle','blademage','channeler','nullifier','monk','machinist','vanguard','brawler','magus','thief'] as const;
export type HeroId=typeof heroIds[number];

export const heroAbilities:Ability[]=[
 {id:'jump',name:'Jump',owner:'lancer',kind:'physical',target:'single_living_enemy',power:165,delayTicks:8,airborneDuringDelay:true},
 {id:'pray',name:'Pray',owner:'oracle',kind:'heal',target:'all_living_allies',power:55,usesPerBattle:3},
 {id:'aim',name:'Aim',owner:'oracle',kind:'physical',target:'single_living_enemy',power:125,pierceDefensePercent:60},
 {id:'oracle_cure',name:'Cure',owner:'oracle',kind:'heal',target:'single_living_ally',power:100,mpCost:6},
 {id:'oracle_protect',name:'Protect',owner:'oracle',kind:'status',target:'single_living_ally',status:'protect',duration:24,mpCost:8},
 {id:'oracle_haste',name:'Haste',owner:'oracle',kind:'status',target:'single_living_ally',status:'haste',duration:24,mpCost:10},
 {id:'elemental_edge',name:'Elemental Edge (Ice)',owner:'blademage',kind:'status',target:'self',status:'elemental_edge',duration:24,mpCost:7,riderElement:'ice'},
 {id:'volley',name:'Volley',owner:'blademage',kind:'physical',target:'single_living_enemy',power:45,hits:4,pierceDefensePercent:35},
 {id:'surge',name:'Surge',owner:'channeler',kind:'status',target:'self',status:'surge',duration:24},
 {id:'channeler_fire',name:'Fire',owner:'channeler',kind:'magical',target:'single_living_enemy',power:100,element:'fire',mpCost:7},
 {id:'channeler_fire2',name:'Fire II',owner:'channeler',kind:'magical',target:'single_living_enemy',power:150,element:'fire',mpCost:12},
 {id:'channeler_cure',name:'Cure',owner:'channeler',kind:'heal',target:'single_living_ally',power:100,mpCost:6},
 {id:'nullify',name:'Nullify',owner:'nullifier',kind:'nullify',target:'self',duration:24},
 {id:'nullifier_blizzard',name:'Blizzard',owner:'nullifier',kind:'magical',target:'single_living_enemy',power:100,element:'ice',mpCost:7},
 {id:'nullifier_cure',name:'Cure',owner:'nullifier',kind:'heal',target:'single_living_ally',power:100,mpCost:6},
 {id:'nullifier_shell',name:'Shell',owner:'nullifier',kind:'status',target:'single_living_ally',status:'shell',duration:24,mpCost:8},
 {id:'flurry_fist',name:'Flurry Fist',owner:'monk',kind:'physical',target:'single_living_enemy',power:145,pierceDefensePercent:40},
 {id:'force_cannon',name:'Force Cannon',owner:'monk',kind:'magical',target:'single_living_enemy',power:160,element:'holy'},
 {id:'rapid_crossbow',name:'Rapid Crossbow',owner:'machinist',kind:'physical',target:'all_living_enemies',power:115},
 {id:'drill',name:'Drill',owner:'machinist',kind:'physical',target:'single_living_enemy',power:165,pierceDefensePercent:70},
 {id:'rising_cut',name:'Rising Cut',owner:'vanguard',kind:'physical',target:'single_living_enemy',power:180,usesPerBattle:3},
 {id:'cross_cut',name:'Cross Cut',owner:'vanguard',kind:'physical',target:'single_living_enemy',power:135,interruptCast:true,usesPerBattle:2},
 {id:'steal',name:'Steal',owner:'thief',kind:'steal',target:'single_living_enemy',stealItem:'potion',usesPerBattle:1},
 {id:'plunder',name:'Plunder',owner:'thief',kind:'physical',target:'single_living_enemy',power:145,stealsScalingPower:65,mpCost:8},
];
