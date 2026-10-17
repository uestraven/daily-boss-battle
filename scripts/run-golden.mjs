import { readFileSync } from 'node:fs';
import { reference001 } from '../dist/src/reference.js';
import { advanceToDecision, applyPlayerAction, createEncounter, starsForResult } from '../dist/src/engine.js';
const witness=JSON.parse(readFileSync(new URL('../fixtures/witness-v06.json',import.meta.url),'utf8'));
let step=advanceToDecision(createEncounter(reference001),reference001);
for(const action of witness.playerActions){
  console.log('EXPECTED',action.expectedTick,'ACTUAL',step.state.tick,'HERO',action.actorId,action.abilityId,'AVAILABLE',step.readyHeroIds);
  if(action.expectedTick!==step.state.tick)throw new Error(`Expected tick ${action.expectedTick}, actual ${step.state.tick}`);
  step=applyPlayerAction(step.state,action,reference001);
}
const {state}=step;
console.log(JSON.stringify({result:state.result,tick:state.tick,heroActions:state.heroActionCount,bossActions:state.bossActionCount,stars:starsForResult(state),actors:Object.fromEntries(Object.entries(state.actors).map(([id,a])=>[id,{hp:a.hp,mp:a.mp,momentum:a.momentum}])),inventory:state.inventory},null,2));
