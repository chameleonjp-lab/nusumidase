import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { platform, release } from 'node:os';

async function ready(page: Page, mode: 'normal' | 'easy' = 'easy') {
  await page.goto('/?review');
  await expect(page.locator('#start')).toBeEnabled({ timeout: 60000 });
  if (mode === 'normal') await page.locator('input[name="game-mode"][value="normal"]').check();
  await page.evaluate(() => {
    const h = (window as any).__nusumidase; h.manual(true); h.begin(); h.step(180);
  });
  await settle(page);
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
}

test('source camera and ten renderer slots stay stable through twenty retries', async ({ page }) => {
  await ready(page, 'normal');
  const initial = await page.evaluate(() => (window as any).__nusumidase.scene.diagnostics());
  expect(initial.planes).toBe(10); expect(initial.flags.bases).toBe(2); expect(initial.flags.cores).toBe(2);
  expect(initial.camera.fov).toBe(64); expect(initial.camera.near).toBe(.5); expect(initial.camera.far).toBe(22000);
  const cameraError = await page.evaluate(async () => {
    const h = (window as any).__nusumidase;
    const view = await import('/src/flight-view.ts' as string);
    const position = h.state.player.position.clone(), quaternion = h.state.player.quaternion.clone();
    view.getFlightCameraPose(h.state.player, h.state.mode, position, quaternion);
    return { position: position.distanceTo(h.scene.camera.position), rotation: quaternion.angleTo(h.scene.camera.quaternion) };
  });
  expect(cameraError.position).toBeLessThan(1e-9); expect(cameraError.rotation).toBeLessThan(1e-7);
  for (let iteration = 0; iteration < 20; iteration++) {
    await page.evaluate(() => { const h = (window as any).__nusumidase; h.begin(); h.step(180); });
    await settle(page);
  }
  const final = await page.evaluate(() => (window as any).__nusumidase.scene.diagnostics());
  expect(final.planes).toBe(10); expect(final.geometries).toBe(initial.geometries); expect(final.textures).toBe(initial.textures);
  expect(final.wrecks).toBe(0); expect(final.particles).toBe(0); expect(final.flags.carriedCores).toBe(0);
});

test('death freezes the camera and respawn resets it to the source pose', async ({ page }) => {
  await ready(page);
  const before = await page.evaluate(() => (window as any).__nusumidase.scene.diagnostics().camera);
  await page.evaluate(async () => {
    const h = (window as any).__nusumidase, state = h.state;
    const respawn = await import('/src/respawn.ts' as string);
    h.queueDamage( { matchId: state.matchId, roundEpoch: state.roundEpoch,
      tick: state.tick + 1, eventSeq: 90001, target: respawn.aircraftRef(state, state.player), amount: 100, cause: 'sea' });
    h.step(); state.player.quaternion.set(0, 1, 0, 0); h.render();
  });
  await settle(page);
  const dead = await page.evaluate(() => {
    const h = (window as any).__nusumidase;
    return { camera: h.scene.diagnostics().camera, lifecycle: h.state.player.lifecycle, tick: h.state.playTicks };
  });
  expect(dead.lifecycle).toBe('respawnPending'); expect(dead.camera).toEqual(before);
  await page.evaluate(() => (window as any).__nusumidase.step(480));
  await settle(page);
  const respawned = await page.evaluate(async () => {
    const h = (window as any).__nusumidase, view = await import('/src/flight-view.ts' as string);
    const position = h.state.player.position.clone(), quaternion = h.state.player.quaternion.clone();
    view.getFlightCameraPose(h.state.player, h.state.mode, position, quaternion);
    return { alive: h.state.player.lifecycle, generation: h.state.player.generation,
      position: position.distanceTo(h.scene.camera.position), rotation: quaternion.angleTo(h.scene.camera.quaternion),
      wrecks: h.scene.diagnostics().wrecks };
  });
  expect(respawned.alive).toBe('active'); expect(respawned.generation).toBe(2);
  expect(respawned.position).toBeLessThan(1e-9); expect(respawned.rotation).toBeLessThan(1e-7); expect(respawned.wrecks).toBe(0);
});

