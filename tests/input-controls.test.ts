import assert from 'node:assert/strict';
import test from 'node:test';
import { FlightControls } from '../src/input';
import { KeyboardSettings } from '../src/keyboard-settings';
import { advanceThrottle, createFlightController } from '../src/flight';
import { acknowledgeInputReset, createGame, startGame, stepGame, flightControllerFor } from '../src/simulation';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class ElementMock {
  attributes=new Map<string,string>(); captures=new Set<number>(); tabIndex=0; isContentEditable=false;
  style={setProperty() {},removeProperty(){}};
  classList={add(){},remove(){},toggle(){}};
  offsetHeight=152;
  getAttribute(name:string){return this.attributes.get(name)??null;}
  setAttribute(name:string,value:string){this.attributes.set(name,value);}
  hasAttribute(name:string){return this.attributes.has(name);}
  setPointerCapture(id:number){this.captures.add(id);}
  releasePointerCapture(id:number){this.captures.delete(id);}
  hasPointerCapture(id:number){return this.captures.has(id);}
  getBoundingClientRect(){return {top:0,bottom:152,left:0,right:76,width:76,height:152};}
  closest(selector:string){return selector==='[role="slider"]'&&this.getAttribute('role')==='slider'?this:null;}
}
const previousElement=Object.getOwnPropertyDescriptor(globalThis,'HTMLElement');
Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:ElementMock});
process.once('exit',()=>{if(previousElement)Object.defineProperty(globalThis,'HTMLElement',previousElement);else Reflect.deleteProperty(globalThis,'HTMLElement');});
function fixture() {
  const buttons={fire:new ElementMock(),loop:new ElementMock(),throttle:new ElementMock()};
  buttons.throttle.setAttribute('role','slider');
  const controls:any=Object.assign(Object.create(FlightControls.prototype),{
    active:()=>true,buttons,surface:new ElementMock(),keyboard:new KeyboardSettings({read(){return null;}} as any),
    steerPointer:null,steerPointerType:null,throttlePointer:null,throttlePointerType:null,throttlePointerCommand:null,
    pointerAxis:0,buttonPointers:new Map(),keys:new Map(),focusedKeys:new Map(),pending:new Map(),
    commandId:0,ownershipRevision:0,steeringRevision:0,turn:0,climb:0,origin:{x:0,y:0},mode:'normal',joystick:new ElementMock(),
  });
  return {controls,buttons};
}
function key(code:string, extra={}) {return {code,repeat:false,isComposing:false,ctrlKey:false,altKey:false,metaKey:false,target:null,preventDefault(){},stopPropagation(){},...extra} as KeyboardEvent;}
function pointer(id:number,extra={}) {return {pointerId:id,pointerType:'touch',isPrimary:false,button:0,buttons:1,clientX:0,clientY:0,preventDefault(){},stopPropagation(){},...extra} as PointerEvent;}

test('short keys and AT fire/loop remain through zero-tick samples and acknowledge exactly once',()=>{
  const {controls}=fixture();
  controls.keyDown(key('KeyW'));controls.keyUp(key('KeyW'));
  controls.keyDown(key('Space'));controls.keyUp(key('Space'));
  controls.keyDown(key('KeyL'));controls.keyUp(key('KeyL'));
  const sampled=controls.sample();assert.equal(sampled.throttle,1);assert.equal(sampled.fire,true);assert.equal(sampled.loop,true);
  assert.deepEqual(controls.sample(),sampled,'sampling a zero-step frame is read-only');
  controls.acknowledge(sampled);
  assert.equal(controls.sample().throttle,0);assert.equal(controls.sample().fire,false);assert.equal(controls.sample().loop,false);
  controls.enqueue({action:'fire',source:'button'});controls.enqueue({action:'loop',source:'button'});
  const at=controls.sample();assert.equal(at.fire,true);assert.equal(at.loop,true);
  controls.acknowledge(at);assert.equal(controls.sample().fire,false);assert.equal(controls.sample().loop,false);
});

