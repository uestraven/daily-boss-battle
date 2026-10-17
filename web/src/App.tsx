import {useEffect, useMemo, useState} from 'react';
import {BattleBackdrop,BackgroundStudio} from './BackgroundStudio.js';
import {backgroundForBoss} from './background-catalog.js';
import {advanceToDecision, applyPlayerAction, createEncounter, effectiveSpeed, nextBossCountdown, previewAction, replay, starsForResult} from '../../dist/src/engine.js';
import {reference001} from '../../dist/src/reference.js';
import {tyrantVariant007} from '../../dist/src/variant.js';
import {tyrantAI008} from '../../dist/src/ai-variant.js';
import {practiceEncounters,bossProfiles} from '../../dist/src/encounters.js';
import {heroes} from '../../dist/src/roster.js';
import {utcDateKey,dailyDefinition,normalizeLedger,emptyLedger,ensureDay,stepForDay,playDailyAction,dailyStatistics} from '../../dist/src/daily.js';
import type {DailyLedger} from '../../src/daily.js';
import {actionInput, availableActions, eligibleTargets, previewDisplay} from '../../dist/src/play-ui.js';
import type {ActorId, ActorState, BattleEvent, BattleInput, BattleState, BattleStep, EncounterDefinition} from '../../src/types.js';
import witness from '../../fixtures/witness-v06.json';
import variantFocus from '../../fixtures/variant-v07-focus.json';
import aiWitness from '../../fixtures/variant-v08-ai.json';
import { RpgWindow } from './components/RpgWindow';
import { RpgCommandMenu } from './components/RpgCommandMenu';
import {
  BattleStageParty,
  BattleStageBossImpacts
} from './components/BattleStageParty';
import { BattleBossSprite } from './components/BattleSprite';

type Edition = 'v06' | 'v07' | 'v08' | 'tide_maw' | 'ink_lurker' | 'crush_wall' | 'storm_keeper' | 'spell_weaver';
const editions: Record<Edition, EncounterDefinition> = {v06: reference001, v07: tyrantVariant007, v08: tyrantAI008,
  tide_maw:practiceEncounters.tide_maw!,ink_lurker:practiceEncounters.ink_lurker!,
  crush_wall:practiceEncounters.crush_wall!,storm_keeper:practiceEncounters.storm_keeper!,spell_weaver:practiceEncounters.spell_weaver!};
