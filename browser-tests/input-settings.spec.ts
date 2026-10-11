import { test, expect, type Page } from '@playwright/test';

type HarnessWindow = Window & { __nusumidase: any };
async function setup(page: Page, mode: 'normal' | 'easy' = 'normal') {
  await page.goto('/?review');
  await expect(page.locator('#start')).toBeEnabled({timeout:60000});
  await page.evaluate(() => (window as HarnessWindow).__nusumidase.manual());
  await page.locator(`input[name="game-mode"][value="${mode}"]`).check();
  await page.locator('#start').click();
  await page.evaluate(() => (window as HarnessWindow).__nusumidase.step(180));
  await expect.poll(() => page.evaluate(() => (window as HarnessWindow).__nusumidase.state.phase)).toBe('playing');
  await page.locator('#flight').focus();
}
async function target(page: Page) {
  return page.evaluate(() => (window as HarnessWindow).__nusumidase.targetSpeed);
}
async function tick(page: Page, count = 1) { await page.evaluate(n => (window as HarnessWindow).__nusumidase.step(n), count); }
async function touchPresentation(page: Page) { await page.evaluate(() => { document.getElementById('app')!.dataset.input = 'touch'; }); }

test('short key input survives sampling without steps, then changes target once across catch-up ticks', async ({ page }) => {
  await setup(page);
  await page.keyboard.down('w'); await page.keyboard.up('w');
  const samples = await page.evaluate(() => {
    const controls = (window as HarnessWindow).__nusumidase.controls;
    return [controls.sample(), controls.sample()];
  });
  expect(samples[0].throttle).toBe(1); expect(samples[1]).toEqual(samples[0]); expect(await target(page)).toBe(110);
  await tick(page, 5); expect(await target(page)).toBeCloseTo(110.3, 7);
  await tick(page, 5); expect(await target(page)).toBeCloseTo(110.3, 7);
  await page.keyboard.down('w'); await tick(page, 60); await page.keyboard.up('w');
  expect(await target(page)).toBeCloseTo(128.3, 7);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  expect(await page.evaluate(() => (window as HarnessWindow).__nusumidase.controls.sample().throttle)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).not.toBeVisible();
  await expect(page.locator('#flight')).toBeFocused();
  // A fresh press after resume must work on the first tick, without a neutral pre-step.
  await page.keyboard.down('w'); await tick(page);
  expect(await target(page)).toBeCloseTo(128.6, 7);
  await tick(page, 10); await page.keyboard.up('w');
  expect(await target(page)).toBeCloseTo(131.6, 7);
});

test('Easy ignores manual throttle and fire, retains six key actions and one touch control', async ({ page }) => {
  await setup(page, 'easy');
  await page.keyboard.down('w'); await page.keyboard.down('Space'); await tick(page, 60);
  await page.keyboard.up('w'); await page.keyboard.up('Space');
  expect(await target(page)).toBe(110);
  await touchPresentation(page);
  await expect(page.locator('#throttle')).toBeHidden(); await expect(page.locator('#fire')).toBeHidden();
  await expect(page.locator('#loop')).toBeVisible();
  const guide=await page.locator('#keyboard-guide').textContent(); expect(guide?.split(' · ').length).toBe(6);
});

test('focused slider combines pointer + focused positive - brake once and clears only focused keys', async ({ page }) => {
  await setup(page); await touchPresentation(page);
  await page.locator('#throttle').focus();
  const box = await page.locator('#throttle').boundingBox(); expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width/2, box!.y + 22); await page.mouse.down();
  await page.keyboard.down('ArrowUp'); await page.keyboard.down('s');
  const input=await page.evaluate(() => (window as HarnessWindow).__nusumidase.controls.sample());
  expect(input.throttle).toBe(1); await expect(page.locator('#throttle')).toBeVisible();
  await tick(page); expect(await target(page)).toBeCloseTo(110.3, 7);
  await page.keyboard.up('ArrowUp'); await page.keyboard.up('s'); await page.mouse.up();
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow','0');
  await page.evaluate(() => (window as HarnessWindow).__nusumidase.controls.clear());
  await tick(page); expect(await target(page)).toBeCloseTo(110.3, 7);
});

