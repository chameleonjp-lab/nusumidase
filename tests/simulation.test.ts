import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { BASE_POSITIONS } from '../src/arena';
import { captureCandidates, flagStartSnapshot, getFlagPosition, resolveFlagTransitions } from '../src/flags';
import { aircraftRef, isProtected, processRespawns, scheduleRespawn } from '../src/respawn';
import { acknowledgeInputReset, applyCaptureCandidates, createGame, getPlayerTargetSpeed, pauseGame, queueDamageEvent, resumeGame, startGame, stateInvariantError, stepFixed, stepGame } from '../src/simulation';
import { FIXED_DT, MATCH_PLAY_TICKS } from '../src/mission';
import type { Aircraft, DamageEvent, GameState } from '../src/types';
const neutral = { turn: 0, climb: 0, fire: false, loop: false, throttle: 0 };
function playing(): GameState { const state = createGame(5, 'normal'); startGame(state); acknowledgeInputReset(state, state.inputEpoch); return state; }
function place(plane: Aircraft, point: Vector3): void { plane.position.copy(point); plane.previous.copy(point); }
function captureFixture(state: GameState): void {
  place(state.player, BASE_POSITIONS.friendly); state.flags.enemy = { ...state.flags.enemy, state: 'carried', carrier: aircraftRef(state, state.player) };
}
function killEvent(state: GameState, plane: Aircraft, eventSeq = 999): DamageEvent {
  return { matchId: state.matchId, roundEpoch: state.roundEpoch, tick: state.tick + 1, eventSeq, target: aircraftRef(state, plane), amount: 80, cause: 'bullet', owner: aircraftRef(state, plane.team === 'friendly' ? state.enemies[0] : state.player) };
}

test('start enters play immediately; the first tick moves aircraft and pause freezes every clock', () => {
  const state = createGame(); startGame(state);
  assert.equal(state.phase, 'playing'); assert.equal(state.phaseTicks, 0); assert.equal(state.playTicks, 0);
  const position = state.player.position.clone(); stepFixed(state, neutral);
  assert.equal(state.playTicks, 1); assert.equal(state.tick, 1); assert.notDeepEqual(state.player.position, position);
  pauseGame(state); const snapshot = JSON.stringify(state); for (let i = 0; i < 600; i++) assert.equal(stepFixed(state, neutral), false);
  assert.equal(JSON.stringify(state), snapshot); resumeGame(state); stepFixed(state, neutral);
  assert.equal(state.phase, 'playing'); assert.equal(state.playTicks, 2);
});

