/** v1.0 local daily challenge service. Pure game rules; no DOM, clocks, or storage IO. */
import {tyrantAI008} from './ai-variant.js';
import {practiceEncounters} from './encounters.js';
import {advanceToDecision,applyPlayerAction,createEncounter,replay,starsForResult} from './engine.js';
import type {BattleInput,BattleMode,BattleState,BattleStep,EncounterDefinition} from './types.js';

const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
export const DAILY_CATALOG_VERSION='v1.0-curated-six';
export const DAILY_KEYS=['blade_tyrant','tide_maw','ink_lurker','crush_wall','storm_keeper','spell_weaver'] as const;
export type DailyKey=typeof DAILY_KEYS[number];
const BASE:Record<DailyKey,EncounterDefinition>={
  blade_tyrant:tyrantAI008,
  tide_maw:practiceEncounters.tide_maw!,
  ink_lurker:practiceEncounters.ink_lurker!,
  crush_wall:practiceEncounters.crush_wall!,
  storm_keeper:practiceEncounters.storm_keeper!,
  spell_weaver:practiceEncounters.spell_weaver!,
};
const DAY_MS=86400000;
const dateRe=/^\d{4}-\d{2}-\d{2}$/;
export function utcDateKey(input:Date):string {
  if(!Number.isFinite(input.valueOf()))throw new Error('Invalid date');
  return input.toISOString().slice(0,10);
}
/** The calendar date in the viewer's own timezone, which is the date the player thinks
 * it is. This is what the client uses to decide which day's battle to serve.
 *
 * Built from the local date components rather than `toISOString`, which is always UTC and
 * is the mistake this function exists to avoid: for anyone west of Greenwich, UTC is
 * already tomorrow for part of their evening.
 *
 * Note what does *not* become local. A date string still maps to exactly one encounter
 * everywhere, so Auckland and Los Angeles both fight the same boss on 2026-10-19; the
 * timezone only decides when each of them rolls over to it. Selection stays pure, the
 * ledger key stays a plain calendar date, and a shared card still names a date the reader
 * can go and play. */
export function localDateKey(input:Date):string {
  if(!Number.isFinite(input.valueOf()))throw new Error('Invalid date');
  const pad=(n:number):string=>String(n).padStart(2,'0');
  return `${input.getFullYear()}-${pad(input.getMonth()+1)}-${pad(input.getDate())}`;
}
export function dayNumber(day:string):number {
  if(!dateRe.test(day))throw new Error('Expected YYYY-MM-DD');
  const timestamp=Date.parse(day+'T00:00:00.000Z');
  if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==day)throw new Error('Invalid UTC date');
  return Math.floor(timestamp/DAY_MS);
}
function mix32(v:number):number {
  v=(v^v>>>16)>>>0;v=Math.imul(v,0x7feb352d)>>>0;
  v=(v^v>>>15)>>>0;v=Math.imul(v,0x846ca68b)>>>0;
  return (v^v>>>16)>>>0;
}
function stableHash(s:string):number {
  let h=2166136261;
  for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619)>>>0;
  return h;
}
/** One full six-boss cycle per six days, in stable seeded order. */
export function dailyKeyFor(day:string):DailyKey {
  const serial=dayNumber(day),cycle=Math.floor(serial/DAILY_KEYS.length),offset=((serial%DAILY_KEYS.length)+DAILY_KEYS.length)%DAILY_KEYS.length;
  const list=[...DAILY_KEYS];
  let seed=mix32(stableHash(DAILY_CATALOG_VERSION)^mix32(cycle));
  for(let i=list.length-1;i>0;i--){seed=mix32(seed+0x9e3779b9);const j=seed%(i+1);[list[i],list[j]]=[list[j]!,list[i]!];}
  return list[offset]!;
}
export function dailyDefinition(day:string):EncounterDefinition {
  const key=dailyKeyFor(day);
  const original=BASE[key];
  const def=clone(original);
  def.id=`daily-${day}-${key}`;
  def.contentVersion=`${original.contentVersion}|${DAILY_CATALOG_VERSION}`;
  // Crucial: preserve the vetted script, loadout, slot order and boss PRNG seed.
  // Only the publication identity changes. Arbitrary teams require their own witnesses.
  return def;
}
/** Replay cost bound: a legitimate battle is well under this, so a huge log is a tamper attempt. */
export const MAX_DAILY_INPUTS=200;
/** `inputs` is the authoritative record. `state` is a derived cache that normalizeLedger
 * recomputes from `inputs`, so editing it cannot change a result. */
