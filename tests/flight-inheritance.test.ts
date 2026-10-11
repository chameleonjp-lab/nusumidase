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
 test(`${mode}: 780-tick input/loop trace matches pinned Kaisen attitude, flight, camera and projection`,()=>{
  const plane=makeAircraft(1,'friendly',new Vector3(...fixture.initial.position),fixture.initial.yaw,'player',0);
  const meta=createFlightController(plane);let held=false;
  for(let tick=0;tick<fixture.steps;tick++){
   const input={turn:tick<120?.45:tick>=420&&tick<480?-.7:0,climb:tick<90?.25:tick>=480&&tick<540?-.35:0,fire:false,loop:tick===180||tick===600,accelerate:tick>=90&&tick<150,brake:tick>=540&&tick<600,steeringRevision:tick<420?0:1};
   const target=advanceThrottle(meta,input,mode,fixture.dt);
   updatePlayerLoop(plane,meta,input,input,input.loop&&!held,fixture.dt,target,141,1);held=input.loop;
   if((tick+1)%30!==0)continue;
   const expected=frames[(tick+1)/30-1];array(plane.position.toArray(),expected.position,'position');array(plane.quaternion.toArray(),expected.quaternion,'quaternion');
   for(const key of ['yaw','pitch','bank','speed','loopProgress','loopCooldown'] as const)close(plane[key],expected[key],key);
   close(target,expected.target,'target');
   const position=new Vector3(),rotation=new Quaternion();getFlightCameraPose(plane,mode,position,rotation);
   array(position.toArray(),expected.cameraPosition,'cameraPosition');array(rotation.toArray(),expected.cameraQuaternion,'cameraQuaternion');
   const projection=projectFlightTarget(plane,new Vector3(900,420,-100),393/852,mode);
   for(const key of ['x','y','depth','distance'] as const)close(projection[key],expected.projection[key],`projection.${key}`);
   assert.equal(projection.visible,expected.projection.visible);assert.equal(projection.inCircle,expected.projection.inCircle);
  }
 });
}