test('a carried core is one separate child visual and drops without resource growth', async ({ page }) => {
  await ready(page);
  const before = await page.evaluate(() => (window as any).__nusumidase.scene.diagnostics());
  await page.evaluate(async () => {
    const h = (window as any).__nusumidase, ref = await import('/src/respawn.ts' as string);
    h.state.flags.enemy = { flagId: 'core-B', homeTeam: 'enemy', roundEpoch: h.state.roundEpoch,
      revision: 1, state: 'carried', carrier: ref.aircraftRef(h.state, h.state.player) }; h.render();
  });
  await settle(page);
  expect(await page.evaluate(() => (window as any).__nusumidase.scene.diagnostics().flags.carriedCores)).toBe(1);
  await page.screenshot({ path: 'test-results/scene-carried.png' });
  await page.evaluate(() => {
    const h = (window as any).__nusumidase;
    h.state.flags.enemy = { flagId: 'core-B', homeTeam: 'enemy', roundEpoch: h.state.roundEpoch, revision: 2,
      state: 'dropped', position: h.state.player.position.clone().set(0, 200, 0), droppedAtPlayTick: h.state.playTicks,
      returnDuePlayTick: h.state.playTicks + 1800 }; h.render();
  });
  await settle(page);
  const dropped = await page.evaluate(() => (window as any).__nusumidase.scene.diagnostics());
  expect(dropped.flags.carriedCores).toBe(0); expect(dropped.flags.cores).toBe(2);
  expect(dropped.geometries).toBe(before.geometries); expect(dropped.textures).toBe(before.textures);
  await page.screenshot({ path: 'test-results/scene-dropped.png' });
});

test('render effects are bounded, expire at five seconds and clear on retry', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const h = (window as any).__nusumidase, state = h.state, refs = await import('/src/respawn.ts' as string);
    for (const plane of state.slots) { plane.health = 0; plane.lifecycle = 'respawnPending'; }
    const events = Array.from({ length: 100 }, (_, index) => {
      const plane = state.slots[index % 10];
      return { id: `${state.matchId}/${state.roundEpoch}/${state.tick}/${index + 100000}`, matchId: state.matchId,
        roundEpoch: state.roundEpoch, tick: state.tick, eventSeq: index + 100000, type: 'kill',
        position: plane.position.clone(), owner: plane.id, target: plane.id, targetRef: refs.aircraftRef(state, plane) };
    });
    h.scene.events(events, state.elapsed); h.render();
  });
  await settle(page);
  const loaded = await page.evaluate(() => (window as any).__nusumidase.scene.diagnostics());
  expect(loaded.particles).toBe(240); expect(loaded.wrecks).toBe(10);
  await page.evaluate(() => { const h = (window as any).__nusumidase; h.state.elapsed += 5.01; h.render(); });
  await settle(page);
  const expired = await page.evaluate(() => (window as any).__nusumidase.scene.diagnostics());
  expect(expired.particles).toBe(0); expect(expired.wrecks).toBe(0);
  await page.evaluate(() => { const h = (window as any).__nusumidase; h.begin(); h.step(180); });
  await settle(page);
  const reset = await page.evaluate(() => (window as any).__nusumidase.scene.diagnostics());
  expect(reset.particles).toBe(0); expect(reset.wrecks).toBe(0); expect(reset.planes).toBe(10);
});

test('context loss pauses all clocks and restored graphics requires explicit resume', async ({ page }) => {
  await ready(page);
  const available = await page.evaluate(() => {
    const h = (window as any).__nusumidase, extension = h.scene.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!extension) return false;
    (window as any).__sceneBeforeLoss = h.scene; (window as any).__lostGraphics = extension; extension.loseContext(); return true;
  });
  test.skip(!available, 'WEBGL_lose_context extension is unavailable in this browser');
  await expect(page.locator('#pause-screen')).toBeVisible();
  const clock = await page.evaluate(() => (window as any).__nusumidase.state.tick);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__nusumidase.state.tick)).toBe(clock);
  await page.evaluate(() => (window as any).__lostGraphics.restoreContext());
  await expect(page.locator('#resume')).toBeVisible({ timeout: 60000 });
  await page.waitForFunction(() => (window as any).__nusumidase.scene !== (window as any).__sceneBeforeLoss, undefined, { timeout: 60000 });
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('paused');
  await page.locator('#resume').click();
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('playing');
});

