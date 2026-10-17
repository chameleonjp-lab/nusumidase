import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { makeAircraft } from '../src/mission';
import { advanceThrottle, createFlightController, updatePlayerLoop } from '../src/flight';
import { getFlightCameraPose, projectFlightTarget } from '../src/flight-view';
import type { GameMode } from '../src/types';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/flight-source-trace.json',import.meta.url),'utf8'));
const close=(actual:number,expected:number,label:string)=>assert.ok(Math.abs(actual-expected)<1e-10,`${label}: ${actual} vs ${expected}`);
const array=(actual:number[],expected:number[],label:string)=>actual.forEach((value,index)=>close(value,expected[index],`${label}[${index}]`));
for(const {mode,frames} of fixture.traces as {mode:GameMode;frames:any[]}[]){
 test(`${mode}: historical 780-tick trace preserves absolute aerodynamics and the unchanged source fixture`,()=>{
  const plane=makeAircraft(1,'friendly',new Vector3(...fixture.initial.position),fixture.initial.yaw,'player',0);
  const meta=createFlightController(plane);let held=false;
  for(let tick=0;tick<fixture.steps;tick++){
   const input={turn:tick<120?.45:tick>=420&&tick<480?-.7:0,climb:tick<90?.25:tick>=480&&tick<540?-.35:0,fire:false,loop:tick===180||tick===600,accelerate:tick>=90&&tick<150,brake:tick>=540&&tick<600,steeringRevision:tick<420?0:1};
   const target=advanceThrottle(meta,input,mode,fixture.dt);
   legacyTraceLoop(plane,meta,input,input,input.loop&&!held,fixture.dt,target,141,1);held=input.loop;
   if((tick+1)%30!==0)continue;
   const expected=frames[(tick+1)/30-1];array(plane.position.toArray(),expected.position,'position');array(plane.quaternion.toArray(),expected.quaternion,'quaternion');
   for(const key of ['yaw','pitch','bank','speed','loopProgress','loopCooldown'] as const)close(plane[key],expected[key],key);
   close(target,expected.target,'target');
   const position=new Vector3(),rotation=new Quaternion();legacyTraceCamera(plane,mode,position,rotation);
   array(position.toArray(),expected.cameraPosition,'cameraPosition');array(rotation.toArray(),expected.cameraQuaternion,'cameraQuaternion');
   const projection=legacyTraceProjection(plane,new Vector3(900,420,-100),393/852,mode);
   for(const key of ['x','y','depth','distance'] as const)close(projection[key],expected.projection[key],`projection.${key}`);
   assert.equal(projection.visible,expected.projection.visible);assert.equal(projection.inCircle,expected.projection.inCircle);
  }
 });
}

// Camera rollout contract: kaisen@67ac107 plus the approved total-angle pilot.
// These assertions use the actual before/after optical axis, without subtracting
// a neutral-leveling baseline. The fixed-source absolute-motion test stays above.
import { Euler, PerspectiveCamera } from 'three';
import { updateQuaternion } from '../src/flight';
import { FLIGHT_FAR, FLIGHT_FOV } from '../src/flight-view';
import { projectGunSight } from '../src/gun-sight';
import type { Aircraft, FlightInput } from '../src/types';
const neutral={turn:0,climb:0,fire:false,loop:false};
const dt=1/60;

function cameraPlane(pitch=0, bank=0, yaw=0, speed=110): Aircraft {
  const p=makeAircraft(1,'friendly',new Vector3(),0,'player',0);p.position.set(0,2400,0);p.pitch=pitch;p.bank=bank;p.yaw=yaw;p.speed=speed;updateQuaternion(p);return p;
}
function cameraPose(p:Aircraft, mode:GameMode) {
  const position=new Vector3(), rotation=new Quaternion();getFlightCameraPose(p,mode,position,rotation);
  return {position,rotation,forward:new Vector3(0,0,-1).applyQuaternion(rotation).normalize()};
}
const opticalAngle=(a:Vector3,b:Vector3)=>Math.atan2(new Vector3().crossVectors(a,b).length(),a.dot(b));
const cameraAuthority=(s:number)=>(s<=85?.92+(s-65)/20*.23:s<=110?1.15-(s-85)/25*.15:1)*Math.max(.78,Math.min(1,1-Math.max(0,s-115)*.008));
function cameraStep(p:Aircraft,i:FlightInput,m:GameMode,response=1,control=createFlightController(p)) {
  updatePlayerLoop(p,control,i,i,false,dt,110,141,response,m);
}

