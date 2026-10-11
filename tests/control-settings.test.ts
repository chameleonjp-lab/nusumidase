import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTROL_NAMES, MODE_CONTROLS, DEFAULT_LAYOUT, decodeControlLayout, controlDimensions, safeThrottlePlacement, rectangularBounds, previewDimensions, validControlLayout, controlLayoutConflict } from '../src/control-settings';

const insets = {top:0,right:0,bottom:0,left:0};
function layout() { return structuredClone(DEFAULT_LAYOUT); }
test('Normal has exactly fire, loop and a rectangular lever; Easy exposes loop only', () => {
  assert.deepEqual(CONTROL_NAMES,['fire','loop','throttle']); assert.deepEqual(MODE_CONTROLS.easy,['loop']);
  assert.deepEqual(DEFAULT_LAYOUT.throttle,{x:.17,y:.75,size:76,opacity:.82});
  assert.deepEqual(DEFAULT_LAYOUT.fire,{x:.83,y:.84,size:96,opacity:.9});
  for (const [width,height] of [[320,568],[393,852],[568,320],[852,393]]) {
    const d=controlDimensions('throttle',76,width,height);
    assert.ok(d.width >= 44); assert.equal(d.height,d.width*2);
    const p=safeThrottlePlacement(layout(),width,height,insets); assert.equal(p.blocked,false);
    const b=rectangularBounds(d,width,height,insets);
    assert.ok(p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY);
    const preview=previewDimensions(width,height,300,260); assert.ok(preview.width <= 300 && preview.height <= 260+1e-9);
  }
});

test('only the lever retreats from controls and HUD; lack of free space blocks placement', () => {
  const source=layout(), before=structuredClone(source); source.throttle={...source.fire};
  const moved=safeThrottlePlacement(source,393,852,insets);
  assert.equal(moved.blocked,false); assert.ok(moved.x!==source.throttle.x||moved.y!==source.throttle.y);
  assert.deepEqual(source.fire,before.fire); assert.deepEqual(source.loop,before.loop);
  const blocked=safeThrottlePlacement(source,393,852,insets,[{x:196.5,y:426,width:393,height:852}]);
  assert.equal(blocked.blocked,true); assert.equal(safeThrottlePlacement(layout(),60,80,insets).blocked,true);
});

test('v1 custom midpoint migrates non-destructively, v2/future/corrupt data cannot revive old controls', () => {
  const legacy={version:1,controls:{fire:{x:.72,y:.86,size:102,opacity:.95},loop:{x:.71,y:.63,size:70,opacity:.72},
    accelerate:{x:.1,y:.8,size:72,opacity:.8},brake:{x:.3,y:.6,size:80,opacity:.9}}};
  const raw=JSON.stringify(legacy), decoded=decodeControlLayout(raw,true);
  assert.deepEqual(decoded.fire,legacy.controls.fire); assert.deepEqual(decoded.loop,legacy.controls.loop);
  assert.deepEqual(decoded.throttle,{x:.2,y:.7,size:76,opacity:.8500000000000001});
  assert.equal(JSON.stringify(legacy),raw); assert.deepEqual(Object.keys(decoded),CONTROL_NAMES);
  assert.deepEqual(decodeControlLayout(JSON.stringify({...legacy,version:8}),true),DEFAULT_LAYOUT);
  assert.deepEqual(decodeControlLayout('broken'),DEFAULT_LAYOUT);
  assert.deepEqual(decodeControlLayout(JSON.stringify({version:3,controls:decoded})),DEFAULT_LAYOUT);
  assert.equal(validControlLayout(decoded),true);
  assert.equal(validControlLayout({...decoded,throttle:{...decoded.throttle,x:NaN}}),false);
});

test('Save preflight rejects peer/HUD collisions in either mode without moving the stored peers',()=>{
  const source=layout();source.loop={...source.fire};const before=structuredClone(source);
  assert.match(controlLayoutConflict(source,'normal',393,852,insets)!,/重な/);assert.deepEqual(source,before);
  assert.match(controlLayoutConflict(layout(),'easy',393,852,insets,[{x:326.19,y:562.32,width:100,height:100}])!,/重な/);
});
