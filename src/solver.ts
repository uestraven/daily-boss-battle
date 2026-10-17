import {advanceToDecision,applyPlayerAction,createEncounter,previewAction,starsForResult} from './engine.js';
import type {BattleInput,BattleState,EncounterDefinition,ActorState,ActiveStatus} from './types.js';

export type SearchOptions={
  beamWidth?:number;
  maxHeroActions?:number;
  maxExpansions?:number;
  maxSolutions?:number;
  forbiddenAbilities?:string[];
};
export type SearchSolution={
  actions:BattleInput[];
  actionTicks:number[];
  tick:number;
  stars:number;
  itemUses:number;
  survivors:number;
  remainingHP:number;
  bossActions:number;
  signature:string;
};
export type SearchReport={
  encounterId:string;
  parameters:Required<SearchOptions>;
  explored:number;
  expanded:number;
  invalidRejected:number;
  endedInDefeat:number;
  endedInVictory:number;
  guardFailures:number;
  deduplicated:number;
  truncated:boolean;
  beamPruned:boolean;
  budgetExhausted:boolean;
  depthLimitReached:boolean;
  exhausted:boolean;
  maxReachedDepth:number;
  solutions:SearchSolution[];
  note:string;
};

type Node={state:BattleState;actions:BattleInput[];actionTicks:number[];rank:number;fingerprint:string};
const copy=<T>(x:T):T=>JSON.parse(JSON.stringify(x)) as T;
const alive=(a:ActorState):boolean=>a.hp>0;
const canonical=(a:BattleInput):string=>`${a.actorId}:${a.abilityId}:${a.targetIds.join(',')}`;
const normalizedAbility=(id:string):string=>['fire','blizzard','thunder'].includes(id)?'elemental_spell':id;
function strategicSignature(inputs:BattleInput[]):string{
  return inputs.map(a=>`${a.actorId}:${normalizedAbility(a.abilityId)}:${a.targetIds.join(',')}`).join('|');
}
function relStatus(st:ActiveStatus|undefined,tick:number):unknown{
  if(!st)return null;
  return [st.expiresAt<0?-1:st.expiresAt-tick,st.nextPulseAt===undefined?null:st.nextPulseAt-tick];
}
function positionKey(s:BattleState,def:EncounterDefinition):string{
  const actorIds=[...def.party,def.bossId];
  const actors=actorIds.map(id=>{
    const a=s.actors[id]!;
    return [a.hp,a.mp,a.atb,a.ready,a.availableFrom-s.tick,a.channelingUntil===null?null:a.channelingUntil-s.tick,a.momentum,a.steals,Object.entries(a.abilityUses).sort(([x],[y])=>x.localeCompare(y)),
      Object.entries(a.statuses).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,relStatus(v,s.tick)])];
  });
  const position=(count:number,initial:string[],repeat:string[]):number=>count<initial.length?count:initial.length+(count-initial.length)%Math.max(1,repeat.length);
  return JSON.stringify([
    actors,s.inventory,s.covers.map(c=>[c.guardianId,c.protectedId,c.expiresAt-s.tick]),s.phase,
    position(s.phaseOneCount,def.bossProgram.phaseOne,def.bossProgram.phaseOneRepeat),
    position(s.phaseTwoCount,def.bossProgram.phaseTwo,def.bossProgram.phaseTwoRepeat),
    s.bossIntent?[s.bossIntent.abilityId,s.bossIntent.targetIds,s.bossIntent.phase]:null,
    s.pending.map(p=>[p.at-s.tick,p.actorId,p.abilityId,p.targetIds]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
    def.bossAI ? [s.bossActionCount,s.bossAI] : null
  ]);
}
function candidateTargets(s:BattleState,actorId:string,rule:string):string[][]{
  const actor=s.actors[actorId]!;
  const allies=actor.team==='heroes'?s.party:[s.bossId];
  const enemies=actor.team==='heroes'?[s.bossId]:s.party;
  switch(rule){
    case 'self':return [[actorId]];
    case 'single_living_ally':return allies.filter(id=>alive(s.actors[id]!)).map(id=>[id]);
    case 'single_other_ally':return allies.filter(id=>id!==actorId&&alive(s.actors[id]!)).map(id=>[id]);
    case 'single_ko_ally':return allies.filter(id=>!alive(s.actors[id]!)).map(id=>[id]);
    case 'single_living_enemy':return enemies.filter(id=>alive(s.actors[id]!)).map(id=>[id]);
    case 'all_living_allies':
    case 'all_living_enemies':return [[]];
    default:return [];
  }
}
/** Every returned action is legal under the existing battle reducer. Pure; no random choices. */
export function enumerateLegalActions(s:BattleState,def:EncounterDefinition):BattleInput[]{
  if(s.result)return [];
  const actions:BattleInput[]=[];
  const available=Object.values(def.abilities).sort((a,b)=>a.id.localeCompare(b.id));
  for(const id of s.party){
    const actor=s.actors[id]!;
    if(!actor.ready||!alive(actor)||actor.channelingUntil!==null)continue;
    for(const ability of available){
      if(ability.owner!=='any_hero'&&ability.owner!==id)continue;
      if(actor.mp<(ability.mpCost??0)||actor.momentum<(ability.momentumCost??0))continue;
      if(ability.item&&s.inventory[ability.item]<=0)continue;
      for(const targetIds of candidateTargets(s,id,ability.target)){
        const target=targetIds.length===1?s.actors[targetIds[0]!]!:null;
        if(ability.kind==='heal'&&target&&target.hp>=target.stats.hp)continue;
        if(ability.item==='potion'&&target&&target.hp>=target.stats.hp)continue;
        if(ability.item==='mana_vial'&&target&&target.mp>=target.stats.mp)continue;
        if(ability.kind==='cover'&&s.covers.some(c=>c.guardianId===id&&c.protectedId===targetIds[0]&&c.expiresAt>s.tick))continue;
        if(ability.kind==='focus'&&actor.statuses.focus)continue;
        if(ability.kind==='status'&&ability.status==='protect'&&target?.statuses.protect)continue;
        const input={actorId:id,abilityId:ability.id,targetIds};
        try{previewAction(s,input,def);actions.push(input);}catch{/* non-legal under engine */}
      }
    }
  }
  return actions.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
}
function evaluate(s:BattleState,def:EncounterDefinition):number{
  const boss=s.actors[s.bossId]!;
  const heroes=def.party.map(id=>s.actors[id]!);
  const living=heroes.filter(a=>a.hp>0);
  if(s.result==='defeat')return -1e8;
  const damage=(def.actors[s.bossId]!.stats.hp-boss.hp);
  const hpLeft=living.reduce((sum,a)=>sum+a.hp/a.stats.hp,0);
  const mpLeft=living.reduce((sum,a)=>sum+(a.stats.mp>0?a.mp/a.stats.mp:0),0);
  const focus=heroes.filter(a=>a.statuses.focus).length;
  const momentum=heroes.reduce((sum,a)=>sum+a.momentum,0);
  const aliveCount=living.length;
  const threat= s.bossIntent?.abilityId==='heavy_slash'&&s.bossIntent.targetIds.some(id=>{
    const a=s.actors[id]!;
    return a.hp>0 && a.hp<=155 && !s.covers.some(c=>c.protectedId===id&&c.expiresAt>s.tick);
  }) ? 100:0;
  return damage*3 + hpLeft*80+mpLeft*22+aliveCount*225+focus*45+momentum*32-threat - s.itemUses*35 - s.heroActionCount*0.5;
}
function toSolution(n:Node):SearchSolution{
  const s=n.state;
  return {actions:n.actions,actionTicks:n.actionTicks,tick:s.tick,stars:starsForResult(s),itemUses:s.itemUses,
    survivors:s.party.filter(id=>s.actors[id]!.hp>0).length,
    remainingHP:s.party.reduce((v,id)=>v+s.actors[id]!.hp,0),
    bossActions:s.bossActionCount,signature:strategicSignature(n.actions)};
}
function compareNode(a:Node,b:Node):number{return b.rank-a.rank||a.fingerprint.localeCompare(b.fingerprint);}
/** Deterministic bounded beam search. Not an exhaustive solvability or fairness proof. */
export function solveEncounter(def:EncounterDefinition,opts:SearchOptions={}):SearchReport{
  const p:Required<SearchOptions>={beamWidth:opts.beamWidth??96,maxHeroActions:opts.maxHeroActions??24,
    maxExpansions:opts.maxExpansions??18000,maxSolutions:opts.maxSolutions??8,forbiddenAbilities:opts.forbiddenAbilities??[]};
  if(!Number.isInteger(p.beamWidth)||p.beamWidth<1||p.beamWidth>2000)throw new Error('Invalid beamWidth');
  if(!Number.isInteger(p.maxHeroActions)||p.maxHeroActions<1||p.maxHeroActions>200)throw new Error('Invalid maxHeroActions');
  if(!Number.isInteger(p.maxExpansions)||p.maxExpansions<1||p.maxExpansions>500000)throw new Error('Invalid maxExpansions');
  if(!Number.isInteger(p.maxSolutions)||p.maxSolutions<1||p.maxSolutions>100)throw new Error('Invalid maxSolutions');
  if(!Array.isArray(p.forbiddenAbilities)||p.forbiddenAbilities.some(v=>typeof v!=='string'))throw new Error('Invalid forbiddenAbilities');
  const report:SearchReport={encounterId:def.id,parameters:p,explored:0,expanded:0,invalidRejected:0,
    endedInDefeat:0,endedInVictory:0,guardFailures:0,deduplicated:0,truncated:false,beamPruned:false,budgetExhausted:false,depthLimitReached:false,exhausted:false,maxReachedDepth:0,solutions:[],
    note:'Bounded search: no solution found does NOT imply the battle is unwinnable; distinct action traces do NOT prove strategically distinct solutions.'};
  const start=advanceToDecision(createEncounter(def),def).state;
  start.events=[];
  let frontier:Node[]=[{state:start,actions:[],actionTicks:[],rank:evaluate(start,def),fingerprint:positionKey(start,def)}];
  const globallySeen=new Map<string,number>();
  const signatures=new Set<string>();
  let budgetStopped=false;
  for(let depth=0;depth<p.maxHeroActions&&frontier.length>0;depth++){
    report.maxReachedDepth=depth;
    const next=new Map<string,Node>();
    for(const node of frontier){
      if(report.expanded>=p.maxExpansions){report.truncated=true;report.budgetExhausted=true;budgetStopped=true;break;}
      report.expanded++;
      for(const action of enumerateLegalActions(node.state,def)){
        if(p.forbiddenAbilities.includes(action.abilityId))continue;
        if(report.explored>=p.maxExpansions*20){report.truncated=true;report.budgetExhausted=true;budgetStopped=true;break;}
        report.explored++;
        let result:BattleState;
        try{result=applyPlayerAction(node.state,action,def).state;}
        catch(e){
          if(e instanceof Error && /exceeded|softlock|guard/.test(e.message))report.guardFailures++;
          else report.invalidRejected++;
          continue;
        }
        const actions=[...node.actions,action],actionTicks=[...node.actionTicks,node.state.tick];
        if(result.result==='defeat'){report.endedInDefeat++;continue;}
        if(result.result==='victory'){
          report.endedInVictory++;
          const sol:Node={state:result,actions,actionTicks,rank:Infinity,fingerprint:''};
          const found=toSolution(sol);
          if(!signatures.has(found.signature)){
            signatures.add(found.signature);report.solutions.push(found);
          }
          continue;
        }
        result.events=[]; // event logs are intentionally omitted from speculative search states.
        const key=positionKey(result,def);
        const rank=evaluate(result,def);
        const prevRank=globallySeen.get(key);
        if(prevRank!==undefined&&prevRank>=rank){report.deduplicated++;continue;}
        globallySeen.set(key,rank);
        const existing=next.get(key);
        const candidate:Node={state:result,actions,actionTicks,rank,fingerprint:key};
        if(!existing||compareNode(candidate,existing)<0)next.set(key,candidate);
        else report.deduplicated++;
      }
      if(budgetStopped)break;
    }
    report.solutions.sort((a,b)=>b.stars-a.stars||a.itemUses-b.itemUses||a.actions.length-b.actions.length||a.tick-b.tick||a.signature.localeCompare(b.signature));
    if(report.solutions.length>p.maxSolutions)report.solutions=report.solutions.slice(0,p.maxSolutions);
    if(budgetStopped)break;
    const sorted=[...next.values()].sort(compareNode);
    if(sorted.length>p.beamWidth){report.truncated=true;report.beamPruned=true;}
    frontier=sorted.slice(0,p.beamWidth);
  }
  report.depthLimitReached=frontier.length>0&&!report.budgetExhausted;
  if(report.depthLimitReached)report.truncated=true;
  report.exhausted=!report.truncated&&frontier.length===0;
  return report;
}

