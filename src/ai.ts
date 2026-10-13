import { Vector3 } from 'three';
import { BASE_POSITIONS, otherTeam } from './arena';
import { clamp, forwardOf } from './flight';
import { predictedShotDirection } from './flight-assist';
import { AI_DECISION_TICKS } from './mission';
import { legalWaypoint, navigationInput, orbitWaypoint, planRoute, routeWaypoint } from './navigation';
import type { NavigationRoute } from './navigation';
import type { Aircraft, AIRole, Flag, FlightInput, GameState, Team } from './types';

export const ROLE_HOLD_TICKS = 120;
export const STUCK_TICKS = 600;
export const VISIBLE_RANGE = 1500;
interface PlanePlan { generation: number; mission: string; route: NavigationRoute; progressStart: number; progressDistance: number; bestDistance: number; reroutes: number; }
interface TeamPlan { signature: string; }
interface PlanningState { epoch: number; planes: Map<number, PlanePlan>; teams: Record<Team, TeamPlan>; }
const plans = new WeakMap<GameState, PlanningState>();
const alive = (plane: Aircraft): boolean => plane.lifecycle === 'active' && plane.health > 0;
const aiPlanes = (state: GameState, team: Team): Aircraft[] => state.slots.filter(plane => plane.team === team && plane !== state.player && alive(plane));

function memoryFor(state: GameState): PlanningState {
  let memory = plans.get(state);
  if (!memory || memory.epoch !== state.roundEpoch) {
    memory = { epoch: state.roundEpoch, planes: new Map(), teams: { friendly: { signature: '' }, enemy: { signature: '' } } };
    plans.set(state, memory);
  }
  return memory;
}

function carrierFor(state: GameState, flag: Flag): Aircraft | null {
  if (flag.state !== 'carried') return null;
  const ref = flag.carrier;
  return state.slots.find(plane => alive(plane) && plane.team === ref.team && plane.slotId === ref.slotId
    && plane.generation === ref.generation && ref.matchId === state.matchId && ref.roundEpoch === state.roundEpoch) ?? null;
}

function flagPosition(state: GameState, flag: Flag): Vector3 {
  return flag.state === 'dropped' ? flag.position.clone()
    : flag.state === 'carried' ? carrierFor(state, flag)?.position.clone() ?? BASE_POSITIONS[flag.homeTeam].clone()
      : BASE_POSITIONS[flag.homeTeam].clone();
}

/** Ordinary enemies are read only while visible; flags/carriers are public mission data. */
export function targetFor(state: GameState, id: number | null, observer: Aircraft = state.player): Aircraft | null {
  if (id === null) return null;
  const enemy = state.slots.find(plane => plane.id === id && plane.team !== observer.team && alive(plane));
  return enemy && enemy.position.distanceTo(observer.position) <= VISIBLE_RANGE ? enemy : null;
}

function arrivalTime(plane: Aircraft, point: Vector3): number {
  const offset = point.clone().sub(plane.position);
  const angle = offset.lengthSq() > 1 ? forwardOf(plane).angleTo(offset) : 0;
  return offset.length() / Math.max(65, plane.speed) + angle / 0.64;
}

function setRole(plane: Aircraft, role: AIRole, tick: number): void {
  if (plane.aiRole !== role) { plane.aiRole = role; plane.aiRoleSinceTick = tick; }
}

function assignRoles(state: GameState, team: Team, memory: PlanningState): void {
  const available = aiPlanes(state, team).sort((a, b) => a.slotId - b.slotId);
  const ownFlag = state.flags[team], stolenFlag = state.flags[otherTeam(team)];
  const carrier = carrierFor(state, stolenFlag);
  const signature = `${ownFlag.state}:${ownFlag.revision}:${carrier?.id ?? '-'}:${carrier?.generation ?? '-'}:`
    + available.map(plane => `${plane.slotId}.${plane.generation}`).join(',');
  const critical = signature !== memory.teams[team].signature;
  memory.teams[team].signature = signature;
  if (carrier && carrier !== state.player) setRole(carrier, 'return', state.playTicks);
  const candidates = available.filter(plane => plane !== carrier);
  const roles: AIRole[] = [];
  if (ownFlag.state !== 'atHome') roles.push(...Array<AIRole>(Math.min(2, candidates.length)).fill('recover'));
  if (carrier && candidates.length > roles.length) roles.push('escort');
  const attackers = Math.min(2, candidates.length - roles.length);
  roles.push(...Array<AIRole>(attackers).fill('attacker'));
  const defenders = Math.min(2, candidates.length - roles.length);
  roles.push(...Array<AIRole>(defenders).fill('defender'));
  while (roles.length < candidates.length) roles.push('recover');
  const assignments = new Map<Aircraft, AIRole>();
  if (!critical) {
    for (const plane of candidates) {
      if (state.playTicks - plane.aiRoleSinceTick >= ROLE_HOLD_TICKS) continue;
      const index = roles.indexOf(plane.aiRole);
      if (index >= 0) { assignments.set(plane, plane.aiRole); roles.splice(index, 1); }
    }
  }
  for (const role of roles) {
    const destination = role === 'recover' ? flagPosition(state, ownFlag)
      : role === 'escort' && carrier ? carrier.position
        : role === 'attacker' ? flagPosition(state, stolenFlag) : BASE_POSITIONS[team];
    const remaining = candidates.filter(plane => !assignments.has(plane));
    remaining.sort((a, b) => arrivalTime(a, destination) - arrivalTime(b, destination) || a.slotId - b.slotId);
    if (remaining[0]) assignments.set(remaining[0], role);
  }
  for (const [plane, role] of assignments) setRole(plane, role, state.playTicks);
}

