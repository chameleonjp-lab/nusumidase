import { spawnPosition, spawnYaw } from './arena';
import { makeAircraft, RESPAWN_PROTECTION_TICKS, RESPAWN_TICKS } from './mission';
import type { Aircraft, AircraftRef, GameState } from './types';

export function aircraftRef(state: GameState, aircraft: Aircraft): AircraftRef {
  return { matchId: state.matchId, roundEpoch: state.roundEpoch, team: aircraft.team, slotId: aircraft.slotId, generation: aircraft.generation };
}
export function sameRef(a: AircraftRef, b: AircraftRef): boolean {
  return a.matchId === b.matchId && a.roundEpoch === b.roundEpoch && a.team === b.team && a.slotId === b.slotId && a.generation === b.generation;
}
export function resolveAircraftRef(state: GameState, ref: AircraftRef): Aircraft | null {
  if (ref.matchId !== state.matchId || ref.roundEpoch !== state.roundEpoch) return null;
  return state.slots.find(plane => plane.team === ref.team && plane.slotId === ref.slotId && plane.generation === ref.generation) ?? null;
}
export function isAlive(aircraft: Aircraft): boolean { return aircraft.lifecycle === 'active' && aircraft.health > 0; }
export function isProtected(state: GameState, aircraft: Aircraft): boolean { return state.playTicks < aircraft.protectionUntilPlayTick; }
/** Idempotent death reservation; the flag reducer drops the carrier in the same transaction. */
export function scheduleRespawn(state: GameState, aircraft: Aircraft): boolean {
  if (aircraft.lifecycle !== 'active') return false;
  aircraft.health = 0; aircraft.lifecycle = 'respawnPending';
  aircraft.respawnDuePlayTick = state.playTicks + RESPAWN_TICKS; aircraft.respawnRef = aircraftRef(state, aircraft);
  aircraft.aiFire = false; return true;
}
/** Keep slot objects stable so renderer references and player convenience views remain valid. */
export function resetAircraft(state: GameState, aircraft: Aircraft, protectedRespawn = false): void {
  const replacement = makeAircraft(aircraft.id, aircraft.team, spawnPosition(aircraft.team, aircraft.slotId), spawnYaw(aircraft.team), aircraft.role, aircraft.slotId, aircraft.generation + 1);
  replacement.protectionUntilPlayTick = protectedRespawn ? state.playTicks + RESPAWN_PROTECTION_TICKS : 0;
  Object.assign(aircraft, replacement);
}
export function processRespawns(state: GameState): Aircraft[] {
  const spawned: Aircraft[] = [];
  for (const aircraft of state.slots) {
    if (aircraft.lifecycle !== 'respawnPending' || aircraft.respawnDuePlayTick === null || aircraft.respawnDuePlayTick > state.playTicks) continue;
    if (!aircraft.respawnRef || resolveAircraftRef(state, aircraft.respawnRef) !== aircraft) {
      aircraft.respawnDuePlayTick = null; aircraft.respawnRef = null; continue;
    }
    resetAircraft(state, aircraft, true); spawned.push(aircraft);
  }
  return spawned;
}
export function cancelRespawns(state: GameState): void {
  for (const aircraft of state.slots) { aircraft.respawnDuePlayTick = null; aircraft.respawnRef = null; }
}
