/** Curated prototype encounters; these are local practice battles, NOT daily-ready verified challenges. */
import {reference001} from './reference.js';
import {heroes,heroAbilities} from './roster.js';
import type {Ability,BossCounterRule,BossOverrideRule,EncounterDefinition,EnrageConfig,Stats,BossTargetSelector} from './types.js';
import {ENGINE_VERSION} from './version.js';
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
export type BossProfile={id:string; name:string; theme:string;stats:Stats;
  /** Curated demonstration party. The daily pool drafts its own parties instead. */
  party:[string,string,string];
  phaseOne:string[];phaseOneRepeat:string[];phaseTwo:string[];phaseTwoRepeat:string[];transitionPercent:number;
  abilities:Ability[];targets:Record<string,BossTargetSelector>;
  affinities?:Record<string,'weak'|'resist'|'immune'>;seed:number;fallback:string;
  /** Reactive rules, declared as data so adding a boss never edits the builder. */
  counters?:BossCounterRule[];overrides?:BossOverrideRule[];
  /** Pressure curve for generated encounters; practice encounters leave it off. */
  enrage?:EnrageConfig};
export const bossProfiles:BossProfile[]=[
 {id:'tide_maw',name:'Tide Maw',theme:'Physical pressure and fading tentacles',stats:{hp:2310,mp:32,attack:82,defense:40,magic:62,resistance:48,speed:82},party:['blademage','nullifier','warden'],phaseOne:['maw_tentacle','maw_water','maw_tentacle'],phaseOneRepeat:['maw_water','maw_tentacle'],phaseTwo:['maw_weak_tentacle','maw_water'],phaseTwoRepeat:['maw_weak_tentacle','maw_water'],transitionPercent:45,seed:4119,fallback:'maw_weak_tentacle',abilities:[
 {id:'maw_tentacle',name:'Tentacle',owner:'tide_maw',kind:'physical',target:'single_living_enemy',power:239},
 {id:'maw_weak_tentacle',name:'Wounded Tentacle',owner:'tide_maw',kind:'physical',target:'single_living_enemy',power:160},
 {id:'maw_water',name:'Water Spout',owner:'tide_maw',kind:'magical',target:'all_living_enemies',power:138,mpCost:5,delayTicks:2},
 ],targets:{maw_tentacle:{kind:'random_slot'},maw_weak_tentacle:{kind:'sequential_slots',slots:[1,2,3]},maw_water:{kind:'all_party'}}},
 {id:'ink_lurker',name:'Ink Lurker',theme:'Tentacles, Ink, and status timing',stats:{hp:2530,mp:36,attack:85,defense:50,magic:76,resistance:55,speed:94},party:['brawler','monk','oracle'],phaseOne:['lurker_tentacle','lurker_ink','lurker_sweep'],phaseOneRepeat:['lurker_tentacle','lurker_ink'],phaseTwo:['lurker_brine','lurker_sweep','lurker_ink'],phaseTwoRepeat:['lurker_sweep','lurker_brine'],transitionPercent:50,seed:6166,fallback:'lurker_tentacle',counters:[{id:'lurker-retaliate',when:'damaged',abilityId:'lurker_tentacle',target:{kind:'last_attacker'},minDamage:145,phase:2,oncePerBattle:true}],abilities:[
 {id:'lurker_tentacle',name:'Tentacle',owner:'ink_lurker',kind:'physical',target:'single_living_enemy',power:165},
 {id:'lurker_ink',name:'Ink',owner:'ink_lurker',kind:'status',target:'single_living_enemy',status:'slow',duration:24},
 {id:'lurker_sweep',name:'Tentacle Sweep',owner:'ink_lurker',kind:'physical',target:'all_living_enemies',power:95},
 {id:'lurker_brine',name:'Brine',owner:'ink_lurker',kind:'magical',target:'all_living_enemies',power:105,mpCost:7,delayTicks:3},
 ],targets:{lurker_tentacle:{kind:'random_slot'},lurker_ink:{kind:'highest_attack'},lurker_sweep:{kind:'all_party'},lurker_brine:{kind:'all_party'}}},
 {id:'crush_wall',name:'Crush Wall',theme:'Telegraphed crush attacks and damage race',stats:{hp:2000,mp:18,attack:98,defense:85,magic:42,resistance:72,speed:84},party:['lancer','machinist','oracle'],phaseOne:['wall_strike','wall_rumble','wall_strike'],phaseOneRepeat:['wall_rumble','wall_strike'],phaseTwo:['wall_haste','wall_crush','wall_strike'],phaseTwoRepeat:['wall_crush','wall_strike'],transitionPercent:45,seed:4444,fallback:'wall_strike',overrides:[{id:'wall-strip-protect',when:{kind:'status_present',status:'protect',side:'heroes'},abilityId:'wall_shatter',target:{kind:'status_holder',status:'protect'},oncePerBattle:true}],abilities:[
 {id:'wall_strike',name:'Stone Hand',owner:'crush_wall',kind:'physical',target:'single_living_enemy',power:180},
 {id:'wall_rumble',name:'Cave-in',owner:'crush_wall',kind:'physical',target:'all_living_enemies',power:95,delayTicks:3},
 {id:'wall_haste',name:'Closing In',owner:'crush_wall',kind:'status',target:'self',status:'haste',duration:24},
 {id:'wall_crush',name:'Crushing Wall',owner:'crush_wall',kind:'physical',target:'all_living_enemies',power:130,delayTicks:4},
 {id:'wall_shatter',name:'Shatter Ward',owner:'crush_wall',kind:'dispel',target:'single_living_enemy',removeStatus:'protect'},
 ],targets:{wall_strike:{kind:'sequential_slots',slots:[1,2,3]},wall_rumble:{kind:'all_party'},wall_crush:{kind:'all_party'},wall_haste:{kind:'self'},wall_shatter:{kind:'status_holder',status:'protect'}}},
 {id:'storm_keeper',name:'Storm Keeper',theme:'Lightning magic and self-recovery',stats:{hp:1250,mp:50,attack:95,defense:65,magic:88,resistance:62,speed:92},party:['machinist','nullifier','warden'],phaseOne:['keeper_horn','keeper_tri_bolt','keeper_horn'],phaseOneRepeat:['keeper_horn','keeper_tri_bolt'],phaseTwo:['keeper_cure','keeper_tri_bolt','keeper_thrash'],phaseTwoRepeat:['keeper_thrash','keeper_tri_bolt'],transitionPercent:50,seed:7777,fallback:'keeper_horn',abilities:[
 {id:'keeper_horn',name:'Horn',owner:'storm_keeper',kind:'physical',target:'single_living_enemy',power:246},
 {id:'keeper_tri_bolt',name:'Tri-Bolt',owner:'storm_keeper',kind:'magical',target:'all_living_enemies',power:181,element:'lightning',mpCost:9,delayTicks:3},
 {id:'keeper_thrash',name:'Thrash',owner:'storm_keeper',kind:'physical',target:'all_living_enemies',power:160},
 {id:'keeper_cure',name:'Greater Cure',owner:'storm_keeper',kind:'heal',target:'self',power:188,mpCost:12},
 ],targets:{keeper_horn:{kind:'random_slot'},keeper_tri_bolt:{kind:'all_party'},keeper_thrash:{kind:'all_party'},keeper_cure:{kind:'self'}},affinities:{fire:'immune',lightning:'resist'}},
 {id:'spell_weaver',name:'Spell Weaver',theme:'Elemental magic and Silence counterplay',stats:{hp:2420,mp:70,attack:60,defense:45,magic:100,resistance:70,speed:100},party:['blademage','channeler','thief'],phaseOne:['weaver_fire','weaver_blizzard','weaver_thunder'],phaseOneRepeat:['weaver_fire','weaver_thunder'],phaseTwo:['weaver_silence','weaver_haste','weaver_blizzard'],phaseTwoRepeat:['weaver_thunder','weaver_fire','weaver_blizzard'],transitionPercent:50,seed:9993,fallback:'weaver_fire',abilities:[
 {id:'weaver_fire',name:'Fire',owner:'spell_weaver',kind:'magical',target:'single_living_enemy',power:125,mpCost:7,element:'fire'},
 {id:'weaver_blizzard',name:'Blizzard',owner:'spell_weaver',kind:'magical',target:'all_living_enemies',power:95,mpCost:7,element:'ice'},
 {id:'weaver_thunder',name:'Thunder',owner:'spell_weaver',kind:'magical',target:'single_living_enemy',power:145,mpCost:7,element:'lightning'},
 {id:'weaver_silence',name:'Silence',owner:'spell_weaver',kind:'status',target:'single_living_enemy',status:'silence',duration:18,mpCost:6},
 {id:'weaver_haste',name:'Haste',owner:'spell_weaver',kind:'status',target:'self',status:'haste',duration:24,mpCost:10},
 ],targets:{weaver_fire:{kind:'random_slot'},weaver_blizzard:{kind:'all_party'},weaver_thunder:{kind:'sequential_slots',slots:[3,1,2]},weaver_silence:{kind:'highest_magic'},weaver_haste:{kind:'self'}}},
 {id:'mad_harlequin',name:'The Mad Harlequin',theme:'Gleeful chaos, silence and delayed punishment',stats:{hp:2400,mp:80,attack:70,defense:50,magic:105,resistance:72,speed:104},party:['monk','oracle','vanguard'],phaseOne:['jester_mock','jester_cackle','jester_jest'],phaseOneRepeat:['jester_jest','jester_mock'],phaseTwo:['jester_tempo','jester_confetti','jester_curtain'],phaseTwoRepeat:['jester_curtain','jester_jest','jester_mock'],transitionPercent:50,seed:31415,fallback:'jester_mock',enrage:{fromTick:90,stepTicks:20,percentPerStep:20,maxPercent:100},abilities:[
 {id:'jester_mock',name:'Mockery',owner:'mad_harlequin',kind:'physical',target:'single_living_enemy',power:126},
 {id:'jester_jest',name:'Cruel Jest',owner:'mad_harlequin',kind:'magical',target:'single_living_enemy',power:90,element:'fire',mpCost:7},
 {id:'jester_cackle',name:'Cackle',owner:'mad_harlequin',kind:'status',target:'single_living_enemy',status:'silence',duration:18,mpCost:6},
 {id:'jester_confetti',name:'Razor Confetti',owner:'mad_harlequin',kind:'magical',target:'all_living_enemies',power:66,element:'ice',mpCost:8,delayTicks:3},
 {id:'jester_tempo',name:'Quickstep',owner:'mad_harlequin',kind:'status',target:'self',status:'haste',duration:24,mpCost:10},
 {id:'jester_curtain',name:'Curtain Call',owner:'mad_harlequin',kind:'physical',target:'all_living_enemies',power:78,delayTicks:4},
 ],targets:{jester_mock:{kind:'random_slot'},jester_jest:{kind:'lowest_hp'},jester_cackle:{kind:'highest_magic'},jester_confetti:{kind:'all_party'},jester_tempo:{kind:'self'},jester_curtain:{kind:'all_party'}},affinities:{fire:'weak',ice:'resist'},counters:[{id:'harlequin-encore',when:'damaged',abilityId:'jester_jest',target:{kind:'last_attacker'},minDamage:160,phase:2,oncePerBattle:true}]},
 {id:'clockwork_emperor',name:'The Clockwork Emperor',theme:'Armoured siege engine that repairs itself',stats:{hp:1430,mp:60,attack:100,defense:90,magic:60,resistance:70,speed:88},party:['channeler','machinist','oracle'],phaseOne:['engine_piston','engine_sweep','engine_piston'],phaseOneRepeat:['engine_sweep','engine_piston'],phaseTwo:['engine_overdrive','engine_repair','engine_siege'],phaseTwoRepeat:['engine_siege','engine_piston','engine_sweep'],transitionPercent:45,seed:27182,fallback:'engine_piston',enrage:{fromTick:90,stepTicks:20,percentPerStep:20,maxPercent:100},abilities:[
 {id:'engine_piston',name:'Piston Strike',owner:'clockwork_emperor',kind:'physical',target:'single_living_enemy',power:341},
 {id:'engine_sweep',name:'Flywheel Sweep',owner:'clockwork_emperor',kind:'physical',target:'all_living_enemies',power:196,delayTicks:3},
 {id:'engine_overdrive',name:'Overdrive',owner:'clockwork_emperor',kind:'status',target:'self',status:'haste',duration:24,mpCost:10},
 {id:'engine_repair',name:'Self-Repair',owner:'clockwork_emperor',kind:'heal',target:'self',power:246,mpCost:14},
 {id:'engine_siege',name:'Siege Mode',owner:'clockwork_emperor',kind:'physical',target:'all_living_enemies',power:254,delayTicks:4},
 {id:'engine_strip',name:'Shear Plating',owner:'clockwork_emperor',kind:'dispel',target:'single_living_enemy',removeStatus:'protect'},
 ],targets:{engine_piston:{kind:'sequential_slots',slots:[1,2,3]},engine_sweep:{kind:'all_party'},engine_overdrive:{kind:'self'},engine_repair:{kind:'self'},engine_siege:{kind:'all_party'},engine_strip:{kind:'status_holder',status:'protect'}},affinities:{lightning:'weak',ice:'immune'},overrides:[{id:'emperor-shear-protect',when:{kind:'status_present',status:'protect',side:'heroes'},abilityId:'engine_strip',target:{kind:'status_holder',status:'protect'},oncePerBattle:true}]},
 {id:'blade_tyrant',name:'The Blade Tyrant',theme:'Telegraphed blade storms and a guarded stance',stats:{hp:1190,mp:24,attack:90,defense:100,magic:70,resistance:100,speed:90},party:['brawler','magus','warden'],phaseOne:['heavy_slash','boss_protect','wind_slash'],phaseOneRepeat:['heavy_slash','wind_slash'],phaseTwo:['boss_haste','blade_storm','heavy_slash'],phaseTwoRepeat:['precision_thrust','wind_slash','heavy_slash'],transitionPercent:50,seed:20261015,fallback:'heavy_slash',abilities:[
 {id:'heavy_slash',name:'Heavy Slash',owner:'blade_tyrant',kind:'physical',target:'single_living_enemy',power:252},
 {id:'wind_slash',name:'Wind Slash',owner:'blade_tyrant',kind:'magical',target:'all_living_enemies',power:108},
 {id:'boss_protect',name:'Protect',owner:'blade_tyrant',kind:'status',target:'self',status:'protect',mpCost:8,duration:24},
 {id:'boss_haste',name:'Haste',owner:'blade_tyrant',kind:'status',target:'self',status:'haste',mpCost:10,duration:24},
 {id:'blade_storm',name:'Blade Storm',owner:'blade_tyrant',kind:'physical',target:'all_living_enemies',power:114,delayTicks:4},
 {id:'counter_slash',name:'Counter Slash',owner:'blade_tyrant',kind:'physical',target:'single_living_enemy',power:114},
 {id:'shatter_guard',name:'Shatter Guard',owner:'blade_tyrant',kind:'dispel',target:'single_living_enemy',removeStatus:'protect'},
 {id:'precision_thrust',name:'Precision Thrust',owner:'blade_tyrant',kind:'physical',target:'single_living_enemy',power:150},
 ],targets:{heavy_slash:{kind:'random_slot'},precision_thrust:{kind:'sequential_slots',slots:[1,2,3]},wind_slash:{kind:'all_party'},blade_storm:{kind:'all_party'},boss_protect:{kind:'self'},boss_haste:{kind:'self'},counter_slash:{kind:'last_attacker'},shatter_guard:{kind:'status_holder',status:'protect'}},affinities:{fire:'resist',ice:'weak'},counters:[{id:'tyrant-retaliate',when:'damaged',abilityId:'counter_slash',target:{kind:'last_attacker'},minDamage:95,phase:2,oncePerBattle:true}],overrides:[{id:'tyrant-strip-protect',when:{kind:'status_present',status:'protect',side:'heroes'},abilityId:'shatter_guard',target:{kind:'status_holder',status:'protect'},oncePerBattle:true}]},
];