test('manual total camera-forward angle matches all eight directions, modes, speeds and attitude branches',()=>{
  // A removed rate branch, wrong mode, bank-dependent view, or horizontal
  // leveling must each fail this matrix (5,184 cases).
  for(const mode of ['easy','normal'] as const)for(const speed of [65,85,110,141])for(const pitch of [-.9,0,.9])for(const bank of [-.72,0,.72])for(const yaw of [-3.14,0,3.14])for(let direction=0;direction<8;direction++)for(const strength of [.25,.45,.6]){
    const theta=direction*Math.PI/4,p=cameraPlane(pitch,bank,yaw,speed),before=cameraPose(p,mode).forward;
    cameraStep(p,{...neutral,turn:Math.cos(theta)*strength,climb:Math.sin(theta)*strength,steeringActive:true},mode);
    const measured=opticalAngle(before,cameraPose(p,mode).forward),expected=.82*cameraAuthority(speed)*dt*strength;
    assert.ok(Math.abs(measured-expected)<=1e-12,JSON.stringify({mode,speed,pitch,bank,yaw,direction,strength,measured,expected}));
  }
});

test('offscreen response changes horizontal rate only; keyboard diagonals and neutral recovery stay bounded',()=>{
  for(const mode of ['easy','normal'] as const)for(const speed of [65,85,110,141])for(const pitch of [-.9,0,.9])for(const sign of [-1,1]){
    const step=.82*cameraAuthority(speed)*dt;
    for(const axis of ['turn','climb'] as const){const p=cameraPlane(pitch,0,0,speed),before=cameraPose(p,mode).forward;cameraStep(p,{...neutral,[axis]:sign*.45,steeringActive:true},mode,1.65);assert.ok(Math.abs(opticalAngle(before,cameraPose(p,mode).forward)-step*.45*(axis==='turn'?1.65:1))<1e-12);}
    const diagonal=cameraPlane(pitch,0,0,speed),before=cameraPose(diagonal,mode).forward;cameraStep(diagonal,{...neutral,turn:sign,climb:sign,steeringActive:true},mode);assert.ok(Math.abs(opticalAngle(before,cameraPose(diagonal,mode).forward)-step)<1e-12);
    const p=cameraPlane(pitch,0,0,speed);cameraStep(p,{...neutral,turn:sign*.6,steeringActive:true},mode);assert.equal(p.pitch,pitch);
    const neutralStep=.82*cameraAuthority(p.speed)*dt;cameraStep(p,{...neutral,steeringActive:true},mode);assert.ok(Math.abs(p.pitch-pitch)<=neutralStep+1e-12);
  }
  for(const sign of [-1,1]){const p=cameraPlane(sign*.95);cameraStep(p,{...neutral,climb:sign,steeringActive:true},'normal');assert.equal(p.pitch,sign*.95);cameraStep(p,{...neutral,climb:-sign,steeringActive:true},'normal');assert.ok(Math.abs(p.pitch)<.95);}
});

