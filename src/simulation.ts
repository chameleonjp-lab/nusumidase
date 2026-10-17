import { Vector3 } from 'three';
import { updateAI } from './ai';
import { aircraftOrder, finitePosition } from './arena';
import { advanceAmmunition, collectBulletDamage, collectContactDamage, fireAircraft, type DamageCandidate } from './combat';
import { autoFireTarget, getFlightAssist } from './flight-assist';
import { advanceThrottle, createFlightController, MAX_SPEED, updateAircraftMotion, updatePlayerLoop, type FlightController } from './flight';
import { captureCandidates, createFlags, dropCarrierFlags, flagInvariantError, flagStartSnapshot, resolveFlagTransitions, type CaptureCandidate, type FlagStartSnapshot, type FlagTransition } from './flags';
import { CAPTURES_TO_WIN, FIXED_DT, makeSlots, MATCH_PLAY_TICKS, MAX_ACCUMULATOR, MAX_EVENTS_PER_STEP, MAX_STEPS_PER_FRAME, resolveMissionConfig, RULES_VERSION } from './mission';
import { aircraftRef, cancelRespawns, isAlive, isProtected, processRespawns, resolveAircraftRef, sameRef, scheduleRespawn } from './respawn';
import type { Aircraft, DamageEvent, FlightInput, GameEvent, GameMode, GameState, MissionConfig, MissionStats, Team } from './types';
export { FIXED_DT } from './mission';