function visibleEnemies(state: GameState, plane: Aircraft): Aircraft[] {
  return state.slots.filter(enemy => enemy.team !== plane.team && alive(enemy)
    && enemy.position.distanceTo(plane.position) <= VISIBLE_RANGE);
}

function missionTarget(state: GameState, plane: Aircraft): { point: Vector3; key: string; moving: boolean } {
  const home = BASE_POSITIONS[plane.team], ownFlag = state.flags[plane.team], enemyFlag = state.flags[otherTeam(plane.team)];
  const carrier = carrierFor(state, enemyFlag);
  if (carrier === plane) {
    return { point: home.clone(), key: 'return', moving: false };
  }
  if (plane.aiRole === 'recover' && ownFlag.state !== 'atHome') {
    if (ownFlag.state === 'dropped') {
      return { point: orbitWaypoint(plane, ownFlag.position, 140, plane.slotId % 2 ? 1 : -1),
        key: `guard:${ownFlag.revision}`, moving: true };
    }
    const thief = carrierFor(state, ownFlag), point = flagPosition(state, ownFlag);
    if (thief) point.addScaledVector(forwardOf(thief), thief.speed * Math.min(1.5, plane.position.distanceTo(point) / 550));
    return { point: legalWaypoint(point), key: `recover:${ownFlag.revision}`, moving: Boolean(thief) };
  }
  if (plane.aiRole === 'escort' && carrier) {
    const forward = forwardOf(carrier); forward.y = 0; forward.normalize();
    const side = new Vector3(-forward.z, 0, forward.x);
    const point = carrier.position.clone().addScaledVector(forward, -140).addScaledVector(side, plane.slotId % 2 ? 100 : -100);
    return { point: legalWaypoint(point), key: `escort:${carrier.id}.${carrier.generation}`, moving: true };
  }
  if (plane.aiRole === 'attacker' && enemyFlag.state !== 'carried') {
    return { point: flagPosition(state, enemyFlag), key: `attack:${enemyFlag.revision}`, moving: false };
  }
  if (plane.aiRole === 'defender') {
    const intruders = visibleEnemies(state, plane).filter(enemy => enemy.position.distanceTo(home) < 900);
    intruders.sort((a, b) => a.position.distanceTo(home) - b.position.distanceTo(home) || a.slotId - b.slotId);
    if (intruders[0]) {
      const enemy = intruders[0];
      return { point: legalWaypoint(enemy.position.clone().addScaledVector(forwardOf(enemy), enemy.speed * 0.5)), key: `intercept:${enemy.id}`, moving: true };
    }
  }
  const patrolBase = plane.aiRole === 'attacker' ? BASE_POSITIONS[otherTeam(plane.team)] : home;
  return { point: orbitWaypoint(plane, patrolBase, 450, plane.slotId % 2 ? 1 : -1), key: `patrol:${plane.aiRole}`, moving: true };
}