test('bank is optical-axis roll; legacy offset, real projection and 500m bore sight agree',()=>{
  for(const mode of ['easy','normal'] as const)for(const pitch of [-Math.PI*2,-Math.PI,-Math.PI/2,-.9,0,.9,Math.PI/2,Math.PI,Math.PI*2])for(const yaw of [-3.14,0,3.14])for(const bank of [-.72,0,.72]){
    const p=cameraPlane(pitch,bank,yaw),pose=cameraPose(p,mode),unbanked=cameraPose(cameraPlane(pitch,0,yaw),mode);
    const expected=new Vector3(0,11,29).applyQuaternion(p.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),bank*.55))).add(p.position);
    assert.equal(pose.position.distanceTo(expected),0);assert.ok(opticalAngle(pose.forward,unbanked.forward)<1e-12);
    // A renderer can interpolate quaternion independently of current scalar Euler.
    p.quaternion.slerp(new Quaternion().setFromEuler(new Euler(.25,-.8,.2,'YXZ')),.37);
    const interpolated=cameraPose(p,mode);
    for(const [width,height]of [[393,852],[393,648],[568,320],[852,393],[1280,720]]){
      const c=new PerspectiveCamera(FLIGHT_FOV,width/height,.1,FLIGHT_FAR);c.position.copy(interpolated.position);c.quaternion.copy(interpolated.rotation);c.updateMatrixWorld(true);
      const point=new Vector3(0,0,-504.5).applyQuaternion(p.quaternion).add(p.position),a=point.clone().project(c),b=projectFlightTarget(p,point,width/height,mode);
      assert.ok(Math.abs(a.x-b.x)<1e-12&&Math.abs(a.y-b.y)<1e-12);
      if(mode==='normal'){const sight=projectGunSight(p,[],width,height);assert.ok(Math.abs(sight.x-(.5+.5*a.x)*width)<1e-9&&Math.abs(sight.y-(.5-.5*a.y)*height)<1e-9);}
    }
    const expectedRotation=p.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),bank)).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),mode==='easy'?-Math.atan2(11,479):-.19)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-bank*.45));
    assert.ok(1-Math.abs(interpolated.rotation.dot(expectedRotation))<1e-12);
  }
});

