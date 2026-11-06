import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { FlightPresentation } from '../src/flight-presentation';
import { acknowledgeInputReset, createGame, startGame, stepFixed } from '../src/simulation';
import { aircraftRef, scheduleRespawn } from '../src/respawn';
import { updateQuaternion } from '../src/flight';
import { getFlightCameraPose } from '../src/flight-view';
import { aimIndicator } from '../src/aim-indicator';
import { projectGunSight } from '../src/gun-sight';
import type { FlightInput, GameMode, GameState } from '../src/types';

// Compare every enumerable authoritative field. A new match gets a unique ID;
// normalize only that ID and all occurrences in its event/reference identities.
const snapshot = (state: GameState) => JSON.parse(JSON.stringify(state).split(state.matchId).join('fixed-match'));
const width=874,height=402;
function fixture(mode: GameMode) {
  const state=createGame(73,mode),player=state.player;
  player.position.set(-1400,300,130);player.previous.copy(player.position);player.yaw=0;updateQuaternion(player);
  for(const enemy of state.enemies)scheduleRespawn(state,enemy);
  const target=state.enemies[0];target.health=1;target.lifecycle='active';target.respawnDuePlayTick=null;target.respawnRef=null;
  target.position.set(-1400,300,-100);target.previous.copy(target.position);target.yaw=0;updateQuaternion(target);
  // Legal carried-core state; scoring still requires the real collection reducer.
  state.flags.enemy={...state.flags.enemy,state:'carried',carrier:aircraftRef(state,player)};
  startGame(state);acknowledgeInputReset(state,state.inputEpoch);return state;
}
const input=(tick:number):FlightInput=>({turn:tick>20?.05:0,climb:tick>20?.03:0,steeringActive:true,fire:true,loop:false,viewAspect:width/height});
for(const mode of ['easy','normal'] as const)test(`${mode}: 30/60/120Hz samples preserve complete shooting, core score, clocks and result at 180 fixed steps`,()=>{
  const reference=fixture(mode),expected=[];
  for(let tick=1;tick<=180;tick++){stepFixed(reference,input(tick));expected.push(snapshot(reference));}
  assert.ok(expected.some(s=>s.bullets.length>0));assert.ok(reference.stats.shots>0);assert.ok(reference.stats.hits>0);assert.ok(reference.stats.kills>0);
  assert.equal(reference.scores.friendly,1);assert.equal(reference.phase,'ended');assert.equal(reference.result?.reason,'captures');assert.ok(reference.playTicks>1);
  for(const refreshHz of [30,60,120]){
    const state=fixture(mode),presentation=new FlightPresentation();let tick=0,halfTicks=0;
    for(let frame=0;frame<refreshHz*3;frame++){
      halfTicks+=120/refreshHz;
      while(halfTicks>=2){const before=snapshot(state);presentation.capture(state);assert.deepEqual(snapshot(state),before,'capture mutated authoritative state');
        stepFixed(state,input(++tick));assert.deepEqual(snapshot(state),expected[tick-1],`${refreshHz}Hz changed authoritative step ${tick}`);halfTicks-=2;}
      const before=snapshot(state),view=presentation.sample(state,halfTicks/2);
      getFlightCameraPose(view.player,mode,new Vector3(),new Quaternion());
      const sight=mode==='easy'?{x:width/2,y:height/2}:projectGunSight(view.player,view.enemies,width,height);
      aimIndicator(view,[...view.allies,...view.enemies],sight,width,height);
      assert.deepEqual(snapshot(state),before,`${refreshHz}Hz sampler or display consumer mutated authoritative state`);
    }
    assert.equal(tick,180);assert.deepEqual(snapshot(state),expected[179]);
  }
});