test('accelerated twelve effective minute renderer soak keeps resources bounded', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const wallStarted = performance.now(), capturedAt = new Date().toISOString();
  await ready(page);
  // A browser user gesture enables the actual audio adapter; simulation time
  // is still accelerated and is never represented as wall-clock sound/FPS.
  await page.locator('#game-sound').click();
  const environment = await page.evaluate(() => {
    const h = (window as any).__nusumidase, gl = h.scene.renderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio, seed: h.state.seed, mode: h.state.mode,
      webglVersion: gl.getParameter(gl.VERSION), vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      unmaskedRenderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
      audioEnabled: document.getElementById('game-sound')?.getAttribute('aria-pressed') === 'true' };
  });
  const sample = () => page.evaluate(() => {
    const h = (window as any).__nusumidase, diagnostic = h.scene.diagnostics();
    return { tick: h.state.tick, playTicks: h.state.playTicks, phase: h.state.phase,
      bullets: h.state.bullets.length, slots: h.state.slots.length, planes: diagnostic.planes,
      particles: diagnostic.particles, wrecks: diagnostic.wrecks,
      geometries: diagnostic.geometries, textures: diagnostic.textures,
      calls: diagnostic.calls, triangles: diagnostic.triangles, queue: diagnostic.queue,
      audioSources: h.metrics.audioSources, pauseReason: h.state.pauseReason };
  });
  const initial = await sample();
  const samples = [initial];
  // At most 43,200 playing ticks plus countdowns. The existing harness runs
  // normal simulation/event/audio code and renders after every 600-tick chunk.
  for (let chunk = 0; chunk < 75; chunk++) {
    if (samples.at(-1)!.phase === 'ended' || samples.at(-1)!.phase === 'paused') break;
    await page.evaluate(() => (window as any).__nusumidase.step(600));
    await settle(page);
    samples.push(await sample());
  }
  const terminal = await page.evaluate(() => {
    const h = (window as any).__nusumidase, result = h.state.result;
    return { phase: h.state.phase, playTicks: h.state.playTicks, result,
      frozenResult: !!result && Object.isFrozen(result) && Object.isFrozen(result.stats),
      frameTimes: h.metrics.frameTimes, updateTimes: h.metrics.updateTimes,
      recordEligible: h.state.recordEligible, pauseReason: h.state.pauseReason };
  });
  const sourceManifest = JSON.parse(readFileSync('docs/evidence/source-manifest.json', 'utf8'));
  const candidateFiles = ['index.html', 'package.json', 'package-lock.json',
    ...readdirSync('src').sort().map(name => `src/${name}`)];
  const sourceHashes = Object.fromEntries(candidateFiles.map(path =>
    [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
  const artifact = {
    schemaVersion: 1, kind: 'accelerated-effective-play-renderer-soak', capturedAt,
    project: testInfo.project.name, browserVersion: page.context().browser()?.version() ?? null,
    os: { platform: platform(), release: release() }, environment,
    sourceCommit: sourceManifest.commit,
    candidateBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    candidateContentHash: createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex'), sourceHashes,
    chunkTicks: 600, samples, wallSeconds: (performance.now() - wallStarted) / 1000,
    effectivePlaySeconds: terminal.playTicks / 60, terminal,
    limits: { planes: 10, bullets: 1024, particles: 240, wrecks: 10, audioEffectSources: 10 },
    measurementScope: 'Resource snapshots every 600 simulation ticks and browser rAF/CPU samples during accelerated stepping. This is not a twelve-minute wall-clock frame-rate or real-device performance result.',
  };
  mkdirSync('docs/evidence', { recursive: true });
  const artifactPath = `docs/evidence/browser-soak-${testInfo.project.name}.json`;
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  await testInfo.attach('accelerated-renderer-soak', { path: artifactPath, contentType: 'application/json' });
  for (const snapshot of samples) {
    expect(snapshot.phase, snapshot.pauseReason ?? undefined).not.toBe('paused');
    expect(snapshot.slots).toBe(10); expect(snapshot.planes).toBe(10);
    expect(snapshot.bullets).toBeLessThanOrEqual(1024); expect(snapshot.particles).toBeLessThanOrEqual(240);
    expect(snapshot.wrecks).toBeLessThanOrEqual(10); expect(snapshot.audioSources).toBeLessThanOrEqual(10);
    expect(snapshot.geometries).toBe(initial.geometries); expect(snapshot.textures).toBe(initial.textures);
    expect(snapshot.queue.failure).toBeNull();
  }
  expect(terminal.phase, terminal.pauseReason ?? undefined).toBe('ended');
  expect(terminal.playTicks).toBe(43200); expect(terminal.result?.reason).toBe('time');
  expect(terminal.frozenResult).toBe(true); expect(terminal.recordEligible).toBe(true);
});