test('loop cancellation obeys independent pre-step bounds across bank, speed and response',()=>{
  const stepDt=1/60, tolerance=1e-12;
  const wrapped=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));
  let cases=0,maxQuaternionStep=0,maxForwardStep=0,maxRetainedRollStep=0,maxPoseError=0;
  for(const mode of ['easy','normal'] as const)
  for(const startPitch of [-.95,0,.95])for(const startBank of [-.72,0,.72])
  for(const startSpeed of [65,85,110,141])for(const response of [1,1.65])
  for(const ticks of [1,25,50,75,90,100,125,150,175,200,225,250,275,299])
  for(const turn of [-1,0,1])for(const climb of [-1,0,1]){
    const p=cameraPlane(startPitch,startBank,0,startSpeed),control=createFlightController(p);
    const zero={...neutral,steeringRevision:1};
    for(let i=0;i<ticks;i++)updatePlayerLoop(p,control,zero,zero,i===0,stepDt,110,141,response,mode);
    const before={...cameraPose(p,mode),pitch:p.pitch,yaw:p.yaw,bank:p.bank,speed:p.speed};

    // Derive every allowance BEFORE cancellation. Circular input has length <= 1,
    // so its requested angular distance is <= angularStep * max(1,response).
    // In the finite-yaw branch both pitch endpoints lie within +/-0.95, giving
    // cos(pitch+look) >= cos(0.95+abs(look)). Dropping the nonnegative pitch term
    // in sin(total/2)^2 - sin(pitchDelta/2)^2 gives a conservative yaw bound.
    // The fallback yaw rate is smaller; bank's target is always within +/-0.72.
    const angularStep=.82*cameraAuthority(before.speed)*stepDt;
    const look=mode==='easy'?-Math.atan2(11,479):-.19;
    const yawBound=turn===0?0:2*Math.asin(Math.min(1,
      Math.sin(angularStep*Math.max(1,response)/2)/Math.cos(.95+Math.abs(look))));
    const bankBound=(Math.abs(before.bank)+.72)*(1-Math.exp(-5.5*stepDt));
    // Rotations compose as yaw * (pitch+look) * retained optical roll. The
    // geodesic triangle inequality bounds their total independently of deltas.
    const quaternionBound=angularStep+yawBound+.45*bankBound;
    assert.ok(quaternionBound<Math.PI/2,'a branch jump cannot enlarge its own allowance');

    const input={...neutral,turn,climb,steeringActive:true,steeringRevision:2};
    cameraStep(p,input,mode,response,control);
    const after=cameraPose(p,mode);
    const relative=before.rotation.clone().invert().multiply(after.rotation);
    const quaternionStep=2*Math.atan2(Math.hypot(relative.x,relative.y,relative.z),Math.abs(relative.w));
    const pitchStep=Math.abs(wrapped(p.pitch-before.pitch));
    const yawStep=Math.abs(wrapped(p.yaw-before.yaw));
    const bankStep=Math.abs(wrapped(p.bank-before.bank));
    const forwardStep=opticalAngle(before.forward,after.forward);
    const context=JSON.stringify({mode,startPitch,startBank,startSpeed,response,ticks,turn,climb,
      pitchStep,yawStep,bankStep,quaternionStep,angularStep,yawBound,bankBound,quaternionBound});
    assert.equal(p.loopProgress,0);assert.equal(p.loopCooldown,2);
    assert.ok(pitchStep<=angularStep+tolerance,`pitch: ${context}`);
    assert.ok(yawStep<=yawBound+tolerance,`yaw: ${context}`);
    assert.ok(bankStep<=bankBound+tolerance,`bank: ${context}`);
    assert.ok(quaternionStep<=quaternionBound+tolerance,`camera quaternion: ${context}`);
    assert.ok(forwardStep<=angularStep+yawBound+tolerance,`camera forward: ${context}`);

    // Independently reconstruct the optical pose; bounded Euler changes alone
    // must not hide an erroneous camera composition or a canonical branch flip.
    const expected=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p.yaw)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),p.pitch+look))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-.45*p.bank));
    const actualComponents=after.rotation.toArray(),expectedComponents=expected.toArray();
    const poseError=Math.min(...[1,-1].map(sign=>Math.max(...actualComponents.map(
      (value,index)=>Math.abs(value-sign*expectedComponents[index])))));
    assert.ok(poseError<=tolerance,`independent camera pose: ${context}`);
    cases++;maxQuaternionStep=Math.max(maxQuaternionStep,quaternionStep);
    maxForwardStep=Math.max(maxForwardStep,forwardStep);maxRetainedRollStep=Math.max(maxRetainedRollStep,.45*bankStep);
    maxPoseError=Math.max(maxPoseError,poseError);
  }
  assert.equal(cases,18144);
  console.log(JSON.stringify({contract:'loop-cancel-pre-step-bounds',cases,maxQuaternionStep,maxForwardStep,maxRetainedRollStep,maxPoseError}));
});


import { getFlightAssist } from '../src/flight-assist';
test('Easy owner at zero or tiny steering suppresses target pull, and ownerless assistance stays absolute',()=>{
  const p=cameraPlane(),pose=cameraPose(p,'easy'),enemy=makeAircraft(2,'enemy',new Vector3(),0,'interceptor',0);
  const tan=Math.tan(FLIGHT_FOV*Math.PI/360);enemy.position.set(.8*500*tan,.55*500*tan,-500).applyQuaternion(pose.rotation).add(pose.position);
  const auto=getFlightAssist(p,[enemy],{...neutral,viewAspect:1},'easy');assert.ok(Math.abs(auto.turn)>0||Math.abs(auto.climb)>0);
  for(const [turn,climb]of [[0,0],[.01,.02],[-.6,-.7]]){const result=getFlightAssist(p,[enemy],{...neutral,turn,climb,viewAspect:1,steeringActive:true},'easy');assert.equal(result.turn,turn);assert.equal(result.climb,climb);}
  const a=cameraPlane(-.2);updatePlayerLoop(a,createFlightController(a),{...neutral,turn:.3,climb:.5},neutral,false,dt,110,141,1,'easy');assert.ok(Math.abs(a.pitch-(-.2+(.5*.95+.2)*(1-Math.exp(-4.2/60))))<1e-12);
  enemy.health=0;const dead=getFlightAssist(p,[enemy],neutral,'easy');assert.equal(dead.turn,0);assert.equal(dead.climb,0);
  assert.equal(getFlightAssist(p,[],neutral,'easy').hasVisibleTarget,false,'bases and cores are not aircraft targets');
});

