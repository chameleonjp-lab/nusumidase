import { Vector3 } from 'three';
import { aircraftOrder, BASE_POSITIONS, legalDropPosition, otherTeam, proximityTime } from './arena';
import { aircraftRef, isAlive, isProtected, resolveAircraftRef, sameRef } from './respawn';
import type { Aircraft, AircraftRef, Flag, FlagEvent, GameState, Team } from './types';

export interface FlagTransition { type: 'pickup' | 'drop' | 'return'; flagId: string; expectedRevision: number; position: Vector3; aircraft?: Aircraft; detail?: string; }
export interface CaptureCandidate { team: Team; carrier: Aircraft; flagId: string; expectedRevision: number; captureId: string; entryTime: number; }
export interface FlagStartSnapshot { flags: Record<Team, Flag>; }
export function createFlags(roundEpoch = 0, revisions: Record<Team, number> = { friendly: 0, enemy: 0 }): Record<Team, Flag> {
  return { friendly: { flagId: 'core-A', homeTeam: 'friendly', roundEpoch, revision: revisions.friendly, state: 'atHome' },
    enemy: { flagId: 'core-B', homeTeam: 'enemy', roundEpoch, revision: revisions.enemy, state: 'atHome' } };
}
export function flagStartSnapshot(state: GameState): FlagStartSnapshot { return { flags: { ...state.flags } }; }
export function getFlagPosition(state: GameState, flag: Flag | Team): Vector3 {
  const value = typeof flag === 'string' ? state.flags[flag] : flag;
  if (value.state === 'atHome') return BASE_POSITIONS[value.homeTeam].clone();
  if (value.state === 'dropped') return value.position.clone();
  return resolveAircraftRef(state, value.carrier)?.position.clone() ?? BASE_POSITIONS[value.homeTeam].clone();
}
export function carriedFlagFor(state: GameState, aircraft: Aircraft): Flag | null {
  const ref = aircraftRef(state, aircraft);
  return Object.values(state.flags).find(flag => flag.state === 'carried' && sameRef(flag.carrier, ref)) ?? null;
}
function base(flag: Flag): Pick<Flag, 'flagId' | 'homeTeam' | 'roundEpoch' | 'revision'> {
  return { flagId: flag.flagId, homeTeam: flag.homeTeam, roundEpoch: flag.roundEpoch, revision: flag.revision + 1 };
}
function eligible(state: GameState, aircraft: Aircraft): boolean { return isAlive(aircraft) && !isProtected(state, aircraft); }
function contacts(state: GameState, point: Vector3, team?: Team): Aircraft[] {
  return state.slots.filter(aircraft => (!team || aircraft.team === team) && eligible(state, aircraft) && proximityTime(aircraft, point) !== null)
    .sort((a, b) => proximityTime(a, point)! - proximityTime(b, point)! || a.position.distanceToSquared(point) - b.position.distanceToSquared(point) || aircraftOrder(a, b));
}
export function validateFlagEvent(state: GameState, event: FlagEvent): Flag | null {
  if (event.matchId !== state.matchId || event.roundEpoch !== state.roundEpoch || event.tick !== state.tick) return null;
  return Object.values(state.flags).find(flag => flag.flagId === event.flagId && flag.revision === event.expectedRevision) ?? null;
}
/** Damage/drop and subsequent contact resolution are called before any snapshot is exposed. */
export function dropCarrierFlags(state: GameState, aircraft: Aircraft): FlagTransition[] {
  const transitions: FlagTransition[] = [];
  for (const flag of Object.values(state.flags)) {
    if (flag.state !== 'carried' || !sameRef(flag.carrier, aircraftRef(state, aircraft))) continue;
    const point = legalDropPosition(aircraft.position);
    state.flags[flag.homeTeam] = point
      ? { ...base(flag), state: 'dropped', position: point, droppedAtPlayTick: state.playTicks }
      : { ...base(flag), state: 'atHome' };
    transitions.push({ type: point ? 'drop' : 'return', flagId: flag.flagId, expectedRevision: flag.revision, position: point ?? BASE_POSITIONS[flag.homeTeam].clone(), aircraft, detail: point ? undefined : 'invalid-drop' });
  }
  return transitions;
}
export function resolveFlagTransitions(state: GameState, start: FlagStartSnapshot): FlagTransition[] {
  const transitions: FlagTransition[] = [];
  for (const team of ['friendly', 'enemy'] as const) {
    const before = start.flags[team], flag = state.flags[team];
    // Already changed by a carrier death: a new drop must wait until the next tick.
    if (before.revision !== flag.revision || flag.roundEpoch !== state.roundEpoch) continue;
    if (flag.state === 'carried') continue;
    const point = getFlagPosition(state, flag);
    // The owning team cannot reset a dropped core by touching it.
    // Only its opponents can acquire it here and carry it to their base.
    const carrier = contacts(state, point, otherTeam(team)).find(aircraft => !carriedFlagFor(state, aircraft));
    if (carrier) {
      state.flags[team] = { ...base(flag), state: 'carried', carrier: aircraftRef(state, carrier) };
      transitions.push({ type: 'pickup', flagId: flag.flagId, expectedRevision: flag.revision, position: point, aircraft: carrier });
    }
  }
  return transitions;
}
export function captureCandidates(state: GameState, start: FlagStartSnapshot): CaptureCandidate[] {
  if (state.phase !== 'playing' || state.roundScored) return [];
  const candidates: CaptureCandidate[] = [];
  for (const team of ['friendly', 'enemy'] as const) {
    const before = start.flags[otherTeam(team)], flag = state.flags[otherTeam(team)];
    if (before.state !== 'carried' || flag.state !== 'carried' || !sameRef(before.carrier, flag.carrier)) continue;
    const carrier = resolveAircraftRef(state, flag.carrier);
    if (!carrier || carrier.team !== team || !eligible(state, carrier)) continue;
    const entryTime = proximityTime(carrier, BASE_POSITIONS[team]);
    if (entryTime === null) continue;
    candidates.push({ team, carrier, flagId: flag.flagId, expectedRevision: flag.revision,
      captureId: `${state.matchId}/${state.roundEpoch}/${state.tick}/capture/${team}/${carrier.slotId}/${carrier.generation}`, entryTime });
  }
  return candidates;
}
export function flagInvariantError(state: GameState): string | null {
  const flags = Object.values(state.flags); if (flags.length !== 2 || new Set(flags.map(flag => flag.flagId)).size !== 2) return 'Two unique flags required';
  const carriers: AircraftRef[] = [];
  for (const [team, flag] of Object.entries(state.flags)) {
    if (flag.homeTeam !== team || flag.flagId !== (team === 'friendly' ? 'core-A' : 'core-B')) return 'Flag home-team identity mismatch';
    if (flag.roundEpoch !== state.roundEpoch || !Number.isInteger(flag.revision) || flag.revision < 0) return 'Invalid flag epoch/revision';
    if (flag.state === 'carried') {
      const aircraft = resolveAircraftRef(state, flag.carrier);
      if (!aircraft || !isAlive(aircraft) || aircraft.team === flag.homeTeam) return 'Invalid flag carrier';
      if (carriers.some(ref => sameRef(ref, flag.carrier))) return 'Aircraft carries multiple flags';
      carriers.push(flag.carrier);
    } else if (flag.state === 'dropped') {
      const point = legalDropPosition(flag.position);
      if (!point || !Number.isInteger(flag.droppedAtPlayTick) || flag.droppedAtPlayTick < 0) return 'Invalid dropped flag';
    } else if (flag.state !== 'atHome') return 'Unknown flag state';
  }
  return null;
}
/** A fresh round invalidates both revisions atomically. */
export function resetFlags(state: GameState): void {
  state.flags = createFlags(state.roundEpoch, { friendly: state.flags.friendly.revision + 1, enemy: state.flags.enemy.revision + 1 });
}
