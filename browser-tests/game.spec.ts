import { test, expect, type Page } from '@playwright/test';

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
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('countdown');
  await page.evaluate(() => (window as any).__nusumidase.step(180));
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('playing');
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

test('home → countdown → flight → pause/settings discard → resume → capture → result → retry', async ({ page }) => {
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
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('roundReset');
  const resetTicks = await page.evaluate(() => (window as any).__nusumidase.state.playTicks);
  await page.evaluate(() => (window as any).__nusumidase.step(180));
  expect(await page.evaluate(() => (window as any).__nusumidase.state.playTicks)).toBe(resetTicks);
  await capture(page);
  await page.evaluate(() => (window as any).__nusumidase.step(180));
  await capture(page);
  await expect(page.locator('#result-title')).toHaveText('勝利');
  await expect(page.locator('#result-captures')).toHaveText('3 — 0');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('nusumidase-records-v1') ?? '{"latest":[]}').latest.length)).toBe(1);
  await page.locator('#retry').click();
  await expect(page.locator('#result')).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__nusumidase.state.phase)).toBe('countdown');
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
  await endAtTime(page, 2, 2);
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
      await page.evaluate(() => (window as any).__nusumidase.step(180));
    }
  }
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('nusumidase-records-v1')!).latest.length)).toBe(20);
  const completedRaw = await page.evaluate(() => localStorage.getItem('nusumidase-records-v1'));
  await page.locator('#retry').click();
  await page.evaluate(() => (window as any).__nusumidase.step(180));
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

test('three-point capture on the final tick wins before time adjudication', async ({ page }) => {
  const errors = await openReview(page);
  await startFlight(page);
  await page.evaluate(async () => {
    const h = (window as any).__nusumidase;
    const { MATCH_PLAY_TICKS } = await import('/src/mission.ts');
    h.state.playTicks = MATCH_PLAY_TICKS - 1;
    h.state.scores = { friendly: 2, enemy: 2 };
  });
  await capture(page);
  await expect(page.locator('#result-title')).toHaveText('勝利');
  await expect(page.locator('#result-reason')).toHaveText('3回のコア回収で決着');
  await expect(page.locator('#result-captures')).toHaveText('3 — 2');
  await expect(page.locator('#result-time')).toHaveText('12:00');
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
