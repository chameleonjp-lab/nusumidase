import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { createGame, stepFixed } from '../src/simulation';
import { autoFireTarget, getFlightAssist } from '../src/flight-assist';
import { createFlightController, forwardOf, updatePlayerLoop, updateQuaternion } from '../src/flight';
import { getFlightCameraPose } from '../src/flight-view';
import { fireAircraft } from '../src/combat';
import { scheduleRespawn } from '../src/respawn';
import { NusumidaseScene } from '../src/scene';
import { aimIndicator } from '../src/aim-indicator';
const neutral={turn:0,climb:0,fire:false,loop:false,viewAspect:874/402};
function fixture(mode:'easy'|'normal',right?:number,behind=false){
 const state=createGame(73,mode);state.phase='playing';state.playTicks=200;
 const p=state.player;p.position.set(0,500,0);p.previous.copy(p.position);p.yaw=0;p.pitch=0;p.bank=0;updateQuaternion(p);
 for(const ally of state.allies){ally.position.set(10000+ally.id*100,500,0);ally.previous.copy(ally.position);}
 for(const enemy of state.enemies)scheduleRespawn(state,enemy);
 if(right!==undefined){const target=state.enemies[0];target.health=80;target.lifecycle='active';target.respawnDuePlayTick=null;target.respawnRef=null;
  const position=new Vector3(),rotation=new Quaternion();getFlightCameraPose(p,mode,position,rotation);target.position.set(right,0,behind?500:-500).applyQuaternion(rotation).add(position);target.previous.copy(target.position);target.speed=110;target.yaw=Math.PI/2;updateQuaternion(target);}
 return state;
}
test('enemy placement and disappearance never alter either mode flight through real fixed ticks',()=>{
 for(const mode of ['easy','normal'] as const)for(const [turn,climb]of [[0,0],[.1,.1],[-.3,.1],[.1,-.3]]){
  const states=[fixture(mode),fixture(mode,105),fixture(mode,0,true)];
  for(let tick=0;tick<12;tick++){
   for(const state of states){if(tick===6&&state.enemies[0].health>0)scheduleRespawn(state,state.enemies[0]);stepFixed(state,{...neutral,turn,climb});assert.equal(state.phase,'playing');assert.equal(state.player.health,80);}
   for(const state of states.slice(1)){assert.ok(state.player.position.distanceTo(states[0].player.position)<.001);assert.ok(state.player.quaternion.angleTo(states[0].player.quaternion)<.001*Math.PI/180);}
  }
 }
});
test('landscape-only circle target passes the actual aspect once and all player muzzles stay forward',()=>{
 const state=fixture('easy',55),p=state.player,target=state.enemies[0];
 assert.equal(autoFireTarget(p,[target],'easy',402/874),null);assert.equal(autoFireTarget(p,[target],'easy',874/402)?.id,target.id);
 let id=1;
 // Once the simulation passes the gate, the weapon must not inspect or choose a target.
 const poison={...state,enemies:new Proxy(state.enemies,{get(){throw new Error('second firing target selection');}})};
 assert.doesNotThrow(()=>fireAircraft(poison,p,true,()=>id++,()=>{}));assert.equal(state.bullets.length,4);
 const forward=forwardOf(p);for(const round of state.bullets)assert.ok(round.velocity.clone().normalize().angleTo(forward)<.001*Math.PI/180);
 for(const aspect of [402/874,874/402]){const live=fixture('easy',55);stepFixed(live,{...neutral,viewAspect:aspect});
  const rounds=live.bullets.filter(round=>round.owner===live.player.id);assert.equal(rounds.length,aspect>1?4:0);
  for(const round of rounds)assert.ok(round.velocity.clone().normalize().angleTo(forwardOf(live.player))<.001*Math.PI/180);
 }
});
test('centered live owner holds pitch in both modes; release levels gradually',()=>{
 for(const mode of ['easy','normal'] as const){const state=fixture(mode),p=state.player,control=createFlightController(p);p.pitch=20*Math.PI/180;updateQuaternion(p);
  for(let tick=0;tick<12;tick++)updatePlayerLoop(p,control,{...neutral,steeringActive:true},{...neutral,steeringActive:true},false,1/60,110,141,1,mode);
  assert.ok(Math.abs(p.pitch-20*Math.PI/180)<.001*Math.PI/180);updatePlayerLoop(p,control,neutral,neutral,false,1/60,110,141,1,mode);assert.ok(p.pitch<20*Math.PI/180&&p.pitch>0);
 }
});
test('trigger rejects dead, friendly and protected targets before any player round is generated',()=>{
 const state=fixture('easy',0),target=state.enemies[0];target.protectionUntilPlayTick=1000;stepFixed(state,neutral);assert.equal(state.bullets.filter(b=>b.owner===state.player.id).length,0);
 target.protectionUntilPlayTick=0;target.team='friendly';assert.equal(autoFireTarget(state.player,[target],'easy',874/402),null);
 target.team='enemy';target.health=0;assert.equal(autoFireTarget(state.player,[target],'easy',874/402),null);
});
function renderScene(state:any){
 const positions=new Map<number,Vector3>();let indicator='';
 const scene:any=Object.assign(Object.create(NusumidaseScene.prototype),{
  disposed:false,matchId:state.matchId,roundEpoch:state.roundEpoch,cameraGeneration:state.player.generation,lastTime:0,visualTime:0,prepared:false,
  pollRender:()=> 'ready',events(){},updatePlane(p:any){positions.set(p.id,p.position.clone());},camera:new PerspectiveCamera(64,874/402,.5,22000),sky:new Object3D(),sea:new Object3D(),seaMaterial:{uniforms:{uTime:{value:0}}},
  flags:{root:{visible:true},update(){}},aircraftTracers:{update(){}},particles:[],particleGeometry:{setDrawRange(){},attributes:{}},renderer:{render(){}},
  drawOverlay(view:any){indicator=aimIndicator(view,view.enemies,{x:437,y:201},874,402);},
 });return {scene,positions,get indicator(){return indicator;}};
}
test('renderer samples models, camera and target circle together while authoritative state stays unchanged',()=>{
 for(const mode of ['easy','normal'] as const){const state=fixture(mode,0),p=state.player,view=renderScene(state),q=p.quaternion.clone();
  state.enemies[0].position.x=100;view.scene.capturePresentation?.(state);
  p.position.x=20;p.pitch=.2;p.bank=.4;updateQuaternion(p);state.enemies[0].position.x=200;state.tick++;
  view.scene.render(state,true,0,.5);assert.equal(view.positions.get(p.id)!.x,10);assert.equal(view.positions.get(state.enemies[0].id)!.x,150);assert.equal(state.player.position.x,20);
  const expected={...p,position:new Vector3(10,500,0),quaternion:q.slerp(p.quaternion,.5),bank:.2};const position=new Vector3(),rotation=new Quaternion();getFlightCameraPose(expected,mode,position,rotation);
  assert.ok(view.scene.camera.position.distanceTo(position)<.001);assert.ok(view.scene.camera.quaternion.angleTo(rotation)<.001*Math.PI/180);
 }
});
test('rendered target entry and exit use the sampled circle at alpha zero, half and one',()=>{
 for(const entering of [false,true]){const state=fixture('easy',entering?100:0),view=renderScene(state),p=state.player;
  view.scene.capturePresentation?.(state);const position=new Vector3(),rotation=new Quaternion();getFlightCameraPose(p,'easy',position,rotation);state.enemies[0].position.set(entering?0:100,0,-500).applyQuaternion(rotation).add(position);state.tick++;
  const colors=[];for(const alpha of [0,.5,1]){view.scene.render(state,true,0,alpha);colors.push(view.indicator);}
  assert.deepEqual(colors,entering?['clear','enemy','enemy']:['enemy','enemy','clear']);
 }
});
test('rising view has no repeated sample across forty-eight 120Hz display frames',()=>{
 for(const mode of ['easy','normal'] as const){const state=fixture(mode),view=renderScene(state);let previous:Vector3|undefined,repeats=0;
  for(let tick=0;tick<25;tick++){view.scene.capturePresentation(state);stepFixed(state,{...neutral,climb:.45,steeringActive:true});
   for(const alpha of [0,.5]){view.scene.render(state,true,0,alpha);const forward=view.scene.camera.getWorldDirection(new Vector3());if(tick>0&&previous&&forward.distanceTo(previous)<1e-12)repeats++;previous=forward;}
  }assert.equal(repeats,0,`${mode}: repeated view in 48 frames`);
 }
});
test('pause and input reset discard a captured pose even when resume precedes the next display',()=>{
 for(const mode of ['easy','normal'] as const){const state=fixture(mode),view=renderScene(state),p=state.player;
  view.scene.capturePresentation(state);p.position.x=20;state.tick++;view.scene.render(state,true,0,1);const current=view.scene.camera.position.clone();
  state.phase='paused';view.scene.resetPresentation();state.phase='playing';view.scene.render(state,true,0,0);assert.ok(view.scene.camera.position.distanceTo(current)<1e-12);
  view.scene.capturePresentation(state);p.generation++;p.position.x=80;state.tick++;view.scene.render(state,true,0,0);assert.equal(view.positions.get(p.id)!.x,80);
 }
});
test('a new target generation never inherits the former target display position',()=>{
 const state=fixture('easy',0),view=renderScene(state),target=state.enemies[0];view.scene.capturePresentation(state);
 target.generation++;target.position.x=300;state.tick++;view.scene.render(state,true,0,0);
 assert.equal(view.positions.get(target.id)!.x,300);assert.equal(view.indicator,'clear');
});
