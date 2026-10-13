import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { BASE_POSITIONS, slotKey } from '../src/arena';
import { captureCandidates, flagInvariantError, flagStartSnapshot } from '../src/flags';
import { collectBulletDamage } from '../src/combat';
import { aircraftRef, resetAircraft } from '../src/respawn';
import { applyCaptureCandidates, createGame, queueDamageEvent, stepFixed } from '../src/simulation';
import type { GameState } from '../src/types';

function playing(): GameState { const state = createGame(2026, 'normal'); state.phase = 'playing'; return state; }
function validCapture(state: GameState) {
  state.player.position.copy(BASE_POSITIONS.friendly); state.player.previous.copy(state.player.position);
  state.flags.enemy = { ...state.flags.enemy, state: 'carried', carrier: aircraftRef(state, state.player) };
  return captureCandidates(state, flagStartSnapshot(state))[0];
}

test('flag invariants reject nonfinite timer and a flag assigned to the wrong home-team key', () => {
  const state = playing();
  state.flags.friendly = { ...state.flags.friendly, state: 'dropped', position: new Vector3(0, 300, 0),
    droppedAtPlayTick: Infinity };
  assert.notEqual(flagInvariantError(state), null);
  const wrong = playing(); wrong.flags.friendly = { ...wrong.flags.friendly, homeTeam: 'enemy' };
  assert.notEqual(flagInvariantError(wrong), null);
});

test('capture reducer rejects a stale candidate from another match with the same revision', () => {
  const previous = playing(), stale = validCapture(previous), current = playing(); validCapture(current);
  assert.equal(applyCaptureCandidates(current, [stale]), false); assert.equal(current.scores.friendly, 0);
});

test('capture reducer rechecks carrier life and identity immediately before committing the score', () => {
  const state = playing(), candidate = validCapture(state); state.player.health = 0;
  assert.equal(applyCaptureCandidates(state, [candidate]), false); assert.equal(state.scores.friendly, 0);
});

test('more than 128 meaningful events pauses and disqualifies the match while preserving the kill', () => {
  const state = playing(), target = state.player, owner = state.enemies[0];
  const generations = Object.fromEntries(state.slots.filter(plane => plane.team === target.team).map(plane => [slotKey(plane.team, plane.slotId), plane.generation]));
  for (let id = 1; id <= 140; id++) {
    const position = target.position.clone().add(new Vector3(0, 0, 20));
    state.bullets.push({ id, matchId: state.matchId, roundEpoch: state.roundEpoch, owner: owner.id, ownerRef: aircraftRef(state, owner),
      team: owner.team, position, previous: position.clone(), velocity: new Vector3(0, 0, -2000), life: 1, damage: 4,
      kind: 'mg', distanceTravelled: 0, targetGenerations: { ...generations } });
  }
  stepFixed(state, { turn: 0, climb: 0, fire: false, loop: false, throttle: 0 });
  assert.equal(state.phase, 'paused'); assert.equal(state.recordEligible, false);
  assert.match(state.pauseReason!, /meaning event limit/);
  assert.ok(state.events.length <= 128); assert.equal(state.events.filter(event => event.type === 'kill').length, 1);
  assert.ok(state.events.some(event => event.type === 'invariant'));
});

test('real damage transaction ignores protection tick119 and applies lethal damage at tick120', () => {
  const state = playing(); state.player.protectionUntilPlayTick = 120; state.playTicks = 118;
  for (const expectedTick of [119, 120]) {
    assert.equal(queueDamageEvent(state, { matchId: state.matchId, roundEpoch: state.roundEpoch, tick: state.tick + 1,
      eventSeq: 900 + expectedTick, target: aircraftRef(state, state.player), owner: aircraftRef(state, state.enemies[0]), amount: 80, cause: 'bullet' }), true);
    stepFixed(state, { turn: 0, climb: 0, fire: false, loop: false, throttle: 0 });
    assert.equal(state.playTicks, expectedTick); assert.equal(state.player.health, expectedTick === 119 ? 80 : 0);
  }
  assert.equal(state.player.lifecycle, 'respawnPending');
});

test('an already flying round cannot hit a new generation occupying the same slot and world position', () => {
  const state = playing(), target = state.player, owner = state.enemies[0];
  const position = target.position.clone().add(new Vector3(0, 0, 20));
  state.bullets.push({ id: 1, matchId: state.matchId, roundEpoch: state.roundEpoch, owner: owner.id, ownerRef: aircraftRef(state, owner),
    team: owner.team, position, previous: position.clone(), velocity: new Vector3(0, 0, -2000), life: 1, damage: 80,
    kind: 'mg', distanceTravelled: 0, targetGenerations: { [slotKey(target.team, target.slotId)]: target.generation } });
  resetAircraft(state, target);
  assert.equal(collectBulletDamage(state, () => {} ).length, 0); assert.equal(target.health, 80);
});