const storageKey = (edition:Edition) => `dffb-playtest-${edition}-${editions[edition].contentVersion}`;
function fresh(def: EncounterDefinition): BattleStep {return advanceToDecision(createEncounter(def),def);}
function load(edition:Edition): BattleStep {
  const def = editions[edition];
  try {
    const raw = localStorage.getItem(storageKey(edition));
    if (raw) return advanceToDecision(JSON.parse(raw) as BattleState,def);
  } catch { /* Old or corrupted test state: initialize a clean battle. */ }
  return fresh(def);
}
const ledgerStorageKey='dffb-local-daily-ledger-v1';
function readLedger():DailyLedger {
  try{return normalizeLedger(JSON.parse(localStorage.getItem(ledgerStorageKey)??'null'));}
  catch{return emptyLedger();}
}
function saveLedger(ledger:DailyLedger):void {
  try{localStorage.setItem(ledgerStorageKey,JSON.stringify(ledger));}catch{/* Local saving unavailable; never promise durable persistence. */}
}
type Mode='daily'|'practice'|'daily_replay';
const shortName = (id: string, def: EncounterDefinition) => def.actors[id]?.name.split(' ')[0] ?? id;
const meter = (value:number,max:number) => `${Math.max(0,Math.min(100,max > 0 ? value/max*100 : 0))}%`;
const words = (value:string) => value.split('_').join(' ');
function elapsed(impact:number | undefined, ready:number) {
  return impact != null ? `${impact} ticks to impact` : ready===0 ? 'Ready now' : `${ready} ticks to act`;
}
function StatusPills({actor,state}:{actor:ActorState;state:BattleState}) {
  const statuses = Object.entries(actor.statuses);
  const covers = state.covers.filter(x=>x.guardianId===actor.id || x.protectedId===actor.id);
  if (!statuses.length && !covers.length && actor.momentum===0) return null;
  return <div className="status-row">
    {statuses.map(([name,value]) => <span className={'status-pill status-'+name} key={name} title={value.expiresAt >= 0 ? `Expires at tick ${value.expiresAt}` : 'Until next action'}>{name} {value.expiresAt>=0 ? Math.max(0,value.expiresAt-state.tick)+'t':''}</span>)}
    {covers.map((x,i) => <span className="status-pill status-cover" key={i}>🛡 {x.guardianId === actor.id ? 'covering' : 'covered'} {Math.max(0,x.expiresAt-state.tick)}t</span>)}
    {actor.momentum>0&&<span className="status-pill status-momentum">✦ Momentum {actor.momentum}/2</span>}
  </div>;
}
function PixelBoss({name}:{name:string}) {
  return <svg className="boss-figure" viewBox="0 0 240 240" role="img" aria-label={`Placeholder boss silhouette for ${name}`}>
    <defs><linearGradient id="armor" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d6c397"/><stop offset=".55" stopColor="#81759d"/><stop offset="1" stopColor="#3f3867"/></linearGradient></defs>
    <path d="M112 12 L132 12 L142 42 L178 31 L164 72 L196 108 L182 128 L202 165 L178 166 L193 219 L45 219 L60 166 L37 165 L60 126 L48 106 L79 72 L65 30 L100 42 Z" fill="#17112f" stroke="#443b71" strokeWidth="4" />
    <path d="M103 19 L125 13 L135 52 L116 70 L98 51 Z" fill="#d9b46a"/><path d="M66 60 L101 45 L117 72 L136 46 L173 60 L162 97 L78 97 Z" fill="url(#armor)"/>
    <path d="M77 99 L103 91 L117 100 L139 90 L165 99 L170 151 L150 191 L88 191 L70 151 Z" fill="#766785" stroke="#ccb989" strokeWidth="5"/>
    <path d="M90 112 L110 121 L119 151 L127 120 L153 109 L145 166 L120 181 L94 166 Z" fill="#3f345c"/>
    <path d="M76 89 L91 72 L107 81 L116 99 L128 81 L146 72 L162 89 L150 108 L130 99 L118 111 L105 99 L89 107 Z" fill="#c2b79c"/>
    <path d="M92 87 L110 87 L105 95 L89 97 Z M126 87 L147 87 L149 96 L131 95 Z" fill="#f0ba76"/>
    <path d="M57 110 L35 133 L29 186 L45 190 L65 147 L84 128 Z M180 106 L201 130 L213 180 L193 189 L173 146 L155 126 Z" fill="#75628d" stroke="#ccab86" strokeWidth="4"/>
    <path d="M30 184 L17 206 L41 212 L48 185 Z M190 184 L203 210 L226 205 L210 180 Z" fill="#b5a1a4"/>
    <path d="M77 187 L71 225 L101 224 L113 191 Z M133 191 L146 224 L176 225 L164 188 Z" fill="#514266" stroke="#a695b3" strokeWidth="4"/>
    <path d="M180 30 L202 20 L203 146 L185 155 Z" fill="#d6d4e3" stroke="#605a87" strokeWidth="4"/>
    <path d="M176 31 L208 33 L195 12 Z" fill="#f2dfc2" />
    <path d="M118 109 L123 122 L118 135 L113 122 Z" fill="#d7aa61"/>
  </svg>;
}
function Meter({value,max,color}:{value:number;max:number;color:'hp'|'mp'|'atb'}) {
 return <div className={'meter meter-'+color}><div className="meter-fill" style={{width:meter(value,max)}} /></div>;
}
function HeroCard({
  id,
  def,
  state,
  selected,
  ready,
  onChoose
}: {
  id: string;
  def: EncounterDefinition;
  state: BattleState;
  selected: boolean;
  ready: boolean;
  onChoose: () => void;
}) {
  const actor = state.actors[id]!;
  const hero = heroes.find(h => h.id === id);

  return (
    <button
      type="button"
      className={[
        'hero-card',
        selected ? 'is-selected' : '',
        ready ? 'is-ready' : '',
        actor.hp === 0 ? 'is-ko' : ''
      ].filter(Boolean).join(' ')}
      onClick={onChoose}
      disabled={!ready}
      aria-pressed={selected}
    >
      <div className="hero-top">
        <span className="rpg-hero-cursor" aria-hidden="true">
          {selected ? '▶' : ''}
        </span>

        <div className="hero-identity">
          <span className="hero-name">
            {shortName(id, def)}
          </span>

          <span className="hero-class">
            {hero?.role.toUpperCase() ?? 'HERO'}
          </span>
        </div>

        <span className={ready ? 'ready-tag' : 'speed-tag'}>
          {actor.hp === 0
            ? 'KO'
            : ready
              ? 'READY'
              : `SPD ${effectiveSpeed(actor)}`}
        </span>
      </div>

      <div className="rpg-hero-stat">
        <div className="rpg-stat-line">
          <span>HP</span>
          <strong>{actor.hp} / {actor.stats.hp}</strong>
        </div>
        <Meter
          value={actor.hp}
          max={actor.stats.hp}
          color="hp"
        />
      </div>

      <div className="rpg-hero-stat">
        <div className="rpg-stat-line">
          <span>MP</span>
          <strong>{actor.mp} / {actor.stats.mp}</strong>
        </div>
        <Meter
          value={actor.mp}
          max={Math.max(1, actor.stats.mp)}
          color="mp"
        />
      </div>

      <div className="rpg-hero-stat">
        <div className="rpg-stat-line">
          <span>ATB</span>
          <strong>
            {ready ? 'READY' : `${actor.atb} / 1000`}
          </strong>
        </div>
        <Meter value={actor.atb} max={1000} color="atb" />
      </div>

      <StatusPills actor={actor} state={state} />
    </button>
  );
}
function describeEvent(e:BattleEvent,def:EncounterDefinition):string {
 const subject = e.actorId ? shortName(e.actorId,def):'Battle';
 const target = e.targetId ? shortName(e.targetId,def):'';
 const ability = e.abilityId ? def.abilities[e.abilityId]?.name ?? words(e.abilityId):'';
 switch(e.type){
  case 'damage':return `${subject} · ${ability} → ${target} −${e.amount} HP`;
  case 'heal':return `${subject} heals ${target} +${e.amount} HP`;
  case 'action_committed':return `${subject} uses ${ability}`;
  case 'boss_intent':return `${subject} prepares ${ability}${e.details?.includes('targets=') ? '': ''}`;
  case 'boss_intent_changed':return `Boss intent changed: ${e.details}`;
  case 'boss_counter_queued':return `Counter queued against ${target} (${e.details})`;
  case 'status_removed':return `${ability} removes ${e.details} from ${target}`;
  case 'phase_change':return `${def.actors[def.bossId]?.name??'Boss'} enters phase II`;
  case 'cover_redirect':return `${subject} intercepts the blow for ${target}`;
  case 'channel_started':return `${ability} begins charging`;
  case 'channel_resolved':return `${ability} resolves`;
  case 'status_applied':return `${subject}: ${e.details}`;
  case 'status_expired':return `${subject}: ${e.details} expired`;
  case 'focus_consumed':return `${subject}'s Focus is consumed`;
  case 'momentum':return `${subject} builds Momentum (${e.amount}/2)`;
  case 'ko':return `${subject} is knocked out`;
  case 'victory':return `Victory! ${def.actors[def.bossId]?.name??'Boss'} falls.`;
  case 'defeat':return 'Defeat. Your party has fallen.';
  case 'revived':return `${target} is revived`;
  case 'mp_restored':return `${target} recovers ${e.amount} MP`;
  case 'nullify_absorb':return `${subject} absorbs the spell with Nullify (+${e.amount} MP)`;
  case 'steal_success':return `${subject} steals ${e.details}; successful steals ${e.amount}`;
  case 'boss_interrupted':return `${subject} interrupts the boss's casting`;
  case 'elemental_edge_consumed':return `${subject} consumes Elemental Edge`;
  case 'fizzle':return `${ability} fizzles; original target unavailable`;
  default:return `${subject}: ${words(e.type)}${e.details ? ` · ${e.details}` : ''}`;
 }
}
export default function App(){
 const [day,setDay] = useState(()=>utcDateKey(new Date()));
 const [ledger,setLedger] = useState<DailyLedger>(()=>ensureDay(readLedger(),utcDateKey(new Date())));
 const [mode,setMode] = useState<Mode>('daily');
 const [edition,setEdition] = useState<Edition>('v08');
 const [step,setStep] = useState<BattleStep>(()=>stepForDay(ensureDay(readLedger(),utcDateKey(new Date())),utcDateKey(new Date())));
 const def=mode==='practice'?editions[edition]:dailyDefinition(day);
 const state=step.state;
 const [selectedHero,setSelectedHero]=useState<ActorId>(()=>step.readyHeroIds[0]??'');
 const [abilityId,setAbilityId]=useState('attack');
 const [targetId,setTargetId]=useState<string>('');
 const [tab,setTab]=useState<'actions'|'details'>('actions');
 const [showAllLog,setShowAllLog]=useState(false);
 const [showHistory,setShowHistory]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [newDayAvailable,setNewDayAvailable]=useState(false);
 const [artOpen,setArtOpen]=useState(false);
 const [backgroundRefresh,setBackgroundRefresh]=useState(0);
 useEffect(()=>{saveLedger(ledger);},[ledger]);
 useEffect(()=>{if(mode!=='practice')return;try{localStorage.setItem(storageKey(edition),JSON.stringify(state));}catch{}},[mode,edition,state]);
 useEffect(()=>{
   const update=()=>setNewDayAvailable(utcDateKey(new Date())!==day);
   update();const timer=window.setInterval(update,60_000);
   return ()=>window.clearInterval(timer);
 },[day]);
 const activeRecord=ledger.records[day];
 const stats=dailyStatistics(ledger,utcDateKey(new Date()));
 const pastRecords=Object.values(ledger.records).filter(r=>r.day!==day).sort((a,b)=>b.day.localeCompare(a.day)).slice(0,8);
 const actorId=step.readyHeroIds.includes(selectedHero)?selectedHero:(step.readyHeroIds[0]??'');
 const offered=useMemo(()=>actorId?availableActions(state,def,actorId):[],[actorId,state,def]);
 const ability=offered.find(x=>x.ability.id===abilityId)?.ability??offered.find(x=>x.enabled)?.ability??offered[0]?.ability;
 const eligible=ability&&actorId?eligibleTargets(state,actorId,ability):[];
 const input: BattleInput | null = ability&&actorId?actionInput(state,actorId,ability,targetId):null;
 const evaluated=useMemo(()=>{
   if(!input) return {preview:null,display:null,error:null};
   try{const preview=previewAction(state,input,def);return {preview,display:previewDisplay(state,def,input,preview),error:null};}
   catch(e){return {preview:null,display:null,error:e instanceof Error?e.message:'Action unavailable'};}
 },[state,def,input?.actorId,input?.abilityId,input?.targetIds.join('|')]);
 const countdown=nextBossCountdown(state);
 const intent=state.bossIntent?def.abilities[state.bossIntent.abilityId]:null;
 const boss=state.actors[state.bossId]!;
 const bossName=def.actors[def.bossId]?.name??'Boss';
 const bossProfile=bossProfiles.find(b=>b.id===def.bossId);
 const affinityNotes=Object.entries(def.affinities?.[def.bossId]??{});
 const recent=showAllLog?state.events.slice().reverse():state.events.slice(-12).reverse();
 const chooseStep=(next:BattleStep)=>{
   setStep(next);setSelectedHero(next.readyHeroIds[0]??'');setAbilityId('attack');setTargetId('');setError(null);
 };
 const reset=()=>{
   if(mode==='daily')return; // Official attempts cannot be restarted.
   if(mode==='daily_replay'){chooseStep(fresh(dailyDefinition(day)));return;}
   try{localStorage.removeItem(storageKey(edition));}catch{}
   chooseStep(fresh(editions[edition]));
 };
 const switchPractice=(nextEdition:Edition=edition)=>{
   setMode('practice');setEdition(nextEdition);chooseStep(load(nextEdition));
 };
 const switchDaily=(nextDay:string=utcDateKey(new Date()))=>{
   try{
     const next=ensureDay(ledger,nextDay);
     saveLedger(next);setLedger(next);setDay(nextDay);setMode('daily');
     chooseStep(stepForDay(next,nextDay));
   }catch(e){setError(e instanceof Error?e.message:'Could not open daily challenge');}
 };
 const switchDailyReplay=()=>{setMode('daily_replay');chooseStep(fresh(dailyDefinition(day)));};
 const submit=()=>{
   if(!input)return;
   try{
     if(mode==='daily'){
       const result=playDailyAction(ledger,day,input);
       saveLedger(result.ledger);setLedger(result.ledger);chooseStep(result.step);
     }else chooseStep(applyPlayerAction(state,input,def));
   }catch(e){setError(e instanceof Error?e.message:'Action failed');}
 };
 const demo=()=>{
   try{
     if(mode!=='practice'||!['v06','v07','v08'].includes(edition))throw new Error('Verified replay is available only for practice Blade Tyrant');
     const fixture=edition==='v06'?witness:edition==='v07'?variantFocus:aiWitness;
     const actions=fixture.playerActions.map(x=>({actorId:x.actorId,abilityId:x.abilityId,targetIds:x.targetIds}));
     chooseStep(replay(def,actions));
   }catch(e){setError(e instanceof Error?e.message:'Demo replay failed');}
 };
 const survivors=state.party.filter(id=>state.actors[id]!.hp>0).length;
 return <div className="app-shell">
  <header className="masthead">
   <div className="brand-lockup"><div className="brand-mark">✦<span>B</span>✦</div><div><div className="brand-eyebrow">A DAILY TACTICAL ENCOUNTER</div><h1>DAILY BOSS <em>BATTLE</em></h1></div></div>
   <div className="header-right"><span className="live-dot"/><span className="mode-text">{mode==='daily'?'OFFICIAL LOCAL DAILY':'PRACTICE LAB'}</span><span className="separator"/><span className="build-pill">BUILD 1.0 DAILY · LOCAL ALPHA</span></div>
  </header>
  <div className="content">
   <div className="mode-switch" role="navigation" aria-label="Battle mode">
     <button className={mode==='daily'?'selected':''} onClick={()=>switchDaily()}>✦ Daily challenge</button>
     <button className={mode==='practice'?'selected':''} onClick={()=>switchPractice()}>⚔ Practice lab</button>
     {mode==='daily_replay'&&<button className="selected" onClick={()=>switchDaily()}>↺ Daily practice replay</button>}
   </div>
   {mode!=='practice'&&<section className="daily-dashboard" aria-label="Daily progress">
      <div><strong>{day}</strong><span>UTC · {mode==='daily'?'official attempt':'unranked replay'}</span></div>
      <div><strong>{stats.completed}</strong><span>days played</span></div>
      <div><strong>{stats.wins}</strong><span>victories</span></div>
      <div><strong>{stats.participationStreak}</strong><span>participation streak</span></div>
      <div><strong>{stats.victoryStreak}</strong><span>victory streak</span></div>
      {activeRecord?.completed&&mode==='daily'&&<div className="daily-result-label">Official {activeRecord.result} · {activeRecord.stars} ★</div>}
      {newDayAvailable&&<button className="subtle-button" onClick={()=>switchDaily()}>Open today's new challenge ↗</button>}
      {pastRecords.some(x=>!x.completed)&&<div className="daily-resume"><span>Resume unfinished:</span>{pastRecords.filter(x=>!x.completed).map(r=><button key={r.day} onClick={()=>switchDaily(r.day)}>{r.day}</button>)}</div>}
      {pastRecords.length>0&&<div className="daily-resume"><button onClick={()=>setShowHistory(x=>!x)}>{showHistory?'Hide':'Show'} recent results</button>{showHistory&&pastRecords.filter(r=>r.completed).map(r=><span key={r.day}>{r.day}: {r.result} · {r.stars}★</span>)}</div>}
      <div className="daily-local-note">Saved in this browser only · Clearing browser data removes results · No account sync</div>
   </section>}
   <div className="page-heading"><div><div className="eyebrow">{mode==='practice'?'PRACTICE ENCOUNTER':`DAILY CHALLENGE · ${day}`} <span className="eyebrow-line"/> {bossProfile?bossProfile.theme.toUpperCase():'THE BROKEN SPAN'}</div><h2>{mode==='practice'?(bossProfile?`Challenge: ${bossName}`:'Clash on the Broken Span'):`Today: ${bossName}`}</h2><p>{mode==='practice'?(bossProfile?bossProfile.theme:'Three heroes. One legendary foe. Every action counts.'):'A curated three-hero team, one boss, and one official result. All players receive the same encounter for this UTC date.'}</p></div>
    <div className="dev-controls">{mode==='practice'?<><label htmlFor="edition">BATTLE VERSION</label><div className="select-wrap"><select id="edition" value={edition} onChange={(e: {target: {value: string}})=>switchPractice(e.target.value as Edition)}><option value="v08">v0.8 · Scripted + seeded AI</option><option value="v07">v0.7 · Balance candidate</option><option value="v06">v0.6 · Original reference</option>{bossProfiles.map(b=><option key={b.id} value={b.id}>{b.name} — practice</option>)}</select></div></>:<><label>DAILY MODE</label><div className="daily-status-line">{mode==='daily'?(activeRecord?.completed?'RESULT LOCKED':'OFFICIAL ATTEMPT IN PROGRESS'):'UNRANKED REPLAY'}</div></>}
      <div className="control-actions">{mode!=='daily'&&<button onClick={()=>reset()} className="subtle-button">↻ Restart</button>}{mode==='practice'&&!bossProfile&&<button className="subtle-button" onClick={demo}>▷ Load verified win</button>}{mode==='daily_replay'&&<button onClick={()=>switchDaily(day)} className="subtle-button">↩ Official result</button>}</div>
    </div>
   </div>
   <div className="play-layout">
    <main className="battle-column">
     <section className="battle-scene retro-combat-stage" aria-label="Battlefield">
      <BattleBackdrop bossId={def.bossId} refresh={backgroundRefresh} onManage={()=>setArtOpen(true)}/>
      <div className="scene-stars"/>
      <div className="arena-pill"><span className="tiny-diamond"/> PHASE {state.phase} <span className="tiny-diamond"/> <span>VIRTUAL TICK {state.tick}</span></div>
      <div className="boss-zone">
       <div className="boss-aura"/>
       <BattleBossSprite
          bossId={def.bossId}
          bossName={bossName}
          fallback={<PixelBoss name={bossName}/>}
        />
       <div className="boss-ground"/>
      </div>
      <BattleStageParty
        state={state}
        def={def}
        selectedHeroId={actorId}
        readyHeroIds={step.readyHeroIds}
        recentEvents={step.events}
        spriteUrls={{
          warden: '/battle-sprites/heroes/warden.png',
          nullifier: '/battle-sprites/heroes/nullifier.png'
        }}
        onChooseHero={(id) => {
          setSelectedHero(id);
          setAbilityId('attack');
          setTargetId('');
          setError(null);
        }}
      />

      <BattleStageBossImpacts
        state={state}
        recentEvents={step.events}
      />
      <div className="boss-ui"><div className="boss-label"><div><div className="boss-rank">{bossProfile?`${mode==='practice'?'PRACTICE':'DAILY'} BOSS`:'THE BLADE TYRANT'}</div><div className="boss-name">{bossName.toUpperCase()} <span>LV. ??</span></div></div><div className="boss-numbers"><strong>{boss.hp.toLocaleString()}</strong><span> / {boss.stats.hp.toLocaleString()} HP</span></div></div><div className="boss-hp-track"><div style={{width:meter(boss.hp,boss.stats.hp)}} /></div><StatusPills actor={boss} state={state}/></div>
      <div className="scene-bottom">{state.result ? (state.result==='victory'?'✦ VICTORY — ENCOUNTER COMPLETE ✦':'✕ DEFEAT — THE BATTLE ENDS ✕') : '✦  BATTLE PAUSED — AWAITING YOUR COMMAND  ✦'}</div>
     </section>
     <RpgWindow  className="hero-section"><div className="section-title"><span>YOUR PARTY</span><span>{survivors} / 3 STANDING</span></div><div className="hero-grid">{state.party.map(id=><HeroCard key={id} id={id} def={def} state={state} selected={actorId===id&&!state.result} ready={step.readyHeroIds.includes(id)} onChoose={()=>{setSelectedHero(id);setAbilityId('attack');setTargetId('');setError(null);}} />)}</div></RpgWindow >
     <section className="combat-footer"><div><span className="symbol">◇</span> Reproducible Tactical ATB <span className="dot-sep">·</span> Wait Mode</div><div>NO TIMER PRESSURE <span className="dot-sep">·</span> NO RANDOM MISSES</div></section>
    </main>
    <aside className="command-column">
      <RpgWindow  className="intent-card"><div className="sidebar-eyebrow"><span className="intent-dot"/> ENEMY INTENT</div>
        {state.result? <div className="intent-complete">The encounter has ended.</div>: <><div className="intent-heading"><span className="intent-icon">⚔</span><div><h3>{intent?.name??'Unknown attack'}</h3><div className="intent-sub">{elapsed(countdown?.impactIn,countdown?.readyIn??0)}</div></div></div><div className="intent-info">{intent?.kind==='physical'?'Physical':intent?.kind==='magical'?'Magical':intent?.kind==='status'?'Support effect':'Special'} <span className="info-dot">·</span> {intent?.target.replaceAll('_',' ')}</div><div className="intent-targets"><span>TARGET{state.bossIntent?.targetIds.length===1?'':'S'}</span><strong>{(state.bossIntent?.targetIds??[]).map(x=>shortName(x,def)).join(', ') || 'None'}</strong></div>{state.bossIntent?.targetDescription && <div className="intent-target-rule">{state.bossIntent.targetDescription} · {state.bossIntent.origin==='counter'?'COUNTER':state.bossIntent.origin==='override'?'CONDITIONAL OVERRIDE':'SCRIPTED'}</div>}</>}
        {affinityNotes.length>0&&<div className="affinity-note"><span>ELEMENTAL READOUT</span><div>{affinityNotes.map(([el,aff])=><b key={el} className={aff==='weak'?'weak':aff==='resist'?'resist':''}>{el.toUpperCase()} · {aff.toUpperCase()}</b>)}</div></div>}
      </RpgWindow >
      <RpgWindow  className="command-card">
       {state.result ? <div className="result-area"><div className="result-rune">{state.result==='victory'?'✦':'✕'}</div><h3>{state.result==='victory'?'VICTORY':'DEFEAT'}</h3><div className="result-stars">{Array.from({length:3},(_,i)=><span key={i} className={i<starsForResult(state)?'earned':''}>★</span>)}</div><p>{state.result==='victory'?`${survivors} heroes standing · ${state.heroActionCount} hero actions · ${state.itemUses} items used`:'Try a new approach. Every attack follows the same rules.'}</p><button className="primary-button" onClick={()=>mode==='daily'?switchDailyReplay():reset()}>{mode==='daily'?'PRACTICE THIS CHALLENGE ↗':'PLAY AGAIN ↗'}</button><div className="result-caption">{mode==='daily'?'Official result saved locally and locked for this date':'Practice mode · Does not change any official daily result'}</div></div>
       :<><div className="command-header"><div><div className="sidebar-eyebrow">YOUR TURN</div><h3>{actorId?`${shortName(actorId,def)}'s commands`:'Waiting for hero'}</h3></div><span className="turn-glyph">✣</span></div>
       {step.readyHeroIds.length>1&&<div className="ready-switch" aria-label="Ready hero selection">{step.readyHeroIds.map(id=><button key={id} className={actorId===id?'active':''} onClick={()=>{setSelectedHero(id);setAbilityId('attack');setTargetId('');}}>{shortName(id,def)}</button>)}</div>}
       <RpgCommandMenu
          actorId={actorId}
          actions={offered}
          state={state}
          selectedAbilityId={ability?.id}
          onChooseAbility={(id) => {
            setAbilityId(id);
            setTargetId('');
            setError(null);
          }}
        />
       <div className="target-block"><div className="sidebar-eyebrow">{ability?.target.startsWith('all_')?'TARGETS':'SELECT TARGET'}</div>{ability?<div className="target-choice">{eligible.map(id=><button className={(input?.targetIds[0]??eligible[0])===id?'active':''} key={id} onClick={()=>setTargetId(id)} disabled={ability.target.startsWith('all_')||ability.target==='self'}>{shortName(id,def)} <span>{state.actors[id]?.hp===0?'KO':`${state.actors[id]?.hp} HP`}</span></button>)}</div>:<p className="muted">No actions available.</p>}</div>
       <div className="preview-block"><div className="sidebar-eyebrow">ACTION FORECAST <span className="forecast-mark">◇ EXACT</span></div>{evaluated.display? <><div className="preview-lines">{evaluated.display.lines.map((line,i)=><div key={i}>{line}</div>)}</div>{evaluated.preview&&<div className="preview-meta"><span>Resolves tick {evaluated.preview.resolvesAt}</span>{evaluated.preview.mpCost>0&&<span>−{evaluated.preview.mpCost} MP</span>}</div>}{evaluated.display.approximate&&<div className="estimate-note">Delayed impact estimate — intervening events may change the outcome.</div>}</>:<p className="muted">{evaluated.error??'Select an available action'}</p>}</div>
       {error&&<div className="error-box" role="alert">{error}</div>}
       <button className="primary-button" onClick={submit} disabled={!evaluated.preview}>CONFIRM ACTION <span>→</span></button>
       <div className="command-hint">Time is paused while you choose. Take your time.</div></>}
      </RpgWindow >
      <RpgWindow className="log-card"><div className="log-header"><div className="sidebar-eyebrow">BATTLE CHRONICLE</div><button onClick={()=>setShowAllLog(x=>!x)}>{showAllLog?'LATEST':'VIEW ALL'} ↗</button></div><div className="log-list" aria-live="polite">{recent.length?recent.map((e,i)=><div className={'log-line '+(e.type==='victory'?'log-victory':'')} key={`${e.tick}-${e.type}-${i}`}><span className="log-time">T{String(e.tick).padStart(2,'0')}</span><span>{describeEvent(e,def)}</span></div>):<div className="muted">Battle awaits your first decision.</div>}</div></RpgWindow>
    </aside>
   </div>
   {artOpen&&<BackgroundStudio initialId={backgroundForBoss(def.bossId)} onClose={()=>setArtOpen(false)} onChange={()=>setBackgroundRefresh(n=>n+1)}/>}
   <footer className="site-footer"><span>✦ DAILY BOSS BATTLE</span><span>LOCAL ALPHA · NO ACCOUNT SYNC / LOCAL PLAYTEST BUILD</span></footer>
  </div>
 </div>;
}
