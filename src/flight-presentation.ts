import { normalizeAngle } from './flight';
import type { Aircraft, GameState } from './types';

/** Display samples never enter combat, clocks or input acknowledgement. */
export class FlightPresentation {
  private state: GameState | null = null;
  private tick = -1;
  private matchId = '';
  private roundEpoch = -1;
  private playerGeneration = -1;
  private aircraft = new Map<number, Aircraft>();
  reset() { this.state = null; this.aircraft.clear(); }
  capture(state: GameState) {
    this.state = state; this.tick = state.tick; this.matchId = state.matchId;
    this.roundEpoch = state.roundEpoch; this.playerGeneration = state.player.generation;
    this.aircraft.clear();
    for (const plane of state.slots) this.aircraft.set(plane.id, { ...plane, position: plane.position.clone(), quaternion: plane.quaternion.clone() });
  }
  sample(state: GameState, alpha: number): GameState {
    if (state.phase !== 'playing') { this.reset(); return state; }
    if (this.state !== state || this.tick !== state.tick - 1 || this.matchId !== state.matchId || this.roundEpoch !== state.roundEpoch || this.playerGeneration !== state.player.generation || state.player.health <= 0) return state;
    const t = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    const planes = new Map<number, Aircraft>();
    for (const plane of state.slots) {
      const before = this.aircraft.get(plane.id);
      const valid = before && before.generation === plane.generation && before.health > 0 && plane.health > 0 && before.lifecycle === 'active' && plane.lifecycle === 'active';
      planes.set(plane.id, valid ? { ...plane, position: before.position.clone().lerp(plane.position,t), quaternion: before.quaternion.clone().slerp(plane.quaternion,t),
        pitch: before.pitch + normalizeAngle(plane.pitch-before.pitch)*t, yaw: before.yaw + normalizeAngle(plane.yaw-before.yaw)*t, bank: before.bank + normalizeAngle(plane.bank-before.bank)*t } : plane);
    }
    return { ...state, slots: state.slots.map(p => planes.get(p.id)!), player: planes.get(state.player.id)!,
      allies: state.allies.map(p => planes.get(p.id)!), enemies: state.enemies.map(p => planes.get(p.id)!),
      bullets: state.bullets.map(round => ({ ...round, position: round.previous.clone().lerp(round.position,t) })) };
  }
}