test('short input reaches product target on one actual tick, never zero or all catch-up ticks',()=>{
  const {controls}=fixture(),state=createGame(42,'normal');startGame(state);
  acknowledgeInputReset(state,state.inputEpoch);
  assert.equal(state.phase,'playing');
  controls.keyDown(key('KeyW'));controls.keyUp(key('KeyW'));
  const controller=flightControllerFor(state);const initial=controller.playerTargetSpeed;
  stepGame(state,()=>controls.sample(),0,frame=>controls.acknowledge(frame));assert.equal(controller.playerTargetSpeed,initial);
  stepGame(state,()=>controls.sample(),5/60,frame=>controls.acknowledge(frame));
  assert.ok(Math.abs(controller.playerTargetSpeed-initial-.3)<1e-8,'five fixed steps deliver one short tap once');
});

test('clear invalidates sampled acknowledgement, cancels pending commands and blocks repeat revival',()=>{
  const {controls}=fixture();controls.keyDown(key('KeyW'));controls.keyUp(key('KeyW'));const old=controls.sample();
  controls.clear();controls.keyDown(key('KeyW',{repeat:true}));assert.equal(controls.sample().throttle,0);
  controls.keyDown(key('KeyS'));controls.keyUp(key('KeyS'));
  assert.equal(controls.acknowledge(old),false);assert.equal(controls.sample().throttle,-1);
  controls.setMode('easy');assert.equal(controls.sample().throttle,0);
});

test('steering, fire and lever have independent pointer ownership; owner-only cancel keeps other fingers',()=>{
  const {controls,buttons}=fixture();
  controls.beginSteering(pointer(1),new ElementMock());controls.moveSteering(pointer(1,{clientX:36}));
  controls.beginButton('fire',pointer(2));controls.beginThrottle(pointer(3,{clientY:22}));
  let frame=controls.sample();assert.equal(frame.turn,1);assert.equal(frame.fire,true);assert.equal(frame.throttle,1);
  controls.beginThrottle(pointer(4,{clientY:130}));assert.equal(controls.peek().throttlePointer,3,'second lever finger cannot take over');
  controls.endPointer(pointer(99),false);frame=controls.sample();assert.equal(frame.turn,1);assert.equal(frame.fire,true);assert.equal(frame.throttle,1);
  controls.endThrottle(3,false);frame=controls.sample();assert.equal(frame.throttle,0);assert.equal(frame.turn,1);assert.equal(frame.fire,true);
  controls.clear();assert.equal(buttons.fire.captures.size,0);assert.equal(buttons.throttle.captures.size,0);assert.equal(controls.sample().turn,0);
});

test('pointer + focused positive - brake combines once, slider focusout keeps steering/fire pointers',()=>{
  const {controls,buttons}=fixture();controls.beginSteering(pointer(1),new ElementMock());controls.moveSteering(pointer(1,{clientX:36}));
  controls.beginButton('fire',pointer(2));controls.beginThrottle(pointer(3,{clientY:22}));
  controls.sliderKeyDown(key('ArrowUp',{target:buttons.throttle}));
  controls.keyDown(key('KeyS',{target:buttons.throttle}));
  assert.equal(controls.sample().throttle,1,'1 + 1 - 1 = 1, no premature clamp');
  controls.clearFocused();const frame=controls.sample();assert.equal(frame.turn,1);assert.equal(frame.fire,true);assert.equal(frame.throttle,1);
  assert.equal(controls.peek().steerPointer,1);assert.equal(controls.peek().throttlePointer,3);
});

test('capture failure and stale-primary mouse recovery fail neutral without clearing touch owners',()=>{
  const {controls,buttons}=fixture();controls.beginButton('fire',pointer(2));
  buttons.throttle.setPointerCapture=()=>{throw new Error('capture unavailable');};
  controls.beginThrottle(pointer(3,{clientY:22}));assert.equal(controls.sample().throttle,0);assert.equal(controls.sample().fire,true);
  controls.beginSteering(pointer(7,{pointerType:'mouse',isPrimary:true}),new ElementMock());
  controls.moveSteering(pointer(7,{pointerType:'mouse',clientX:36}));
  controls.beginSteering(pointer(8,{pointerType:'mouse',isPrimary:true}),new ElementMock());
  assert.equal(controls.peek().steerPointer,8);assert.equal(controls.sample().turn,0);assert.equal(controls.sample().fire,true);
  controls.moveSteering(pointer(8,{pointerType:'mouse',buttons:0}));assert.equal(controls.peek().steerPointer,null);
});

