import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { combineThrottleAxes, throttleAxisFromRaw, throttleAxisFromClientY, resolveThrottleAxis } from '../src/throttle-lever';
import { advanceThrottle, createFlightController } from '../src/flight';
import { createGame } from '../src/simulation';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/throttle-lever-v1.json', import.meta.url), 'utf8'));
const approx = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('pinned shared core and all 35 fixtures agree through the product throttle adapter', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('../src/throttle-lever.ts', import.meta.url))).digest('hex'), 'e83fe3c570581d16cb76e08ef9a039bbe9d4a50da6575366ac7e126bf3f30cf0');
  assert.equal(createHash('sha256').update(readFileSync(new URL('./fixtures/throttle-lever-v1.json', import.meta.url))).digest('hex'), '416c5ac01d4d14d1f45d94385e07233090740db04382e468db1f0c64689df8ca');
  assert.equal(fixture.axis.length + fixture.pointer.length + fixture.combine.length + fixture.advance.length, 35);
  for (const item of fixture.axis) approx(throttleAxisFromRaw(item.raw), item.expected);
  for (const item of fixture.pointer) approx(throttleAxisFromClientY(item.y, item.top, item.bottom), item.expected);
  for (const item of fixture.combine) approx(combineThrottleAxes(item.pointer, item.accelerate, item.brake, item.focused), item.expected);
  const state = createGame(71, 'normal');
  for (const item of fixture.advance) {
    const controller = createFlightController(state.player); controller.playerTargetSpeed = item.start;
    advanceThrottle(controller, { turn: 0, climb: 0, fire: false, loop: false, throttle: item.axis }, item.mode, item.dt);
    approx(controller.playerTargetSpeed, item.expected);
  }
});

test('finite fail-safe, one final three-source clamp and explicit zero remain authoritative', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(throttleAxisFromRaw(value), 0); assert.equal(throttleAxisFromClientY(value, 0, 100), 0);
    assert.equal(throttleAxisFromClientY(10, value, 100), 0); assert.equal(resolveThrottleAxis({ throttle: value, accelerate: true }), 0);
  }
  assert.equal(combineThrottleAxes(1, false, true, 1), 1);
  assert.equal(resolveThrottleAxis({ throttle: 0, accelerate: true }), 0);
  assert.equal(resolveThrottleAxis({ accelerate: true }), 1);
  assert.equal(resolveThrottleAxis({ accelerate: true, brake: true }), 0);
});

test('one second of product ticks changes target at the contract rate, release retains target and Easy stays cruise', () => {
  const state = createGame(91, 'normal'), controller = createFlightController(state.player);
  const frame = { turn: 0, climb: 0, fire: false, loop: false, throttle: throttleAxisFromRaw(.54) };
  const actualSpeed = state.player.speed;
  for (let tick = 0; tick < 60; tick++) advanceThrottle(controller, frame, 'normal', 1 / 60);
  approx(controller.playerTargetSpeed, 119); assert.equal(state.player.speed, actualSpeed, 'lever never instantaneously assigns actual airspeed');
  advanceThrottle(controller, { ...frame, throttle: 0 }, 'normal', 1 / 60); approx(controller.playerTargetSpeed, 119);
  advanceThrottle(controller, { ...frame, throttle: -1 }, 'easy', 1); assert.equal(controller.playerTargetSpeed, 110);
});
