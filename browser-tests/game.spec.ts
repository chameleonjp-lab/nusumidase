import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

async function openReview(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.location().url.includes('/favicon.ico')) errors.push(message.text());
  });
  await page.goto('/?review');
  await expect(page.locator('#start')).toBeEnabled({ timeout: 60_000 });
  await page.evaluate(() => (window as any).__nusumidase.manual(true));
  return errors;
}
async function startFlight(page: Page): Promise<void> {
  await page.locator('input[name="game-mode"][value="normal"]').check();
  await page.locator('#start').click();
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('playing');
  expect(await page.evaluate(() => (window as any).__nusumidase.state.playTicks)).toBe(0);
}
/** Set a legal same-generation carried flag at the collection sphere; scoring still runs through the reducer. */
async function capture(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as any).__nusumidase, state = h.state;
    const { BASE_POSITIONS } = await import('/src/arena.ts');
    const { aircraftRef } = await import('/src/respawn.ts');
    state.player.position.copy(BASE_POSITIONS.friendly);
    state.player.previous.copy(BASE_POSITIONS.friendly);
    state.flags.enemy = { ...state.flags.enemy, state: 'carried', carrier: aircraftRef(state, state.player) };
    h.step();
  });
}
async function endAtTime(page: Page, friendly = 0, enemy = 0): Promise<void> {
  await page.evaluate(async ({ friendly, enemy }) => {
    const h = (window as any).__nusumidase;
    const { MATCH_PLAY_TICKS } = await import('/src/mission.ts');
    h.state.playTicks = MATCH_PLAY_TICKS - 1;
    h.state.scores = { friendly, enemy };
    h.step();
  }, { friendly, enemy });
  await expect(page.locator('#result')).toBeVisible();
  const id = await page.evaluate(() => (window as any).__nusumidase.state.result.matchId);
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('nusumidase-records-v1');
    return raw ? JSON.parse(raw).latest[0]?.completedMatchId : null;
  })).toBe(id);
}

test('home → immediate flight → pause/settings discard → resume → capture → result → immediate retry', async ({ page }) => {
  const errors = await openReview(page);
  await expect(page.locator('#home')).toBeVisible();
  await startFlight(page);
  await expect(page.locator('#timer')).toHaveText('12:00');
  const initial = await page.evaluate(() => {
    const s = (window as any).__nusumidase.state;
    return { matchId: s.matchId, position: s.player.position.toArray() };
  });
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => (window as any).__nusumidase.step());
  expect(await page.evaluate(() => (window as any).__nusumidase.state.player.position.toArray())).not.toEqual(initial.position);
  await page.locator('#pause').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  const paused = await page.evaluate(() => JSON.stringify((window as any).__nusumidase.state));
  await page.locator('#pause-controls').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await page.locator('#control-editor-touch').click();
  await page.locator('#control-target').selectOption('throttle');
  await page.locator('#control-x').press('Home');
  await page.locator('#control-x').press('ArrowRight');
  await page.locator('#control-cancel').click();
  await expect(page.locator('#control-settings')).not.toBeVisible();
  await expect(page.locator('#pause-screen')).toBeVisible();
  await expect(page.locator('#pause-controls')).toBeFocused();
  await page.evaluate(() => (window as any).__nusumidase.step(300));
  expect(await page.evaluate(() => JSON.stringify((window as any).__nusumidase.state))).toBe(paused);
  expect(await page.evaluate(() => localStorage.getItem('nusumidase-controls-v2'))).toBeNull();
  await page.locator('#resume').click();
  await expect(page.locator('#pause-screen')).not.toBeVisible();
  await capture(page);
  await expect(page.locator('#friendly-captures')).toHaveText('1');
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('ended');
  await expect(page.locator('#result-title')).toHaveText('勝利');
  await expect(page.locator('#result-captures')).toHaveText('1 — 0');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('nusumidase-records-v1') ?? '{"latest":[]}').latest.length)).toBe(1);
  await page.locator('#retry').click();
  await expect(page.locator('#result')).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('playing');
  expect(await page.evaluate(() => (window as any).__nusumidase.state.playTicks)).toBe(0);
  expect(await page.evaluate(() => (window as any).__nusumidase.state.matchId)).not.toBe(initial.matchId);
  expect(await page.evaluate(() => (window as any).__nusumidase.controls.sample().fire)).toBe(false);
  expect(errors).toEqual([]);
});