test('every player, ally and enemy carrier leaves its core at death, across respawn and another pickup/drop', () => {
  for (let index = 0; index < 10; index++) {
    const state = playing(), carrier = state.slots[index], coreTeam = carrier.team === 'friendly' ? 'enemy' : 'friendly';
    const point = new Vector3(0, 400, 600);
    place(carrier, point);
    state.flags[coreTeam] = { ...state.flags[coreTeam], state: 'carried', carrier: aircraftRef(state, carrier) };
    assert.equal(queueDamageEvent(state, killEvent(state, carrier)), true); stepFixed(state, neutral);
    const deathPoint = carrier.position.clone(), dropped = state.flags[coreTeam];
    assert.equal(carrier.lifecycle, 'respawnPending', `carrier ${index}`);
    assert.equal(dropped.state, 'dropped'); assert.deepEqual(getFlagPosition(state, coreTeam), deathPoint);
    const owner = state.slots.find(plane => plane.team === coreTeam)!;
    place(owner, deathPoint); resolveFlagTransitions(state, flagStartSnapshot(state));
    assert.equal(state.flags[coreTeam], dropped, 'the core owner cannot reset it by contact');
    state.playTicks += 1801; processRespawns(state);
    assert.equal(carrier.generation, 2); assert.equal(carrier.lifecycle, 'active');
    assert.deepEqual(getFlagPosition(state, coreTeam), deathPoint);
    assert.equal(state.flags[coreTeam], dropped);
    const nextCarrier = state.slots.find(plane => plane.team === carrier.team && plane !== carrier)!;
    place(nextCarrier, deathPoint); resolveFlagTransitions(state, flagStartSnapshot(state));
    const picked = state.flags[coreTeam];
    assert.equal(picked.state, 'carried');
    if (picked.state === 'carried') assert.deepEqual(picked.carrier, aircraftRef(state, nextCarrier));
    place(owner, new Vector3(1200, 500, -900));
    place(nextCarrier, new Vector3(300, 450, 700));
    assert.equal(queueDamageEvent(state, killEvent(state, nextCarrier)), true); stepFixed(state, neutral);
    assert.equal(state.flags[coreTeam].state, 'dropped');
    assert.deepEqual(getFlagPosition(state, coreTeam), nextCarrier.position);
    assert.notDeepEqual(getFlagPosition(state, coreTeam), deathPoint);
    assert.equal(stateInvariantError(state), null);
    assert.deepEqual(state.scores, { friendly: 0, enemy: 0 });
  }
});
test('frame adapter never consumes zero-step input, caps catch-up at five and pauses excessive backlog', () => {
  const state = playing(); let samples = 0, acks = 0;
  assert.equal(stepGame(state, () => { samples++; return neutral; }, FIXED_DT / 2, () => acks++), 0); assert.equal(samples, 0);
  assert.equal(stepGame(state, () => { samples++; return neutral; }, FIXED_DT / 2, () => acks++), 1); assert.equal(acks, 1);
  assert.equal(stepGame(state, neutral, 0.1), 5);
  const tick = state.tick; assert.equal(stepGame(state, neutral, 0.3), 0); assert.equal(state.phase, 'paused'); assert.equal(state.pauseReason, 'performance'); assert.equal(state.tick, tick);
});
test('cleared input adapter can immediately accept a fresh post-resume press without a neutral tick; stale epoch acknowledgement fails', () => {
  const state = playing(); pauseGame(state); const oldEpoch = state.inputEpoch; resumeGame(state);
  assert.equal(acknowledgeInputReset(state, oldEpoch), false); assert.equal(acknowledgeInputReset(state, state.inputEpoch), true);
  stepFixed(state, { ...neutral, throttle: 1 }); assert.equal(getPlayerTargetSpeed(state), 110.3);
});
test('external damage rejects malformed identity and old owner generations, and bounded queue overflow pauses safely', () => {
  const state = playing(), event = killEvent(state, state.player);
  assert.equal(queueDamageEvent(state, { ...event, eventSeq: NaN }), false);
  assert.equal(queueDamageEvent(state, { ...event, owner: { ...event.owner!, generation: 999 } }), false);
  for (let eventSeq = 0; eventSeq < 128; eventSeq++) assert.equal(queueDamageEvent(state, { ...event, eventSeq, amount: 1 }), true);
  assert.equal(queueDamageEvent(state, { ...event, eventSeq: 128 }), false); assert.equal(state.phase, 'paused'); assert.equal(state.recordEligible, false);
});
test('the first capture ends immediately without another round or resetting the aircraft', () => {
  const state = playing(); captureFixture(state); const generations = state.slots.map(plane => plane.generation);
  state.player.mg = 10; state.stats.kills = 3; stepFixed(state, neutral);
  assert.equal(state.phase, 'ended'); assert.equal(state.roundEpoch, 0); assert.equal(state.scores.friendly, 1); assert.equal(state.playTicks, 1);
  assert.equal(state.result?.outcome, 'victory'); assert.equal(state.stats.kills, 3); assert.equal(state.stats.captures, 1);
  for (const [index, plane] of state.slots.entries()) assert.equal(plane.generation, generations[index]);
  assert.equal(state.player.mg, 10); assert.equal(state.flags.enemy.state, 'carried');
  const snapshot = JSON.stringify(state);
  for (let i = 0; i < 180; i++) assert.equal(stepFixed(state, { ...neutral, fire: true, throttle: 1 }), false);
  assert.equal(JSON.stringify(state), snapshot);
});
test('arrival-tick lethal combat beats capture and schedules one respawn with legal flag drop', () => {
  const state = playing(); captureFixture(state); const event = killEvent(state, state.player);
  assert.equal(queueDamageEvent(state, event), true); assert.equal(queueDamageEvent(state, event), false); stepFixed(state, neutral);
  assert.equal(state.scores.friendly, 0); assert.equal(state.flags.enemy.state, 'dropped'); assert.equal(state.player.lifecycle, 'respawnPending');
  assert.equal(state.player.respawnDuePlayTick, 481); assert.equal(state.stats.deaths, 1); assert.equal(state.events.filter(event => event.type === 'kill').length, 1); assert.equal(stateInvariantError(state), null);
});
test('simultaneous lethal events kill both carriers, each drops once and neither scores', () => {
  const state = playing(); captureFixture(state); const enemy = state.enemies[0]; place(enemy, BASE_POSITIONS.enemy);
  state.flags.friendly = { ...state.flags.friendly, state: 'carried', carrier: aircraftRef(state, enemy) };
  assert.ok(queueDamageEvent(state, killEvent(state, state.player, 1))); assert.ok(queueDamageEvent(state, killEvent(state, enemy, 2))); stepFixed(state, neutral);
  assert.equal(state.flags.enemy.state, 'dropped'); assert.equal(state.flags.friendly.state, 'dropped'); assert.equal(state.events.filter(event => event.type === 'kill').length, 2); assert.deepEqual(state.scores, { friendly: 0, enemy: 0 });
});
test('respawn at exactly death+480 and protection ends at exactly spawn+120, paused clocks do not advance', () => {
  const state = playing(); state.playTicks = 100; const player = state.player, old = player.generation;
  assert.equal(scheduleRespawn(state, player), true); assert.equal(scheduleRespawn(state, player), false);
  state.playTicks = 579; assert.equal(processRespawns(state).length, 0); state.playTicks = 580; assert.deepEqual(processRespawns(state), [player]);
  assert.equal(player.generation, old + 1); assert.equal(player.protectionUntilPlayTick, 700); assert.equal(player.mg, 288); assert.equal(player.speed, 110);
  state.playTicks = 699; assert.equal(isProtected(state, player), true); state.playTicks = 700; assert.equal(isProtected(state, player), false);
  pauseGame(state); const snapshot = JSON.stringify(state); stepGame(state, neutral, 60); assert.equal(JSON.stringify(state), snapshot);
});
test('protected spawn cannot take bullet damage but boundary crossing remains fatal', () => {
  const state = playing(); state.player.protectionUntilPlayTick = 120; queueDamageEvent(state, killEvent(state, state.player)); stepFixed(state, neutral);
  assert.equal(state.player.health, 80); state.player.position.x = -2401; stepFixed(state, neutral); assert.equal(state.player.health, 0);
});
test('stale match/epoch/generation events fail, and late damage cannot change a completed match', () => {
  const state = playing(), event = killEvent(state, state.player);
  for (const changed of [{ matchId: 'old' }, { roundEpoch: 9 }, { target: { ...event.target, generation: 9 } }]) assert.equal(queueDamageEvent(state, { ...event, ...changed }), false);
  captureFixture(state); stepFixed(state, neutral); for (let i = 0; i < 180; i++) stepFixed(state, neutral);
  const snapshot = JSON.stringify(state); for (let i = 0; i < 1000; i++) assert.equal(queueDamageEvent(state, event), false); assert.equal(JSON.stringify(state), snapshot);
});
test('one capture ends once with deeply frozen result and takes precedence on the final time tick', () => {
  const state = playing(); state.playTicks = MATCH_PLAY_TICKS - 1; captureFixture(state); stepFixed(state, neutral);
  assert.equal(state.phase, 'ended'); assert.equal(state.result?.outcome, 'victory'); assert.equal(state.result?.reason, 'captures'); assert.equal(state.playTicks, MATCH_PLAY_TICKS);
  assert.ok(Object.isFrozen(state.result)); assert.ok(Object.isFrozen(state.result?.stats.teamKills)); assert.ok(Object.isFrozen(state.result?.scores)); assert.ok(Object.isFrozen(state.events)); assert.ok(Object.isFrozen(state.events[0]));
  const result = state.result, snapshot = JSON.stringify(state); for (let i = 0; i < 100; i++) assert.equal(stepFixed(state, { ...neutral, fire: true }), false);
  assert.equal(state.result, result); assert.equal(JSON.stringify(state), snapshot);
});
test('no core returned by twelve minutes is a draw', () => {
  const draw = playing(); draw.playTicks = MATCH_PLAY_TICKS - 1; stepFixed(draw, neutral);
  assert.equal(draw.result?.outcome, 'draw'); assert.equal(draw.result?.reason, 'time');
  assert.deepEqual(draw.result?.captures, { friendly: 0, enemy: 0 });
});
test('the first return wins for either team even while its own core is absent', () => {
  for (const team of ['friendly', 'enemy'] as const) {
    const state = playing(), carrier = team === 'friendly' ? state.player : state.enemies[0];
    const opponent = team === 'friendly' ? 'enemy' : 'friendly';
    place(carrier, BASE_POSITIONS[team]);
    state.flags[opponent] = { ...state.flags[opponent], state: 'carried', carrier: aircraftRef(state, carrier) };
    state.flags[team] = { ...state.flags[team], state: 'dropped', position: new Vector3(0, 300, 0), droppedAtPlayTick: 0 };
    stepFixed(state, neutral);
    assert.equal(state.phase, 'ended'); assert.equal(state.scores[team], 1); assert.equal(state.scores[opponent], 0);
    assert.equal(state.result?.outcome, team === 'friendly' ? 'victory' : 'defeat');
  }
});
test('two returns in one tick use actual entry order regardless of candidate and aircraft array order', () => {
  for (const firstTeam of ['friendly', 'enemy'] as const) for (const reversed of [false, true]) {
    const state = playing(); captureFixture(state); const enemy = state.enemies[0];
    place(enemy, BASE_POSITIONS.enemy);
    state.flags.friendly = { ...state.flags.friendly, state: 'carried', carrier: aircraftRef(state, enemy) };
    for (const carrier of [state.player, enemy]) {
      const distance = carrier.team === firstTeam ? 100 : 200;
      carrier.previous.copy(BASE_POSITIONS[carrier.team]).add(new Vector3(-distance, 0, 0));
    }
    if (reversed) state.slots.reverse();
    const candidates = captureCandidates(state, flagStartSnapshot(state)); if (reversed) candidates.reverse();
    assert.equal(applyCaptureCandidates(state, candidates), true);
    assert.equal(state.scores[firstTeam], 1); assert.equal(state.scores[firstTeam === 'friendly' ? 'enemy' : 'friendly'], 0);
  }
});
test('exactly simultaneous returns end in a draw rather than favouring a team', () => {
  const state = playing(); captureFixture(state); place(state.enemies[0], BASE_POSITIONS.enemy);
  state.flags.friendly = { ...state.flags.friendly, state: 'carried', carrier: aircraftRef(state, state.enemies[0]) };
  stepFixed(state, neutral);
  assert.equal(state.phase, 'ended'); assert.equal(state.result?.outcome, 'draw'); assert.equal(state.result?.reason, 'captures');
  assert.deepEqual(state.result?.captures, { friendly: 1, enemy: 1 });
});
test('a forged sphere-entry time cannot turn a later arrival into a win', () => {
  const state = playing(); captureFixture(state);
  const candidates = captureCandidates(state, flagStartSnapshot(state));
  assert.equal(applyCaptureCandidates(state, [{ ...candidates[0], entryTime: -1 }]), false);
  assert.deepEqual(state.scores, { friendly: 0, enemy: 0 });
});
test('abnormal simultaneous capture candidates cause safe pause and invalidate records', () => {
  const state = playing(); captureFixture(state); const candidates = captureCandidates(state, flagStartSnapshot(state));
  assert.equal(applyCaptureCandidates(state, [...candidates, ...candidates]), false); assert.equal(state.phase, 'paused'); assert.equal(state.recordEligible, false); assert.equal(state.scores.friendly, 0);
  resumeGame(state); assert.equal(state.phase, 'paused');
});
test('numeric flying/control state remains finite through deterministic mixed-input trace', () => {
  const state = playing();
  for (let i = 0; i < 1200 && state.phase === 'playing'; i++) {
    stepFixed(state, { turn: Math.sin(i / 100), climb: Math.sin(i / 120) * 0.2, fire: i % 3 === 0, loop: i % 500 === 0, throttle: Math.sin(i / 300) });
    assert.equal(stateInvariantError(state), null, `tick ${state.tick}`); assert.ok(state.bullets.length <= 1024); assert.ok(state.events.length <= 128);
  }
});
test('match identifiers remain distinct across fresh module sessions and repeated retries with a fixed seed', async () => {
  const firstUrl = new URL('../src/simulation.ts?identity-session=one', import.meta.url).href;
  const secondUrl = new URL('../src/simulation.ts?identity-session=two', import.meta.url).href;
  const first = await import(firstUrl), second = await import(secondUrl);
  assert.notEqual(first.createGame(5).matchId, second.createGame(5).matchId); assert.notEqual(createGame(5).matchId, createGame(5).matchId);
});
function deterministicSnapshot(state: GameState): string {
  return JSON.stringify({ ...state, slots: [...state.slots].sort((a, b) => a.id - b.id) }, (key, value) => {
    if (key === 'matchId' || key === 'id' && typeof value === 'string') return undefined;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value;
  });
}
test('shuffling authoritative aircraft and bullet arrays does not alter fixed-seed combat/flag outcomes', () => {
  const first = playing(), second = playing();
  for (let tick = 0; tick < 1200; tick++) {
    const input = { ...neutral, turn: Math.sin(tick / 160) * 0.4, fire: tick % 30 < 15 };
    second.slots.reverse(); second.bullets.reverse(); stepFixed(first, input); stepFixed(second, input);
    assert.equal(deterministicSnapshot(first), deterministicSnapshot(second), `tick ${tick}`);
  }
});
test('30/60/120Hz frame segmentation gives the same authoritative simulation trace', () => {
  const traces: GameState[] = [];
  for (const frequency of [30, 60, 120]) {
    const state = createGame(5, 'normal'); startGame(state);
    for (let frame = 0; frame < frequency * 10; frame++) stepGame(state, () => ({ ...neutral, turn: Math.sin(state.tick / 200) * 0.1, throttle: state.tick < 240 ? 0 : 0.5 }), 1 / frequency);
    traces.push(state);
  }
  assert.equal(traces[0].tick, 600); assert.equal(deterministicSnapshot(traces[0]), deterministicSnapshot(traces[1])); assert.equal(deterministicSnapshot(traces[1]), deterministicSnapshot(traces[2]));
});

