import './style.css';
import './control-settings.css';
import { createGame, startGame, pauseGame, resumeGame, stepFixed, getPlayerTargetSpeed, acknowledgeInputReset, queueDamageEvent } from './simulation';
import { FIXED_DT, MATCH_PLAY_TICKS, LOW_ALTITUDE_WARNING, MAX_ACCUMULATOR, MAX_STEPS_PER_FRAME, RULES_VERSION } from './mission';
import { FlightControls } from './input';
import { ControlSettings } from './control-settings';
import { KeyboardSettings, ControlInputPresentation, isKeyboardEditingTarget, keyboardEventHasShortcutModifier } from './keyboard-settings';
import { RulesGuide } from './rules-guide';
import { NusumidaseScene } from './scene';
import { FlightAudio } from './audio';
import { RecordsService, recordGroup } from './records';
import { carriedFlagFor, getFlagPosition } from './flags';
import { BASE_POSITIONS, boundaryWarning } from './arena';
import { isAlive, isProtected } from './respawn';
import type { GameMode, GameState, GameEvent, Team } from './types';

function el<T extends HTMLElement = HTMLElement>(id: string): T { const node = document.getElementById(id); if (!node) throw new Error(`Missing UI: ${id}`); return node as T; }
function setStatusText(id: string, text: string) { const node=el(id); if(node.textContent!==text)node.textContent=text; }
const app = el('app'), canvas = el<HTMLCanvasElement>('flight'), overlay = el<HTMLCanvasElement>('markers');
const abort = new AbortController(), signal = abort.signal;
let selectedMode: GameMode = 'easy', state = createGame(undefined, selectedMode);
let screen: 'home'|'playing'|'paused'|'result' = 'home', scene: NusumidaseScene | null = null;
let ready = false, contextLost = false, disposed = false, frameId = 0, lastFrame = 0, accumulator = 0, graphicsEpoch = 0;
let notificationUntilTick = 0, lastInputEpoch = state.inputEpoch, lastResultId = '', manualHarness = false;
const frameTimes: number[] = [], updateTimes: number[] = [];
const audio = new FlightAudio(); audio.enabled = false;
let lastAudioActive: boolean|null = null, lastAudioEnabled: boolean|null = null;
const records = new RecordsService();
const buttons = { fire:el<HTMLButtonElement>('fire'), loop:el<HTMLButtonElement>('loop'), throttle:el('throttle') };
for (const button of Object.values(buttons)) button.dataset.flightControl = 'true';
const keyboard = new KeyboardSettings(), presentation = new ControlInputPresentation();
const settings = new ControlSettings(buttons, keyboard, presentation);
let rules: RulesGuide;
const controls = new FlightControls(canvas, buttons, () => screen === 'playing' && state.phase === 'playing' && isAlive(state.player) && !settings.isOpen && !rules?.isOpen, keyboard);
function clearInput() { controls.clear(); if(acknowledgeInputReset(state,state.inputEpoch))lastInputEpoch=state.inputEpoch; }
rules = new RulesGuide(() => ({mode:state.mode,input:presentation.value,keyboardDescription:keyboard.describe(state.mode)}), () => clearInput());
function modeName(mode: GameMode) { return mode === 'easy' ? 'イージー' : 'ノーマル'; }
function formatTime(ticks: number) { const secs = Math.ceil(Math.max(0,ticks)/60); return `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`; }
function instructions() {
  app.dataset.input = presentation.value;
  el('flight-tip').textContent = presentation.value === 'touch' ? 'ドラッグで操縦' : 'キーで操縦';
  el('input-guide').textContent = presentation.value === 'touch' ? '画面をドラッグして操縦' : 'キーボードで操縦';
  el('mode-guide').textContent = state.mode === 'easy' ? '自動巡航 · 照準円内の敵機へ自動射撃' : '手動射撃 · 速度レバーを離すと調整した速度を保持';
  el('keyboard-guide').hidden = presentation.value === 'touch'; el('keyboard-guide').textContent = keyboard.describe(state.mode);
}
function syncMode() { app.dataset.mode = state.mode; controls.setMode(state.mode); settings.setActiveMode(state.mode); el('normal-controls').hidden = state.mode !== 'normal'; el('hud-mode').textContent = modeName(state.mode); el('result-mode').textContent = modeName(state.mode); instructions(); showBest(); }
const unsubKeyboard = keyboard.subscribe(() => { clearInput(); instructions(); });
const unsubPresentation = presentation.subscribe(instructions);
function showBest() { const best = records.load().best[recordGroup(state.mode,RULES_VERSION)]; el('best-record').textContent = best ? `この端末の最高記録 ${best.captures.friendly} — ${best.captures.enemy}` : ''; }
function setScreen(next: typeof screen) {
  settings.close(); rules.close(); clearInput(); screen = next; app.dataset.screen = next;
  el('home').hidden = next !== 'home'; el('hud').hidden = next === 'home' || next === 'result'; el('pause-screen').hidden = next !== 'paused'; el('result').hidden = next !== 'result';
  if(next==='home'&&contextLost){el('startup-error').hidden=false;el('startup-error').textContent='描画が中断されました。復帰を待つか、再読み込みしてください';el('reload').hidden=false;}
  accumulator = 0; lastFrame = 0; const id = next === 'home' ? contextLost?'reload':'start' : next === 'paused' ? 'resume' : next === 'result' ? 'retry' : 'flight';
  el(id).focus({preventScroll:true}); syncAudio(true);
}
function announce(text: string, ticks = 180) { el('announcement').textContent = text; notificationUntilTick = state.tick + ticks; }
function syncAudio(force=false) { audio.active = screen === 'playing' && state.phase === 'playing' && isAlive(state.player) && !document.hidden && !contextLost; if(force||lastAudioActive!==audio.active||lastAudioEnabled!==audio.enabled){audio.sync();lastAudioActive=audio.active;lastAudioEnabled=audio.enabled;} for (const id of ['home-sound','game-sound']) { el(id).setAttribute('aria-pressed',String(audio.enabled)); el(id).setAttribute('aria-label',audio.enabled?'音をオフにする':'音をオンにする'); } el('home-sound').textContent = audio.enabled?'音をオフにする':'音をオンにする'; el('game-sound').textContent=audio.enabled?'音 ON':'音 OFF'; }
async function toggleAudio() { audio.enabled=!audio.enabled; if(audio.enabled) await audio.unlock(); syncAudio(); if(audio.failed) announce('音を再生できません'); }
for (const id of ['home-sound','game-sound']) el(id).addEventListener('click',()=>void toggleAudio(),{signal});
function begin() {
  if (!ready || contextLost || disposed || (screen === 'playing' && state.phase === 'countdown')) return;
  clearInput(); audio.resetFlight(); state = createGame(undefined, selectedMode); startGame(state); lastInputEpoch=state.inputEpoch; lastResultId=''; el<HTMLButtonElement>('resume').disabled=false; notificationUntilTick=0; el('announcement').textContent=''; syncMode(); setScreen('playing'); updateHUD(); if(audio.enabled) void audio.unlock();
}
function pause(reason = '時計・復活・装填も停止しています') { if(screen !== 'playing')return; el<HTMLButtonElement>('resume').disabled=!state.recordEligible; pauseGame(state,reason); clearInput(); el('pause-reason').textContent=reason; setScreen('paused'); }
function resume() { if(screen !== 'paused' || contextLost || !ready || settings.isOpen || rules.isOpen || !state.recordEligible)return; resumeGame(state); clearInput(); setScreen('playing'); }
function home() { if(state.phase !== 'ended' && state.phase !== 'ready') announce('試合を中断しました'); audio.resetFlight(); state=createGame(undefined,selectedMode); syncMode(); setScreen('home'); showBest(); }
for(const id of ['start','retry','pause-restart'])el(id).addEventListener('click',begin,{signal});
el('pause').addEventListener('click',()=>pause(),{signal}); el('resume').addEventListener('click',resume,{signal});
for(const id of ['pause-home','result-home'])el(id).addEventListener('click',home,{signal});
for(const id of ['home-controls','pause-controls','result-controls'])el(id).addEventListener('click',()=>{ if(screen === 'playing')pause(); clearInput(); settings.open(el(id),screen==='home'?selectedMode:state.mode,screen!=='paused'); },{signal});
for(const id of ['home-rules','pause-rules'])el(id).addEventListener('click',()=>{ if(screen==='playing')pause(); clearInput(); rules.open(el(id)); },{signal});
for(const radio of document.querySelectorAll<HTMLInputElement>('input[name="game-mode"]'))radio.addEventListener('change',()=>{if(screen!=='home'||!radio.checked)return; selectedMode=radio.value==='normal'?'normal':'easy'; state=createGame(undefined,selectedMode); syncMode();},{signal});
window.addEventListener('keydown',event=>{ if(event.repeat||event.isComposing||keyboardEventHasShortcutModifier(event)||(screen!=='paused'&&isKeyboardEditingTarget(event.target))||settings.isOpen||rules.isOpen||event.code!==keyboard.code('pause'))return; if(screen==='playing'){event.preventDefault();pause();}else if(screen==='paused'&&!settings.isOpen&&!rules.isOpen){event.preventDefault();resume();} },{signal});
window.addEventListener('blur',()=>pause('画面を離れたため一時停止しました'),{signal});
window.addEventListener('pagehide',()=>pause('画面を離れたため一時停止しました'),{signal});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('画面が非表示になったため一時停止しました');},{signal});
function resized() { clearInput(); scene?.resize(); }
window.addEventListener('resize',resized,{signal}); window.addEventListener('orientationchange',resized,{signal}); window.visualViewport?.addEventListener('resize',resized,{signal});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();graphicsEpoch++;contextLost=true;ready=false;const lostScene=scene;scene=null;lostScene?.dispose();el<HTMLButtonElement>('start').disabled=true;if(screen==='home'){el('startup-error').hidden=false;el('startup-error').textContent='描画が中断されました。復帰を待つか、再読み込みしてください';el('reload').hidden=false;}pause('描画が中断されました。復帰後も再開操作が必要です'); el('resume').hidden=true;},{signal});
// Retire old GL handles while the context is lost; rebuild after the restored event dispatch.
canvas.addEventListener('webglcontextrestored',()=>{const epoch=graphicsEpoch;setTimeout(()=>{if(!disposed&&contextLost&&epoch===graphicsEpoch)void restoreGraphics();},0);},{signal});
async function restoreGraphics() { const epoch=++graphicsEpoch; try { scene?.dispose(); const restored=new NusumidaseScene(canvas,overlay); scene=restored; restored.render(state,true); await restored.prepare(); if(disposed||epoch!==graphicsEpoch||scene!==restored)return; contextLost=false; ready=true; el<HTMLButtonElement>('start').disabled=false;el('start').textContent='出撃する';el('startup-error').hidden=true;el('reload').hidden=true;el('pause-reload').hidden=true;el('resume').hidden=false; el('pause-reason').textContent='描画が復帰しました。飛行を再開できます'; }catch(error){if(disposed||epoch!==graphicsEpoch)return;console.error(error);if(screen==='home'){el('startup-error').hidden=false;el('startup-error').textContent='描画を復旧できません。再読み込みしてください';el('reload').hidden=false;}el('pause-reason').textContent='描画を復旧できません。再読み込みしてください';el('pause-reload').hidden=false;} }
for(const id of ['reload','pause-reload'])el(id).addEventListener('click',()=>location.reload(),{signal});
function flagText(team: Team) { const flag=state.flags[team]; return flag.state==='atHome'?'基地に待機':flag.state==='dropped'?'撃破地点に留まる':team==='friendly'?'敵機が携行':'味方が携行'; }
function updateHUD() {
  const p=state.player; el('timer').textContent=formatTime(MATCH_PLAY_TICKS-state.playTicks); el('friendly-captures').textContent=String(state.scores.friendly); el('enemy-captures').textContent=String(state.scores.enemy); el('friendly-flag').textContent=flagText('friendly'); el('enemy-flag').textContent=flagText('enemy');
  const hp=Math.ceil(Math.max(0,p.health)/p.maxHealth*100); el('health').textContent=String(hp);el('health-bar').style.width=`${hp}%`; el('altitude').textContent=`${Math.round(p.position.y)}m`;el('speed').textContent=`${Math.round(p.speed*3.6)}km/h`;el('target-speed').textContent=String(Math.round(getPlayerTargetSpeed(state)*3.6)); el('allies-count').textContent=String(state.allies.filter(isAlive).length); el('mg-ammo').textContent=String(p.mg);el('cannon-ammo').textContent=String(p.cannon);
  el('reload-status').hidden=p.reloadTicksRemaining<=0;el('reload-status').textContent=`再装填 ${Math.ceil(p.reloadTicksRemaining/60)}秒`;
  el('loop-status').textContent=p.loopProgress>0?'宙返り中':p.loopCooldown>0?`${p.loopCooldown.toFixed(1)}秒`:'すぐ使える';buttons.loop.disabled=!isAlive(p)||p.loopCooldown>0||state.phase!=='playing';
  const carried=carriedFlagFor(state,p);el('carrier-status').hidden=!carried;
  if(carried){const base=BASE_POSITIONS.friendly;el('carrier-status').textContent=`敵コア携行中\n自基地 ${Math.round(p.position.distanceTo(base))}m · 高度差 ${Math.round(base.y-p.position.y)}m`;}
  let status=''; if(state.phase==='countdown')status=`出撃\n${Math.ceil((180-state.phaseTicks)/60)}`; else if(!isAlive(p))status=`撃墜 · 復活まで ${Math.max(0,Math.ceil(((p.respawnDuePlayTick??state.playTicks)-state.playTicks)/60))}秒`;else if(isProtected(state,p))status=`復活保護 ${Math.ceil((p.protectionUntilPlayTick-state.playTicks)/60)}秒`;
  el('lifecycle-status').hidden=!status;setStatusText('lifecycle-status',status);
  const waiting=state.allies.filter(plane=>!isAlive(plane)&&plane.respawnDuePlayTick!==null);
  setStatusText('ally-announcements',waiting.length?`僚機${waiting.length}機が復活待ち · 最短${Math.max(0,Math.ceil((Math.min(...waiting.map(plane=>plane.respawnDuePlayTick!))-state.playTicks)/60))}秒`:'');
  const low=p.position.y<LOW_ALTITUDE_WARNING; const edge=boundaryWarning(p.position);el('warning').hidden=!isAlive(p)||(!low&&!edge);setStatusText('warning',low?'低空注意 · 機首を上げて':'空域の境界に接近 · 内側へ旋回');
  if(notificationUntilTick && state.tick>=notificationUntilTick){el('announcement').textContent='';notificationUntilTick=0;}
}
function processEvents(events: readonly Readonly<GameEvent>[]) {
  scene?.events(events,state.elapsed);
  const messages: {text:string;priority:number;ticks:number}[]=[];
  const notice=(text:string,priority:number,ticks=150)=>messages.push({text,priority,ticks});
  for(const event of events){ audio.event(event,event.owner===state.player.id||event.target===state.player.id,event.type==='kill'&&event.target===state.player.id);
    const side=event.team==='friendly'?'自軍':'敵軍';
    if(event.type==='capture')notice(`${side}がコアを回収`,6,180);
    else if(event.type==='pickup')notice(`${event.owner===state.player.id?'敵コアを取得':side+'がコアを取得'}`,3);
    else if(event.type==='return')notice(`${event.flagId==='core-A'?'自軍':'敵軍'}コアが${event.detail==='automatic'?'自動帰還':'帰還'}`,4);
    else if(event.type==='drop')notice('携行機が撃墜 · コアが落下',5);
    else if(event.type==='respawn'&&event.owner===state.player.id)notice('復活 · 2秒間の保護',2,120);
    else if(event.type==='warning')notice(event.detail??'コア奪還を優先',1,180);
  }
  messages.sort((a,b)=>b.priority-a.priority);
  const unique=messages.filter((message,index)=>messages.findIndex(other=>other.text===message.text)===index).slice(0,3);
  if(unique.length)announce(unique.map(message=>message.text).join(' · '),Math.max(...unique.map(message=>message.ticks)));
}
function complete() {
  const result=state.result; if(!result||lastResultId===result.matchId)return;lastResultId=result.matchId;clearInput();
  el('result-title').textContent=result.outcome==='victory'?'勝利':result.outcome==='defeat'?'敗北':'引分';el('result-reason').textContent=result.reason==='captures'?(result.outcome==='draw'?'同時にコアを持ち帰ったため引分':'先に1個のコアを持ち帰って決着'):'12分の有効プレイ時間で判定';el('result-time').textContent=formatTime(result.playTicks);el('result-captures').textContent=`${result.captures.friendly} — ${result.captures.enemy}`;el('result-personal-captures').textContent=`${result.stats.captures}回`;el('result-returns').textContent=`${result.stats.returns}回`;el('result-kills').textContent=`${result.stats.kills} / ${result.stats.deaths}`;el('result-rules').textContent=result.rulesVersion;el('record-warning').hidden=true;setScreen('result');audio.finishFlight();
  const matchId=result.matchId;void records.append(result).then(saved=>{if(disposed||lastResultId!==matchId)return;el('record-warning').hidden=saved.ok;el('record-warning').textContent=saved.message;showBest();});
}
function advance(dt: number) {
  if(screen!=='playing'||settings.isOpen||rules.isOpen)return;
  if(dt>MAX_ACCUMULATOR||!Number.isFinite(dt)){pause('描画が遅れたため一時停止しました。飛行を再開してください');return;}
  accumulator+=Math.max(0,dt);if(accumulator>MAX_ACCUMULATOR){pause('描画が遅れたため一時停止しました。飛行を再開してください');return;}
  let steps=0;
  while(accumulator+1e-10>=FIXED_DT&&steps<MAX_STEPS_PER_FRAME&&screen==='playing'){
    const frame=controls.sample();const consumed=stepFixed(state,{...frame,viewAspect:canvas.clientWidth/Math.max(1,canvas.clientHeight)});if(consumed)controls.acknowledge(frame);accumulator-=FIXED_DT;steps++;afterStep();processEvents(state.events);

  }
}
function afterStep() {
    if(lastInputEpoch!==state.inputEpoch){lastInputEpoch=state.inputEpoch;clearInput();audio.resetFlight();syncAudio(true);}
    if(state.phase==='paused'){el('pause-reason').textContent=state.pauseReason??'試合の整合性を確認できません';setScreen('paused');el<HTMLButtonElement>('resume').disabled=!state.recordEligible;return;}
    if(state.phase==='ended'){complete();return;}
}