test('blur/pagehide pause all clocks, guide Escape preserves pause and returns focus', async ({ page }) => {
  const errors = await openReview(page);
  await startFlight(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#pause-screen')).toBeVisible();
  const before = await page.evaluate(() => JSON.stringify((window as any).__nusumidase.state));
  await page.locator('#pause-rules').click();
  await expect(page.locator('#rules-guide')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#rules-guide')).not.toBeVisible();
  await expect(page.locator('#pause-rules')).toBeFocused();
  await page.evaluate(() => (window as any).__nusumidase.step(600));
  expect(await page.evaluate(() => JSON.stringify((window as any).__nusumidase.state))).toBe(before);
  await page.locator('#resume').click();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator('#pause-screen')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('paused');
  expect(errors).toEqual([]);
});

test('time tie produces one frozen result and one completed record despite repeated callbacks', async ({ page }) => {
  const errors = await openReview(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    (window as any).__recordWrites = 0;
    Storage.prototype.setItem = function (key, raw) {
      if (key === 'nusumidase-records-v1') (window as any).__recordWrites++;
      return original.call(this, key, raw);
    };
  });
  // The spy is initialized through reload before the game is started.
  await page.reload();
  await expect(page.locator('#start')).toBeEnabled();
  await page.evaluate(() => (window as any).__nusumidase.manual(true));
  await startFlight(page);
  await endAtTime(page, 0, 0);
  await expect(page.locator('#result-title')).toHaveText('引分');
  await expect(page.locator('#result-time')).toHaveText('12:00');
  const report = await page.evaluate(() => {
    const h = (window as any).__nusumidase, result = h.state.result;
    const raw = JSON.stringify(result);
    const frozen = [result, result.captures, result.stats, result.stats.teamKills].every(Object.isFrozen);
    const changed = Reflect.set(result.stats, 'kills', 1000);
    h.step(100);
    return { raw, after: JSON.stringify(h.state.result), frozen, changed,
      records: JSON.parse(localStorage.getItem('nusumidase-records-v1')!).latest,
      writes: (window as any).__recordWrites };
  });
  expect(report.frozen).toBe(true);
  expect(report.changed).toBe(false);
  expect(report.after).toBe(report.raw);
  expect(report.records).toHaveLength(1);
  expect(report.records[0].completedMatchId).toBe(JSON.parse(report.raw).matchId);
  expect(report.writes).toBe(1);
  expect(errors).toEqual([]);
});

test('twenty retry results remain bounded, terminal identities survive reload and unfinished matches are not saved', async ({ page }) => {
  const errors = await openReview(page);
  await startFlight(page);
  const ids = new Set<string>();
  for (let index = 0; index < 21; index++) {
    await endAtTime(page, index % 2, 0);
    const id = await page.evaluate(() => (window as any).__nusumidase.state.result.matchId);
    expect(ids.has(id)).toBe(false);
    ids.add(id);
    if (index < 20) {
      await page.locator('#retry').click();
    }
  }
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('nusumidase-records-v1')!).latest.length)).toBe(20);
  const completedRaw = await page.evaluate(() => localStorage.getItem('nusumidase-records-v1'));
  await page.locator('#retry').click();
  await page.reload();
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#start')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('nusumidase-records-v1'))).toBe(completedRaw);
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('ready');
  await page.evaluate(() => (window as any).__nusumidase.manual(true));
  await startFlight(page);
  expect(ids.has(await page.evaluate(() => (window as any).__nusumidase.state.matchId))).toBe(false);
  await page.locator('#pause').click();
  await page.locator('#pause-home').click();
  await expect(page.locator('#home')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('nusumidase-records-v1'))).toBe(completedRaw);
  expect(errors).toEqual([]);
});