test('zero-axis steering owner cannot falsely release an input-generation gate',()=>{
  const state=playing();pauseGame(state);resumeGame(state);
  const before=getPlayerTargetSpeed(state);
  stepFixed(state,{...neutral,steeringActive:true});
  stepFixed(state,{...neutral,throttle:1,steeringActive:true});assert.equal(getPlayerTargetSpeed(state),before);
  assert.equal(acknowledgeInputReset(state,state.inputEpoch),true);
  stepFixed(state,{...neutral,throttle:1,steeringActive:true});assert.ok(getPlayerTargetSpeed(state)>before);
});

test('carried-core death and exact respawn discard the old held-steering generation',()=>{
  const state=playing(),player=state.player;place(player,new Vector3(0,500,600));
  state.flags.enemy={...state.flags.enemy,state:'carried',carrier:aircraftRef(state,player)};
  const epoch=state.inputEpoch;queueDamageEvent(state,killEvent(state,player));stepFixed(state,{...neutral,turn:.4,steeringActive:true});
  const dropped=state.flags.enemy,deathPosition=getFlagPosition(state,'enemy').clone();
  assert.equal(dropped.state,'dropped');assert.ok(state.inputEpoch>epoch);assert.equal(player.lifecycle,'respawnPending');
  const deathEpoch=state.inputEpoch,generation=player.generation;
  state.playTicks=player.respawnDuePlayTick!-1;stepFixed(state,{...neutral,turn:.4,steeringActive:true});
  assert.equal(player.generation,generation+1);assert.equal(player.lifecycle,'active');assert.ok(state.inputEpoch>deathEpoch);
  assert.equal(acknowledgeInputReset(state,deathEpoch),false);assert.deepEqual(getFlagPosition(state,'enemy'),deathPosition);assert.equal(state.flags.enemy,dropped);
  const target=getPlayerTargetSpeed(state);stepFixed(state,{...neutral,steeringActive:true});stepFixed(state,{...neutral,throttle:1,steeringActive:true});assert.equal(getPlayerTargetSpeed(state),target);
  acknowledgeInputReset(state,state.inputEpoch);stepFixed(state,{...neutral,throttle:1,steeringActive:true});assert.ok(getPlayerTargetSpeed(state)>target);assert.equal(stateInvariantError(state),null);
});

