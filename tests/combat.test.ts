import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { aircraftContactTime, advanceAmmunition, collectBulletDamage, collectContactDamage, fireAircraft, sweptAircraftHitTime } from '../src/combat';
import { updateQuaternion } from '../src/flight';
import { aircraftDamageMultiplier } from '../src/aircraft-damage';
import { MAX_BULLETS } from '../src/mission';
import { aircraftRef, resetAircraft } from '../src/respawn';
import { slotKey } from '../src/arena';
import { createGame } from '../src/simulation';
import type { Aircraft, Bullet, GameEvent, GameState } from '../src/types';

function fixture(): GameState {
  const state = createGame(9, 'normal'); state.phase = 'playing'; state.tick = 200; state.playTicks = 20;
  for (const plane of state.slots) { plane.position.set((plane.id - 4) * 100, 300, 1000); plane.previous.copy(plane.position); }
  return state;
}
function place(plane: Aircraft, position: Vector3): void { plane.position.copy(position); plane.previous.copy(position); plane.yaw = 0; plane.pitch = 0; plane.bank = 0; updateQuaternion(plane); }
function bullet(state: GameState, id = 1, owner = state.player): Bullet {
  return { id, matchId: state.matchId, roundEpoch: state.roundEpoch, owner: owner.id, ownerRef: aircraftRef(state, owner), team: owner.team,
    position: new Vector3(0, 300, 10), previous: new Vector3(0, 300, 10), velocity: new Vector3(0, 0, -1200), life: 1.5,
    damage: 20, kind: 'cannon', distanceTravelled: 0,
    targetGenerations: Object.fromEntries(state.slots.filter(plane => plane.team !== owner.team).map(plane => [slotKey(plane.team, plane.slotId), plane.generation])) };
}
test('weapon pairs reserve atomically at capacity remaining one/two; failed reservation preserves ammo/cadence', () => {
  const state = fixture(), plane = state.player; let id = 1;
  state.bullets = Array.from({ length: MAX_BULLETS - 1 }, (_, index) => bullet(state, index + 1)); plane.cannon = 0;
  fireAircraft(state, plane, true, () => id++, () => {});
  assert.equal(state.bullets.length, MAX_BULLETS - 1); assert.equal(plane.mg, 288); assert.equal(plane.fireClock, 0);
  state.bullets.pop(); fireAircraft(state, plane, true, () => id++, () => {});
  assert.equal(state.bullets.length, MAX_BULLETS); assert.equal(plane.mg, 286); assert.equal(plane.fireClock, 1 / 12); assert.equal(plane.cannonClock, 0);
});
test('one weapon empty keeps the other usable; both empty trigger exactly 360 ticks of reload', () => {
  const state = fixture(), plane = state.player, events: string[] = []; plane.mg = 2; plane.cannon = 0; let id = 1;
  fireAircraft(state, plane, true, () => id++, type => events.push(type));
  assert.equal(state.bullets.length, 2); assert.equal(plane.mg, 0); assert.equal(plane.reloadTicksRemaining, 360);
  for (let i = 0; i < 359; i++) advanceAmmunition(state, plane, type => events.push(type));
  assert.equal(plane.reloadTicksRemaining, 1); assert.equal(plane.mg, 0); advanceAmmunition(state, plane, type => events.push(type));
  assert.equal(plane.mg, 288); assert.equal(plane.cannon, 96); assert.equal(events.filter(type => type === 'reload-start').length, 1); assert.equal(events.filter(type => type === 'reload-complete').length, 1);
});
test('player retains original four muzzle offsets, speed inheritance, lifetime and baseline damage', () => {
  const state = fixture(), plane = state.player; place(plane, new Vector3(0, 300, 0)); plane.speed = 110; let id = 1;
  fireAircraft(state, plane, true, () => id++, () => {}); assert.equal(state.bullets.length, 4);
  assert.deepEqual(state.bullets.map(round => round.position.toArray()), [[-0.3, 300.52, -4.25], [0.3, 300.52, -4.25], [-2.5, 300, -2.4], [2.5, 300, -2.4]]);
  assert.deepEqual(state.bullets.map(round => round.velocity.length()), [930, 930, 810, 810]); assert.deepEqual(state.bullets.map(round => round.damage), [4, 4, 20, 20]);
  assert.ok(state.bullets.every(round => round.life === 1.5)); assert.equal(plane.mg, 286); assert.equal(plane.cannon, 94);
});
test('AI teams use identical finite ammo, cadence, spread magnitude and damage', () => {
  for (const team of ['friendly', 'enemy'] as const) {
    const state = fixture(), plane = team === 'friendly' ? state.allies[0] : state.enemies[0], target = team === 'friendly' ? state.enemies[0] : state.player;
    place(plane, new Vector3(0, 300, 300)); place(target, new Vector3(0, 300, 0)); plane.targetId = target.id; let id = 1;
    fireAircraft(state, plane, true, () => id++, () => {}); assert.equal(state.bullets.length, 4);
    assert.deepEqual(state.bullets.map(round => round.damage), [2.4, 2.4, 9.6, 9.6]); assert.equal(plane.fireClock, 0.28); assert.equal(plane.cannonClock, 0.95); assert.equal(plane.mg, 286); assert.equal(plane.cannon, 94);
  }
});
test('swept detailed aircraft hit volumes catch crossing between ticks, use first target once and do not mutate HP while collecting', () => {
  const state = fixture(), target = state.enemies[0], farther = state.enemies[1]; place(target, new Vector3(0, 300, 0)); place(farther, new Vector3(0, 300, -7));
  const round = bullet(state); round.previous.set(0, 300, 10); round.position.set(0, 300, -10); assert.notEqual(sweptAircraftHitTime(round, target), null);
  round.position.copy(round.previous); state.bullets = [round]; const damage = collectBulletDamage(state, () => {});
  assert.equal(damage.length, 1); assert.equal(damage[0].target, target); assert.equal(target.health, 80); assert.equal(farther.health, 80); assert.equal(state.bullets.length, 0);
});
test('friendly and protected planes are transparent to rounds; stale generation and epoch rounds do not hit new occupants', () => {
  const state = fixture(), friendly = state.allies[0], enemy = state.enemies[0]; place(friendly, new Vector3(0, 300, 0)); place(enemy, new Vector3(0, 300, -5));
  state.bullets = [bullet(state)]; let damage = collectBulletDamage(state, () => {}); assert.equal(damage[0].target, enemy);
  enemy.protectionUntilPlayTick = 200; state.bullets = [bullet(state)]; assert.equal(collectBulletDamage(state, () => {}).length, 0);
  enemy.protectionUntilPlayTick = 0; const old = bullet(state); resetAircraft(state, enemy); place(enemy, new Vector3(0, 300, 0)); state.bullets = [old];
  assert.equal(collectBulletDamage(state, () => {}).length, 0);
  const priorEpoch = bullet(state); priorEpoch.roundEpoch = 99; state.bullets = [priorEpoch]; assert.equal(collectBulletDamage(state, () => {}).length, 0); assert.equal(state.bullets.length, 0);
});
test('an already-fired dead shooter round remains active, and attenuation uses actual muzzle-to-impact flight distance', () => {
  const state = fixture(), target = state.enemies[0]; place(target, new Vector3(0, 300, 0)); const round = bullet(state); round.distanceTravelled = 800;
  state.player.health = 0; state.player.lifecycle = 'respawnPending'; state.bullets = [round];
  const damage = collectBulletDamage(state, () => {}); assert.equal(damage.length, 1); assert.equal(damage[0].amount, 14);
  assert.deepEqual([199.999, 200, 500, 800].map(distance => aircraftDamageMultiplier('mg', distance)), [1, 0.75, 0.5, 0.25]);
  assert.throws(() => aircraftDamageMultiplier('cannon', NaN), RangeError);
});
test('enemy aircraft swept collision marks both lethal while friendly/protected contacts cause no damage', () => {
  const state = fixture(), a = state.player, b = state.enemies[0]; place(a, new Vector3(-20, 300, 0)); place(b, new Vector3(20, 300, 0)); a.position.x = 20; b.position.x = -20;
  assert.notEqual(aircraftContactTime(a, b), null); const damage = collectContactDamage(state); assert.equal(damage.length, 2); assert.ok(damage.every(hit => hit.cause === 'collision' && hit.amount === 80));
  b.protectionUntilPlayTick = 21; assert.equal(collectContactDamage(state).length, 0); b.protectionUntilPlayTick = 0; b.team = 'friendly'; assert.equal(collectContactDamage(state).length, 0);
});
test('sea consumes a round once and advancing lifetime cannot resurrect it', () => {
  const state = fixture(), round = bullet(state), events: GameEvent['type'][] = []; round.position.set(0, 1, 0); round.previous.copy(round.position); round.velocity.set(0, -120, 0); state.bullets = [round];
  assert.equal(collectBulletDamage(state, type => events.push(type)).length, 0); assert.equal(state.bullets.length, 0); assert.deepEqual(events, ['splash']);
  assert.equal(collectBulletDamage(state, type => events.push(type)).length, 0); assert.equal(events.length, 1);
});
