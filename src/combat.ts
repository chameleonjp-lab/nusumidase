// Aircraft hit volumes, muzzle offsets and ballistics retain the pinned Kaisen source.
import { Vector3 } from 'three';
import { hasSafeShot } from './ai';
import { aircraftOrder, isLegalPosition, segmentSphereEntry, slotKey } from './arena';
import { applyEasyShotCorrection, autoFireTarget, predictedShotDirection } from './flight-assist';
import { forwardOf } from './flight';
import { aircraftDamageMultiplier } from './aircraft-damage';
import { AIRCRAFT_BULLET_LIFETIME, FIXED_DT, MAX_BULLETS, PLAYER_CANNON_CAPACITY, PLAYER_MG_CAPACITY, PLAYER_RELOAD_TICKS } from './mission';
import { aircraftRef, isAlive, isProtected } from './respawn';
import type { Aircraft, AircraftRef, Bullet, GameEvent, GameState } from './types';

const HIT_SPHERES = [
  { center: new Vector3(0, 0, -3.8), radius: 3 }, { center: new Vector3(0, 0, 0), radius: 4.6 },
  { center: new Vector3(0, 0, 3.4), radius: 2.7 }, { center: new Vector3(4, 0, 0.25), radius: 2.1 }, { center: new Vector3(-4, 0, 0.25), radius: 2.1 },
];
export type EmitEvent = (type: GameEvent['type'], aircraft: Aircraft | null, options?: Partial<GameEvent>) => void;
export interface DamageCandidate { target: Aircraft; owner?: AircraftRef; amount: number; cause: 'bullet' | 'collision' | 'boundary' | 'sea'; order: number; }
export function sweptAircraftHitTime(bullet: Pick<Bullet, 'previous' | 'position'>, aircraft: Aircraft, stepFraction = 1): number | null {
  const endCenter = aircraft.previous.clone().lerp(aircraft.position, stepFraction);
  if (segmentSphereEntry(bullet.previous.clone().sub(aircraft.previous), bullet.position.clone().sub(endCenter), 8) === null) return null;
  let first: number | null = null;
  for (const sphere of HIT_SPHERES) {
    const offset = sphere.center.clone().applyQuaternion(aircraft.quaternion);
    const time = segmentSphereEntry(bullet.previous.clone().sub(aircraft.previous).sub(offset), bullet.position.clone().sub(endCenter).sub(offset), sphere.radius);
    if (time !== null && (first === null || time < first)) first = time;
  }
  return first;
}
export function aircraftContactTime(a: Aircraft, b: Aircraft): number | null {
  if (segmentSphereEntry(a.previous.clone().sub(b.previous), a.position.clone().sub(b.position), 16) === null) return null;
  let first: number | null = null;
  for (const sphereA of HIT_SPHERES) for (const sphereB of HIT_SPHERES) {
    const offset = sphereA.center.clone().applyQuaternion(a.quaternion).sub(sphereB.center.clone().applyQuaternion(b.quaternion));
    const time = segmentSphereEntry(a.previous.clone().sub(b.previous).add(offset), a.position.clone().sub(b.position).add(offset), sphereA.radius + sphereB.radius);
    if (time !== null && (first === null || time < first)) first = time;
  }
  return first;
}
export function advanceAmmunition(state: GameState, plane: Aircraft, emit: EmitEvent): void {
  if (!isAlive(plane)) return;
  plane.fireClock = Math.max(0, plane.fireClock - FIXED_DT); plane.cannonClock = Math.max(0, plane.cannonClock - FIXED_DT);
  if (plane.reloadTicksRemaining > 0 && --plane.reloadTicksRemaining === 0) {
    plane.mg = PLAYER_MG_CAPACITY; plane.cannon = PLAYER_CANNON_CAPACITY; emit('reload-complete', plane);
  }
  if (plane.reloadTicksRemaining === 0 && plane.mg === 0 && plane.cannon === 0) {
    plane.reloadTicksRemaining = PLAYER_RELOAD_TICKS; emit('reload-start', plane);
  }
}
export function fireAircraft(state: GameState, plane: Aircraft, firing: boolean, nextBulletId: () => number, emit: EmitEvent): void {
  if (!firing || !isAlive(plane) || isProtected(state, plane) || plane.reloadTicksRemaining > 0) return;
  const player = plane === state.player;
  const target = player ? autoFireTarget(plane, state.enemies.filter(p => isAlive(p) && !isProtected(state, p)), state.mode, undefined)
    : state.slots.find(candidate => candidate.id === plane.targetId && isAlive(candidate) && !isProtected(state, candidate) && candidate.team !== plane.team) ?? null;
  if (!player && (!target || !hasSafeShot(state, plane, target))) return;
  for (const kind of ['mg', 'cannon'] as const) {
    const clock = kind === 'mg' ? 'fireClock' : 'cannonClock';
    if (plane[clock] > 1e-8 || plane[kind] < 2 || state.bullets.length + 2 > MAX_BULLETS) continue;
    // The reservation is a pair: capacity failure never consumes ammo or starts cadence.
    const generations = Object.fromEntries(state.slots.filter(candidate => candidate.team !== plane.team).map(candidate => [slotKey(candidate.team, candidate.slotId), candidate.generation]));
    for (const side of [-1, 1]) {
      const forward = forwardOf(plane), offset = kind === 'mg' ? new Vector3(side * 0.3, 0.52, -4.25) : new Vector3(side * 2.5, 0, -2.4);
      const position = plane.position.clone().add(offset.applyQuaternion(plane.quaternion)), speed = plane.speed + (kind === 'mg' ? 820 : 700);
      const prediction = target ? predictedShotDirection(position, forward, target, speed, AIRCRAFT_BULLET_LIFETIME) : forward;
      const direction = player && state.mode === 'easy' ? applyEasyShotCorrection(forward, prediction) : prediction;
      if (!player) {
        direction.x += Math.sin(state.tick * 1.7 + plane.id * 3 + side + state.seed) * 0.012;
        direction.y += Math.cos(state.tick * 1.3 + plane.id * 2 + side + state.seed) * 0.012; direction.normalize();
      }
      state.bullets.push({ id: nextBulletId(), matchId: state.matchId, roundEpoch: state.roundEpoch, owner: plane.id,
        ownerRef: aircraftRef(state, plane), team: plane.team, position, previous: position.clone(), kind,
        velocity: direction.multiplyScalar(speed), life: AIRCRAFT_BULLET_LIFETIME, damage: player ? kind === 'mg' ? 4 : 20 : kind === 'mg' ? 2.4 : 9.6,
        distanceTravelled: 0, targetGenerations: generations });
      if (player) state.stats.shots = Math.min(1_000_000, state.stats.shots + 1);
      emit('shot', plane, { position, weapon: kind });
    }
    plane[kind] -= 2; plane[clock] = player ? kind === 'mg' ? 1 / 12 : 1 / 4 : kind === 'mg' ? 0.28 : 0.95;
  }
  if (plane.mg === 0 && plane.cannon === 0 && plane.reloadTicksRemaining === 0) {
    plane.reloadTicksRemaining = PLAYER_RELOAD_TICKS; emit('reload-start', plane);
  }
}
export function collectBulletDamage(state: GameState, emit: EmitEvent): DamageCandidate[] {
  const damage: DamageCandidate[] = [], survivors: Bullet[] = [];
  const candidates = state.slots.filter(plane => isAlive(plane) && !isProtected(state, plane)).sort(aircraftOrder);
  // Ten targets bound broad-phase work. The inexpensive broad sphere rejects detailed volumes.
  for (const bullet of [...state.bullets].sort((a, b) => a.id - b.id)) {
    if (bullet.matchId !== state.matchId || bullet.roundEpoch !== state.roundEpoch || bullet.life <= 0) continue;
    bullet.previous.copy(bullet.position); const travel = Math.min(FIXED_DT, bullet.life);
    bullet.position.addScaledVector(bullet.velocity, travel); bullet.life = Math.max(0, bullet.life - FIXED_DT);
    const seaTime = bullet.previous.y <= 0 ? 0 : bullet.position.y <= 0 ? bullet.previous.y / (bullet.previous.y - bullet.position.y) : Infinity;
    let first = seaTime, target: Aircraft | null = null;
    for (const candidate of candidates) {
      if (candidate.team === bullet.team || bullet.targetGenerations[slotKey(candidate.team, candidate.slotId)] !== candidate.generation) continue;
      const hit = sweptAircraftHitTime(bullet, candidate, travel / FIXED_DT);
      if (hit !== null && hit < first) { first = hit; target = candidate; }
    }
    const stepDistance = bullet.previous.distanceTo(bullet.position);
    if (first !== Infinity) {
      const point = bullet.previous.clone().lerp(bullet.position, first);
      if (target) {
        const amount = bullet.damage * aircraftDamageMultiplier(bullet.kind, bullet.distanceTravelled + stepDistance * first);
        damage.push({ target, owner: bullet.ownerRef, amount, cause: 'bullet', order: bullet.id });
        emit('hit', target, { position: point, owner: bullet.owner, ownerRef: bullet.ownerRef, weapon: bullet.kind, amount });
        if (bullet.owner === state.player.id) state.stats.hits = Math.min(1_000_000, state.stats.hits + 1);
      } else emit('splash', null, { position: point, owner: bullet.owner });
    } else if (bullet.life > 0) { bullet.distanceTravelled += stepDistance; survivors.push(bullet); }
  }
  state.bullets = survivors; return damage;
}
export function collectContactDamage(state: GameState): DamageCandidate[] {
  const damage: DamageCandidate[] = [], planes = state.slots.filter(isAlive).sort(aircraftOrder);
  for (const plane of planes) if (!isLegalPosition(plane.position) || !isLegalPosition(plane.previous)) damage.push({ target: plane, amount: plane.maxHealth, cause: plane.position.y <= 0 ? 'sea' : 'boundary', order: -2 });
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
    const a = planes[i], b = planes[j];
    if (a.team === b.team || isProtected(state, a) || isProtected(state, b) || aircraftContactTime(a, b) === null) continue;
    damage.push({ target: a, owner: aircraftRef(state, b), amount: a.maxHealth, cause: 'collision', order: -1 },
      { target: b, owner: aircraftRef(state, a), amount: b.maxHealth, cause: 'collision', order: -1 });
  }
  return damage;
}