// Exercise the actual DOM update functions without importing main's RAF/bootstrap.
// Parsing declarations keeps this tied to production code rather than a copied setter.
async function hudHarness(state: GameState) {
  const { readFileSync } = await import('node:fs');
  const { createContext, runInContext } = await import('node:vm');
  const ts = await import('typescript');
  const { boundaryWarning } = await import('../src/arena');
  const { carriedFlagFor } = await import('../src/flags');
  const { isAlive } = await import('../src/respawn');
  const { LOW_ALTITUDE_WARNING } = await import('../src/mission');
  const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = ['setStatusText', 'setStatusHidden', 'setStatusAttribute', 'formatTime', 'flagText', 'updateHUD', 'syncAudio'];
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''));
  assert.equal(functions.length, names.length);
  const code = ts.transpileModule(functions.map(node => node.getText(source)).join('\n'), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const writes: string[] = [], nodes = new Map<string, any>();
  const ids = ['timer','friendly-captures','enemy-captures','friendly-flag','enemy-flag','health','health-bar','altitude','speed','target-speed','allies-count','mg-ammo','cannon-ammo','reload-status','loop-status','loop','carrier-status','lifecycle-status','ally-announcements','warning','announcement','home-sound','game-sound'];
  for (const id of ids) {
    const values: any = {textContent:'',hidden:false,disabled:false,width:''}, attributes = new Map<string,string>();
    const node: any = {style:{},getAttribute:(name:string)=>attributes.get(name)??null,setAttribute:(name:string,value:string)=>{writes.push(`${id}:${name}`);attributes.set(name,value);}};
    for (const key of ['textContent','hidden','disabled']) Object.defineProperty(node,key,{get:()=>values[key],set:value=>{writes.push(`${id}:${key}`);values[key]=value;}});
    Object.defineProperty(node.style,'width',{get:()=>values.width,set:value=>{writes.push(`${id}:width`);values.width=value;}});
    nodes.set(id,node);
  }
  const el = (id:string) => {assert.ok(nodes.has(id), `unexpected UI target ${id}`);return nodes.get(id);};
  const audio = {active:false,enabled:false,syncCalls:0,sync(){this.syncCalls++;}};
  const document = {hidden:false};
  const context = createContext({state,el,buttons:{loop:el('loop')},audio,document,screen:'playing',contextLost:false,
    lastAudioActive:null,lastAudioEnabled:null,notificationUntilTick:0,MATCH_PLAY_TICKS,LOW_ALTITUDE_WARNING,
    BASE_POSITIONS,boundaryWarning,carriedFlagFor,isAlive,isProtected,getPlayerTargetSpeed});
  runInContext(code,context);
  return {nodes,writes,audio,document,context,
    update:()=>runInContext('updateHUD(); syncAudio();',context),
    sync:(force=false)=>runInContext(`syncAudio(${force});`,context)};
}

