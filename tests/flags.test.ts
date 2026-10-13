import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { BASE_POSITIONS, legalDropPosition, proximityTime } from '../src/arena';
import { captureCandidates, carriedFlagFor, dropCarrierFlags, flagInvariantError, flagStartSnapshot, getFlagPosition, resolveFlagTransitions, validateFlagEvent } from '../src/flags';
import { aircraftRef, scheduleRespawn } from '../src/respawn';
import { createGame } from '../src/simulation';
import type { Aircraft, GameState } from '../src/types';

function fixture(): GameState {
  const state = createGame(17, 'normal'); state.phase = 'playing'; state.playTicks = 100; state.tick = 280;
  for (const plane of state.slots) { plane.position.set(plane.team === 'friendly' ? -1000 : 1000, 500, 1000 + plane.slotId * 100); plane.previous.copy(plane.position); }
  return state;
}
function place(plane: Aircraft, point: Vector3): void { plane.position.copy(point); plane.previous.copy(point); }

test('inclusive 45m swept proximity catches high-speed crossings and excludes outside sphere', () => {
  const state = fixture(), plane = state.player, base = BASE_POSITIONS.enemy;
  for (const [distance, expected] of [[44.999, true], [45, true], [45.001, false]] as const) {
    place(plane, base.clone().add(new Vector3(0, distance, 0))); assert.equal(proximityTime(plane, base) !== null, expected);
  }
  plane.previous.copy(base).add(new Vector3(-100, 0, 0)); plane.position.copy(base).add(new Vector3(100, 0, 0));
  assert.equal(proximityTime(plane, base), 0.275);
});
test('enemy pickup has one deterministic owner irrespective of slots array order', () => {
  for (const reversed of [false, true]) {
    const state = fixture(), planes = [state.player, state.allies[0]];
    for (const plane of planes) place(plane, BASE_POSITIONS.enemy);
    if (reversed) state.slots.reverse();
    const transitions = resolveFlagTransitions(state, flagStartSnapshot(state)); assert.equal(transitions.length, 1);
    assert.equal(state.flags.enemy.state, 'carried'); if (state.flags.enemy.state === 'carried') assert.equal(state.flags.enemy.carrier.slotId, 0);
    assert.equal(flagInvariantError(state), null); assert.ok(carriedFlagFor(state, state.player));
  }
});
test('a closer swept entry wins before endpoint distance and stable slot tie', () => {
  const state = fixture(), base = BASE_POSITIONS.enemy;
  state.player.previous.copy(base).add(new Vector3(-100, 0, 0)); state.player.position.copy(base);
  place(state.allies[0], base.clone().add(new Vector3(40, 0, 0)));
  resolveFlagTransitions(state, flagStartSnapshot(state));
  assert.equal(state.flags.enemy.state === 'carried' && state.flags.enemy.carrier.slotId, 1);
});
test('manual home-team return outranks a simultaneous enemy pickup', () => {
  const state = fixture(), point = new Vector3(0, 300, 0), flag = state.flags.enemy;
  state.flags.enemy = { ...flag, state: 'dropped', position: point, droppedAtPlayTick: 1 };
  place(state.player, point); place(state.enemies[0], point);
  const transitions = resolveFlagTransitions(state, flagStartSnapshot(state));
  assert.equal(state.flags.enemy.state, 'atHome'); assert.equal(transitions[0].detail, 'manual');
});
test('new carrier drop is contact-ineligible until next tick', () => {
  const state = fixture(), dead = state.enemies[0], point = new Vector3(0, 300, 0);
  place(dead, point); place(state.enemies[1], point);
  state.flags.friendly = { ...state.flags.friendly, state: 'carried', carrier: aircraftRef(state, dead) };
  const start = flagStartSnapshot(state); scheduleRespawn(state, dead); dropCarrierFlags(state, dead);
  assert.equal(resolveFlagTransitions(state, start).length, 0); assert.equal(state.flags.friendly.state, 'dropped');
  state.playTicks++; resolveFlagTransitions(state, flagStartSnapshot(state));
  assert.equal(state.flags.friendly.state, 'carried'); assert.equal(flagInvariantError(state), null);
});
test('a core stays at the exact death point after thirty seconds and until contact, without following the dead carrier', () => {
  const state = fixture(), point = new Vector3(2300, 80, 1700), carrier = state.player;
  place(carrier, point);
  state.flags.enemy = { ...state.flags.enemy, state: 'carried', carrier: aircraftRef(state, carrier) };
  scheduleRespawn(state, carrier); dropCarrierFlags(state, carrier);
  carrier.position.set(0, 300, 0);
  for (const tick of [1900, 10000, 43199]) {
    state.playTicks = tick;
    assert.deepEqual(resolveFlagTransitions(state, flagStartSnapshot(state)), []);
    assert.equal(state.flags.enemy.state, 'dropped');
    assert.deepEqual(getFlagPosition(state, 'enemy').toArray(), point.toArray());
    assert.equal(flagInvariantError(state), null);
  }
  place(state.allies[0], point);
  const transitions = resolveFlagTransitions(state, flagStartSnapshot(state));
  assert.equal(state.flags.enemy.state, 'carried'); assert.equal(transitions[0].type, 'pickup');
});
test('drop preserves finite boundary/sea death coordinates and rejects NaN without a score', () => {
  assert.deepEqual(legalDropPosition(new Vector3(2401, 19, -1801))?.toArray(), [2401, 19, -1801]);
  assert.deepEqual(legalDropPosition(new Vector3(-2300, 899, 1700))?.toArray(), [-2300, 899, 1700]);
  assert.equal(legalDropPosition(new Vector3(NaN, 100, 0)), null);
  const state = fixture(); state.flags.enemy = { ...state.flags.enemy, state: 'carried', carrier: aircraftRef(state, state.player) };
  state.player.position.x = NaN; const events = dropCarrierFlags(state, state.player);
  assert.equal(state.flags.enemy.state, 'atHome'); assert.equal(events[0].detail, 'invalid-drop'); assert.equal(state.scores.friendly, 0);
});
test('both flags carried or own flag dropped allow capture; position derives from live carrier', () => {
  const state = fixture(); place(state.player, BASE_POSITIONS.friendly);
  state.flags.enemy = { ...state.flags.enemy, state: 'carried', carrier: aircraftRef(state, state.player) };
  assert.deepEqual(getFlagPosition(state, 'enemy').toArray(), state.player.position.toArray());
  assert.equal(captureCandidates(state, flagStartSnapshot(state)).length, 1);
  state.flags.friendly = { ...state.flags.friendly, state: 'carried', carrier: aircraftRef(state, state.enemies[0]) };
  place(state.enemies[0], BASE_POSITIONS.enemy); assert.equal(captureCandidates(state, flagStartSnapshot(state)).length, 2);
  state.flags.friendly = { flagId: 'core-A', homeTeam: 'friendly', roundEpoch: 0, revision: 2, state: 'dropped', position: new Vector3(0, 300, 0), droppedAtPlayTick: 1 };
  assert.equal(captureCandidates(state, flagStartSnapshot(state)).length, 1);
});
test('capture does not wait for an absent own core to return', () => {
  const state = fixture(); place(state.player, BASE_POSITIONS.friendly);
  state.flags.enemy = { ...state.flags.enemy, state: 'carried', carrier: aircraftRef(state, state.player) };
  state.flags.friendly = { ...state.flags.friendly, state: 'dropped', position: new Vector3(0, 300, 0), droppedAtPlayTick: 1 };
  state.playTicks = 1801; const start = flagStartSnapshot(state); resolveFlagTransitions(state, start);
  assert.equal(state.flags.friendly.state, 'dropped'); assert.equal(captureCandidates(state, start).length, 1); state.playTicks++;
  assert.equal(captureCandidates(state, flagStartSnapshot(state)).length, 1);
});
test('own flag stolen on arrival tick allows capture but newly picked-up enemy flag cannot instantly score', () => {
  const state = fixture(); place(state.player, BASE_POSITIONS.friendly); place(state.enemies[0], BASE_POSITIONS.friendly);
  state.flags.enemy = { ...state.flags.enemy, state: 'carried', carrier: aircraftRef(state, state.player) };
  const start = flagStartSnapshot(state); resolveFlagTransitions(state, start);
  assert.equal(captureCandidates(state, start).length, 1);
  const fresh = fixture(); place(fresh.player, BASE_POSITIONS.enemy); const previous = flagStartSnapshot(fresh);
  resolveFlagTransitions(fresh, previous); place(fresh.player, BASE_POSITIONS.friendly); assert.equal(captureCandidates(fresh, previous).length, 0);
});
test('old match/epoch/revision/tick flag events fail validation; protected planes cannot acquire or return', () => {
  const state = fixture(), flag = state.flags.enemy, event = { matchId: state.matchId, roundEpoch: state.roundEpoch, tick: state.tick, eventSeq: 1, flagId: flag.flagId, expectedRevision: flag.revision };
  assert.equal(validateFlagEvent(state, event), flag);
  for (const changed of [{ matchId: 'old' }, { roundEpoch: 99 }, { expectedRevision: 99 }, { tick: state.tick - 1 }]) assert.equal(validateFlagEvent(state, { ...event, ...changed }), null);
  place(state.player, BASE_POSITIONS.enemy); state.player.protectionUntilPlayTick = state.playTicks + 120;
  assert.equal(resolveFlagTransitions(state, flagStartSnapshot(state)).length, 0);
});
