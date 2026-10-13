import { Quaternion, Vector3 } from 'three';
import { createFlightController, CRUISE_SPEED, updateQuaternion } from './flight';
import { spawnPosition, spawnYaw } from './arena';
import type { Aircraft, GameMode, MissionConfig, Team } from './types';
export { createFlightController };
export const RULES_VERSION = 'nusumidase-ctf-v3';
export const FIXED_DT = 1 / 60;
export const MATCH_PLAY_TICKS = 12 * 60 * 60;
export const RESPAWN_TICKS = 480;
export const RESPAWN_PROTECTION_TICKS = 120;
export const CAPTURES_TO_WIN = 1;
export const AIRCRAFT_HEALTH = 80;
export const PLAYER_MG_CAPACITY = 288;
export const PLAYER_CANNON_CAPACITY = 96;
export const PLAYER_RELOAD_TICKS = 360;
export const AIRCRAFT_BULLET_LIFETIME = 1.5;
export const AI_DECISION_TICKS = 6;
export const MAX_BULLETS = 1024;
export const MAX_EVENTS_PER_STEP = 128;
export const MAX_RENDER_EVENTS = 512;
export const LOW_ALTITUDE_WARNING = 65;
export const MAX_STEPS_PER_FRAME = 5;
export const MAX_ACCUMULATOR = 0.25;
export const DEFAULT_MISSION_CONFIG = Object.freeze({ mode: 'easy' as GameMode });
export function resolveMissionConfig(config: Partial<MissionConfig> | GameMode = {}): Readonly<MissionConfig> {
  const mode = typeof config === 'string' ? config : config.mode ?? 'easy';
  if (mode !== 'normal' && mode !== 'easy') throw new RangeError('Unknown flight control mode');
  return Object.freeze({ mode });
}
export function makeAircraft(id: number, team: Team, position = spawnPosition(team, id % 5), yaw = spawnYaw(team), role: Aircraft['role'] = 'interceptor', slotId = id % 5, generation = 1): Aircraft {
  const aircraft: Aircraft = {
    kind: 'aircraft', id, team, slotId, generation, role, lifecycle: 'active', position, previous: position.clone(), quaternion: new Quaternion(),
    yaw, pitch: 0, bank: 0, speed: CRUISE_SPEED, health: AIRCRAFT_HEALTH, maxHealth: AIRCRAFT_HEALTH,
    mg: PLAYER_MG_CAPACITY, cannon: PLAYER_CANNON_CAPACITY, reloadTicksRemaining: 0, fireClock: 0, cannonClock: 0,
    respawnDuePlayTick: null, respawnRef: null, protectionUntilPlayTick: 0, loopProgress: 0, loopCooldown: 0,
    mode: 'pursue', age: 0, targetId: null, aiPhase: 'approach', aiPhaseTime: 0, aiWaypoint: position.clone(),
    aiTurn: 0, aiClimb: 0, aiFire: false, aiRole: slotId < 2 ? 'attacker' : 'defender', aiRoleSinceTick: -120,
    aiProgressTick: 0, aiBestDistance: Infinity, aiRouteStage: 0,
  };
  updateQuaternion(aircraft); return aircraft;
}
export function makeSlots(): Aircraft[] {
  return (['friendly', 'enemy'] as const).flatMap(team => Array.from({ length: 5 }, (_, slotId) =>
    makeAircraft((team === 'friendly' ? 1 : 6) + slotId, team, spawnPosition(team, slotId), spawnYaw(team), team === 'friendly' && slotId === 0 ? 'player' : 'interceptor', slotId)));
}
