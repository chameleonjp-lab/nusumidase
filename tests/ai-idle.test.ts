import assert from 'node:assert/strict';
import test from 'node:test';
import { MATCH_PLAY_TICKS } from '../src/mission';
import { createGame, startGame, stateInvariantError, stepFixed } from '../src/simulation';
import type { FlightInput } from '../src/types';

const neutral: FlightInput = { turn: 0, climb: 0, fire: false, loop: false, throttle: 0 };

test('20 fixed-seed idle matches reach a finite result within twelve effective minutes', () => {
  let captures = 0, pickups = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const state = createGame(seed, seed % 2 ? 'normal' : 'easy'); startGame(state);
    for (let steps = 0; steps < MATCH_PLAY_TICKS && state.phase !== 'ended'; steps++) {
      const before = state.playTicks; stepFixed(state, neutral);
      assert.notEqual(state.phase, 'paused', `seed=${seed}, tick=${state.tick}, reason=${state.pauseReason}`);
      assert.equal(stateInvariantError(state), null, `seed=${seed}, tick=${state.tick}`);
      assert.equal(state.playTicks, before + 1);
      for (const event of state.events) {
        if (event.type === 'capture' && event.owner !== state.player.id) captures++;
        if (event.type === 'pickup' && event.owner !== state.player.id) pickups++;
      }
    }
    assert.equal(state.phase, 'ended', `seed=${seed}: match never ended`);
    assert.ok(state.result && Object.isFrozen(state.result));
    assert.ok(state.result.playTicks <= MATCH_PLAY_TICKS);
    assert.ok(state.slots.length === 10 && state.bullets.length <= 1024);
    assert.ok(state.scores.friendly <= 1 && state.scores.enemy <= 1);
    assert.equal(state.roundEpoch, 0);
    const result = state.result; stepFixed(state, neutral); assert.equal(state.result, result);
  }
  // The no-input runs also prove that the legal flight planner can pick up
  // cores and deliver them; timeout alone would hide a nonfunctional AI.
  assert.ok(pickups > 0, 'No AI aircraft ever acquired a core');
  assert.ok(captures > 0, 'No AI aircraft ever delivered a core');
});