test('first capture on the final tick wins before time adjudication', async ({ page }) => {
  const errors = await openReview(page);
  await startFlight(page);
  await page.evaluate(async () => {
    const h = (window as any).__nusumidase;
    const { MATCH_PLAY_TICKS } = await import('/src/mission.ts');
    h.state.playTicks = MATCH_PLAY_TICKS - 1;
    h.state.scores = { friendly: 0, enemy: 0 };
  });
  await capture(page);
  await expect(page.locator('#result-title')).toHaveText('勝利');
  await expect(page.locator('#result-reason')).toHaveText('先に1個のコアを持ち帰って決着');
  await expect(page.locator('#result-captures')).toHaveText('1 — 0');
  await expect(page.locator('#result-time')).toHaveText('12:00');
  expect(errors).toEqual([]);
});

test('the core remains at its death point past thirty seconds and one return wins with own core absent', async ({ page }) => {
  const errors = await openReview(page);
  await expect(page.locator('#home')).toContainText('先に1つ自基地へ');
  await startFlight(page);
  const deathPoint = await page.evaluate(async () => {
    const h = (window as any).__nusumidase, state = h.state;
    const { aircraftRef } = await import('/src/respawn.ts');
    for (const plane of state.slots) if (plane !== state.player) plane.protectionUntilPlayTick = 10000;
    state.player.position.set(2300, 80, 1700); state.player.previous.copy(state.player.position);
    state.flags.enemy = { ...state.flags.enemy, state: 'carried', carrier: aircraftRef(state, state.player) };
    h.queueDamage({ matchId: state.matchId, roundEpoch: state.roundEpoch, tick: state.tick + 1, eventSeq: 999,
      target: aircraftRef(state, state.player), owner: aircraftRef(state, state.enemies[0]), amount: 80, cause: 'bullet' });
    h.step();
    return state.player.position.toArray();
  });
  await expect(page.locator('#enemy-flag')).toHaveText('撃破地点に留まる');
  await page.evaluate(() => (window as any).__nusumidase.step(1801));
  const dropped = await page.evaluate(() => {
    const state = (window as any).__nusumidase.state;
    return { phase: state.phase, flag: state.flags.enemy.state, corePosition: state.flags.enemy.position.toArray(),
      planePosition: state.player.position.toArray() };
  });
  expect(dropped.phase).toBe('playing'); expect(dropped.flag).toBe('dropped');
  expect(dropped.corePosition).toEqual(deathPoint); expect(dropped.planePosition).not.toEqual(deathPoint);
  await expect(page.locator('#enemy-flag')).toHaveText('撃破地点に留まる');
  await page.evaluate(async () => {
    const state = (window as any).__nusumidase.state;
    state.flags.friendly = { ...state.flags.friendly, state: 'dropped', position: state.player.position.clone().set(0, 300, 0), droppedAtPlayTick: state.playTicks };
  });
  await capture(page);
  await expect(page.locator('#result-title')).toHaveText('勝利');
  await expect(page.locator('#result-reason')).toHaveText('先に1個のコアを持ち帰って決着');
  await expect(page.locator('#result-captures')).toHaveText('1 — 0');
  expect(errors).toEqual([]);
});

