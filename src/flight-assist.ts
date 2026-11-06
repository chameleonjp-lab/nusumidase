// Flight assistance adapted from the pinned source listed in docs/PLAN.md.
import type { Aircraft, CombatTarget, FlightInput, GameMode } from './types';
import { Vector3 } from 'three';
import { projectFlightTarget } from './flight-view';

export const PLAYER_MAX_PITCH = 0.95;
export const EASY_AUTO_FIRE_RANGE = 1200;
/** Authoritative aim/marker point. Returns a copy so consumers cannot move entities. */
export function targetAimPoint(target: CombatTarget): Vector3 {
  const point = target.position.clone();
  return point;
}

export interface FlightAssistResult {
  turn: number;
  climb: number;
  responseMultiplier: number;
  hasVisibleTarget: boolean;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function normalizedAspect(aspect: number | undefined): number {
  return Number.isFinite(aspect) && (aspect ?? 0) > 0 ? aspect! : 393 / 852;
}

/** Targets affect the trigger only; both modes retain the same manual rates. */
export function getFlightAssist(_player: Aircraft, _enemies: readonly CombatTarget[], input: FlightInput, _mode: GameMode): FlightAssistResult {
  return { turn: clamp(input.turn,-1,1), climb: clamp(input.climb,-1,1), responseMultiplier: 1, hasVisibleTarget: false };
}

/** Re-checks the live world immediately before firing; it does not use render state. */
export function shouldAutoFire(
  player: Aircraft,
  enemies: readonly CombatTarget[],
  mode: GameMode,
  aspect: number | undefined,
): boolean {
  return autoFireTarget(player, enemies, mode, aspect) !== null;
}

export function autoFireTarget(player: Aircraft, enemies: readonly CombatTarget[], mode: GameMode, aspect: number | undefined): CombatTarget | null {
  if (mode !== 'easy') return null;
  const safeAspect = normalizedAspect(aspect);
  let best: CombatTarget | null = null;
  let bestRadius = Infinity;
  for (const enemy of enemies) {
    if (enemy.health <= 0 || enemy.team !== 'enemy' || enemy.lifecycle !== 'active') continue;
    const projection = projectFlightTarget(player, targetAimPoint(enemy), safeAspect, mode);
    const radius = Math.hypot(projection.x * Math.max(1, safeAspect), projection.y * Math.max(1, 1 / safeAspect));
    if (projection.visible && projection.inCircle && projection.distance <= EASY_AUTO_FIRE_RANGE && radius < bestRadius) {
      best = enemy;
      bestRadius = radius;
    }
  }
  return best;
}

/** Straight flight prediction; maneuvers after launch can still evade the shot. */
export function predictedShotDirection(origin: Vector3, forward: Vector3, target: CombatTarget, bulletSpeed: number, lifetime: number, aimPoint?: Vector3): Vector3 {
  const velocity = new Vector3(0, 0, -1).applyQuaternion(target.quaternion).multiplyScalar(target.speed);
  const relative = (aimPoint?.clone() ?? targetAimPoint(target)).sub(origin);
  const a = velocity.lengthSq() - bulletSpeed * bulletSpeed;
  const b = 2 * relative.dot(velocity);
  const c = relative.lengthSq();
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0 || Math.abs(a) < 1e-8) return forward.clone();
  const root = Math.sqrt(discriminant);
  const times = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(t => t > 0 && t <= lifetime);
  if (!times.length) return forward.clone();
  const direction = relative.addScaledVector(velocity, Math.min(...times)).normalize();
  // A small firing gate plus this limit prevents wide-angle automatic hits.
  return forward.angleTo(direction) <= 0.16 ? direction : forward.clone();
}