test('live HUD values stay current while unchanged frames perform zero DOM writes', async () => {
  for (const mode of ['normal','easy'] as const) {
    const state=createGame(5,mode);startGame(state);
    const h=await hudHarness(state),node=(id:string)=>h.nodes.get(id);
    h.update();
    assert.equal(node('timer').textContent,'12:00');assert.equal(node('health').textContent,'100');
    assert.equal(node('health-bar').style.width,'100%');assert.equal(node('friendly-flag').textContent,'基地に待機');
    assert.equal(node('mg-ammo').textContent,'288');assert.equal(node('cannon-ammo').textContent,'96');
    assert.equal(node('reload-status').hidden,true);assert.equal(node('carrier-status').hidden,true);
    h.writes.length=0;const before=JSON.stringify(state);for(let i=0;i<60;i++)h.update();
    assert.deepEqual(h.writes,[]);assert.equal(JSON.stringify(state),before);
    state.playTicks=61;state.player.health=40;state.player.mg=9;state.player.cannon=3;
    state.player.reloadTicksRemaining=120;state.player.loopCooldown=2.5;state.player.position.y=40;
    state.scores.friendly=1;state.flags.enemy={...state.flags.enemy,state:'carried',carrier:aircraftRef(state,state.player)};
    h.update();assert.equal(node('timer').textContent,'11:59');assert.equal(node('health').textContent,'50');
    assert.equal(node('health-bar').style.width,'50%');assert.equal(node('friendly-captures').textContent,'1');
    assert.equal(node('enemy-flag').textContent,'味方が携行');assert.equal(node('mg-ammo').textContent,'9');
    assert.equal(node('cannon-ammo').textContent,'3');assert.equal(node('reload-status').textContent,'再装填 2秒');
    assert.equal(node('reload-status').hidden,false);assert.equal(node('loop-status').textContent,'2.5秒');
    assert.equal(node('loop').disabled,true);assert.equal(node('carrier-status').hidden,false);
    assert.match(node('carrier-status').textContent,/敵コア携行中\n自基地/);assert.equal(node('warning').hidden,false);
    assert.equal(node('warning').textContent,'低空注意 · 機首を上げて');
    // A live-DOM comparison repairs external/settings changes; no stale cache.
    node('mg-ammo').textContent='stale';node('carrier-status').hidden=true;node('health-bar').style.width='0%';
    h.update();assert.equal(node('mg-ammo').textContent,'9');assert.equal(node('carrier-status').hidden,false);
    assert.equal(node('health-bar').style.width,'50%');
    h.writes.length=0;h.update();assert.deepEqual(h.writes,[]);
    state.player.health=0;state.player.lifecycle='respawnPending';state.player.respawnDuePlayTick=state.playTicks+480;
    h.update();assert.equal(node('lifecycle-status').hidden,false);assert.equal(node('lifecycle-status').textContent,'撃墜 · 復活まで 8秒');
    assert.equal(node('warning').hidden,true);assert.equal(node('loop').disabled,true);
    state.player.health=80;state.player.lifecycle='active';state.player.protectionUntilPlayTick=state.playTicks+120;
    h.update();assert.equal(node('lifecycle-status').textContent,'復活保護 2秒');
  }
});

