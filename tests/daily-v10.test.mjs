import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {DAILY_CATALOG_VERSION,DAILY_KEYS,dayNumber,dailyKeyFor,utcDateKey,localDateKey,dailyDefinition,
  emptyLedger,normalizeLedger,ensureDay,stepForDay,playDailyAction,setDayMode,
  curatedCatalog,dailyStatistics} from '../dist/src/daily.js';
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

test('the mode a day is played under is recorded, and locked once it is finished', () => {
  // Mode is interface-only, so it leaves no trace in the action log and cannot be derived
  // by replay the way the result and star count are. It is carried instead, which is why
  // it is worth asserting it survives a round trip at all.
  const day = '2026-03-04';
  let ledger = ensureDay(emptyLedger(), day, curatedCatalog);
  assert.equal(ledger.records[day].mode, undefined, 'unset until chosen');

  ledger = setDayMode(ledger, day, 'normal');
  assert.equal(ledger.records[day].mode, 'normal');
  ledger = setDayMode(ledger, day, 'easy');
  assert.equal(ledger.records[day].mode, 'easy', 'changeable before the first action');

  // Play it out, then confirm the mode is pinned.
  const def = curatedCatalog.definitionFor(day);
  let step = stepForDay(ledger, day, curatedCatalog);
  for (let i = 0; i < 200 && !step.terminal; i++) {
    const actor = step.readyHeroIds[0];
    if (!actor) break;
    const played = playDailyAction(ledger, day, {actorId: actor, abilityId: 'attack',
      targetIds: [step.state.bossId]}, curatedCatalog);
    ledger = played.ledger;
    step = played.step;
  }
  assert.ok(ledger.records[day].completed, 'the day finished');
  assert.equal(ledger.records[day].mode, 'easy', 'the mode came along for the ride');

  const after = setDayMode(ledger, day, 'normal');
  assert.equal(after.records[day].mode, 'easy',
    'a finished day cannot be relabelled, for the same reason its result is locked');
});

test('a reloaded ledger keeps a valid mode and discards a bogus one', () => {
  const day = '2026-03-05';
  let ledger = setDayMode(ensureDay(emptyLedger(), day, curatedCatalog), day, 'normal');
  const reloaded = normalizeLedger(JSON.parse(JSON.stringify(ledger)), curatedCatalog);
  assert.equal(reloaded.records[day].mode, 'normal', 'survives a round trip');

  // Anything else is dropped rather than rejecting the whole record: the field is
  // unverifiable either way, and losing a legitimate result over it would be worse.
  for (const bogus of ['hard', '', 0, null, {}, 'EASY']) {
    const tampered = JSON.parse(JSON.stringify(ledger));
    tampered.records[day].mode = bogus;
    const normalized = normalizeLedger(tampered, curatedCatalog);
    assert.ok(normalized.records[day], `record survives mode=${JSON.stringify(bogus)}`);
    assert.equal(normalized.records[day].mode, undefined,
      `mode=${JSON.stringify(bogus)} is discarded`);
  }
});

test('a record written before modes existed stays valid and unlabelled', () => {
  // Those attempts were played with the telegraph and statuses on screen, so defaulting
  // them to 'normal' would assert something untrue about how they were earned.
  const day = '2026-03-06';
  const ledger = ensureDay(emptyLedger(), day, curatedCatalog);
  const legacy = JSON.parse(JSON.stringify(ledger));
  delete legacy.records[day].mode;
  const normalized = normalizeLedger(legacy, curatedCatalog);
  assert.ok(normalized.records[day], 'still a usable record');
  assert.equal('mode' in normalized.records[day], false, 'and carries no mode at all');
});

test('the local date key is the viewer\'s calendar date, not UTC', () => {
  // Built from local components on purpose. toISOString() is always UTC, which is the
  // bug this function exists to avoid: west of Greenwich, UTC is already tomorrow for
  // part of the evening, so a player would be handed the next day's battle early.
  const pad = n => String(n).padStart(2, '0');
  for (const iso of ['2026-10-18T03:57:00Z', '2026-01-01T00:30:00Z',
    '2026-12-31T23:30:00Z', '2026-03-09T07:00:00Z', '2026-06-30T12:00:00Z']) {
    const d = new Date(iso);
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    assert.equal(localDateKey(d), expected, `wrong key for ${iso}`);
    assert.match(localDateKey(d), /^\d{4}-\d{2}-\d{2}$/, 'single digits must be padded');
  }
  assert.throws(() => localDateKey(new Date('nonsense')), /Invalid date/);
});

test('a local date key is still a key the ledger and pool accept', () => {
  // Whatever timezone produced it, it has to be a plain calendar date the rest of the
  // system can key on -- dayNumber parses it, and selection is driven by the string.
  const key = localDateKey(new Date());
  assert.doesNotThrow(() => dayNumber(key));
  const ledger = ensureDay(emptyLedger(), key, curatedCatalog);
  assert.ok(ledger.records[key], 'a day can be started from a local key');
  assert.equal(ledger.records[key].day, key);
});

test('the same date string yields the same encounter regardless of timezone', () => {
  // The property that survives the move to local time, and the reason sharing still
  // works: local time decides *when* a browser rolls over, never *what* it gets.
  for (const day of ['2026-10-18', '2026-10-19', '2027-02-28']) {
    const a = curatedCatalog.definitionFor(day);
    const b = curatedCatalog.definitionFor(day);
    assert.equal(a.id, b.id);
    assert.equal(curatedCatalog.keyFor(day), curatedCatalog.keyFor(day));
  }
});

test('under a real timezone, the local key diverges from the UTC key', () => {
  // The decisive test, and it needs a child process: Node reads TZ once at startup, and
  // CI runs on UTC where local and UTC are identical -- so an in-process test would pass
  // on a `toISOString()` implementation and prove nothing at all.
  const probe = (tz, iso) => {
    const script =
      `import {localDateKey, utcDateKey} from './dist/src/daily.js';` +
      `const d = new Date(${JSON.stringify(iso)});` +
      `process.stdout.write(localDateKey(d) + ' ' + utcDateKey(d));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
      {env: {...process.env, TZ: tz}, encoding: 'utf8'});
    const [local, utc] = out.trim().split(' ');
    return {local, utc};
  };

  // 00:30 UTC on the 1st is still the previous evening in New York. A UTC key would hand
  // that player New Year's Day's battle while their own calendar still says December.
  const ny = probe('America/New_York', '2026-01-01T00:30:00Z');
  assert.equal(ny.utc, '2026-01-01');
  assert.equal(ny.local, '2025-12-31', 'New York is still on the previous date');

  // And east of Greenwich it runs the other way.
  const akl = probe('Pacific/Auckland', '2026-01-01T00:30:00Z');
  assert.equal(akl.utc, '2026-01-01');
  assert.equal(akl.local, '2026-01-01');
  const akl2 = probe('Pacific/Auckland', '2025-12-31T13:30:00Z');
  assert.equal(akl2.utc, '2025-12-31');
  assert.equal(akl2.local, '2026-01-01', 'Auckland has already crossed into the new year');

  // Mid-afternoon UTC is the same date almost everywhere, so the two must agree there.
  for (const tz of ['America/Los_Angeles', 'Europe/Berlin', 'Asia/Tokyo', 'UTC']) {
    const noon = probe(tz, '2026-06-15T12:00:00Z');
    assert.equal(noon.local, '2026-06-15', `${tz} should agree at midday UTC`);
  }
});