for (const viewport of [{width:320,height:568},{width:393,height:852},{width:568,height:320},{width:852,height:393}]) {
  test(`live/preview lever uses the same safe rectangle at ${viewport.width}x${viewport.height}, including 200% text`, async ({page}) => {
    await page.setViewportSize(viewport); await setup(page); await touchPresentation(page);
    const live=await page.locator('#throttle').boundingBox(); expect(live).not.toBeNull();
    expect(live!.width).toBeGreaterThanOrEqual(44); expect(live!.height).toBeCloseTo(live!.width*2,2);
    expect(live!.x).toBeGreaterThanOrEqual(0); expect(live!.y).toBeGreaterThanOrEqual(0);
    expect(live!.x+live!.width).toBeLessThanOrEqual(viewport.width); expect(live!.y+live!.height).toBeLessThanOrEqual(viewport.height);
    const peers=await page.locator('#fire, #loop, #pause, #game-sound').evaluateAll(elements => elements.map(el => {const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
    for(const peer of peers) expect(live!.x+live!.width<=peer.x||peer.x+peer.width<=live!.x||live!.y+live!.height<=peer.y||peer.y+peer.height<=live!.y).toBeTruthy();
    await page.evaluate(() => (window as HarnessWindow).__nusumidase.pause());
    await page.locator('#pause-controls').click(); await page.locator('#control-editor-touch').click();
    const geometries=await page.evaluate(() => {
      const live=document.getElementById('throttle')!,preview=document.querySelector<HTMLElement>('[data-control="throttle"]')!,app=document.getElementById('app')!,area=document.getElementById('control-preview')!;
      // Match the editor's unscaled CSS design space; offset widths intentionally
      // exclude zoom/transforms and round fractional layout boxes.
      const scale=area.offsetWidth/app.offsetWidth;
      return {liveW:parseFloat(live.style.getPropertyValue('--control-size')),liveH:parseFloat(live.style.getPropertyValue('--control-height')),previewW:preview.getBoundingClientRect().width/scale,previewH:preview.getBoundingClientRect().height/scale};
    });
    expect(geometries.previewW).toBeCloseTo(geometries.liveW,1); expect(geometries.previewH).toBeCloseTo(geometries.liveH,1);
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    await expect(page.locator('#control-save')).toBeInViewport(); await expect(page.locator('#control-close')).toBeInViewport();
    await page.locator('#control-cancel').click();
    await expect(page.locator('#pause-screen')).toBeVisible(); await expect(page.locator('#pause-controls')).toBeFocused();
  });
}

test('settings Cancel writes zero, Save commits all owned values, future raw stays intact with explicit session use', async ({page}) => {
  await page.goto('/?review');await expect(page.locator('#start')).toBeEnabled({timeout:60000});
  await page.evaluate(()=>localStorage.clear());
  await page.locator('#home-controls').click();await page.locator('#control-editor-touch').click();
  await page.locator('#control-x').focus(); await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft');await page.locator('#control-cancel').click();
  expect(await page.evaluate(()=>localStorage.length)).toBe(0);
  await page.locator('#home-controls').click();await page.locator('#control-editor-touch').click();
  await page.locator('#control-x').focus(); await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft');await page.locator('#control-save').click();await expect(page.locator('#control-settings')).not.toBeVisible();
  const keys=await page.evaluate(()=>Object.keys(localStorage).sort());
  expect(keys).toEqual(['nusumidase-controls-easy-v2','nusumidase-controls-v2','nusumidase-keyboard-v1','nusumidase-transaction-v1']);
  const future='{"version":99,"controls":{"private":"preserve"}}';
  await page.evaluate(raw=>localStorage.setItem('nusumidase-controls-v2',raw),future);
  await page.reload();await expect(page.locator('#start')).toBeEnabled({timeout:60000});
  await page.locator('#home-controls').click();await page.locator('#control-save').click();
  await expect(page.locator('#control-settings')).toBeVisible();await expect(page.locator('#control-storage-note')).toContainText('未知');
  await expect(page.locator('#control-save')).toHaveText('今回だけ使う');await page.locator('#control-save').click();
  await expect(page.locator('#control-settings')).not.toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('nusumidase-controls-v2'))).toBe(future);
});