// Historical reference only: source ae3e3c / the fixture's pinned Kaisen commit.
// The fixture bytes and all historical assertions remain intact. Production
// updateAircraftMotion still supplies the absolute/NPC equations; cancellation
// and optical composition below reproduce the superseded source explicitly.
// Current manual camera acceptance is the total-angle and continuity matrix.
import { clamp, normalizeAngle, updateAircraftMotion, STALL_SPEED, LOOP_DURATION, LOOP_COOLDOWN, type FlightController } from '../src/flight';
import { PLAYER_MAX_PITCH } from '../src/flight-assist';
import { FLIGHT_CAMERA_BANK_FACTOR, FLIGHT_VISIBILITY_RANGE, EASY_AIM_RADIUS } from '../src/flight-view';
const LEGACY_EPSILON=1e-8, LEGACY_MAX_BANK=.72;
function legacyTraceLoop(
  player: Aircraft,
  meta: FlightController,
  input: FlightInput,
  userInput: FlightInput,
  loopPressed: boolean,
  dt: number,
  preferredSpeed: number,
  speedCeiling: number,
  responseMultiplier: number,
): boolean {
  if (player.loopCooldown > 0) player.loopCooldown = Math.max(0, player.loopCooldown - dt);

  const revisionChanged = meta.loopStartSteeringRevision !== undefined
    && userInput.steeringRevision !== undefined
    && userInput.steeringRevision !== meta.loopStartSteeringRevision;
  const commandChanged = Math.abs(userInput.turn - meta.loopStartTurn) > LEGACY_EPSILON
    || Math.abs(userInput.climb - meta.loopStartClimb) > LEGACY_EPSILON;
  const steeringChanged = meta.loopStartSteeringRevision !== undefined && userInput.steeringRevision !== undefined
    ? revisionChanged
    : commandChanged;
  if (player.loopProgress > 0 && steeringChanged) {
    // Preserve the current position and attitude, then let normal flight
    // response recover pitch and bank gradually without a snap.
    player.loopProgress = 0;
    player.loopCooldown = LOOP_COOLDOWN;
    meta.playerLoopActive = false;
    const recoveryPitch = clamp(userInput.climb, -1, 1) * PLAYER_MAX_PITCH;
    const attitude = new Euler().setFromQuaternion(player.quaternion, 'YXZ');
    const recoveryBank = clamp(userInput.turn, -1, 1) * LEGACY_MAX_BANK;
    player.pitch = recoveryPitch + normalizeAngle(attitude.x - recoveryPitch);
    player.yaw = attitude.y;
    player.bank = recoveryBank + normalizeAngle(-attitude.z - recoveryBank);
    updateAircraftMotion(
      player,
      userInput.turn,
      userInput.climb,
      dt,
      preferredSpeed,
      false,
      speedCeiling,
      PLAYER_MAX_PITCH,
      responseMultiplier,
    );
    return false;
  }

  if (player.loopProgress <= 0 && loopPressed && player.loopCooldown <= LEGACY_EPSILON && player.speed >= STALL_SPEED) {
    player.loopProgress = LEGACY_EPSILON;
    meta.playerLoopActive = true;
    meta.loopStartYaw = player.yaw;
    meta.loopStartPitch = player.pitch;
    meta.loopStartSteeringRevision = userInput.steeringRevision;
    meta.loopStartTurn = userInput.turn;
    meta.loopStartClimb = userInput.climb;
  }

  if (player.loopProgress <= 0) {
    updateAircraftMotion(
      player,
      input.turn,
      input.climb,
      dt,
      preferredSpeed,
      false,
      speedCeiling,
      PLAYER_MAX_PITCH,
      responseMultiplier,
    );
    return false;
  }

  if (!meta.playerLoopActive) {
    meta.playerLoopActive = true;
    meta.loopStartYaw = player.yaw;
    meta.loopStartPitch = player.pitch;
  }

  const progress = clamp(player.loopProgress + dt / LOOP_DURATION, 0, 1);
  player.loopProgress = progress;
  player.yaw = meta.loopStartYaw;
  player.pitch = meta.loopStartPitch + progress * Math.PI * 2;
  const completed = progress >= 1 - LEGACY_EPSILON;
  if (completed) {
    player.yaw = meta.loopStartYaw;
    player.pitch = meta.loopStartPitch;
    player.loopProgress = 0;
    player.loopCooldown = LOOP_COOLDOWN;
    meta.playerLoopActive = false;
  }
  updateAircraftMotion(player, 0, 0, dt, preferredSpeed, true, speedCeiling, PLAYER_MAX_PITCH, responseMultiplier);
  return completed;
}


