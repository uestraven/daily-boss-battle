import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DAILY_CATALOG_VERSION,DAILY_KEYS,dayNumber,dailyKeyFor,utcDateKey,dailyDefinition,
  emptyLedger,normalizeLedger,ensureDay,stepForDay,playDailyAction,dailyStatistics} from '../dist/src/daily.js';
import {replay,starsForResult,advanceToDecision,createEncounter} from '../dist/src/engine.js';
const witnesses=JSON.parse(readFileSync(new URL('../fixtures/daily-witnesses-v10.json',import.meta.url),'utf8'));
const dateFromDay=d=>new Date(d*86400000).toISOString().slice(0,10);

test('UTC day parser rejects invalid dates and is timezone-independent',()=>{
 assert.equal(utcDateKey(new Date('2026-10-15T23:59:59.000Z')),'2026-10-15');
 assert.equal(utcDateKey(new Date('2026-10-16T00:00:00.000Z')),'2026-10-16');
 assert.equal(dayNumber('2026-10-15')+1,dayNumber('2026-10-16'));
 for(const s of ['2026-02-30','2026-13-01','2026-01-0X','1970-1-01'])assert.throws(()=>dayNumber(s));
 assert.throws(()=>utcDateKey(new Date('invalid')));
});
test('each six-day block includes all six bosses exactly once and repeats deterministically',()=>{
 const start=Math.floor(dayNumber('2026-10-15')/6)*6;
 for(let period=0;period<7;period++){
  const group=Array.from({length:6},(_,i)=>dailyKeyFor(dateFromDay(start+period*6+i)));
  assert.deepEqual([...group].sort(),[...DAILY_KEYS].sort());
  assert.deepEqual(group,Array.from({length:6},(_,i)=>dailyKeyFor(dateFromDay(start+period*6+i))));
 }
});
test('all daily templates retain the vetted three heroes, boss AI seed and exact ruleset',()=>{
 for(let i=0;i<40;i++){
  const day=dateFromDay(dayNumber('2026-10-15')+i),key=dailyKeyFor(day),def=dailyDefinition(day);
  assert.equal(def.id,`daily-${day}-${key}`);
  assert.equal(def.party.length,3);
  assert.equal(new Set(def.party).size,3);
  assert.ok(def.bossAI?.seed);
  assert.ok(def.contentVersion.includes(DAILY_CATALOG_VERSION));
  const fresh=advanceToDecision(createEncounter(def),def);
  assert.ok(fresh.readyHeroIds.length>0);
 }
});
test('witnesses establish six real wins in the daily-wrapped encounters',()=>{
 for(const [key,witness] of Object.entries(witnesses)){
  assert.ok(DAILY_KEYS.includes(key));
  const start=Math.floor(dayNumber('2026-10-15')/6)*6;
  const day=Array.from({length:6},(_,i)=>dateFromDay(start+i)).find(d=>dailyKeyFor(d)===key);
  assert.ok(day,key);
  const def=dailyDefinition(day);
  const result=replay(def,witness.actions).state;
  assert.equal(result.result,'victory',key);
  assert.equal(result.tick,witness.expected.finalTick,key);
  assert.equal(result.heroActionCount,witness.expected.actionCount,key);
  assert.equal(result.itemUses,witness.expected.itemUses,key);
  assert.equal(starsForResult(result),witness.expected.stars,key);
 }
 assert.equal(Object.keys(witnesses).length,6);
});
test('official result can only be recorded once; replay cannot modify it',()=>{
 const day='2026-10-15',key=dailyKeyFor(day),witness=witnesses[key];
 let ledger=ensureDay(emptyLedger(),day);
 const firstState=ledger.records[day].state;
 assert.equal(ensureDay(ledger,day),ledger);
 for(const action of witness.actions){ledger=playDailyAction(ledger,day,action).ledger;}
 const record=ledger.records[day];
 assert.equal(record.result,'victory');assert.ok(record.completed);
 assert.equal(record.stars,witness.expected.stars);
 assert.throws(()=>playDailyAction(ledger,day,witness.actions[0]),/locked/);
 const restored=stepForDay(JSON.parse(JSON.stringify(ledger)),day);
 assert.equal(restored.terminal,'victory');assert.equal(restored.needsPlayerInput,false);
 assert.deepEqual(ledger.records[day].state,record.state);
 assert.notDeepEqual(firstState,record.state);
});
test('save/load retains an in-progress battle and exact next decision',()=>{
 const day='2026-10-16',witness=witnesses[dailyKeyFor(day)];
 let ledger=ensureDay(emptyLedger(),day);
 const output=playDailyAction(ledger,day,witness.actions[0]);ledger=output.ledger;
 const parsed=normalizeLedger(JSON.parse(JSON.stringify(ledger)));
 assert.deepEqual(stepForDay(parsed,day).state,output.step.state);
 assert.equal(parsed.records[day].completed,false);
 const oldState=parsed.records[day].state;
 ledger=playDailyAction(parsed,day,witness.actions[1]).ledger;
 assert.notDeepEqual(oldState,ledger.records[day].state);
 assert.equal(parsed.records[day].state.heroActionCount,1);
});
test('practice and cross-day challenges never overwrite an official result',()=>{
 const first='2026-10-15',second='2026-10-16',w1=witnesses[dailyKeyFor(first)],w2=witnesses[dailyKeyFor(second)];
 let ledger=ensureDay(emptyLedger(),first);
 for(const action of w1.actions)ledger=playDailyAction(ledger,first,action).ledger;
 const old=JSON.stringify(ledger.records[first]);
 const practice=replay(dailyDefinition(first),w1.actions);
 assert.equal(practice.state.result,'victory');
 ledger=ensureDay(ledger,second);
 ledger=playDailyAction(ledger,second,w2.actions[0]).ledger;
 assert.equal(JSON.stringify(ledger.records[first]),old);
});
test('normalization drops mismatched and malformed records without changing valid records',()=>{
 const day='2026-10-15';const ledger=ensureDay(emptyLedger(),day);
 const damaged=structuredClone(ledger);damaged.records[day].definitionId='wrong-id';
 assert.deepEqual(normalizeLedger(damaged),emptyLedger());
 assert.deepEqual(normalizeLedger(ledger),ledger);
 assert.deepEqual(normalizeLedger(null),emptyLedger());
 assert.deepEqual(normalizeLedger({schema:7,records:{}}),emptyLedger());
});
test('daily stats track participation, victory, defeat, star totals and breaks in streaks',()=>{
 const today='2026-10-18';let ledger=emptyLedger();
 const completed=(day,result,stars)=>{
  ledger=ensureDay(ledger,day);
  const r=ledger.records[day];r.state.result=result;r.result=result;r.completed=true;r.stars=stars;
  // Test aggregate only, not simulated battle; two-star defeat impossible in real rules.
 };
 completed('2026-10-15','victory',3);
 completed('2026-10-16','victory',2);
 completed('2026-10-17','defeat',0);
 let stats=dailyStatistics(ledger,today);
 assert.equal(stats.completed,3);assert.equal(stats.wins,2);assert.equal(stats.losses,1);
 assert.equal(stats.stars,5);assert.equal(stats.participationStreak,3);
 assert.equal(stats.victoryStreak,0);assert.equal(stats.bestParticipationStreak,3);
 completed(today,'victory',3);
 stats=dailyStatistics(ledger,today);
 assert.equal(stats.participationStreak,4);assert.equal(stats.victoryStreak,1);
 assert.equal(stats.bestParticipationStreak,4);
 ledger.records[today].result='defeat';ledger.records[today].state.result='defeat';ledger.records[today].stars=0;
 assert.equal(dailyStatistics(ledger,today).victoryStreak,0);
});