/** Where a day's encounter comes from. The ledger is written against this rather than
 * against the curated six, so the verified pool reuses exactly the same replay-based
 * integrity model instead of growing a second one. */
export type DailyCatalog={
  version:string;
  keyFor(day:string):string;
  definitionFor(day:string):EncounterDefinition;
};

export const curatedCatalog:DailyCatalog={
  version:DAILY_CATALOG_VERSION,
  keyFor:(day)=>dailyKeyFor(day),
  definitionFor:(day)=>dailyDefinition(day),
};

export type DailyRecord={day:string;catalogVersion:string;key:string;definitionId:string;
  inputs:BattleInput[];state:BattleState;
  completed:boolean;result:'victory'|'defeat'|null;stars:number|null;
  /** Which interface the result was earned under.
   *
   * Carried rather than verified, and it is the only field here that cannot be: mode
   * leaves no trace in the action log, by design, since the engine must not know about it.
   * Everything else is re-derived by replay and a hand-edited copy is discarded. So this
   * says what the browser recorded, not what can be proved -- which is consistent with
   * results being per-browser and unadjudicated anyway.
   *
   * Absent on records written before modes existed. Those were played with the telegraph
   * and statuses on screen, so they are not silently relabelled as `normal`; the card
   * simply shows no mode for them. */
  mode?:BattleMode};
export type DailyLedger={schema:1;records:Record<string,DailyRecord>};
export function emptyLedger():DailyLedger{return {schema:1,records:{}};}
export function normalizeLedger(input:unknown,catalog:DailyCatalog=curatedCatalog):DailyLedger {
  if(!input||typeof input!=='object'||Array.isArray(input))return emptyLedger();
  const raw=input as Partial<DailyLedger>;
  if(raw.schema!==1||!raw.records||typeof raw.records!=='object'||Array.isArray(raw.records))return emptyLedger();
  const ledger=emptyLedger();
  for(const [day,v] of Object.entries(raw.records)){
    try{
      const expected=catalog.definitionFor(day);
      if(!v||v.day!==day||v.definitionId!==expected.id||v.key!==catalog.keyFor(day)||v.catalogVersion!==catalog.version)continue;
      if(v.result!==null&&v.result!=='victory'&&v.result!=='defeat')continue;
      if(!Array.isArray(v.inputs)||v.inputs.length>MAX_DAILY_INPUTS)continue;
      // The action log is the only trusted field: replay it and derive everything else.
      // A hand-edited state, result, or star count cannot survive this.
      const verified=replay(expected,v.inputs).state;
      if(verified.result!==v.result)continue;
      if(v.completed!==(verified.result!==null))continue;
      if(v.stars!==(verified.result===null?null:starsForResult(verified)))continue;
      // An unrecognised mode is dropped rather than rejecting the record: it is
      // unverifiable either way, and a legitimate result should not be lost to it.
      const mode=v.mode==='easy'||v.mode==='normal'?v.mode:undefined;
      ledger.records[day]={...clone(v),state:verified,...(mode?{mode}:{})};
      if(!mode)delete ledger.records[day]!.mode;
    }catch{/* Old/malformed entries are not used as official records. */}
  }
  return ledger;
}
/** Creates exactly one official record for a date; never overwrites an existing result. */
export function ensureDay(ledger:DailyLedger,day:string,catalog:DailyCatalog=curatedCatalog):DailyLedger {
  const def=catalog.definitionFor(day);
  if(ledger.records[day])return ledger;
  const next=clone(ledger);
  const state=advanceToDecision(createEncounter(def),def).state;
  next.records[day]={day,key:catalog.keyFor(day),catalogVersion:catalog.version,definitionId:def.id,
    inputs:[],state,completed:false,result:null,stars:null};
  return next;
}
/** Records which interface the day is being played under.
 *
 * Refuses once the day is complete, for the same reason the result itself is locked: the
 * mode a result was earned under cannot be revised after the fact. Replays are unranked
 * and never reach this. */
