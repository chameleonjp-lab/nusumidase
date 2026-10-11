import {
  ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, OctahedronGeometry,
  Path, Quaternion, Shape, TorusGeometry, Vector3,
} from 'three';
import { BASE_POSITIONS, BASE_RADIUS, slotKey } from './arena';
import { getFlagPosition } from './flags';
import { resolveAircraftRef } from './respawn';
import type { GameState, Team } from './types';

export const TEAM_COLORS = { friendly: 0x27aaa4, enemy: 0xe29b55 } as const;
const TEAMS = ['friendly', 'enemy'] as const;

/** The two authoritative cores are represented once, including while carried. */
export class FlagView {
  readonly root = new Group();
  private readonly bases: Record<Team, Group>;
  private readonly cores: Record<Team, Group>;
  private readonly geometry = [new TorusGeometry(BASE_RADIUS, .85, 8, 96),
    new TorusGeometry(6, .30, 8, 32), new OctahedronGeometry(4.6), letterGeometry('A'), letterGeometry('B')];
  private readonly materials = TEAMS.map(team => new MeshStandardMaterial({
    color: TEAM_COLORS[team], metalness: .78, roughness: .29,
    emissive: TEAM_COLORS[team], emissiveIntensity: .14,
  }));
  private readonly silver = new MeshStandardMaterial({ color: 0xd7ddd4, metalness: .87, roughness: .24 });
  private disposed = false;

  constructor() {
    this.root.name = 'non-colliding bases and team cores';
    this.bases = {} as Record<Team, Group>;
    this.cores = {} as Record<Team, Group>;
    TEAMS.forEach((team, index) => {
      const base = new Group(); base.name = `non-colliding ${team} ring base`;
      const ring = new Mesh(this.geometry[0], this.materials[index]);
      ring.rotation.y = Math.PI / 2;
      base.add(ring); base.position.copy(BASE_POSITIONS[team]);
      this.bases[team] = base; this.root.add(base);
      const core = new Group(); core.name = `${team} metallic core ${index === 0 ? 'A' : 'B'}`;
      const metal = new Mesh(this.geometry[2], this.silver); metal.position.z = 1.2;
      const outline = new Mesh(this.geometry[1], this.materials[index]);
      core.add(metal, outline);
      for (const side of [-1, 1]) {
        const letter = new Mesh(this.geometry[3 + index], this.materials[index]);
        letter.position.z = side * 4.4;
        if (side < 0) letter.rotation.y = Math.PI;
        core.add(letter);
      }
      this.cores[team] = core; this.root.add(core);
    });
  }

  update(state: GameState, planeRoots: ReadonlyMap<string, Group>): void {
    TEAMS.forEach(team => {
      const flag = state.flags[team], core = this.cores[team];
      const carrier = flag.state === 'carried' ? resolveAircraftRef(state, flag.carrier) : null;
      const parent = carrier ? planeRoots.get(slotKey(carrier.team, carrier.slotId)) : null;
      if (parent) {
        if (core.parent !== parent) parent.add(core);
        // The original airframe and its scale are untouched. The small core
        // is a separate child under the rear belly, clear of the guns/sight.
        core.position.set(0, -1.55, 2.9); core.scale.setScalar(.16);
        core.quaternion.identity();
      } else {
        if (core.parent !== this.root) this.root.add(core);
        core.position.copy(getFlagPosition(state, flag)); core.scale.setScalar(1);
        core.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), state.elapsed * .38 + Math.PI / 2);
      }
      core.visible = !carrier || (carrier.health > 0 && carrier.lifecycle === 'active');
    });
  }

  reset(): void {
    TEAMS.forEach(team => {
      const core = this.cores[team]; this.root.add(core);
      core.position.copy(BASE_POSITIONS[team]); core.quaternion.copy(new Quaternion());
      core.scale.setScalar(1); core.visible = true;
    });
  }

  diagnostics() {
    return { bases: TEAMS.length, cores: TEAMS.length,
      carriedCores: TEAMS.filter(team => this.cores[team].parent !== this.root).length };
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const core of Object.values(this.cores)) core.removeFromParent();
    this.root.removeFromParent();
    for (const geometry of this.geometry) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.silver.dispose();
  }
}

function letterGeometry(letter: 'A' | 'B'): ExtrudeGeometry {
  const shape = new Shape();
  if (letter === 'A') {
    shape.moveTo(-3.2, -4); shape.lineTo(-1.3, -4); shape.lineTo(-.7, -1.9);
    shape.lineTo(.7, -1.9); shape.lineTo(1.3, -4); shape.lineTo(3.2, -4);
    shape.lineTo(.9, 4); shape.lineTo(-.9, 4); shape.closePath();
    const hole = new Path(); hole.moveTo(-.48, -.2); hole.lineTo(0, 1.55); hole.lineTo(.48, -.2); hole.closePath();
    shape.holes.push(hole);
  } else {
    shape.moveTo(-2.7, -4); shape.lineTo(-2.7, 4); shape.lineTo(.1, 4);
    shape.bezierCurveTo(3.6, 4, 3.7, 1.1, 1.9, .15);
    shape.bezierCurveTo(4.1, -.7, 3.8, -4, .2, -4); shape.closePath();
    for (const y of [-1.9, 1.95]) {
      const hole = new Path(); hole.moveTo(-.9, y - .78); hole.lineTo(.1, y - .78);
      hole.bezierCurveTo(1.65, y - .78, 1.65, y + .78, .1, y + .78);
      hole.lineTo(-.9, y + .78); hole.closePath(); shape.holes.push(hole);
    }
  }
  return new ExtrudeGeometry(shape, { depth: .45, bevelEnabled: true,
    bevelThickness: .1, bevelSize: .1, bevelSegments: 2, curveSegments: 12 });
}
