import type { Quaternion, Vector3 } from 'three';

export type Team = 'friendly' | 'enemy';
export type GameMode = 'normal' | 'easy';
export type MatchPhase = 'ready' | 'playing' | 'ended';
export type AIRole = 'attacker' | 'defender' | 'escort' | 'recover' | 'return' | 'wait';
export type AIPhase = 'approach' | 'attack' | 'extend';
export interface AircraftRef { matchId: string; roundEpoch: number; team: Team; slotId: number; generation: number; }
export interface Aircraft {
  kind: 'aircraft'; id: number; team: Team; slotId: number; generation: number;
  role: 'player' | 'interceptor' | 'strike'; lifecycle: 'active' | 'respawnPending';
  position: Vector3; previous: Vector3; quaternion: Quaternion;
  yaw: number; pitch: number; bank: number; speed: number; health: number; maxHealth: number;
  mg: number; cannon: number; reloadTicksRemaining: number; fireClock: number; cannonClock: number;
  respawnDuePlayTick: number | null; respawnRef: AircraftRef | null; protectionUntilPlayTick: number;
  loopProgress: number; loopCooldown: number; mode: 'pursue' | 'evade' | 'flee'; age: number;
  targetId: number | null; aiPhase: AIPhase; aiPhaseTime: number; aiWaypoint: Vector3;
  aiTurn: number; aiClimb: number; aiFire: boolean; aiRole: AIRole; aiRoleSinceTick: number;
  aiProgressTick: number; aiBestDistance: number; aiRouteStage: number;
}
export type CombatTarget = Aircraft;
interface FlagBase { flagId: string; homeTeam: Team; roundEpoch: number; revision: number; }
export type Flag = (FlagBase & { state: 'atHome' })
  | (FlagBase & { state: 'carried'; carrier: AircraftRef })
  | (FlagBase & { state: 'dropped'; position: Vector3; droppedAtPlayTick: number });
export interface Bullet {
  id: number; matchId: string; roundEpoch: number; owner: number; ownerRef: AircraftRef; team: Team;
  position: Vector3; previous: Vector3; velocity: Vector3; life: number; damage: number; kind: 'mg' | 'cannon';
  distanceTravelled: number;
  /** Generation visible when fired. A new occupant of a slot cannot inherit a pending hit. */
  targetGenerations: Record<string, number>;
}
export type EventType = 'shot' | 'hit' | 'kill' | 'damage' | 'loop' | 'end' | 'splash' | 'reload-start' | 'reload-complete'
  | 'respawn' | 'pickup' | 'drop' | 'return' | 'capture' | 'round-reset' | 'warning' | 'invariant';
export interface GameEvent {
  id: string; matchId: string; roundEpoch: number; tick: number; eventSeq: number; type: EventType;
  position: Vector3; owner: number; target?: number; targetKind?: 'aircraft'; team?: Team; amount?: number;
  ownerRef?: AircraftRef; targetRef?: AircraftRef; flagId?: string; expectedRevision?: number;
  weapon?: 'mg' | 'cannon'; detail?: string; targetTeam?: Team;
}
export interface FlightInput {
  turn: number; climb: number; fire: boolean; loop: boolean; throttle?: number;
  accelerate?: boolean; brake?: boolean; viewAspect?: number; steeringRevision?: number;
  matchId?: string; roundEpoch?: number;
}
export interface MissionConfig { mode: GameMode; }
export interface PersonalStats { captures: number; returns: number; kills: number; deaths: number; shots: number; hits: number; loops: number; damageTaken: number; }
export interface MissionStats extends PersonalStats { teamKills: Record<Team, number>; teamReturns: Record<Team, number>; }
export interface GameResult {
  readonly matchId: string; readonly mode: GameMode; readonly rulesVersion: string;
  readonly outcome: 'victory' | 'defeat' | 'draw'; readonly reason: 'captures' | 'time';
  readonly captures: Readonly<Record<Team, number>>; readonly scores: Readonly<Record<Team, number>>;
  readonly playTicks: number; readonly time: number; readonly stats: Readonly<MissionStats>; readonly recordEligible: boolean;
}
export interface GameState {
  phase: MatchPhase | 'paused'; pausedFrom: MatchPhase | null; pauseReason: string | null;
  matchId: string; roundEpoch: number; tick: number; playTicks: number; phaseTicks: number;
  mode: GameMode; config: Readonly<MissionConfig>; seed: number; elapsed: number;
  slots: Aircraft[]; player: Aircraft; allies: Aircraft[]; enemies: Aircraft[];
  flags: Record<Team, Flag>; scores: Record<Team, number>; bullets: Bullet[]; events: readonly Readonly<GameEvent>[];
  stats: MissionStats; result: Readonly<GameResult> | null; recordEligible: boolean;
  lastCapturePlayTick: number; roundScored: boolean; inputEpoch: number;
}
export interface EventIdentity { matchId: string; roundEpoch: number; tick: number; eventSeq: number; }
export interface DamageEvent extends EventIdentity { target: AircraftRef; owner?: AircraftRef; amount: number; cause: 'bullet' | 'collision' | 'boundary' | 'sea'; }
export interface FlagEvent extends EventIdentity { flagId: string; expectedRevision: number; }