test('player, ally and enemy cores stay visibly at each death point and can be picked up again there', async ({ page }) => {
  const errors = await openReview(page);
  await startFlight(page);
  for (const carrierIndex of [0, 1, 5]) {
    const dropped = await page.evaluate(async index => {
      const h = (window as any).__nusumidase; h.home(); h.begin();
      const state = h.state, carrier = state.slots[index], team = carrier.team === 'friendly' ? 'enemy' : 'friendly';
      const { aircraftRef } = await import('/src/respawn.ts');
      for (const plane of state.slots) if (plane !== carrier) plane.protectionUntilPlayTick = 10000;
      carrier.position.set(0, 400, 600); carrier.previous.copy(carrier.position);
      state.flags[team] = { ...state.flags[team], state: 'carried', carrier: aircraftRef(state, carrier) };
      if (!h.queueDamage({ matchId: state.matchId, roundEpoch: state.roundEpoch, tick: state.tick + 1,
        eventSeq: 90001, target: aircraftRef(state, carrier), amount: 80, cause: 'bullet' })) throw new Error('Death event rejected');
      h.step();
      return { team, point: carrier.position.toArray(), state: state.flags[team].state };
    }, carrierIndex);
    expect(dropped.state).toBe('dropped');
    await expect(page.locator(`#${dropped.team}-flag`)).toHaveText('撃破地点に留まる');
    await expect.poll(() => page.evaluate(team => {
      const flags = (window as any).__nusumidase.scene.diagnostics().flags;
      return { visible: flags.visibleCores, position: flags.corePositions[team] };
    }, dropped.team)).toEqual({ visible: 2, position: dropped.point });
    const secondDrop = await page.evaluate(async ({ team, point, carrierIndex }) => {
      const h = (window as any).__nusumidase, state = h.state;
      const { aircraftRef } = await import('/src/respawn.ts');
      const original = state.slots[carrierIndex], owner = state.slots.find((plane: any) => plane.team === team);
      owner.protectionUntilPlayTick = 0; owner.position.fromArray(point); owner.previous.copy(owner.position);
      h.step();
      if (state.flags[team].state !== 'dropped') throw new Error('Owner contact reset the core');
      owner.position.set(1200, 500, -900); owner.previous.copy(owner.position);
      const picker = state.slots.find((plane: any) => plane.team === original.team && plane !== original);
      picker.protectionUntilPlayTick = 0; picker.position.fromArray(point); picker.previous.copy(picker.position);
      h.step();
      if (state.flags[team].state !== 'carried' || state.flags[team].carrier.slotId !== picker.slotId) throw new Error('Pickup at death point failed');
      picker.position.set(300, 450, 700); picker.previous.copy(picker.position);
      if (!h.queueDamage({ matchId: state.matchId, roundEpoch: state.roundEpoch, tick: state.tick + 1,
        eventSeq: 90002, target: aircraftRef(state, picker), amount: 80, cause: 'bullet' })) throw new Error('Second death event rejected');
      h.step();
      return { point: picker.position.toArray(), state: state.flags[team].state };
    }, { ...dropped, carrierIndex });
    expect(secondDrop.state).toBe('dropped'); expect(secondDrop.point).not.toEqual(dropped.point);
    await expect.poll(() => page.evaluate(team => {
      const flags = (window as any).__nusumidase.scene.diagnostics().flags;
      return { visible: flags.visibleCores, position: flags.corePositions[team] };
    }, dropped.team)).toEqual({ visible: 2, position: secondDrop.point });
  }
  expect(errors).toEqual([]);
});

test('product frame adapter holds short edges through zero steps, caps catch-up and pauses backlog', async ({ page }) => {
  const errors = await openReview(page);
  await startFlight(page);
  const initial = await page.evaluate(() => (window as any).__nusumidase.state.playTicks);
  await page.keyboard.press('l');
  await page.evaluate(() => (window as any).__nusumidase.frame(1 / 120));
  expect(await page.evaluate(() => (window as any).__nusumidase.state.playTicks)).toBe(initial);
  expect(await page.evaluate(() => (window as any).__nusumidase.controls.sample().loop)).toBe(true);
  await page.evaluate(() => (window as any).__nusumidase.frame(1 / 120));
  expect(await page.evaluate(() => (window as any).__nusumidase.state.playTicks)).toBe(initial + 1);
  expect(await page.evaluate(() => (window as any).__nusumidase.controls.sample().loop)).toBe(false);
  await page.evaluate(() => (window as any).__nusumidase.frame(0.1));
  expect(await page.evaluate(() => (window as any).__nusumidase.state.playTicks)).toBe(initial + 6);
  const beforeBacklog = await page.evaluate(() => (window as any).__nusumidase.state.playTicks);
  await page.evaluate(() => (window as any).__nusumidase.frame(0.3));
  await expect(page.locator('#pause-screen')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__nusumidase.state.playTicks)).toBe(beforeBacklog);
  await expect(page.locator('#pause-reason')).toContainText('描画が遅れた');
  expect(errors).toEqual([]);
});

