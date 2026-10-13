import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { flightInputForAI, hasSafeShot, ROLE_HOLD_TICKS, targetFor, updateAI } from '../src/ai';
import { BASE_POSITIONS, isLegalPosition, otherTeam, segmentSphereEntry } from '../src/arena';
import { ENEMY_MAX_PITCH, forwardOf, updateAircraftMotion, updateQuaternion } from '../src/flight';
import { FIXED_DT, makeAircraft, makeSlots, resolveMissionConfig } from '../src/mission';
import { navigationInput, orbitWaypoint, planRoute, routeWaypoint, SAFE_WAYPOINTS } from '../src/navigation';
import type { Aircraft, GameMode, GameState, Team } from '../src/types';

function fixture(mode: GameMode = 'normal'): GameState {
  const slots = makeSlots();
  return { phase: 'playing', pausedFrom: null, pauseReason: null, matchId: 'ai-fixture', roundEpoch: 0, tick: 0, playTicks: 0, phaseTicks: 0,
    mode, config: resolveMissionConfig(mode), seed: 47, elapsed: 0, slots, player: slots[0], allies: slots.slice(1, 5), enemies: slots.slice(5),
    flags: { friendly: { flagId: 'friendly-core', homeTeam: 'friendly', roundEpoch: 0, revision: 0, state: 'atHome' },
      enemy: { flagId: 'enemy-core', homeTeam: 'enemy', roundEpoch: 0, revision: 0, state: 'atHome' } },
    scores: { friendly: 0, enemy: 0 }, bullets: [], events: [],
    stats: { captures: 0, returns: 0, kills: 0, deaths: 0, shots: 0, hits: 0, loops: 0, damageTaken: 0,
      teamKills: { friendly: 0, enemy: 0 }, teamReturns: { friendly: 0, enemy: 0 } },
    result: null, recordEligible: true, lastCapturePlayTick: 0, roundScored: false, inputEpoch: 0 };
}

function carried(state: GameState, homeTeam: Team, carrier: Aircraft): void {
  state.flags[homeTeam] = { ...state.flags[homeTeam], state: 'carried', revision: state.flags[homeTeam].revision + 1,
    carrier: { matchId: state.matchId, roundEpoch: state.roundEpoch, team: carrier.team, slotId: carrier.slotId, generation: carrier.generation } };
}

test('both teams allocate attack, defence and reserve; human control remains intact', () => {
  const state = fixture(); state.player.aiTurn = 0.123; updateAI(state);
  assert.equal(state.allies.filter(plane => plane.aiRole === 'attacker').length, 2);
  assert.equal(state.allies.filter(plane => plane.aiRole === 'defender').length, 2);
  assert.equal(state.enemies.filter(plane => plane.aiRole === 'attacker').length, 2);
  assert.equal(state.enemies.filter(plane => plane.aiRole === 'defender').length, 2);
  assert.equal(state.enemies.filter(plane => plane.aiRole === 'recover').length, 1);
  assert.equal(state.player.aiTurn, 0.123);
  for (const plane of [...state.allies, ...state.enemies]) {
    const input = flightInputForAI(plane);
    assert.ok(Number.isFinite(input.turn) && Math.abs(input.turn) <= 1);
    assert.ok(Number.isFinite(input.climb) && Math.abs(input.climb) <= 1);
    assert.equal(input.throttle, 0); assert.equal(input.loop, false);
  }
});

test('roles hold 120 ticks, but theft/death triggers reassignment at the next six-tick decision', () => {
  const state = fixture(); updateAI(state);
  const roles = state.allies.map(plane => plane.aiRole);
  state.allies.forEach((plane, index) => { plane.aiRoleSinceTick = 0; plane.position.x = index % 2 ? 1000 : -1400; });
  state.playTicks = ROLE_HOLD_TICKS - 6; updateAI(state);
  assert.deepEqual(state.allies.map(plane => plane.aiRole), roles);
  carried(state, 'friendly', state.enemies[0]);
  state.playTicks += 6; updateAI(state);
  assert.equal(state.allies.filter(plane => plane.aiRole === 'recover').length, 2);
  assert.ok(state.allies.some(plane => plane.aiRole === 'attacker'));
  const survivor = state.allies[0];
  for (const plane of state.allies.slice(1)) { plane.health = 0; plane.lifecycle = 'respawnPending'; }
  state.playTicks += 6; updateAI(state); assert.equal(survivor.aiRole, 'recover');
});

test('carrier returns even when its own core is stolen, while one separate aircraft escorts', () => {
  const state = fixture(), carrier = state.allies[0]; carried(state, 'enemy', carrier); updateAI(state);
  assert.equal(carrier.aiRole, 'return'); assert.equal(state.allies.filter(plane => plane.aiRole === 'escort').length, 1);
  assert.equal(carrier.aiWaypoint.distanceTo(BASE_POSITIONS.friendly), 0);
  carried(state, 'friendly', state.enemies[0]); state.playTicks = 6; updateAI(state);
  assert.equal(carrier.aiRole, 'return');
  assert.equal(carrier.aiWaypoint.distanceTo(BASE_POSITIONS.friendly), 0);
  assert.equal(state.allies.filter(plane => plane.aiRole === 'recover').length, 2);
});