test('sound button text and accessibility attributes reflect toggles and live DOM repairs', async () => {
  const h=await hudHarness(playing()),home=h.nodes.get('home-sound'),game=h.nodes.get('game-sound');
  h.sync();assert.equal(game.textContent,'音 OFF');assert.equal(game.getAttribute('aria-pressed'),'false');
  assert.equal(home.textContent,'音をオンにする');assert.equal(game.getAttribute('aria-label'),'音をオンにする');
  h.writes.length=0;const calls=h.audio.syncCalls;h.sync();assert.deepEqual(h.writes,[]);assert.equal(h.audio.syncCalls,calls);
  h.audio.enabled=true;h.sync();assert.equal(game.textContent,'音 ON');assert.equal(home.textContent,'音をオフにする');
  assert.equal(home.getAttribute('aria-pressed'),'true');assert.equal(game.getAttribute('aria-label'),'音をオフにする');
  home.setAttribute('aria-label','stale');game.textContent='stale';h.sync();
  assert.equal(home.getAttribute('aria-label'),'音をオフにする');assert.equal(game.textContent,'音 ON');
  h.document.hidden=true;h.sync();assert.equal(h.audio.active,false);assert.equal(h.audio.syncCalls,calls+2);
  h.writes.length=0;h.sync();assert.deepEqual(h.writes,[]);
});


test('HUD rounding, notification expiry and restoration keep their original transitions', async () => {
  const state=playing(),h=await hudHarness(state),node=(id:string)=>h.nodes.get(id);
  h.update();h.writes.length=0;state.player.mg--;
  h.update();assert.deepEqual(h.writes,['mg-ammo:textContent']);
  for (const [tick,text] of [[0,'12:00'],[59,'12:00'],[60,'11:59'],[61,'11:59'],[MATCH_PLAY_TICKS-1,'00:01'],[MATCH_PLAY_TICKS,'00:00']] as const) {
    state.playTicks=tick;h.update();assert.equal(node('timer').textContent,text);
  }
  for (const [ticks,text,hidden] of [[61,'再装填 2秒',false],[60,'再装填 1秒',false],[1,'再装填 1秒',false],[0,'再装填 0秒',true]] as const) {
    state.player.reloadTicksRemaining=ticks;h.update();assert.equal(node('reload-status').textContent,text);assert.equal(node('reload-status').hidden,hidden);
  }
  for (const [health,text] of [[80,'100'],[79.2,'99'],[79.20001,'100'],[0,'0'],[-1,'0']] as const) {
    state.player.health=health;h.update();assert.equal(node('health').textContent,text);assert.equal(node('health-bar').style.width,`${text}%`);
  }
  state.player.health=80;state.player.position.y=300;state.player.position.x=2399;
  h.update();assert.equal(node('warning').hidden,false);assert.equal(node('warning').textContent,'空域の境界に接近 · 内側へ旋回');
  state.phase='paused';h.context.screen='paused';h.context.contextLost=true;h.update();assert.equal(node('loop').disabled,true);assert.equal(h.audio.active,false);
  const pausedDisplay=[...h.nodes.values()].map(n=>[n.textContent,n.hidden,n.disabled,n.style.width]);
  h.context.contextLost=false;h.update();assert.deepEqual([...h.nodes.values()].map(n=>[n.textContent,n.hidden,n.disabled,n.style.width]),pausedDisplay);
  node('announcement').textContent='通知';h.context.notificationUntilTick=3;state.tick=2;h.update();assert.equal(node('announcement').textContent,'通知');
  state.tick=3;h.update();assert.equal(node('announcement').textContent,'');assert.equal(h.context.notificationUntilTick,0);
  // The expiry bookkeeping must still run when another writer already cleared the DOM.
  h.context.notificationUntilTick=3;h.writes.length=0;h.update();assert.equal(h.context.notificationUntilTick,0);assert.deepEqual(h.writes,[]);
  const calls=h.audio.syncCalls;h.sync(true);assert.equal(h.audio.syncCalls,calls+1);assert.deepEqual(h.writes,[]);
  state.phase='playing';h.context.screen='playing';h.sync();assert.equal(h.audio.active,true);assert.equal(h.audio.syncCalls,calls+2);
});

async function overlayPreparationHarness(state: GameState, visible: boolean) {
  const { NusumidaseScene } = await import('../src/scene');
  const { PerspectiveCamera } = await import('three');
  const { getFlightCameraPose } = await import('../src/flight-view');
  const scene:any=Object.create(NusumidaseScene.prototype), camera=new PerspectiveCamera(64,393/852,.5,22000);
  getFlightCameraPose(state.player,state.mode,camera.position,camera.quaternion);camera.updateMatrixWorld();
  const style:Record<string,unknown>={},stack:Record<string,unknown>[]=[];
  const raster:any[][]=[],reads:any[]=[];let commands:any[]=[],failRead=0,readCount=0,failRedraw=false;
  const methods:Record<string,any>={
    clearRect:(...args:any[])=>{commands=[['clearRect',...args]];},
    save:()=>{stack.push({...style});commands.push(['save']);},
    restore:()=>{const saved=stack.pop();assert.ok(saved);for(const key of Object.keys(style))delete style[key];Object.assign(style,saved);commands.push(['restore']);},
    getImageData:(...args:any[])=>{reads.push({args,commands:[...commands],pose:[...camera.position.toArray(),...camera.quaternion.toArray()]});if(++readCount===failRead)throw new Error('readback failed');return {data:new Uint8ClampedArray(0)};},
  };
  for(const name of ['beginPath','arc','moveTo','lineTo','stroke','fillRect','fillText','closePath','translate','fill','rect'])methods[name]=(...args:any[])=>commands.push([name,...args]);
  const ctx=new Proxy(methods,{get:(target,key:string)=>key in target?target[key]:style[key],set:(_target,key:string,value)=>{style[key]=value;commands.push(['set',key,value]);return true;}});
  Object.assign(scene,{camera,ctx,current:state,overlay:{width:393,height:852},width:393,height:852,overlayVisible:visible,overlayRevision:0,disposed:false,prepared:false});
  const draw=scene.drawOverlay;
  scene.drawOverlay=function(view:GameState,show:boolean){if(failRedraw&&view===state)throw new Error('redraw failed');const result=draw.call(this,view,show);raster.push([...commands]);return result;};
  scene.drawOverlay(state,visible);
  const snapshot=()=>JSON.stringify({position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),matrix:camera.matrix.toArray(),world:camera.matrixWorld.toArray(),inverse:camera.matrixWorldInverse.toArray(),needsUpdate:camera.matrixWorldNeedsUpdate});
  return {scene,camera,ctx,style,stack,raster,reads,snapshot,
    failRead:(n:number)=>{failRead=n;},failRedraw:()=>{failRedraw=true;},getReadCount:()=>readCount};
}