function followMission(state: GameState, plane: Aircraft, memory: PlanningState): void {
  const mission = missionTarget(state, plane);
  let plan = memory.planes.get(plane.id);
  if (!plan || plan.generation !== plane.generation || plan.mission !== mission.key) {
    plan = { generation: plane.generation, mission: mission.key, route: planRoute(plane.position, mission.point, 0, mission.moving ? undefined : forwardOf(plane)),
      progressStart: state.playTicks, progressDistance: plane.position.distanceTo(mission.point),
      bestDistance: plane.position.distanceTo(mission.point), reroutes: 0 };
    memory.planes.set(plane.id, plan);
    if (mission.key.startsWith('attack:') && state.flags[otherTeam(plane.team)].state === 'atHome'
      && plane.position.distanceTo(mission.point) > 1000) {
      // Separate attacking lanes leave room for escorts and a descending
      // approach to the core, rather than funneling every aircraft head-on.
      const side = (plane.slotId % 2 ? 1 : -1) * (plane.team === 'friendly' ? 1 : -1);
      const inward = plane.team === 'friendly' ? -1 : 1;
      const lane = Math.imul(state.seed ^ plane.slotId, 0x45d9f3b) >>> 0;
      const height = 140 + (lane % 5) * 40, separation = 450 + ((lane >>> 8) % 4) * 70;
      plan.route.points.unshift(legalWaypoint(mission.point.clone().add(new Vector3(inward * 650, height, side * separation))));
    }
    if (mission.key === 'return' && plane.position.distanceTo(mission.point) > 1500) {
      // The carrier climbs along an ordinary exit leg before turning home.
      // It remains targetable and has the same airframe and speed as escorts.
      const side = plane.slotId % 2 ? 1 : -1;
      const exit = legalWaypoint(plane.position.clone().addScaledVector(forwardOf(plane), 650).add(new Vector3(0, 350, side * 650)));
      const crossing = new Vector3(0, 650, side * 1000);
      plan.route.points.unshift(exit, crossing);
    }
  }
  if (mission.moving) {
    plan.route.goal.copy(mission.point);
    plan.route.points[plan.route.points.length - 1].copy(mission.point);
  }
  const distance = plane.position.distanceTo(plan.route.goal);
  plan.bestDistance = Math.min(plan.bestDistance, distance);
  const trackProgress = mission.key !== 'wait' && !mission.key.startsWith('patrol:') && !mission.key.startsWith('escort:');
  if (trackProgress && state.playTicks - plan.progressStart >= STUCK_TICKS) {
    if (plan.progressDistance - plan.bestDistance < 20) {
      plan.reroutes = Math.min(2, plan.reroutes + 1);
      plan.route = planRoute(plane.position, mission.point, plan.reroutes, forwardOf(plane));
      // The second failed leg uses another known safe route. The objective,
      // flag state and flight equations are preserved.
    }
    plan.progressStart = state.playTicks; plan.progressDistance = distance; plan.bestDistance = distance;
  }
  plane.aiProgressTick = plan.progressStart; plane.aiBestDistance = plan.bestDistance; plane.aiRouteStage = plan.reroutes;
  plane.aiWaypoint.copy(routeWaypoint(plane, plan.route));
  const input = navigationInput(plane, plane.aiWaypoint);
  plane.aiTurn = input.turn; plane.aiClimb = input.climb;
}

/** A friendly in the firing corridor suppresses the shot without steering off the route. */
export function hasSafeShot(state: GameState, plane: Aircraft, enemy: Aircraft): boolean {
  if (!alive(plane) || !alive(enemy) || enemy.team === plane.team || state.playTicks < plane.protectionUntilPlayTick
    || state.playTicks < enemy.protectionUntilPlayTick) return false;
  const offset = enemy.position.clone().sub(plane.position), distance = offset.length();
  const forward = forwardOf(plane);
  if (distance < 40 || distance > 740 || forward.angleTo(offset) > 0.085) return false;
  const directions = [forward, ...[820, 700].map(speed => predictedShotDirection(plane.position, forward, enemy, plane.speed + speed, 1.5))];
  return !state.slots.some(ally => {
    if (ally === plane || ally.team !== plane.team || !alive(ally)) return false;
    return directions.some(direction => {
      const displacement = ally.position.clone().sub(plane.position), along = displacement.dot(direction);
      // Muzzle offsets and the symmetric AI spread are covered by this margin.
      return along > 0 && along < distance + 20 && displacement.addScaledVector(direction, -along).lengthSq() < 18 * 18;
    });
  });
}

export function flightInputForAI(plane: Aircraft): FlightInput {
  return { turn: Number.isFinite(plane.aiTurn) ? clamp(plane.aiTurn, -1, 1) : 0,
    climb: Number.isFinite(plane.aiClimb) ? clamp(plane.aiClimb, -1, 1) : 0, fire: Boolean(plane.aiFire), loop: false, throttle: 0 };
}

/** Both teams share one deterministic planner. Human slot zero is never controlled. */
export function updateAI(state: GameState): void {
  if (state.phase !== 'playing') return;
  const memory = memoryFor(state);
  if (state.playTicks % AI_DECISION_TICKS === 0 || memory.teams.friendly.signature === '') {
    for (const team of ['friendly', 'enemy'] as const) assignRoles(state, team, memory);
    for (const plane of state.slots) if (plane !== state.player && alive(plane)) followMission(state, plane, memory);
  }
  // Firing gates use this tick's positions, not a six-tick-old decision.
  for (const plane of state.slots) {
    if (plane === state.player) continue;
    if (!alive(plane)) { plane.aiTurn = 0; plane.aiClimb = 0; plane.aiFire = false; plane.targetId = null; continue; }
    const targets = visibleEnemies(state, plane).filter(enemy => hasSafeShot(state, plane, enemy));
    targets.sort((a, b) => a.position.distanceToSquared(plane.position) - b.position.distanceToSquared(plane.position) || a.slotId - b.slotId);
    plane.targetId = targets[0]?.id ?? null; plane.aiFire = targets.length > 0;
  }
}