test('ally respawn and live warnings update on change; simultaneous capture precedes the final-minute notice', async ({ page }) => {
  const errors = await openReview(page);
  await startFlight(page);
  await page.evaluate(async () => {
    const h=(window as any).__nusumidase, state=h.state;
    const { aircraftRef }=await import('/src/respawn.ts');
    h.queueDamage({matchId:state.matchId,roundEpoch:state.roundEpoch,tick:state.tick+1,eventSeq:99991,
      target:aircraftRef(state,state.allies[0]),amount:100,cause:'sea'});
    h.step();state.player.position.y=50;h.render();
  });
  await expect(page.locator('#ally-announcements')).toHaveText('僚機1機が復活待ち · 最短8秒');
  await expect(page.locator('#warning')).toContainText('低空注意');
  const mutations=await page.evaluate(() => {
    const observer=new MutationObserver(()=>{});
    for(const id of ['warning','lifecycle-status','ally-announcements'])observer.observe(document.getElementById(id)!,{childList:true,subtree:true,characterData:true});
    for(let i=0;i<10;i++)(window as any).__nusumidase.render();
    const count=observer.takeRecords().length;observer.disconnect();return count;
  });
  expect(mutations).toBe(0);
  await page.evaluate(() => { const h=(window as any).__nusumidase;h.state.playTicks=39599; });
  await capture(page);
  await expect(page.locator('#announcement')).toHaveText('自軍がコアを回収 · 残り60秒');
  expect(errors).toEqual([]);
});