const LEGACY_CAMERA_OFFSET = new Vector3(0, 11, 29);
const LEGACY_NORMAL_LOOK = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.19);
const LEGACY_EASY_LOOK = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.atan2(11, 479));
const LEGACY_TAN_HALF_FOV = Math.tan(FLIGHT_FOV * Math.PI / 360);

/** Shared by rendering and targeting so the displayed circle is the actual firing gate. */
function legacyTraceCamera(player: Aircraft, mode: GameMode, position: Vector3, rotation: Quaternion): void {
  // Retain pitch/yaw and loops, but transmit only 45% of the bank to the view.
  // Using the same rotation for the offset avoids a sideways camera swing.
  rotation.copy(player.quaternion).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), player.bank * (1 - FLIGHT_CAMERA_BANK_FACTOR)));
  position.copy(LEGACY_CAMERA_OFFSET).applyQuaternion(rotation).add(player.position);
  rotation.multiply(mode === 'easy' ? LEGACY_EASY_LOOK : LEGACY_NORMAL_LOOK);
}

function legacyTraceProjection(player: Aircraft, target: Vector3, aspect: number, mode: GameMode) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 393 / 852;
  const position = new Vector3(), rotation = new Quaternion();
  legacyTraceCamera(player, mode, position, rotation);
  const local = target.clone().sub(position).applyQuaternion(rotation.invert());
  const depth = -local.z, divisor = Math.max(0.0001, Math.abs(depth));
  const x = local.x / (divisor * LEGACY_TAN_HALF_FOV * safeAspect);
  const y = local.y / (divisor * LEGACY_TAN_HALF_FOV);
  const distance = player.position.distanceTo(target);
  const visible = distance <= FLIGHT_VISIBILITY_RANGE && depth > 0.1 && depth < FLIGHT_FAR && Math.abs(x) <= 1 && Math.abs(y) <= 1;
  const radial = Math.hypot(x * Math.max(1, safeAspect), y * Math.max(1, 1 / safeAspect)) / 2;
  return { x, y, depth, distance, visible, inCircle: visible && radial <= EASY_AIM_RADIUS };
}


import { acknowledgeInputReset, createGame, startGame, stepFixed } from '../src/simulation';
test('Normal fire changes combat output without changing twelve real ticks of camera or flight',()=>{
  for(const turn of [-.6,0,.6])for(const climb of [-.6,0,.6]){
    const a=createGame(77,'normal'),b=createGame(77,'normal');
    for(const s of [a,b]){startGame(s);acknowledgeInputReset(s,s.inputEpoch);s.player.position.set(0,500,1200);s.player.previous.copy(s.player.position);s.player.pitch=.3;s.player.yaw=.8;s.player.bank=.2;updateQuaternion(s.player);}
    for(let tick=0;tick<12;tick++){
      stepFixed(a,{...neutral,turn,climb,steeringActive:true});stepFixed(b,{...neutral,turn,climb,fire:true,steeringActive:true});
      const values=(p:Aircraft)=>[...p.position.toArray(),...p.quaternion.toArray(),p.speed,...cameraPose(p,'normal').forward.toArray()];
      assert.deepEqual(values(a.player),values(b.player));assert.equal(a.phase,'playing');assert.equal(b.phase,'playing');
    }
    assert.ok(b.player.mg<a.player.mg);
  }
});