interface SimulationMeta {
  accumulator: number; flight: FlightController; loopHeld: boolean; pendingLoop: boolean; inputBlocked: boolean;
  nextBulletId: number; eventSeq: number; pendingEvents: GameEvent[]; queuedDamage: DamageEvent[]; processedEvents: Map<string, number>; overflow: boolean;
  flagStart?: FlagStartSnapshot;
}
const metadata = new WeakMap<GameState, SimulationMeta>();
let nextMatch = 0;
// Only identity uses environmental randomness; flight, AI, damage and all timers remain seeded/tick driven.
const matchSession = globalThis.crypto?.randomUUID?.() ?? (globalThis.crypto
  ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('')
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
function metaFor(state: GameState): SimulationMeta {
  const meta = metadata.get(state); if (!meta) throw new Error('Game must be created by createGame'); return meta;
}
function initialStats(): MissionStats { return { captures: 0, returns: 0, kills: 0, deaths: 0, shots: 0, hits: 0, loops: 0, damageTaken: 0, teamKills: { friendly: 0, enemy: 0 }, teamReturns: { friendly: 0, enemy: 0 } }; }
const bounded = (value: number): number => Math.min(1_000_000, value + 1);
function emit(state: GameState, type: GameEvent['type'], aircraft: Aircraft | null, options: Partial<GameEvent> = {}): void {
  const meta = metaFor(state), eventSeq = meta.eventSeq++;
  const event: GameEvent = {
    ...options, id: `${state.matchId}/${state.roundEpoch}/${state.tick}/${eventSeq}`, matchId: state.matchId,
    roundEpoch: state.roundEpoch, tick: state.tick, eventSeq, type, position: (options.position ?? aircraft?.position ?? new Vector3()).clone(),
    owner: options.owner ?? aircraft?.id ?? 0, ownerRef: options.ownerRef ?? (aircraft ? aircraftRef(state, aircraft) : undefined),
    target: options.target ?? aircraft?.id, targetRef: options.targetRef ?? (aircraft ? aircraftRef(state, aircraft) : undefined), team: options.team ?? aircraft?.team,
  };
  if (meta.pendingEvents.length >= MAX_EVENTS_PER_STEP) {
    meta.overflow = true;
    // Preserve the decisive notification even when the match is disqualified by overflow.
    if (['kill', 'drop', 'capture', 'end', 'invariant'].includes(type)) {
      const disposable = meta.pendingEvents.findIndex(item => ['shot', 'hit', 'damage', 'splash'].includes(item.type));
      if (disposable >= 0) meta.pendingEvents.splice(disposable, 1); else return;
    } else return;
  }
  meta.pendingEvents.push(event);
}
function commitEvents(state: GameState): void {
  const meta = metaFor(state);
  state.events = Object.freeze(meta.pendingEvents.map(event => {
    Object.freeze(event.position); if (event.ownerRef) Object.freeze(event.ownerRef); if (event.targetRef) Object.freeze(event.targetRef);
    return Object.freeze(event);
  }));
  meta.pendingEvents = [];
}
function invalidateInputs(state: GameState): void {
  const meta = metaFor(state); meta.accumulator = 0; meta.pendingLoop = false; meta.loopHeld = false; meta.inputBlocked = true;
  meta.flight.loopHeld = false; state.inputEpoch++;
}
export function createGame(seed = 0x4e555355, config: Partial<MissionConfig> | GameMode = {}): GameState {
  const normalized = (Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0x4e555355) || 0x4e555355, mission = resolveMissionConfig(config), slots = makeSlots();
  const state: GameState = {
    phase: 'ready', pausedFrom: null, pauseReason: null, matchId: `nusumidase-${matchSession}-${++nextMatch}`, roundEpoch: 0,
    tick: 0, playTicks: 0, phaseTicks: 0, mode: mission.mode, config: mission, seed: normalized, elapsed: 0,
    slots, player: slots[0], allies: slots.slice(1, 5), enemies: slots.slice(5), flags: createFlags(), scores: { friendly: 0, enemy: 0 },
    bullets: [], events: Object.freeze([]), stats: initialStats(), result: null, recordEligible: true, lastCapturePlayTick: 0, roundScored: false, inputEpoch: 0,
  };
  metadata.set(state, { accumulator: 0, flight: createFlightController(state.player), loopHeld: false, pendingLoop: false, inputBlocked: false,
    nextBulletId: 1, eventSeq: 0, pendingEvents: [], queuedDamage: [], processedEvents: new Map(), overflow: false });
  return state;
}
export function startGame(state: GameState): void {
  if (state.phase !== 'ready') return;
  state.phase = 'playing'; state.phaseTicks = 0; invalidateInputs(state);
}
export function pauseGame(state: GameState, reason = 'user'): void {
  if (state.phase === 'paused' || state.phase === 'ended' || state.phase === 'ready') return;
  state.pausedFrom = state.phase; state.phase = 'paused'; state.pauseReason = reason; invalidateInputs(state);
}
export function resumeGame(state: GameState): void {
  if (state.phase !== 'paused' || !state.pausedFrom || state.pauseReason?.startsWith('invariant')) return;
  state.phase = state.pausedFrom; state.pausedFrom = null; state.pauseReason = null; invalidateInputs(state);
}
/** A trusted input adapter calls this only after releasing all sources/captures for this epoch. */
export function acknowledgeInputReset(state: GameState, expectedEpoch: number): boolean {
  if (expectedEpoch !== state.inputEpoch || state.phase === 'ended' || state.phase === 'paused') return false;
  const meta = metaFor(state); meta.inputBlocked = false; meta.pendingLoop = false; meta.loopHeld = false; meta.flight.loopHeld = false;
  return true;
}
function invariantPause(state: GameState, reason: string): void {
  state.recordEligible = false; pauseGame(state, `invariant: ${reason}`); emit(state, 'invariant', null, { detail: reason });
}
function finish(state: GameState, reason: 'captures' | 'time'): void {
  if (state.result) return;
  state.phase = 'ended'; state.phaseTicks = 0; cancelRespawns(state); invalidateInputs(state);
  const scores = Object.freeze({ ...state.scores }), stats = Object.freeze({ ...state.stats, teamKills: Object.freeze({ ...state.stats.teamKills }), teamReturns: Object.freeze({ ...state.stats.teamReturns }) });
  state.result = Object.freeze({ matchId: state.matchId, mode: state.mode, rulesVersion: RULES_VERSION,
    outcome: scores.friendly > scores.enemy ? 'victory' : scores.friendly < scores.enemy ? 'defeat' : 'draw', reason,
    captures: scores, scores, playTicks: state.playTicks, time: state.playTicks * FIXED_DT, stats, recordEligible: state.recordEligible });
  emit(state, 'end', state.player, { detail: state.result.outcome });
}
function flagNotifications(state: GameState, transitions: FlagTransition[]): void {
  for (const transition of transitions) {
    emit(state, transition.type, transition.aircraft ?? null, { flagId: transition.flagId, expectedRevision: transition.expectedRevision, position: transition.position, detail: transition.detail });
  }
}
/** Dispatch exactly once for current match/epoch/tick/generation. It is consumed in the damage transaction. */
export function queueDamageEvent(state: GameState, event: DamageEvent): boolean {
  const meta = metaFor(state), key = `${event.matchId}/${event.roundEpoch}/${event.tick}/${event.eventSeq}`;
  if (state.phase !== 'playing' || event.matchId !== state.matchId || event.roundEpoch !== state.roundEpoch || event.tick !== state.tick + 1
    || !Number.isSafeInteger(event.eventSeq) || event.eventSeq < 0 || !Number.isFinite(event.amount) || event.amount <= 0
    || !resolveAircraftRef(state, event.target) || event.owner && !resolveAircraftRef(state, event.owner) || meta.processedEvents.has(key)) return false;
  if (meta.queuedDamage.length >= MAX_EVENTS_PER_STEP) {
    invariantPause(state, 'queued damage event limit exceeded'); commitEvents(state); return false;
  }
  meta.processedEvents.set(key, event.tick); meta.queuedDamage.push({ ...event, target: { ...event.target }, owner: event.owner ? { ...event.owner } : undefined }); return true;
}
function aggregateDamage(state: GameState, damage: DamageCandidate[]): void {
  const victims = new Map<Aircraft, DamageCandidate[]>();
  for (const hit of damage) {
    if (!isAlive(hit.target) || (isProtected(state, hit.target) && hit.cause !== 'boundary' && hit.cause !== 'sea')) continue;
    if (hit.owner?.team === hit.target.team && hit.cause === 'bullet') continue;
    const values = victims.get(hit.target) ?? []; values.push(hit); victims.set(hit.target, values);
  }
  const deaths: { aircraft: Aircraft; credit: DamageCandidate }[] = [];
  // All HP is resolved against the same pre-damage population. A dead shooter still has its hit.
  for (const [aircraft, hits] of [...victims.entries()].sort(([a], [b]) => aircraftOrder(a, b))) {
    hits.sort((a, b) => a.order - b.order || (a.owner?.team === b.owner?.team ? 0 : a.owner?.team === 'friendly' ? -1 : 1) || (a.owner?.slotId ?? -1) - (b.owner?.slotId ?? -1));
    const total = hits.reduce((sum, hit) => sum + hit.amount, 0), actual = Math.min(aircraft.health, total);
    aircraft.health = Math.max(0, aircraft.health - total);
    if (aircraft === state.player) state.stats.damageTaken = Math.min(1_000_000, state.stats.damageTaken + actual);
    emit(state, 'damage', aircraft, { amount: actual, detail: hits[0].cause });
    if (aircraft.health <= 1e-8) deaths.push({ aircraft, credit: hits[0] });
  }
  for (const { aircraft, credit } of deaths) {
    if (!scheduleRespawn(state, aircraft)) continue;
    if (aircraft === state.player) { state.stats.deaths = bounded(state.stats.deaths); invalidateInputs(state); }
    if (credit.owner && credit.owner.team !== aircraft.team) {
      state.stats.teamKills[credit.owner.team] = bounded(state.stats.teamKills[credit.owner.team]);
      if (credit.owner.team === 'friendly' && credit.owner.slotId === 0) state.stats.kills = bounded(state.stats.kills);
    }
    emit(state, 'kill', aircraft, { owner: credit.owner ? state.slots.find(p => p.team === credit.owner!.team && p.slotId === credit.owner!.slotId)?.id ?? 0 : 0, ownerRef: credit.owner, detail: credit.cause });
    flagNotifications(state, dropCarrierFlags(state, aircraft));
  }
}
export function applyCaptureCandidates(state: GameState, candidates: readonly CaptureCandidate[]): boolean {
  if (candidates.length > 2 || new Set(candidates.map(value => value.captureId)).size !== candidates.length
    || new Set(candidates.map(value => value.team)).size !== candidates.length) {
    invariantPause(state, 'duplicate or invalid capture candidates'); return false;
  }
  if (candidates.length === 0 || state.roundScored || state.phase !== 'playing') return false;
  const meta = metaFor(state);
  const legal = captureCandidates(state, meta.flagStart ?? flagStartSnapshot(state));
  if (legal.length !== candidates.length) return false;
  for (const candidate of candidates) {
    const flag = Object.values(state.flags).find(value => value.flagId === candidate.flagId);
    const current = legal.find(value => value.captureId === candidate.captureId && value.team === candidate.team
      && value.carrier === candidate.carrier && value.flagId === candidate.flagId && value.expectedRevision === candidate.expectedRevision
      && value.entryTime === candidate.entryTime);
    if (!current || !flag || flag.revision !== candidate.expectedRevision || flag.state !== 'carried' || candidate.team !== candidate.carrier.team
      || flag.homeTeam === candidate.team || !sameRef(flag.carrier, aircraftRef(state, candidate.carrier))
      || resolveAircraftRef(state, flag.carrier) !== candidate.carrier || !isAlive(candidate.carrier) || isProtected(state, candidate.carrier)
      || meta.processedEvents.has(candidate.captureId)) return false;
  }
  legal.sort((a, b) => a.entryTime - b.entryTime);
  // Compare actual sphere-entry fractions, never the order of the two teams.
  // Exactly equal entries are a simultaneous finish rather than an arbitrary win.
  const winners = legal.filter(value => value.entryTime === legal[0].entryTime);
  if (meta.pendingEvents.length + winners.length + 1 > MAX_EVENTS_PER_STEP) { invariantPause(state, 'meaning event limit exceeded'); return false; }
  state.roundScored = true;
  state.lastCapturePlayTick = state.playTicks;
  for (const candidate of winners) {
    meta.processedEvents.set(candidate.captureId, state.tick); state.scores[candidate.team]++;
    if (candidate.carrier === state.player) state.stats.captures = bounded(state.stats.captures);
    emit(state, 'capture', candidate.carrier, { flagId: candidate.flagId, expectedRevision: candidate.expectedRevision, amount: state.scores[candidate.team] });
  }
  return true;
}
function normalizedInput(state: GameState, supplied: FlightInput): FlightInput {
  const meta = metaFor(state), axis = (value: number | undefined) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value!)) : 0;
  const input: FlightInput = { ...supplied, turn: axis(supplied.turn), climb: axis(supplied.climb), fire: !!supplied.fire, loop: !!supplied.loop };
  if (supplied.throttle !== undefined) input.throttle = axis(supplied.throttle);
  const stale = supplied.matchId !== undefined && supplied.matchId !== state.matchId || supplied.roundEpoch !== undefined && supplied.roundEpoch !== state.roundEpoch;
  const neutral = !input.steeringActive && input.turn === 0 && input.climb === 0 && !input.fire && !input.loop && (input.throttle ?? 0) === 0 && !input.accelerate && !input.brake;
  if (meta.inputBlocked && neutral) meta.inputBlocked = false;
  if (stale || meta.inputBlocked || !isAlive(state.player)) return { turn: 0, climb: 0, fire: false, loop: false, throttle: 0, viewAspect: supplied.viewAspect };
  return input;
}
export function stateInvariantError(state: GameState): string | null {
  if (state.slots.length !== 10 || new Set(state.slots.map(p => `${p.team}:${p.slotId}`)).size !== 10) return 'Ten unique aircraft slots required';
  if (state.bullets.length > 1024) return 'Bullet limit exceeded';
  for (const plane of state.slots) {
    if (!['friendly', 'enemy'].includes(plane.team) || !Number.isInteger(plane.slotId) || plane.slotId < 0 || plane.slotId > 4
      || !Number.isInteger(plane.generation) || plane.generation < 1) return 'Invalid aircraft slot/generation';
    if (!finitePosition(plane.position) || !Number.isFinite(plane.speed) || plane.speed < 65 || plane.speed > 141) return 'Non-finite/out-of-range flight state';
    if (![plane.yaw, plane.pitch, plane.bank, plane.quaternion.x, plane.quaternion.y, plane.quaternion.z, plane.quaternion.w].every(Number.isFinite)) return 'Non-finite aircraft attitude';
    if (!Number.isFinite(plane.health) || plane.health < 0 || plane.health > plane.maxHealth || plane.maxHealth !== 80) return 'Invalid aircraft HP';
    if (!Number.isInteger(plane.mg) || plane.mg < 0 || plane.mg > 288 || !Number.isInteger(plane.cannon) || plane.cannon < 0 || plane.cannon > 96
      || !Number.isInteger(plane.reloadTicksRemaining) || plane.reloadTicksRemaining < 0 || plane.reloadTicksRemaining > 360
      || !Number.isFinite(plane.fireClock) || plane.fireClock < 0 || !Number.isFinite(plane.cannonClock) || plane.cannonClock < 0
      || !Number.isInteger(plane.protectionUntilPlayTick) || plane.protectionUntilPlayTick < 0) return 'Invalid aircraft weapon/protection timer';
    if (plane.lifecycle === 'active' && plane.health <= 0 || plane.lifecycle === 'respawnPending' && plane.health !== 0) return 'Aircraft lifecycle/HP mismatch';
    if (state.phase !== 'ended' && plane.lifecycle === 'respawnPending' && (!Number.isInteger(plane.respawnDuePlayTick)
      || !plane.respawnRef || !sameRef(plane.respawnRef, aircraftRef(state, plane)))) return 'Invalid respawn reservation';
  }
  for (const bullet of state.bullets) if (!finitePosition(bullet.position) || !finitePosition(bullet.previous) || !finitePosition(bullet.velocity)
    || !Number.isFinite(bullet.life) || bullet.life < 0 || !Number.isFinite(bullet.damage) || bullet.damage < 0
    || !Number.isFinite(bullet.distanceTravelled) || bullet.distanceTravelled < 0 || !bullet.targetGenerations || typeof bullet.targetGenerations !== 'object') return 'Invalid bullet numeric state';
  for (const team of ['friendly', 'enemy'] as const) if (!Number.isInteger(state.scores[team]) || state.scores[team] < 0 || state.scores[team] > CAPTURES_TO_WIN) return 'Invalid capture count';
  return flagInvariantError(state);
}
/** One authoritative tick. Never uses DOM, wall-clock, promises, or rendering state. */
export function stepFixed(state: GameState, supplied: FlightInput): boolean {
  if (state.phase === 'ready' || state.phase === 'paused' || state.phase === 'ended') return false;
  const meta = metaFor(state); meta.eventSeq = 0; meta.pendingEvents = []; meta.overflow = false;
  const input = normalizedInput(state, supplied); state.tick++;
  state.playTicks++; state.elapsed = state.playTicks * FIXED_DT;
  for (const plane of processRespawns(state).sort(aircraftOrder)) {
    emit(state, 'respawn', plane);
    if (plane === state.player) { meta.flight = createFlightController(plane); invalidateInputs(state); }
  }
  const start = flagStartSnapshot(state);
  meta.flagStart = start;
  const error = stateInvariantError(state); if (error) { invariantPause(state, error); commitEvents(state); return true; }
  updateAI(state);
  for (const plane of [...state.slots].sort(aircraftOrder)) {
    if (!isAlive(plane)) continue;
    plane.previous.copy(plane.position); plane.age += FIXED_DT; advanceAmmunition(state, plane, (type, aircraft, options) => emit(state, type, aircraft, options));
    if (plane === state.player) {
      const enemies = state.enemies.filter(enemy => isAlive(enemy) && !isProtected(state, enemy));
      const assist = getFlightAssist(plane, enemies, input, state.mode);
      const preferred = advanceThrottle(meta.flight, input, state.mode, FIXED_DT);
      const loopPressed = input.loop && !meta.loopHeld; meta.loopHeld = input.loop;
      if (updatePlayerLoop(plane, meta.flight, { ...input, turn: assist.turn, climb: assist.climb }, input, loopPressed, FIXED_DT, preferred, MAX_SPEED, assist.responseMultiplier, state.mode)) {
        state.stats.loops = bounded(state.stats.loops); emit(state, 'loop', plane);
      }
    } else updateAircraftMotion(plane, plane.aiTurn, plane.aiClimb, FIXED_DT, 110);
  }
  const ordered = [...state.slots].sort(aircraftOrder), offset = state.tick % ordered.length;
  for (let index = 0; index < ordered.length; index++) {
    const plane = ordered[(index + offset) % ordered.length];
    const firing = plane === state.player ? state.mode === 'easy'
      ? autoFireTarget(plane, state.enemies.filter(enemy => isAlive(enemy) && !isProtected(state, enemy)), state.mode, input.viewAspect) !== null : input.fire : plane.aiFire;
    fireAircraft(state, plane, firing, () => meta.nextBulletId++, (type, aircraft, options) => emit(state, type, aircraft, options));
  }
  const damage = [...collectBulletDamage(state, (type, aircraft, options) => emit(state, type, aircraft, options)), ...collectContactDamage(state)];
  for (const event of meta.queuedDamage) {
    const target = resolveAircraftRef(state, event.target);
    if (event.tick === state.tick && target && event.matchId === state.matchId && event.roundEpoch === state.roundEpoch) damage.push({ target, owner: event.owner, amount: event.amount, cause: event.cause, order: event.eventSeq });
  }
  meta.queuedDamage = []; aggregateDamage(state, damage);
  flagNotifications(state, resolveFlagTransitions(state, start));
  const invariant = stateInvariantError(state);
  if (invariant) invariantPause(state, invariant);
  else if (meta.overflow) invariantPause(state, 'meaning event limit exceeded');
  else {
    applyCaptureCandidates(state, captureCandidates(state, start));
    if (state.phase === 'playing') {
      if (state.scores.friendly >= CAPTURES_TO_WIN || state.scores.enemy >= CAPTURES_TO_WIN) finish(state, 'captures');
      else if (state.playTicks >= MATCH_PLAY_TICKS) {
        if (meta.pendingEvents.length >= MAX_EVENTS_PER_STEP) invariantPause(state, 'meaning event limit exceeded');
        else finish(state, 'time');
      }
      else if (state.playTicks - state.lastCapturePlayTick > 0 && (state.playTicks - state.lastCapturePlayTick) % 5400 === 0) emit(state, 'warning', null, { detail: '敵コアを持ち帰ろう' });
      if (state.playTicks === MATCH_PLAY_TICKS - 3600) emit(state, 'warning', null, { detail: '残り60秒' });
    }
  }
  for (const [id, tick] of meta.processedEvents) if (tick < state.tick - 120) meta.processedEvents.delete(id);
  commitEvents(state); return true;
}
/** Frame adapter: at most five ticks; backlog above 250ms pauses without inventing time. */
export function stepGame(state: GameState, source: FlightInput | (() => FlightInput), frameDt: number, onStep?: (input: FlightInput) => void): number {
  const meta = metaFor(state);
  if (state.phase === 'ready' || state.phase === 'paused' || state.phase === 'ended' || !Number.isFinite(frameDt) || frameDt < 0) return 0;
  meta.accumulator += frameDt;
  if (meta.accumulator > MAX_ACCUMULATOR + 1e-10) { pauseGame(state, 'performance'); return 0; }
  let steps = 0;
  while (meta.accumulator + 1e-10 >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    const input = typeof source === 'function' ? source() : source;
    meta.accumulator = Math.max(0, meta.accumulator - FIXED_DT);
    if (!stepFixed(state, input)) break; steps++; onStep?.(input);
    if (state.phase !== 'playing') break;
  }
  return steps;
}
export function playerTargetSpeed(state: GameState): number { return metaFor(state).flight.playerTargetSpeed; }
export const getPlayerTargetSpeed = playerTargetSpeed;
export function flightControllerFor(state: GameState, aircraft: Aircraft = state.player): FlightController {
  if (aircraft !== state.player) throw new Error('Only the player has an input flight controller');
  return metaFor(state).flight;
}