export type PolicyName='attack_only'|'defend_only'|'greedy_damage';
export type PolicyResult={policy:PolicyName;result:'victory'|'defeat'|'action_cap'|'error';tick:number;heroActions:number;bossActions:number;stars:number;survivors:number;itemsUsed:number;error?:string};
/** Diagnostic policy baselines, not a model of human play or estimated player win rates. */
export function runBaselinePolicy(def:EncounterDefinition,policy:PolicyName,maxHeroActions=120):PolicyResult{
  if(!Number.isInteger(maxHeroActions)||maxHeroActions<1||maxHeroActions>1000)throw new Error('Invalid action cap');
  let s=advanceToDecision(createEncounter(def),def).state;
  let failure:string|undefined;
  while(!s.result&&s.heroActionCount<maxHeroActions){
    const choices=enumerateLegalActions(s,def);
    if(!choices.length){failure='No legal actions at ready player decision';break;}
    let chosen:BattleInput|undefined;
    if(policy==='attack_only')chosen=choices.find(a=>a.abilityId==='attack');
    if(policy==='defend_only')chosen=choices.find(a=>a.abilityId==='defend');
    if(policy==='greedy_damage'){
      let max=-Infinity;
      for(const a of choices){
        const preview=previewAction(s,a,def);
        const damage=preview.events.filter(e=>e.type==='damage'&&e.targetId===s.bossId).reduce((v,e)=>v+(e.amount??0),0);
        const rank=damage - preview.mpCost*0.01;
        if(rank>max){max=rank;chosen=a;}
      }
    }
    if(!chosen){failure=`Required policy action unavailable: ${policy}`;break;}
    try{s=applyPlayerAction(s,chosen,def).state;}
    catch(e){failure=e instanceof Error?e.message:String(e);break;}
    // Do not retain large combat logs for stress probes.
    s.events=[];
  }
  return {policy,result:failure?'error':s.result??'action_cap',tick:s.tick,heroActions:s.heroActionCount,bossActions:s.bossActionCount,
    stars:starsForResult(s),survivors:s.party.filter(id=>s.actors[id]!.hp>0).length,itemsUsed:s.itemUses,...(failure?{error:failure}:{})};
}