test('Canvas2D preparation uses both real HUD paths and restores blank or paused display and exact camera',async()=>{
  const { getFlightCameraPose }=await import('../src/flight-view');
  for(const mode of ['normal','easy'] as const)for(const visible of [false,true])for(const dead of [false,true]){
    const state=createGame(5,mode);if(visible){startGame(state);pauseGame(state);}
    if(dead){state.player.lifecycle='respawnPending';state.player.health=0;state.player.respawnDuePlayTick=480;}
    const h=await overlayPreparationHarness(state,visible);
    // A restored/dead view may intentionally differ from the current plane pose.
    h.camera.position.add(new Vector3(2,3,4));h.camera.rotateZ(.17);h.camera.updateMatrixWorld();
    h.scene.drawOverlay(state,visible);const beforePixels=h.raster.at(-1),beforeCamera=h.snapshot(),beforeStyle={...h.style},beforeState=JSON.stringify(state);
    h.scene.prepareOverlay();
    assert.equal(h.reads.length,2);assert.deepEqual(h.reads.map(r=>r.args),[[0,0,393,852],[0,0,393,852]]);
    for(const [i,warmMode] of (['normal','easy'] as const).entries()){
      const position=state.player.position.clone(),quaternion=state.player.quaternion.clone();getFlightCameraPose(state.player,warmMode,position,quaternion);
      assert.deepEqual(h.reads[i].pose,[...position.toArray(),...quaternion.toArray()]);
      assert.ok(h.reads[i].commands.some((command:any[])=>command[0]==='fillText'));
    }
    assert.equal(h.snapshot(),beforeCamera);assert.deepEqual(h.raster.at(-1),beforePixels);assert.deepEqual(h.style,beforeStyle);assert.equal(h.stack.length,0);
    assert.equal(JSON.stringify(state),beforeState);assert.equal(h.scene.current,state);assert.equal(h.scene.overlayVisible,visible);assert.equal(h.scene.prepared,false);
  }
});

test('Canvas2D readback and redraw failures propagate while restoring camera/context and avoiding readiness',async()=>{
  for(const visible of [false,true])for(const failAt of [1,2]){
    const state=playing();pauseGame(state);const h=await overlayPreparationHarness(state,visible);
    const pixels=h.raster.at(-1),camera=h.snapshot(),style={...h.style},before=JSON.stringify(state);h.failRead(failAt);
    assert.throws(()=>h.scene.prepareOverlay(),/readback failed/);
    assert.equal(h.snapshot(),camera);assert.deepEqual(h.raster.at(-1),pixels);assert.deepEqual(h.style,style);assert.equal(h.stack.length,0);
    assert.equal(JSON.stringify(state),before);assert.equal(h.scene.prepared,false);
  }
  const h=await overlayPreparationHarness(playing(),true),camera=h.snapshot(),style={...h.style};h.failRead(1);h.failRedraw();
  assert.throws(()=>h.scene.prepareOverlay(),/redraw failed/);assert.equal(h.snapshot(),camera);assert.deepEqual(h.style,style);assert.equal(h.stack.length,0);assert.equal(h.scene.prepared,false);
});