// New focused cases are explicitly selected by their CI step, so the existing
// browser inventory and historical evidence paths remain unchanged.
if (process.env.CAMERA_CONTROLS_ONLY === '1') {
const cameraSourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
// These bounded display ablations are explicitly selected only by a non-gating
// diagnostic step. Acceptance always uses 'none' with the complete product.
const renderDiagnostic=process.env.CAMERA_RENDER_DIAGNOSTIC??'none';
if(!['none','full','canvas-off','hud-off','both-off'].includes(renderDiagnostic))throw new Error('Unknown render diagnostic');
const cameraTest = test.extend({ screenshot: 'off' as const, trace: 'off' as const });
for (const mode of ['normal', 'easy'] as const) for (const viewport of [
  {width:393,height:852},{width:393,height:648},{width:568,height:320},{width:852,height:393},{width:1280,height:720},
]) cameraTest(`@camera-controls live ${mode} ${viewport.width}x${viewport.height}`, async ({page}) => {
  await page.setViewportSize(viewport);await page.goto('/?review');
  await expect(page.locator('#start')).toBeEnabled();
  let startupReadiness:any=null;
  try{
  // Observe only real render submissions. A pending GPU fence deliberately lets
  // simulation advance without updating the camera, so an arbitrary rAF's live
  // state is not the state that produced the currently submitted view.
  await page.evaluate(async(renderDiagnostic)=>{
    const view=await import('/src/flight-view.ts'),gun=await import('/src/gun-sight.ts');
    const h=(window as any).__nusumidase,scene=h.scene,original=scene.render;
    const originalPoll=scene.pollRender,originalWebGL=scene.renderer.render,originalOverlay=scene.drawOverlay;
    const gl=scene.renderer.getContext(),debugRenderer=gl.getExtension('WEBGL_debug_renderer_info');
    const hideCanvas=renderDiagnostic==='canvas-off'||renderDiagnostic==='both-off';
    const hideHUD=renderDiagnostic==='hud-off'||renderDiagnostic==='both-off';
    const hud=document.querySelector<HTMLElement>('#hud')!;
    const oldDisplay=hud.style.getPropertyValue('display'),oldPriority=hud.style.getPropertyPriority('display');
    const hadStyleAttribute=hud.hasAttribute('style');
    const restoreHUD=()=>{
      if(!hideHUD)return;
      if(oldDisplay)hud.style.setProperty('display',oldDisplay,oldPriority);else hud.style.removeProperty('display');
      if(!hadStyleAttribute&&!hud.getAttribute('style'))hud.removeAttribute('style');
    };
    const observation={sequence:0,samples:[] as any[],readyFrame:null as any,frameSamples:[] as any[],firstPause:null as any,
      backend:{vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),
        unmaskedRenderer:debugRenderer?gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL):null},
      maxObservationMs:0,maxOriginalRenderMs:0,maxWebGLMs:0,maxOverlayMs:0,
      restore:()=>{scene.render=original;scene.pollRender=originalPoll;scene.renderer.render=originalWebGL;scene.drawOverlay=originalOverlay;restoreHUD();}};
    (window as any).__cameraObservation=observation;
    let lastFrameTime:number|null=null,currentFrame:any=null;
    const capturePause=()=>{
      if(h.state.phase!=='paused'||observation.firstPause!==null)return;
      const metrics=h.metrics;
      observation.firstPause={tick:h.state.tick,reason:h.state.pauseReason,queue:scene.diagnostics().queue,
        frames:observation.frameSamples.map(frame=>({...frame})),
        frameTimes:metrics.frameTimes.slice(-32),updateTimes:metrics.updateTimes.slice(-32)};
    };
    // The explicit timestamp identifies the product's rAF poll. The nested
    // render() poll has no argument and must not count as another frame.
    // rawRafDeltaMs is not advance(dt): begin/setScreen reset lastFrame to 0,
    // so the first playing frame has effective dt=0 despite a nonzero raw gap.
    scene.pollRender=function(...args:any[]){
      // Capture even when the previous frame paused and returned before render,
      // including a failed/stalled fence or a pause while submission is pending.
      if(typeof args[0]==='number')capturePause();
      const before=performance.now(),result=originalPoll.apply(this,args);
      if(typeof args[0]==='number'){
        currentFrame={nowMs:args[0],rawRafDeltaMs:lastFrameTime===null?null:args[0]-lastFrameTime,
          tickBefore:h.state.tick,phaseBefore:h.state.phase,matchId:h.state.matchId,screen:h.screen,status:result,pollMs:performance.now()-before};
        lastFrameTime=args[0];observation.frameSamples.push(currentFrame);
        if(observation.frameSamples.length>32)observation.frameSamples.shift();
      }
      return result;
    };
    scene.renderer.render=function(...args:any[]){
      const before=performance.now();try{return originalWebGL.apply(this,args);}finally{
        const ms=performance.now()-before;observation.maxWebGLMs=Math.max(observation.maxWebGLMs,ms);
        if(currentFrame)currentFrame.webGLMs=ms;
      }
    };
    scene.drawOverlay=function(...args:any[]){
      const before=performance.now();try{if(!hideCanvas)return originalOverlay.apply(this,args);}finally{
        const ms=performance.now()-before;observation.maxOverlayMs=Math.max(observation.maxOverlayMs,ms);
        if(currentFrame)currentFrame.overlayMs=ms;
      }
    };
    scene.render=function(...args:any[]){
      const observationStart=performance.now();
      const state=args[0],p={...state.player,position:state.player.position.clone(),quaternion:state.player.quaternion.clone()};
      const tick=state.tick,phase=state.phase,mode=state.mode,matchId=state.matchId,inputEpoch=state.inputEpoch;
      const renderStart=performance.now();
      const submitted=original.apply(this,args); // Exactly once, with untouched arguments.
      const renderEnd=performance.now();
      if(currentFrame)Object.assign(currentFrame,{tickRendered:tick,phaseRendered:phase,renderMs:renderEnd-renderStart});
      capturePause();
      if(submitted&&phase==='ready'&&observation.readyFrame?.matchId!==matchId){
        const diagnostics=this.diagnostics();
        const queue=diagnostics.queue;
        observation.readyFrame={matchId,mode,submittedCount:queue.submittedCount,submissionQueue:queue,
          validFence:queue.failure===null&&queue.status==='pending'&&queue.submittedCount>queue.completedCount};
      }
      if(submitted&&phase==='playing'){
        const c=this.camera,diagnostics=this.diagnostics(),position=p.position.clone(),rotation=p.quaternion.clone();
        view.getFlightCameraPose(p,mode,position,rotation);
        const point=p.position.clone().set(0,0,-504.5).applyQuaternion(p.quaternion).add(p.position),ndc=point.clone().project(c);
        const sight=gun.projectGunSight(p,[],diagnostics.width,diagnostics.height);
        const actual=c.quaternion.toArray(),expected=rotation.toArray();
        const rotationError=Math.min(...[1,-1].map(sign=>Math.max(...actual.map((value:number,index:number)=>Math.abs(value-sign*expected[index])))));
        observation.samples.push({sequence:++observation.sequence,tick,phase,mode,matchId,inputEpoch,generation:p.generation,
          pitch:p.pitch,yaw:p.yaw,positionError:position.distanceTo(c.position),rotationError,
          sightPixelError:Math.max(Math.abs(sight.x-(.5+.5*ndc.x)*diagnostics.width),Math.abs(sight.y-(.5-.5*ndc.y)*diagnostics.height)),
          calls:diagnostics.calls,queue:diagnostics.queue,camera:actual});
        if(observation.samples.length>32)observation.samples.shift();
      }
      observation.maxObservationMs=Math.max(observation.maxObservationMs,renderStart-observationStart+performance.now()-renderEnd);
      observation.maxOriginalRenderMs=Math.max(observation.maxOriginalRenderMs,renderEnd-renderStart);
      return submitted;
    };
    if(hideHUD)hud.style.setProperty('display','none','important');
  },renderDiagnostic);
  const live=()=>page.evaluate(()=>{
    const h=(window as any).__nusumidase,o=(window as any).__cameraObservation;
    return {tick:h.state.tick,phase:h.state.phase,pauseReason:h.state.pauseReason,sequence:o.sequence,queue:h.scene.diagnostics().queue};
  });
  const next=async(afterTick:number,afterSequence:number,limits:{yawBefore?:number;maxYawDelta?:number}={})=>{
    const handle=await page.waitForFunction(({afterTick,afterSequence,limits})=>{
      const h=(window as any).__nusumidase,o=(window as any).__cameraObservation,s=o.samples.at(-1);
      if(h.state.phase==='paused')throw new Error(JSON.stringify({reason:h.state.pauseReason,tick:h.state.tick,queue:h.scene.diagnostics().queue}));
      if(!s||s.phase!=='playing'||s.tick<=afterTick||s.sequence<=afterSequence)return false;
      if(limits.yawBefore!==undefined&&limits.maxYawDelta!==undefined){
        const delta=Math.atan2(Math.sin(s.yaw-limits.yawBefore),Math.cos(s.yaw-limits.yawBefore));
        if(delta>=limits.maxYawDelta)return false;
      }
      return s;
    },{afterTick,afterSequence,limits},{timeout:10000,polling:'raf'});
    try{return await handle.jsonValue();}finally{await handle.dispose();}
  };
    await page.locator(`input[name="game-mode"][value="${mode}"]`).check();
    // Mode selection creates a new ready-state scene. Start only after its first
    // real submitted frame completes, rather than carrying shader/upload work
    // from an earlier mode into the active-flight clock. No extra render call.
    const readyFrame=await page.waitForFunction(mode=>{
      const h=(window as any).__nusumidase,o=(window as any).__cameraObservation,r=o.readyFrame;
      if(h.state.phase!=='ready'||h.state.mode!==mode||!r||r.matchId!==h.state.matchId||r.mode!==mode)return false;
      const queue=h.scene.diagnostics().queue;
      if(!r.validFence||queue.failure!==null||queue.status==='failed'||queue.status==='stalled')
        throw new Error(JSON.stringify({reason:'Selected-mode ready frame did not have a healthy fence',readyFrame:r,queue}));
      return queue.completedCount>=r.submittedCount?{...r,queue}:false;
    },mode,{timeout:10000,polling:'raf'});
    try{startupReadiness=await readyFrame.jsonValue();}finally{await readyFrame.dispose();}
    await page.locator('#start').click();
    await page.locator('#flight').focus();const initial=await next(2,0);
    await page.keyboard.down('ArrowUp');
    // Release the short climb on real simulation progress, not on a potentially
    // slow GPU submission; observation must not prolong the pilot's input.
    const climb=await page.waitForFunction(({tick,pitch})=>{
      const h=(window as any).__nusumidase;
      if(h.state.phase==='paused')throw new Error(JSON.stringify({reason:h.state.pauseReason,tick:h.state.tick,queue:h.scene.diagnostics().queue}));
      return h.state.tick>tick&&h.state.player.pitch>pitch+.03;
    },{tick:initial.tick,pitch:initial.pitch},{timeout:10000,polling:'raf'});
    await climb.dispose();
    await page.keyboard.down('ArrowRight');await page.keyboard.up('ArrowUp');
    // Both a strictly later product tick and a later submitted frame are needed
    // after keyup; never compare a pre-keyup cached observation to held input.
    const released=await live();const turning=await next(released.tick,released.sequence,{yawBefore:initial.yaw,maxYawDelta:-.015});
    const held=await next(turning.tick+8,turning.sequence);
    expect(held.matchId).toBe(initial.matchId);expect(held.generation).toBe(initial.generation);expect(held.phase).toBe('playing');
    expect(held.pitch).toBeCloseTo(turning.pitch,10);
    // The product normalizes yaw at ±π; compare the signed turn across that seam.
    const heldYawDelta=Math.atan2(Math.sin(held.yaw-turning.yaw),Math.cos(held.yaw-turning.yaw));
    expect(heldYawDelta).toBeLessThan(0);expect(held.calls).toBeGreaterThan(0);
    const samples=await page.evaluate(()=>(window as any).__cameraObservation.samples);
    for(const sample of samples){
      expect(sample.positionError).toBeLessThan(1e-9);expect(sample.rotationError).toBeLessThan(1e-12);
      if(mode==='normal')expect(sample.sightPixelError).toBeLessThan(1e-8);
    }
    expect((await live()).phase).toBe('playing');await page.keyboard.up('ArrowRight');
    // Display ablations compare only the same active-flight input sequence;
    // hidden UI cannot establish pause/settings acceptance. The mandatory run
    // has no ablation and always executes all assertions below.
    if(renderDiagnostic!=='none')return;
    await page.locator('#pause').click({timeout:5000});const paused=await live();
    expect(paused.phase).toBe('paused');expect(paused.pauseReason).toBe('時計・復活・装填も停止しています');
    await page.locator('#pause-controls').click();await page.locator('#control-cancel').click();
    expect((await live()).phase).toBe('paused');expect((await live()).tick).toBe(paused.tick);
  }finally{
    if(!page.isClosed()){
      const evidence=await page.evaluate(()=>{
        const o=(window as any).__cameraObservation,h=(window as any).__nusumidase;
        if(!o)return {observationUnavailable:true};
        o.restore();const metrics=h.metrics;
        return {observedFrames:o.sequence,maxObservationMs:o.maxObservationMs,maxOriginalRenderMs:o.maxOriginalRenderMs,
          maxWebGLMs:o.maxWebGLMs,maxOverlayMs:o.maxOverlayMs,backend:o.backend,firstPause:o.firstPause,
          frameSamples:o.frameSamples,frameTimes:metrics.frameTimes.slice(-32),updateTimes:metrics.updateTimes.slice(-32),
          lastSamples:o.samples.slice(-4),live:{phase:h.state.phase,tick:h.state.tick,pauseReason:h.state.pauseReason,queue:h.scene.diagnostics().queue}};
      });
      console.log(JSON.stringify({sourceCommit:cameraSourceCommit,renderDiagnostic,acceptanceRun:renderDiagnostic==='none',mode,viewport,startupReadiness,...evidence}));
    }
  }
});
}