function frame(now: number) {
  if(disposed)return;frameId=requestAnimationFrame(frame);const dt=lastFrame?(now-lastFrame)/1000:0;lastFrame=now;
  if(ready&&!contextLost){const renderStatus=scene?.pollRender(now);if(renderStatus==='stalled'||renderStatus==='failed'){pause('描画の完了を確認できないため一時停止しました');return;}const started=performance.now();if(!manualHarness)advance(dt);updateHUD();if(renderStatus==='ready')scene?.render(state,screen==='playing'||screen==='paused',state.phase==='ended'?dt:0);updateTimes.push(performance.now()-started);if(updateTimes.length>720)updateTimes.shift();if(dt>0){frameTimes.push(dt*1000);if(frameTimes.length>720)frameTimes.shift();}audio.update(state.player.speed);audio.updatePasses(state.slots,state.player,state.elapsed);if(screen!=='result')syncAudio();}
}
function dispose() { if(disposed)return;disposed=true;graphicsEpoch++;cancelAnimationFrame(frameId);abort.abort();unsubKeyboard();unsubPresentation();controls.dispose();settings.dispose();rules.dispose();presentation.dispose();scene?.dispose();audio.dispose(); }
// Explicit development harness; production builds expose no mutable game state.
if(import.meta.env.DEV&&new URLSearchParams(location.search).has('review')){
  Object.assign(window,{__nusumidase:{get state(){return state;},get scene(){return scene;},get controls(){return controls;},get settings(){return settings;},get screen(){return screen;},get targetSpeed(){return getPlayerTargetSpeed(state);},queueDamage(event: Parameters<typeof queueDamageEvent>[1]){return queueDamageEvent(state,event);},begin,pause,resume,home,manual(value=true){manualHarness=value;accumulator=0;clearInput();},step(count=1){for(let i=0;i<count;i++){const frame=controls.sample();if(stepFixed(state,frame))controls.acknowledge(frame);afterStep();processEvents(state.events);if(state.phase==='ended'||state.phase==='paused')break;}updateHUD();scene?.render(state,true);},render(){updateHUD();scene?.render(state,true);},frame(dt:number){advance(dt);updateHUD();},get metrics(){return{frameTimes:[...frameTimes],updateTimes:[...updateTimes],audioSources:audio.activeEffectSourceCount};},dispose}});
}
syncMode();syncAudio();frameId=requestAnimationFrame(frame);
try { const initial=new NusumidaseScene(canvas,overlay),epoch=graphicsEpoch;scene=initial;initial.render(state,false);void initial.prepare().then(()=>{if(disposed||epoch!==graphicsEpoch||scene!==initial)return;ready=true;el<HTMLButtonElement>('start').disabled=false;el('start').textContent='出撃する';}).catch(error=>{if(!disposed&&epoch===graphicsEpoch&&scene===initial)failGraphics(error);}); }catch(error){failGraphics(error);}
function failGraphics(error: unknown){ready=false;el('startup-error').hidden=false;el('startup-error').textContent='3D画面を準備できません。WebGL対応ブラウザーで再読み込みしてください。';el('reload').hidden=false;console.error(error);}
if(import.meta.hot)import.meta.hot.dispose(dispose);