test('ordinary targets are visible only within 1500m and friendly firing corridors suppress shots', () => {
  const state = fixture(), plane = state.allies[0], enemy = state.enemies[0];
  plane.position.set(0, 300, 0); plane.yaw = 0; plane.pitch = 0; plane.bank = 0; updateQuaternion(plane);
  enemy.position.set(0, 300, -500);
  assert.equal(targetFor(state, enemy.id, plane), enemy); assert.equal(hasSafeShot(state, plane, enemy), true);
  state.allies[1].position.set(0, 300, -250); assert.equal(hasSafeShot(state, plane, enemy), false);
  state.allies[1].position.set(-30, 300, -250); assert.equal(hasSafeShot(state, plane, enemy), false);
  state.allies[1].position.x = 100; enemy.position.z = -1500.001;
  assert.equal(targetFor(state, enemy.id, plane), null); assert.equal(hasSafeShot(state, plane, enemy), false);
});

test('ten-second stalled objective reroutes twice through different finite safe points without teleporting', () => {
  const state = fixture(); updateAI(state);
  const plane = state.allies.find(item => item.aiRole === 'attacker')!;
  const position = plane.position.clone(), speed = plane.speed;
  state.playTicks = 600; updateAI(state); assert.equal(plane.aiRouteStage, 1);
  const first = plane.aiWaypoint.clone();
  state.playTicks = 1200; updateAI(state); assert.equal(plane.aiRouteStage, 2);
  assert.notDeepEqual(plane.aiWaypoint.toArray(), first.toArray());
  assert.deepEqual(plane.position.toArray(), position.toArray()); assert.equal(plane.speed, speed);
  assert.ok(SAFE_WAYPOINTS.length <= 64);
});

test('a stalled public carrier interception also reroutes after ten seconds', () => {
  const state = fixture(); carried(state, 'friendly', state.enemies[0]); updateAI(state);
  const plane = state.allies.find(item => item.aiRole === 'recover')!;
  state.playTicks = 600; updateAI(state); assert.equal(plane.aiRouteStage, 1);
});

function flyTo(plane: Aircraft, target: Vector3, preferredSpeed: number): number {
  const route = planRoute(plane.position, target, 0, forwardOf(plane)); let controls = { turn: 0, climb: 0 };
  for (let tick = 0; tick < 180 * 60; tick++) {
    if (tick % 6 === 0) controls = navigationInput(plane, routeWaypoint(plane, route));
    plane.previous.copy(plane.position);
    updateAircraftMotion(plane, controls.turn, controls.climb, FIXED_DT, preferredSpeed, false, 141, ENEMY_MAX_PITCH);
    assert.ok(isLegalPosition(plane.position), `illegal route: speed=${preferredSpeed} tick=${tick} goal=${target.toArray()} position=${plane.position.toArray()}`);
    assert.ok(Number.isFinite(plane.speed) && plane.speed >= 65 && plane.speed <= 141);
    assert.ok(Math.abs(plane.pitch) <= ENEMY_MAX_PITCH + 1e-9);
    if (segmentSphereEntry(plane.previous.clone().sub(target), plane.position.clone().sub(target), 45) !== null) return tick + 1;
  }
  assert.fail(`180 second route timeout: speed=${preferredSpeed} goal=${target.toArray()} final=${plane.position.toArray()}`);
}

test('real inherited flight reaches both bases and every legal drop corner, then returns, in both modes at 65/110/141', () => {
  for (const mode of ['normal', 'easy'] as const) for (const team of ['friendly', 'enemy'] as const) for (const speed of [65, 110, 141]) {
    const home = BASE_POSITIONS[team], goals: Vector3[] = [BASE_POSITIONS[otherTeam(team)].clone()];
    for (const x of [-2000, 2000]) for (const z of [-1400, 1400]) for (const y of [150, 750]) goals.push(new Vector3(x, y, z));
    for (const goal of goals) {
      const plane = makeAircraft(2, team, home.clone(), team === 'friendly' ? -Math.PI / 2 : Math.PI / 2);
      plane.speed = speed; // Initial fixture, never changed by the route planner.
      const outbound = flyTo(plane, goal, speed), inbound = flyTo(plane, home, speed);
      assert.ok(outbound <= 10800 && inbound <= 10800, `${mode}:${team}:${speed}`);
    }
  }
});

test('waiting circle stays legal and can turn into a capture approach using ordinary flight', () => {
  for (const team of ['friendly', 'enemy'] as const) for (const speed of [65, 110, 141]) {
    const home = BASE_POSITIONS[team], plane = makeAircraft(2, team, home.clone().add(new Vector3(300, 0, 0)), -Math.PI);
    plane.speed = speed;
    for (let tick = 0; tick < 60 * 60; tick++) {
      const controls = navigationInput(plane, orbitWaypoint(plane, home, 300));
      updateAircraftMotion(plane, controls.turn, controls.climb, FIXED_DT, speed);
      assert.ok(isLegalPosition(plane.position));
      assert.ok(plane.position.distanceTo(home) <= 550);
    }
    assert.ok(forwardOf(plane).length() > 0.99); flyTo(plane, home, speed);
  }
});
