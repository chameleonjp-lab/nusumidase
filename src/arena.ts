import { Vector3 } from 'three';
import type { Aircraft, Team } from './types';

export const BASE_POSITIONS: Readonly<Record<Team, Vector3>> = Object.freeze({
  friendly: Object.freeze(new Vector3(-1400, 300, 0)) as Vector3,
  enemy: Object.freeze(new Vector3(1400, 300, 0)) as Vector3,
});
export const BASE_RADIUS = 45;
export const ARENA_BOUNDS = Object.freeze({ minX: -2400, maxX: 2400, minZ: -1800, maxZ: 1800, minY: 20, maxY: 900 });
export const otherTeam = (team: Team): Team => team === 'friendly' ? 'enemy' : 'friendly';
export const slotKey = (team: Team, slotId: number): string => `${team}:${slotId}`;
export const aircraftOrder = (a: Aircraft, b: Aircraft): number => (a.team === b.team ? 0 : a.team === 'friendly' ? -1 : 1) || a.slotId - b.slotId;
export function finitePosition(point: Vector3): boolean { return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z); }
export function isLegalPosition(point: Vector3): boolean {
  return finitePosition(point) && point.x >= ARENA_BOUNDS.minX && point.x <= ARENA_BOUNDS.maxX
    && point.z >= ARENA_BOUNDS.minZ && point.z <= ARENA_BOUNDS.maxZ && point.y > ARENA_BOUNDS.minY && point.y < ARENA_BOUNDS.maxY;
}
export function boundaryWarning(point: Vector3): boolean {
  return !finitePosition(point) || Math.abs(point.x) >= 2200 || Math.abs(point.z) >= 1600 || point.y <= 70 || point.y >= 850;
}
/** Preserve the actual death position. A dropped core never moves to a safer point. */
export function legalDropPosition(point: Vector3): Vector3 | null {
  if (!finitePosition(point)) return null;
  return point.clone();
}
export function spawnPosition(team: Team, slotId: number): Vector3 { return new Vector3(team === 'friendly' ? -1750 : 1750, 300, (slotId - 2) * 100); }
export function spawnYaw(team: Team): number { return team === 'friendly' ? -Math.PI / 2 : Math.PI / 2; }
/** Inclusive swept sphere entry, including an endpoint exactly on its boundary. */
export function segmentSphereEntry(start: Vector3, end: Vector3, radius: number): number | null {
  if (!finitePosition(start) || !finitePosition(end) || !Number.isFinite(radius) || radius < 0) return null;
  const delta = end.clone().sub(start), a = delta.lengthSq(), c = start.lengthSq() - radius * radius;
  if (c <= 0) return 0;
  if (a < 1e-12) return null;
  const b = 2 * start.dot(delta), discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const entry = (-b - Math.sqrt(discriminant)) / (2 * a);
  return entry >= 0 && entry <= 1 ? entry : null;
}
export function proximityTime(aircraft: Aircraft, point: Vector3, radius = BASE_RADIUS): number | null {
  return segmentSphereEntry(aircraft.previous.clone().sub(point), aircraft.position.clone().sub(point), radius);
}