const COMMON=reference001.abilities;
const abilityBook={...clone(COMMON),...Object.fromEntries(heroAbilities.map(a=>[a.id,a]))};
export function buildPracticeEncounter(profile:BossProfile):EncounterDefinition {
  const defActors:EncounterDefinition['actors']={};
  for(const id of profile.party){const hero=heroes.find(x=>x.id===id);if(!hero)throw new Error(`Unknown hero ${id}`);defActors[id]={name:hero.name,stats:clone(hero.stats),...(hero.momentumCap?{momentumCap:hero.momentumCap}:{})};}
  defActors[profile.id]={name:profile.name,stats:clone(profile.stats)};
  const abilities=clone(abilityBook);
  for(const a of profile.abilities)abilities[a.id]=clone(a);
  const ai:NonNullable<EncounterDefinition['bossAI']>={seed:profile.seed,defaultTarget:{kind:'random_slot'},fallbackAbility:profile.fallback,targetRules:profile.targets};
  if(profile.overrides)ai.overrides=clone(profile.overrides);
  if(profile.counters)ai.counters=clone(profile.counters);
  const affinities:NonNullable<EncounterDefinition['affinities']>={};
  if(profile.affinities){affinities[profile.id]={};for(const [key,val] of Object.entries(profile.affinities))if(['weak','resist','immune'].includes(val))affinities[profile.id]![key as 'fire'|'ice'|'lightning']=val as 'weak'|'resist'|'immune';}
  return {id:`practice-${profile.id}-v09`,engineVersion:ENGINE_VERSION,contentVersion:'0.9-baseline',party:[...profile.party],bossId:profile.id,actors:defActors,abilities,inventory:{potion:2,mana_vial:1,revive_tonic:1},affinities,bossProgram:{phaseOne:profile.phaseOne,phaseOneRepeat:profile.phaseOneRepeat,phaseTwo:profile.phaseTwo,phaseTwoRepeat:profile.phaseTwoRepeat,transitionPercent:profile.transitionPercent},bossAI:ai,maxTicks:2000};
}
export const practiceEncounters=Object.fromEntries(bossProfiles.map(p=>[p.id,buildPracticeEncounter(p)])) as Record<string,EncounterDefinition>;