test('steeringActive belongs only to steering owners, including deadzone, opposing keys and unconsumed short taps',()=>{
  const {controls}=fixture();assert.equal(controls.sample().steeringActive,undefined);
  controls.beginSteering(pointer(1),new ElementMock());let frame=controls.sample();assert.equal(frame.turn,0);assert.equal(frame.climb,0);assert.equal(frame.steeringActive,true);
  controls.beginButton('fire',pointer(2));controls.beginThrottle(pointer(3,{clientY:22}));assert.equal(controls.sample().steeringActive,true);
  controls.endPointer(pointer(1),false);frame=controls.sample();assert.equal(frame.steeringActive,undefined);assert.equal(frame.fire,true);assert.equal(frame.throttle,1);
  controls.clear();controls.keyDown(key('ArrowLeft'));controls.keyDown(key('ArrowRight'));frame=controls.sample();assert.equal(frame.turn,0);assert.equal(frame.steeringActive,true);
  controls.clear();controls.keyDown(key('ArrowUp'));controls.keyUp(key('ArrowUp'));const tap=controls.sample();assert.equal(tap.steeringActive,true);assert.equal(tap.climb,1);assert.deepEqual(controls.sample(),tap);
  controls.acknowledge(tap);assert.equal(controls.sample().steeringActive,undefined);
  controls.beginSteering(pointer(4),new ElementMock());controls.active=()=>false;assert.equal(controls.sample().steeringActive,undefined);
});
test('height-only resize keeps independent owners and rebases the next client coordinate',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
 const win={innerWidth:402,innerHeight:874};Object.defineProperty(globalThis,'window',{configurable:true,value:win});
 try{const {controls}=fixture();controls.viewportWidth=402;controls.viewportHeight=874;
  controls.beginSteering(pointer(1),new ElementMock());controls.moveSteering(pointer(1,{clientX:12,clientY:-6}));controls.beginButton('fire',pointer(2));const before=controls.sample();
  win.innerHeight=820;controls.resizeViewport?.();assert.equal(controls.sample().turn,before.turn);assert.equal(controls.sample().fire,true);assert.equal(controls.peek().steerPointer,1);
  controls.moveSteering(pointer(1,{clientX:12,clientY:-60}));assert.equal(controls.sample().climb,before.climb);controls.moveSteering(pointer(1,{clientX:18,clientY:-60}));assert.ok(controls.sample().turn>before.turn);
  win.innerWidth=874;win.innerHeight=402;controls.resizeViewport?.();assert.equal(controls.peek().steerPointer,null);assert.equal(controls.sample().fire,false);
 }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
for(const mode of ['easy','normal'] as const)test(`${mode}: input and actual main resize handlers retain the same finger when height crosses width`,()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
 const win=Object.assign(new EventTarget(),{innerWidth:402,innerHeight:420,visualViewport:new EventTarget()});Object.defineProperty(globalThis,'window',{configurable:true,value:win});
 try{const {controls}=fixture();controls.setMode(mode);controls.viewportWidth=402;controls.viewportHeight=420;
  win.addEventListener('resize',()=>controls.resizeViewport());
  const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');const start=source.indexOf('let viewportWidth=');const end=source.indexOf("canvas.addEventListener('webglcontextlost'",start);
  assert.ok(start>=0&&end>start);let clears=0,resizes=0;
  vm.runInNewContext(source.slice(start,end),{window:win,signal:new AbortController().signal,clearInput(){clears++;controls.clear();},scene:{resize(){resizes++;}}});
  controls.beginSteering(pointer(7),new ElementMock());controls.moveSteering(pointer(7,{clientX:12,clientY:-6}));const before=controls.sample();
  for(const height of [390,420]){win.innerHeight=height;win.dispatchEvent(new Event('resize'));assert.equal(clears,0);assert.equal(controls.peek().steerPointer,7);assert.equal(controls.sample().turn,before.turn);assert.equal(controls.sample().climb,before.climb);
   controls.moveSteering(pointer(7,{clientX:12,clientY:height===390?-36:-6}));assert.equal(controls.sample().turn,before.turn);assert.equal(controls.sample().climb,before.climb);}
  assert.equal(resizes,2);controls.moveSteering(pointer(7,{clientX:18,clientY:-6}));assert.ok(controls.sample().turn>before.turn);
  win.dispatchEvent(new Event('orientationchange'));assert.equal(clears,1);assert.equal(controls.peek().steerPointer,null);
  controls.beginSteering(pointer(8),new ElementMock());win.innerWidth=420;win.dispatchEvent(new Event('resize'));assert.equal(clears,2);assert.equal(controls.peek().steerPointer,null);
 }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
