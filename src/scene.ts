import {
  ACESFilmicToneMapping, BackSide, BufferAttribute, BufferGeometry, Color,
  CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, PerspectiveCamera, Points, Quaternion, Scene, ShaderMaterial,
  SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { AircraftFactory, type AircraftVisual } from './aircraft';
import { AircraftBatchFactory } from './aircraft-batch';
import { AircraftTracers } from './aircraft-tracers';
import { AIM_COLORS, aimIndicator, aimRadius } from './aim-indicator';
import { BASE_POSITIONS, slotKey } from './arena';
import { seaVertex, seaFragment, skyVertex, skyFragment } from './atmosphere';
import { FlagView, TEAM_COLORS } from './flag-view';
import { carriedFlagFor, getFlagPosition } from './flags';
import { targetAimPoint } from './flight-assist';
import { FLIGHT_FOV, FLIGHT_VISIBILITY_RANGE, getFlightCameraPose } from './flight-view';
import { projectGunSight } from './gun-sight';
import { PLAYER_RELOAD_TICKS } from './mission';
import { createOceanGeometry, oceanAnchor } from './ocean';
import { RenderQueue } from './render-queue';
import { isAlive, isProtected, resolveAircraftRef } from './respawn';
import type { Aircraft, GameEvent, GameState, Team } from './types';

export const EFFECT_CAPACITY = 240;
export const WRECK_CAPACITY = 10;
export const WRECK_LIFETIME = 5;
interface Particle { p: Vector3; v: Vector3; born: number; life: number; color: Color; size: number; }
interface PlaneVisual { visual: AircraftVisual; generation: number; }
interface Wreck { generation: number; time: number; position: Vector3; rotation: Quaternion; velocity: Vector3; }
const TEAMS = ['friendly', 'enemy'] as const;

/** Kaisen's airframe, lighting, ocean and flight camera with a CTF-only view. */
export class NusumidaseScene {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(FLIGHT_FOV, 1, .5, 22000);
  private readonly scene = new Scene();
  private readonly aircraft = new AircraftFactory();
  private readonly aircraftBatches = new AircraftBatchFactory();
  private readonly aircraftTracers = new AircraftTracers();
  private readonly flags = new FlagView();
  private readonly planes = new Map<string, PlaneVisual>();
  private readonly planeRoots = new Map<string, Group>();
  private readonly teamBandGeometry = new CylinderGeometry(.34, .39, .6, 14, 1, true);
  private readonly teamMaterials = {
    friendly: new MeshBasicMaterial({ color: TEAM_COLORS.friendly }),
    enemy: new MeshBasicMaterial({ color: TEAM_COLORS.enemy }),
  };
  private readonly seaMaterial = new ShaderMaterial({ uniforms: { uTime: { value: 0 } },
    vertexShader: seaVertex, fragmentShader: seaFragment });
  private readonly sea = new Mesh(createOceanGeometry(), this.seaMaterial);
  private readonly sky = new Mesh(new SphereGeometry(21000, 32, 20),
    new ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment,
      side: BackSide, depthWrite: false }));
  private readonly particleGeometry = new BufferGeometry();
  private readonly particlePositions = new Float32Array(EFFECT_CAPACITY * 3);
  private readonly particleColors = new Float32Array(EFFECT_CAPACITY * 3);
  private readonly particleSizes = new Float32Array(EFFECT_CAPACITY);
  private readonly particleOpacity = new Float32Array(EFFECT_CAPACITY);
  private readonly points: Points;
  private readonly renderQueue: RenderQueue;
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private readonly wrecks = new Map<string, Wreck>();
  private current: GameState | null = null;
  private matchId = '';
  private roundEpoch = -1;
  private cameraGeneration = -1;
  private lastEventTick = -1;
  private lastEventSeq = -1;
  private lastTime = 0;
  private visualTime = 0;
  private width = 1;
  private height = 1;
  private prepared = false;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly overlay: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    if (!('fenceSync' in gl)) throw new Error('WebGL2 is required');
    this.renderQueue = new RenderQueue(gl);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    const context = overlay.getContext('2d');
    if (!context) throw new Error('Canvas 2D is required');
    this.ctx = context;
    this.scene.background = new Color(0xaecbd0);
    this.scene.fog = new Fog(0xaecbd0, 1400, 6000);
    this.scene.add(new HemisphereLight(0xc6e5ec, 0x23424e, 2.3));
    const sun = new DirectionalLight(0xffe9b5, 3.1); sun.position.set(-600, 700, -350);
    this.scene.add(sun, this.sea, this.sky, this.flags.root, this.aircraftTracers.root);
    // Ten immutable slot visuals are created once. Match/round/respawn reset
    // reuses their geometry, textures and groups rather than growing a cache.
    for (const team of TEAMS) for (let slotId = 0; slotId < 5; slotId++) {
      const player = team === 'friendly' && slotId === 0;
      const detail = player ? 'hero' : 'enemy';
      const visual = this.aircraftBatches.optimize(this.aircraft.create(detail), detail);
      if (!player) {
        const band = new Mesh(this.teamBandGeometry, this.teamMaterials[team]);
        band.rotation.x = Math.PI / 2; band.position.set(0, .04, 2.45); band.scale.z = 1.12;
        visual.root.add(band);
      }
      visual.root.visible = false;
      const key = slotKey(team, slotId);
      this.planes.set(key, { visual, generation: -1 }); this.planeRoots.set(key, visual.root);
      this.scene.add(visual.root);
    }
    this.particleGeometry.setAttribute('position', new BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute('color', new BufferAttribute(this.particleColors, 3));
    this.particleGeometry.setAttribute('size', new BufferAttribute(this.particleSizes, 1));
    this.particleGeometry.setAttribute('opacity', new BufferAttribute(this.particleOpacity, 1));
    this.particleGeometry.setDrawRange(0, 0);
    this.points = new Points(this.particleGeometry, new ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      vertexShader: 'attribute float size;attribute float opacity;varying vec3 vColor;varying float vAlpha;void main(){vColor=color;vAlpha=opacity;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(size*450./max(1.,-p.z),1.,80.);gl_Position=projectionMatrix*p;}',
      fragmentShader: 'varying vec3 vColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;gl_FragColor=vec4(vColor,pow(1.-d,1.7)*.8*vAlpha);}',
    }));
    this.points.frustumCulled = false; this.scene.add(this.points);
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.width = rect.width; this.height = rect.height;
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height; this.camera.updateProjectionMatrix();
    this.overlay.width = Math.round(rect.width); this.overlay.height = Math.round(rect.height);
    this.aircraftTracers.coreMaterial.resolution.set(rect.width, rect.height);
    this.aircraftTracers.outlineMaterial.resolution.set(rect.width, rect.height);
  }

  async prepare(): Promise<void> {
    if (this.disposed) return;
    // Compile and upload the whole immutable pool behind the loading screen.
    // Compilation alone does not upload a geometry outside the initial view
    // (notably the A core letter). Warmup must exercise it before Start.
    const planes = [...this.planes.values()];
    const visibility = planes.map(plane => plane.visual.root.visible);
    const flagsVisible = this.flags.root.visible;
    const culling = new Map<Mesh, boolean>();
    this.scene.traverse(object => {
      if (object instanceof Mesh) {
        culling.set(object, object.frustumCulled);
        object.frustumCulled = false;
      }
    });
    for (const plane of planes) plane.visual.root.visible = true;
    this.flags.root.visible = true;
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
      if (this.disposed) return;
      const sample = new Vector3(0, 0, -80).applyQuaternion(this.camera.quaternion).add(this.camera.position);
      this.particlePositions.set(sample.toArray()); this.particleColors.set([1, .6, .2]);
      this.particleSizes[0] = 8; this.particleOpacity[0] = 1;
      for (const attribute of Object.values(this.particleGeometry.attributes)) attribute.needsUpdate = true;
      this.particleGeometry.setDrawRange(0, 1); this.aircraftTracers.prime(sample);
      this.renderer.render(this.scene, this.camera);
    } finally {
      // Restore every original flag/airframe culling and visibility value,
      // including compile rejection or disposal during the async preparation.
      planes.forEach((plane, index) => { plane.visual.root.visible = visibility[index]; });
      this.flags.root.visible = flagsVisible;
      for (const [mesh, frustumCulled] of culling) mesh.frustumCulled = frustumCulled;
      this.particleGeometry.setDrawRange(0, 0); this.aircraftTracers.update([]);
    }
    if (this.disposed) return;
    // The visible completion barrier includes a clean frame with live culling
    // and no priming tracers/particles before preparation is acknowledged.
    this.renderer.render(this.scene, this.camera);
    const preparationStarted = performance.now();
    this.renderQueue.submit(preparationStarted);
    while (!this.disposed) {
      const status = this.renderQueue.poll(performance.now());
      if (status === 'ready') break;
      // Loading/recovery freezes simulation and may upload an entire new GPU
      // pool. Keep the runtime's 1s stall rule, but allow this initial barrier
      // up to 30s without submitting another frame or resetting its fence.
      if (status === 'failed' || performance.now() - preparationStarted > 30000) {
        throw new Error(`Initial GPU frame failed: ${JSON.stringify(this.renderQueue.diagnostics(performance.now()))}`);
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    if (!this.disposed) { this.prepared = true; this.renderQueue.reset(); }
  }

  pollRender(now = performance.now()) { return this.prepared ? this.renderQueue.poll(now) : 'ready'; }
  resetRenderQueue(): void { this.renderQueue.reset(); }

  private reset(state: GameState): void {
    this.matchId = state.matchId; this.roundEpoch = state.roundEpoch; this.current = state;
    this.flags.reset(); this.particles.length = 0; this.wrecks.clear();
    this.lastEventTick = -1; this.lastEventSeq = -1;
    this.lastTime = this.visualTime = state.elapsed;
    this.aircraftTracers.update([]); this.particleGeometry.setDrawRange(0, 0);
    for (const plane of this.planes.values()) {
      plane.generation = -1; plane.visual.propeller.rotation.z = 0;
      plane.visual.ailerons[0].rotation.x = plane.visual.ailerons[1].rotation.x = 0;
      plane.visual.elevator.rotation.x = 0;
    }
    this.cameraGeneration = state.player.generation;
    getFlightCameraPose(state.player, state.mode, this.camera.position, this.camera.quaternion);
    this.camera.updateMatrixWorld();
  }

  events(events: readonly Readonly<GameEvent>[], time: number): void {
    if (!this.current) return;
    for (const event of events) {
      if (event.matchId !== this.matchId || event.roundEpoch !== this.roundEpoch) continue;
      if (event.tick < this.lastEventTick || (event.tick === this.lastEventTick && event.eventSeq <= this.lastEventSeq)) continue;
      this.lastEventTick = event.tick; this.lastEventSeq = event.eventSeq;
      if (event.type !== 'hit' && event.type !== 'kill' && event.type !== 'splash') continue;
      // Effects start on delivery in the authoritative playing clock.
      const born = time;
      if (event.type === 'kill' && event.target !== undefined) {
        const target = this.current.slots.find(plane => plane.id === event.target);
        if (target && !isAlive(target) && (!event.targetRef || resolveAircraftRef(this.current, event.targetRef) === target)) {
          const key = slotKey(target.team, target.slotId);
          if (!this.wrecks.has(key) && this.wrecks.size < WRECK_CAPACITY) this.wrecks.set(key, {
            generation: target.generation, time: born, position: event.position.clone(), rotation: target.quaternion.clone(),
            velocity: new Vector3(0, 0, -1).applyQuaternion(target.quaternion).multiplyScalar(target.speed * .5),
          });
        }
      }
      const life = event.type === 'kill' ? 2.4 : event.type === 'splash' ? 1.1 : .7;
      if (time - born >= life) continue;
      const count = event.type === 'kill' ? 18 : event.type === 'splash' ? 4 : 3;
      const overflow = this.particles.length + count - EFFECT_CAPACITY;
      if (overflow > 0) this.particles.splice(0, overflow);
      for (let index = 0; index < count; index++) {
        // Visual randomness is a deterministic event hash and never touches
        // simulation state or its random stream.
        const seed = event.tick * 31 + event.eventSeq * 13 + index * 17, angle = seed * 2.399963;
        const radius = event.type === 'kill' ? 18 : event.type === 'splash' ? 3 : 5;
        this.particles.push({ p: event.position.clone(),
          v: new Vector3(Math.cos(angle) * radius, event.type === 'splash' ? 18 + seed % 17 : 6 + seed % 13, Math.sin(angle) * radius),
          born, life, color: new Color(event.type === 'splash' ? 0xbbf4f5 : event.type === 'kill' && index % 2 === 0 ? 0x354047 : index % 3 === 0 ? 0xffd993 : 0xed641d),
          size: event.type === 'kill' ? 28 : event.type === 'splash' ? 13 : 8 });
      }
    }
    if (this.particles.length > EFFECT_CAPACITY) this.particles.splice(0, this.particles.length - EFFECT_CAPACITY);
  }

  render(state: GameState, showHUD: boolean, presentationDt = 0): boolean {
    if (this.disposed) return false;
    if (state.matchId !== this.matchId || state.roundEpoch !== this.roundEpoch) this.reset(state);
    this.current = state;
    if (this.pollRender() !== 'ready') return false;
    const dt = Math.max(0, Math.min(.1, state.elapsed - this.lastTime)); this.lastTime = state.elapsed;
    this.visualTime = state.phase === 'ended' ? this.visualTime + Math.max(0, Math.min(.1, presentationDt)) : state.elapsed;
    this.events(state.events, state.elapsed);
    for (const aircraft of state.slots) this.updatePlane(aircraft, state, dt);
    // Death leaves the last live view untouched. A new generation or round
    // uses the exact source pose immediately, with no stale interpolation.
    if (isAlive(state.player) || this.cameraGeneration !== state.player.generation) {
      getFlightCameraPose(state.player, state.mode, this.camera.position, this.camera.quaternion);
      this.cameraGeneration = state.player.generation;
    }
    this.camera.updateMatrixWorld(); this.sky.position.copy(this.camera.position);
    this.sea.position.x = oceanAnchor(state.player.position.x); this.sea.position.z = oceanAnchor(state.player.position.z);
    this.seaMaterial.uniforms.uTime.value = state.elapsed;
    this.flags.update(state, this.planeRoots); this.flags.root.visible = state.phase !== 'ready';
    this.aircraftTracers.update(state.bullets);
    this.particles = this.particles.filter(particle => this.visualTime - particle.born < particle.life);
    this.particles.forEach((particle, index) => {
      const age = Math.max(0, this.visualTime - particle.born);
      const position = particle.p.clone().addScaledVector(particle.v, age); position.y -= age * age * 4;
      this.particlePositions.set(position.toArray(), index * 3);
      this.particleColors.set([particle.color.r, particle.color.g, particle.color.b], index * 3);
      this.particleOpacity[index] = 1 - age / particle.life; this.particleSizes[index] = particle.size * (1 + age * .4);
    });
    this.particleGeometry.setDrawRange(0, this.particles.length);
    for (const attribute of Object.values(this.particleGeometry.attributes)) attribute.needsUpdate = true;
    this.renderer.render(this.scene, this.camera); this.drawOverlay(state, showHUD);
    if (this.prepared) this.renderQueue.submit(performance.now());
    return true;
  }

  private updatePlane(aircraft: Aircraft, state: GameState, dt: number): void {
    const key = slotKey(aircraft.team, aircraft.slotId), plane = this.planes.get(key);
    if (!plane) return;
    const visual = plane.visual;
    if (plane.generation !== aircraft.generation) {
      const wreck = this.wrecks.get(key);
      if (wreck && wreck.generation !== aircraft.generation) this.wrecks.delete(key);
      plane.generation = aircraft.generation;
    }
    visual.root.visible = isAlive(aircraft) && (!isProtected(state, aircraft) || state.playTicks % 16 < 11);
    visual.root.position.copy(aircraft.position); visual.root.quaternion.copy(aircraft.quaternion);
    const wreck = this.wrecks.get(key);
    if (!isAlive(aircraft) && wreck) {
      const age = this.visualTime - wreck.time;
      visual.root.visible = age < WRECK_LIFETIME;
      visual.root.position.copy(wreck.position).addScaledVector(wreck.velocity, age);
      visual.root.position.y -= age * age * 4.9;
      visual.root.quaternion.copy(wreck.rotation); visual.root.rotateZ(age * .65); visual.root.rotateX(age * .16);
      if (visual.root.position.y < 0) visual.root.visible = false;
      if (age >= WRECK_LIFETIME) this.wrecks.delete(key);
    }
    visual.propeller.rotation.z = (visual.propeller.rotation.z + dt * (34 + Math.min(8, aircraft.speed * .035))) % (Math.PI * 2);
    const deflection = Math.max(-.3, Math.min(.3, aircraft.bank * .34));
    visual.ailerons[0].rotation.x = deflection; visual.ailerons[1].rotation.x = -deflection;
    visual.elevator.rotation.x = Math.max(-.26, Math.min(.26, -aircraft.pitch * .32));
  }

  private drawOverlay(state: GameState, show: boolean): void {
    const c = this.ctx, w = this.width, h = this.height;
    c.shadowBlur = 0; c.clearRect(0, 0, w, h); if (!show) return;
    if (isAlive(state.player)) {
      const sight = state.mode === 'normal' ? this.gunSight(state) : { x: w / 2, y: h / 2 };
      const radius = aimRadius(state.mode, w, h);
      const indicator = aimIndicator(state, [...state.allies, ...state.enemies], sight, w, h);
      const color = AIM_COLORS[indicator];
      c.strokeStyle = color; c.lineWidth = 1; c.beginPath(); c.arc(sight.x, sight.y, radius, 0, Math.PI * 2);
      if (state.mode === 'normal') {
        c.moveTo(sight.x - radius - 6, sight.y); c.lineTo(sight.x - radius + 5, sight.y);
        c.moveTo(sight.x + radius - 5, sight.y); c.lineTo(sight.x + radius + 6, sight.y);
        c.moveTo(sight.x, sight.y - radius - 6); c.lineTo(sight.x, sight.y - radius + 5);
        c.moveTo(sight.x, sight.y + radius - 5); c.lineTo(sight.x, sight.y + radius + 6);
        c.strokeStyle = 'rgba(3,25,39,.65)'; c.lineWidth = 2; c.stroke(); c.strokeStyle = color; c.lineWidth = 1;
      }
      c.stroke();
      if (state.player.reloadTicksRemaining > 0) {
        const progress = 1 - state.player.reloadTicksRemaining / PLAYER_RELOAD_TICKS;
        c.strokeStyle = 'rgba(7,30,43,.8)'; c.lineWidth = 5;
        c.beginPath(); c.arc(sight.x, sight.y, radius + 7, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = '#ffd27a'; c.lineWidth = 3;
        c.beginPath(); c.arc(sight.x, sight.y, radius + 7, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); c.stroke();
      }
      c.fillStyle = color; c.fillRect(sight.x - 1, sight.y - 1, 2, 2);
    }
    c.shadowColor = 'rgba(0,20,30,.9)'; c.shadowBlur = 3; c.font = '600 11px system-ui'; c.textAlign = 'center';
    for (const target of [...state.allies, ...state.enemies]) {
      if (!isAlive(target)) continue;
      const world = targetAimPoint(target), distance = world.distanceTo(state.player.position);
      if (distance > FLIGHT_VISIBILITY_RANGE) continue;
      const local = world.clone().sub(this.camera.position).applyQuaternion(this.camera.quaternion.clone().invert());
      const projection = world.clone().project(this.camera);
      if (local.z >= 0 || Math.abs(projection.x) > .94 || Math.abs(projection.y) > .82) continue;
      const x = (projection.x * .5 + .5) * w, y = (-projection.y * .5 + .5) * h, friendly = target.team === 'friendly';
      c.strokeStyle = friendly ? '#77dacb' : '#ffb28b'; c.fillStyle = c.strokeStyle; c.lineWidth = 1.25; c.beginPath();
      if (friendly) c.arc(x, y, 4, 0, Math.PI * 2);
      else { c.moveTo(x, y - 6); c.lineTo(x + 5, y); c.lineTo(x, y + 6); c.lineTo(x - 5, y); c.closePath(); }
      c.stroke();
      c.fillStyle = friendly ? '#77dacb' : '#f4e3c8'; c.fillText(friendly ? '自軍' : '敵軍', x, y - 12);
      if (!friendly) {
        c.fillStyle = 'rgba(7,24,32,.8)'; c.fillRect(x - 19, y + 12, 38, 3);
        c.fillStyle = '#ffc69b'; c.fillRect(x - 19, y + 12, 38 * target.health / target.maxHealth, 3);
        c.fillStyle = '#f4e3c8'; c.fillText(`${Math.round(distance)}m`, x, y + 28);
      }
    }
    c.shadowBlur = 0;
    this.drawPublicMarkers(state); this.radar(state, c, w, h);
  }

  private drawPublicMarkers(state: GameState): void {
    for (const team of TEAMS) {
      const flag = state.flags[team], letter = team === 'friendly' ? 'A' : 'B', label = team === 'friendly' ? '自軍' : '敵軍';
      this.publicMarker(state, BASE_POSITIONS[team], `${label} ${letter} 基地`, team, false);
      if (flag.state !== 'atHome') {
        const carrier = flag.state === 'carried' ? resolveAircraftRef(state, flag.carrier) : null;
        if (carrier !== state.player) this.publicMarker(state, getFlagPosition(state, flag),
          `${label} ${letter} コア · ${flag.state === 'dropped' ? '落下' : '携行'}`, team, true);
      }
    }
  }

  private publicMarker(state: GameState, world: Vector3, label: string, team: Team, core: boolean): void {
    const c = this.ctx, w = this.width, h = this.height;
    const projection = world.clone().project(this.camera);
    const local = world.clone().sub(this.camera.position).applyQuaternion(this.camera.quaternion.clone().invert());
    const marginX = Math.min(76, w * .22), top = Math.min(104, h * .22), bottom = Math.max(top + 24, h - Math.min(158, h * .28));
    let x = (projection.x * .5 + .5) * w, y = (-projection.y * .5 + .5) * h;
    const onscreen = local.z < -.1 && x >= marginX && x <= w - marginX && y >= top && y <= bottom;
    let angle = 0;
    if (!onscreen) {
      const dx = local.x, dy = -local.y;
      const vx = Math.abs(dx) + Math.abs(dy) < .001 ? 0 : dx;
      const vy = Math.abs(dx) + Math.abs(dy) < .001 ? 1 : dy;
      const cy = (top + bottom) / 2;
      const divisor = Math.max(Math.abs(vx) / Math.max(1, w / 2 - marginX), Math.abs(vy) / Math.max(1, (bottom - top) / 2), .00001);
      x = w / 2 + vx / divisor; y = cy + vy / divisor; angle = Math.atan2(vy, vx);
    }
    const distance = state.player.position.distanceTo(world), altitude = world.y - state.player.position.y;
    c.save(); c.shadowColor = 'rgba(0,20,30,.9)'; c.shadowBlur = 3; c.strokeStyle = team === 'friendly' ? '#77dacb' : '#ffb28b';
    c.fillStyle = c.strokeStyle; c.lineWidth = 1.1;
    c.beginPath();
    if (!onscreen) {
      c.moveTo(x + Math.cos(angle) * 7, y + Math.sin(angle) * 7);
      c.lineTo(x + Math.cos(angle + 2.45) * 6, y + Math.sin(angle + 2.45) * 6);
      c.lineTo(x + Math.cos(angle - 2.45) * 6, y + Math.sin(angle - 2.45) * 6); c.closePath(); c.stroke();
    } else if (core) {
      c.moveTo(x, y - 7); c.lineTo(x + 7, y); c.lineTo(x, y + 7); c.lineTo(x - 7, y); c.closePath(); c.stroke();
    } else { c.arc(x, y, 7, 0, Math.PI * 2); c.stroke(); }
    // Public information uses two compact side rows, leaving the inherited
    // centre sight and airframe clear. The world anchor and leader retain the
    // same camera projection even when the description sits in a side row.
    // The carrier HUD already describes the home base. Reuse that side row
    // for the public stolen home core instead of writing over the HUD reason.
    const carrying = !!carriedFlagFor(state, state.player);
    if (carrying && team === 'friendly' && !core) { c.restore(); return; }
    const portrait = h > w;
    const labelY = portrait ? Math.min(h - 170, Math.max(252, h * .31)) : Math.min(h - 130, Math.max(190, h * .51));
    const textX = team === 'friendly' ? Math.min(86, w * .23) : w - Math.min(86, w * .23);
    const textY = labelY + (core && !carrying ? 42 : 0);
    const edgeX = textX + (x > textX ? 46 : -46), edgeY = textY + 5;
    c.save(); c.globalAlpha = .25; c.lineWidth = .75;
    c.beginPath(); c.moveTo(x, y - 9); c.lineTo(edgeX, edgeY); c.lineTo(textX, edgeY); c.stroke(); c.restore();
    c.font = '600 10px system-ui'; c.textAlign = 'center';
    c.fillText(`${label}${altitude < -5 ? ' ↓' : altitude > 5 ? ' ↑' : ''}`, textX, textY);
    c.font = '10px system-ui'; c.fillStyle = '#dce8df';
    c.fillText(`${distance >= 1000 ? `${(distance / 1000).toFixed(1)}km` : `${Math.round(distance)}m`} · 高度${Math.round(world.y)}m`, textX, textY + 13);
    c.restore();
  }

  private radar(state: GameState, c: CanvasRenderingContext2D, w: number, h: number): void {
    const radius = w < 360 ? 42 : 49, x = w - radius - 18, y = Math.min(h * .33, 180);
    c.save(); c.translate(x, y); c.fillStyle = 'rgba(4,24,34,.66)'; c.strokeStyle = 'rgba(150,212,211,.36)'; c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.arc(0, 0, radius / 2, 0, Math.PI * 2); c.moveTo(-radius, 0); c.lineTo(radius, 0);
    c.moveTo(0, -radius); c.lineTo(0, radius); c.stroke();
    const cy = Math.cos(state.player.yaw), sy = Math.sin(state.player.yaw), range = 2400;
    const plot = (world: Vector3, team: Team, shape: 'plane' | 'base' | 'core') => {
      const dx = world.x - state.player.position.x, dz = world.z - state.player.position.z;
      let px = (dx * cy - dz * sy) / range * radius, py = (dx * sy + dz * cy) / range * radius;
      const distance = Math.hypot(px, py);
      if (distance > radius - 4) { px *= (radius - 4) / distance; py *= (radius - 4) / distance; }
      c.fillStyle = team === 'friendly' ? '#70d8c7' : '#ffb78c'; c.strokeStyle = c.fillStyle; c.beginPath();
      if (shape === 'base') c.arc(px, py, 4, 0, Math.PI * 2);
      else if (shape === 'core') c.rect(px - 2.5, py - 2.5, 5, 5);
      else if (team === 'friendly') c.arc(px, py, 2.2, 0, 7);
      else { c.moveTo(px, py - 3); c.lineTo(px + 3, py); c.lineTo(px, py + 3); c.lineTo(px - 3, py); c.closePath(); }
      if (shape === 'base' || distance > radius - 4) c.stroke(); else c.fill();
      if (shape === 'base') { c.font = '600 9px system-ui'; c.textAlign = 'center'; c.fillText(team === 'friendly' ? 'A' : 'B', px, py - 6); }
    };
    for (const plane of [...state.allies, ...state.enemies]) {
      if (!isAlive(plane) || plane.position.distanceTo(state.player.position) > FLIGHT_VISIBILITY_RANGE) continue;
      plot(plane.position, plane.team, 'plane');
    }
    for (const team of TEAMS) { plot(BASE_POSITIONS[team], team, 'base'); if (state.flags[team].state !== 'atHome') plot(getFlagPosition(state, team), team, 'core'); }
    c.fillStyle = '#fff4ce'; c.beginPath(); c.moveTo(0, -5); c.lineTo(3, 4); c.lineTo(0, 2); c.lineTo(-3, 4); c.closePath(); c.fill();
    c.fillStyle = '#b8cfce'; c.font = '9px system-ui'; c.textAlign = 'center'; c.fillText('2.4km', 0, radius + 13); c.restore();
  }

  gunSight(state: GameState) { return projectGunSight(state.player, state.enemies, this.width, this.height); }

  diagnostics() {
    return { queue: this.renderQueue.diagnostics(performance.now()), calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures, particles: this.particles.length, effectCapacity: EFFECT_CAPACITY,
      wrecks: this.wrecks.size, wreckCapacity: WRECK_CAPACITY, planes: this.planes.size,
      width: this.width, height: this.height, pixelRatio: this.renderer.getPixelRatio(),
      camera: { fov: this.camera.fov, near: this.camera.near, far: this.camera.far, position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray() },
      aircraftTracers: this.aircraftTracers.diagnostics(), flags: this.flags.diagnostics() };
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.renderQueue.dispose(); this.flags.dispose();
    for (const plane of this.planes.values()) plane.visual.root.removeFromParent();
    this.planes.clear(); this.planeRoots.clear(); this.particles.length = 0; this.wrecks.clear();
    this.aircraftBatches.dispose(); this.aircraftTracers.dispose(); this.aircraft.dispose();
    this.teamBandGeometry.dispose(); this.teamMaterials.friendly.dispose(); this.teamMaterials.enemy.dispose();
    this.sea.geometry.dispose(); this.seaMaterial.dispose(); this.sky.geometry.dispose(); (this.sky.material as ShaderMaterial).dispose();
    this.particleGeometry.dispose(); (this.points.material as ShaderMaterial).dispose(); this.renderer.dispose();
  }
}