test('preparation warms the current backing store after compile/queued resize and awaits every clean GPU fence',async()=>{
  const originalRAF=Object.getOwnPropertyDescriptor(globalThis,'requestAnimationFrame');
  try{
    for(const resizeStage of ['none','compile','pending','same-size','read-failure','fence-failure','disposed'] as const){
      const state=playing();pauseGame(state);const h=await overlayPreparationHarness(state,true),s=h.scene,events:string[]=[];
      let rect={width:393,height:852},submissions=0,polls=0,frames=0;
      s.canvas={getBoundingClientRect:()=>rect};s.planes=new Map();s.flags={root:{visible:false}};s.scene={traverse:()=>{}};
      s.particlePositions=new Float32Array(3);s.particleColors=new Float32Array(3);s.particleSizes=new Float32Array(1);s.particleOpacity=new Float32Array(1);
      s.particleGeometry={attributes:{},setDrawRange:()=>{}};
      s.aircraftTracers={prime:()=>{},update:()=>{},coreMaterial:{resolution:{set:()=>{}}},outlineMaterial:{resolution:{set:()=>{}}}};
      s.renderer={compileAsync:async()=>{if(resizeStage==='compile'){rect={width:568,height:320};s.resize();}},render:()=>events.push('render'),setSize:()=>{}};
      s.renderQueue={submit:()=>{assert.equal(s.prepared,false);submissions++;events.push('submit');polls=0;},poll:()=>resizeStage==='fence-failure'?'failed':++polls===1?'pending':'ready',reset:()=>events.push('reset'),diagnostics:()=>({})};
      const realPrepare=s.prepareOverlay;s.prepareOverlay=function(){events.push(`warm:${this.overlay.width}x${this.overlay.height}`);return realPrepare.call(this);};
      Object.defineProperty(globalThis,'requestAnimationFrame',{configurable:true,value:(callback:(now:number)=>void)=>{
        assert.equal(s.prepared,false);frames++;if(resizeStage==='disposed')s.disposed=true;
        if(frames===1&&(resizeStage==='pending'||resizeStage==='same-size')){if(resizeStage==='pending')rect={width:1280,height:720};s.resize();}
        queueMicrotask(()=>callback(performance.now()));return frames;
      }});
      const before=JSON.stringify(state);
      if(resizeStage==='read-failure'){h.failRead(1);await assert.rejects(s.prepare(),/readback failed/);assert.equal(s.prepared,false);assert.equal(submissions,0);assert.equal(JSON.stringify(state),before);continue;}
      if(resizeStage==='fence-failure'){await assert.rejects(s.prepare(),/Initial GPU frame failed/);assert.equal(s.prepared,false);assert.equal(events.includes('reset'),false);assert.equal(JSON.stringify(state),before);continue;}
      await s.prepare();assert.equal(JSON.stringify(state),before);
      if(resizeStage==='disposed'){assert.equal(s.prepared,false);assert.equal(events.includes('reset'),false);continue;}
      assert.equal(s.prepared,true);
      const expectedPasses=resizeStage==='pending'||resizeStage==='same-size'?2:1;
      assert.equal(submissions,expectedPasses);assert.equal(frames,expectedPasses);assert.equal(h.reads.length,2*expectedPasses);
      assert.deepEqual(h.reads.at(-1).args,[0,0,rect.width,rect.height]);assert.equal(events.at(-1),'reset');
      for(let i=0;i<events.length;i++)if(events[i].startsWith('warm:'))assert.deepEqual(events.slice(i+1,i+3),['render','submit']);
    }
  }finally{if(originalRAF)Object.defineProperty(globalThis,'requestAnimationFrame',originalRAF);else delete (globalThis as any).requestAnimationFrame;}
});

test('public label clip keeps original text operations, current path and exact fallback states',async()=>{
  const { NusumidaseScene }=await import('../src/scene');
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Path2D');
  class ClipPath { rectangles:number[][]=[]; rect(...values:number[]){this.rectangles.push(values);} }
  Object.defineProperty(globalThis,'Path2D',{configurable:true,value:ClipPath});
  try{
    for(const variant of ['clip','missing-bounds','nonfinite-bounds','transform','alpha','composite','filter','offset','blur','throw'] as const){
      const commands:any[]=[],stack:any[]=[],path=['existing','leader'];let measures=0;
      const c:any={font:'old',textAlign:'left',fillStyle:'#77dacb',shadowBlur:3,shadowOffsetX:0,shadowOffsetY:0,globalAlpha:1,globalCompositeOperation:'source-over',filter:'none',
        getTransform:()=>({isIdentity:variant!=='transform'}),
        measureText:()=>{measures++;return variant==='missing-bounds'?{}:{actualBoundingBoxLeft:20,actualBoundingBoxRight:variant==='nonfinite-bounds'?NaN:22,actualBoundingBoxAscent:8,actualBoundingBoxDescent:3};},
        save:()=>stack.push({font:c.font,textAlign:c.textAlign,fillStyle:c.fillStyle}),restore:()=>Object.assign(c,stack.pop()),
        clip:(p:ClipPath)=>commands.push(['clip',p.rectangles]),
        fillText:(text:string,x:number,y:number)=>{commands.push(['text',text,x,y,c.font,c.fillStyle]);if(variant==='throw')throw new Error('text failure');},
      };
      if(variant==='alpha')c.globalAlpha=.5;if(variant==='composite')c.globalCompositeOperation='copy';if(variant==='filter')c.filter='blur(1px)';if(variant==='offset')c.shadowOffsetX=1;if(variant==='blur')c.shadowBlur=4;
      const s:any=Object.create(NusumidaseScene.prototype);s.ctx=c;
      if(variant==='throw')assert.throws(()=>s.drawPublicLabel('基地','1.0km · 高度30m',86.25,264.12),/text failure/);
      else s.drawPublicLabel('基地','1.0km · 高度30m',86.25,264.12);
      assert.deepEqual(path,['existing','leader']);assert.equal(stack.length,0);
      const clipped=variant==='clip'||variant==='throw';assert.equal(commands.some(x=>x[0]==='clip'),clipped);
      if(clipped)assert.deepEqual(commands[0],['clip',[[42,232,91,73]]]);
      if(variant!=='throw')assert.deepEqual(commands.filter(x=>x[0]==='text'),[
        ['text','基地',86.25,264.12,'600 10px system-ui','#77dacb'],['text','1.0km · 高度30m',86.25,277.12,'10px system-ui','#dce8df']]);
      if(['alpha','composite','filter','offset','blur','transform'].includes(variant))assert.equal(measures,0);
    }
  }finally{if(descriptor)Object.defineProperty(globalThis,'Path2D',descriptor);else delete (globalThis as any).Path2D;}
});