export function setDayMode(ledger:DailyLedger,day:string,mode:BattleMode):DailyLedger {
  const record=ledger.records[day];if(!record)throw new Error('Daily record not started');
  if(record.completed)return ledger;
  const next=clone(ledger);
  next.records[day]={...record,mode};
  return next;
}
export function stepForDay(ledger:DailyLedger,day:string,catalog:DailyCatalog=curatedCatalog):BattleStep {
  const record=ledger.records[day];if(!record)throw new Error('Daily record not started');
  const def=catalog.definitionFor(day);
  if(record.completed){return {state:clone(record.state),events:[],readyHeroIds:[],needsPlayerInput:false,terminal:record.result};}
  return advanceToDecision(record.state,def);
}
export function playDailyAction(ledger:DailyLedger,day:string,input:BattleInput,catalog:DailyCatalog=curatedCatalog):{ledger:DailyLedger;step:BattleStep} {
  const record=ledger.records[day];if(!record)throw new Error('Daily record not started');
  if(record.completed)throw new Error('Official daily result is locked; use practice mode');
  const def=catalog.definitionFor(day);
  const step=applyPlayerAction(record.state,input,def);
  const next=clone(ledger);
  next.records[day]={...record,inputs:[...record.inputs,input],state:step.state,
    result:step.state.result,completed:step.state.result!==null,
    stars:step.state.result===null?null:starsForResult(step.state)};
  return {ledger:next,step};
}
export type DailyStatistics={completed:number;wins:number;losses:number;stars:number;
  participationStreak:number;victoryStreak:number;bestParticipationStreak:number};
function consecutive(ledger:DailyLedger,last:number,winsOnly:boolean):number {
  let total=0;
  for(let d=last;d>=last-100000;d--){
    const key=new Date(d*DAY_MS).toISOString().slice(0,10);const rec=ledger.records[key];
    if(!rec?.completed||(winsOnly&&rec.result!=='victory'))break;
    total++;
  }
  return total;
}
export function dailyStatistics(ledger:DailyLedger,today:string):DailyStatistics {
  const thisDay=dayNumber(today);
  const all=Object.values(ledger.records).filter(r=>r.completed&&dayNumber(r.day)<=thisDay);
  const days=all.map(r=>dayNumber(r.day)).sort((a,b)=>a-b);
  let best=0,run=0,last=Number.NEGATIVE_INFINITY;
  for(const day of days){run=day===last+1?run+1:1;best=Math.max(best,run);last=day;}
  const start=(winsOnly:boolean)=>{
    const todayRecord=ledger.records[today];
    if(winsOnly && todayRecord?.completed && todayRecord.result==='defeat')return 0;
    const from=todayRecord?.completed && (!winsOnly||todayRecord.result==='victory')?thisDay:thisDay-1;
    return consecutive(ledger,from,winsOnly);
  };
  return {completed:all.length,wins:all.filter(r=>r.result==='victory').length,
    losses:all.filter(r=>r.result==='defeat').length,stars:all.reduce((sum,r)=>sum+(r.stars??0),0),
    participationStreak:start(false),victoryStreak:start(true),bestParticipationStreak:best};
}
