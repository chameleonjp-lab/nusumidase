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
