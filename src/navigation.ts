import { Vector3 } from 'three';
import { BASE_POSITIONS, finitePosition } from './arena';
import { clamp, desiredFlightInput, forwardOf } from './flight';
import type { Aircraft } from './types';

/** Routes use a bounded, symmetric set of safe points; no position/velocity is changed. */
export const MAX_ROUTE_WAYPOINTS = 64;
export const SAFE_WAYPOINTS: readonly Vector3[] = Object.freeze([
  new Vector3(-1400, 300, 0), new Vector3(1400, 300, 0),
  new Vector3(-900, 450, -900), new Vector3(-900, 450, 900),
  new Vector3(900, 450, -900), new Vector3(900, 450, 900),
  new Vector3(0, 450, 0),
]);
export interface NavigationRoute { goal: Vector3; points: Vector3[]; index: number; }

export function legalWaypoint(point: Vector3): Vector3 {
  if (!finitePosition(point)) return new Vector3(0, 300, 0);
  return new Vector3(clamp(point.x, -2000, 2000), clamp(point.y, 150, 750), clamp(point.z, -1400, 1400));
}

/** At most four waypoints, including staging for turns and height differences. */
export function planRoute(start: Vector3, destination: Vector3, detour = 0, heading?: Vector3): NavigationRoute {
  const goal = legalWaypoint(destination), points: Vector3[] = [];
  if (detour > 0) {
    const candidates = SAFE_WAYPOINTS.slice(2).map((point, index) => ({ point, index,
      cost: start.distanceTo(point) + point.distanceTo(goal) }));
    candidates.sort((a, b) => a.cost - b.cost || a.index - b.index);
    const candidate = candidates[(detour - 1) % candidates.length];
    points.push(candidate.point.clone());
  }
  const horizontal = Math.hypot(goal.x - start.x, goal.z - start.z);
  if (heading && horizontal < 650 && horizontal > 45) {
    const toward = goal.clone().sub(start); toward.y = 0;
    const forward = heading.clone(); forward.y = 0;
    // A target inside the minimum turn circle needs a fresh approach. An
    // extension breaks a circular chase without altering the aircraft speed.
    if (forward.lengthSq() > 0.01 && forward.angleTo(toward) > 0.65) {
      forward.normalize();
      const extension = legalWaypoint(start.clone().addScaledVector(forward, 800));
      extension.y = clamp(start.y, 150, 750);
      if (extension.distanceTo(goal) > 650) points.push(extension);
      else {
        const towardCenter = new Vector3(-start.x, 0, -start.z);
        if (towardCenter.lengthSq() < 1) towardCenter.set(1, 0, 0);
        points.push(legalWaypoint(start.clone().addScaledVector(towardCenter.normalize(), 900)));
      }
    }
  }
  // A level staging leg provides room to reach a 600m height difference at
  // the inherited pitch limit, including an almost vertical nearby target.
  if (Math.abs(goal.y - start.y) > 220 && horizontal < Math.abs(goal.y - start.y) * 2.4) {
    const away = start.clone().sub(goal); away.y = 0;
    if (away.lengthSq() < 1) away.set(start.x <= 0 ? 1 : -1, 0, 0);
    away.normalize();
    const staging = legalWaypoint(goal.clone().addScaledVector(away, 1150));
    staging.y = goal.y;
    if (staging.distanceTo(goal) > 600) points.push(staging);
  }
  points.push(goal.clone());
  return { goal, points, index: 0 };
}

export function routeWaypoint(aircraft: Aircraft, route: NavigationRoute): Vector3 {
  while (route.index < route.points.length - 1 && aircraft.position.distanceTo(route.points[route.index]) < 100) route.index++;
  return route.points[route.index];
}

/** Radius-300 waiting / radius-450 defensive circles lie wholly inside the map. */
export function orbitWaypoint(aircraft: Aircraft, center: Vector3, radius = 300, direction = 1): Vector3 {
  const offset = aircraft.position.clone().sub(center); offset.y = 0;
  const phase = offset.lengthSq() < 1 ? (aircraft.slotId / 5) * Math.PI * 2 : Math.atan2(offset.z, offset.x);
  // Aim a short arc ahead instead of repeatedly targeting the centre.
  const next = phase + direction * 0.6;
  return legalWaypoint(new Vector3(center.x + Math.cos(next) * radius, center.y, center.z + Math.sin(next) * radius));
}

/** Existing turn/pitch response remains authoritative; boundary avoidance is input only. */
export function navigationInput(aircraft: Aircraft, target: Vector3): { turn: number; climb: number } {
  let waypoint = legalWaypoint(target);
  const heading = forwardOf(aircraft);
  let edgeDistance = Infinity;
  if (heading.x > 0.01) edgeDistance = Math.min(edgeDistance, (2400 - aircraft.position.x) / heading.x);
  if (heading.x < -0.01) edgeDistance = Math.min(edgeDistance, (-2400 - aircraft.position.x) / heading.x);
  if (heading.z > 0.01) edgeDistance = Math.min(edgeDistance, (1800 - aircraft.position.z) / heading.z);
  if (heading.z < -0.01) edgeDistance = Math.min(edgeDistance, (-1800 - aircraft.position.z) / heading.z);
  if (edgeDistance < 350) {
    waypoint = new Vector3(clamp(aircraft.position.x, -1300, 1300), clamp(aircraft.position.y, 200, 700), clamp(aircraft.position.z, -800, 800));
  }
  const controls = desiredFlightInput(aircraft, waypoint);
  if (aircraft.position.y < 110) controls.climb = Math.max(controls.climb, 0.75);
  if (aircraft.position.y > 800) controls.climb = Math.min(controls.climb, -0.75);
  return { turn: Number.isFinite(controls.turn) ? clamp(controls.turn, -1, 1) : 0,
    climb: Number.isFinite(controls.climb) ? clamp(controls.climb, -1, 1) : 0 };
}

export function baseWaitingWaypoint(aircraft: Aircraft): Vector3 {
  return orbitWaypoint(aircraft, BASE_POSITIONS[aircraft.team], 300);
}
