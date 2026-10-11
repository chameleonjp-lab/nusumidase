// Joystick response, key routing and pointer recovery adapted from the pinned Kaisen baseline.
import type { FlightInput } from './types';
import { KeyboardSettings, keyboardEventHasShortcutModifier, type KeyAction } from './keyboard-settings';
import { clampThrottleAxis, combineThrottleAxes, throttleAxisFromClientY } from './throttle-lever';

export type FlightMode = 'normal' | 'easy';
export type FlightControlButtons = { fire: HTMLButtonElement; loop: HTMLButtonElement; throttle: HTMLElement };
export type NusumidaseControlButtons = FlightControlButtons;
export type InputFrame = FlightInput & { ownershipRevision: number; pendingInputIds: readonly number[] };
type ButtonName = 'fire' | 'loop';
type Command = { id: number; source?: 'key' | 'button'; action?: KeyAction; pointerAxis?: number; focusedAxis?: number };
type KeyHold = { action: KeyAction; id: number; focused: boolean };
const STEERING = new Set<KeyAction>(['left', 'right', 'up', 'down']);
const NORMAL = new Set<KeyAction>(['fire', 'accelerate', 'brake']);
const POSITIVE = new Set(['ArrowUp', 'ArrowRight', 'End']);
const NEGATIVE = new Set(['ArrowDown', 'ArrowLeft', 'Home']);

/** Sampling is read-only. Pending taps are acknowledged only after a real simulation tick. */
export class FlightControls {
  private steerPointer: number | null = null;
  private steerPointerType: string | null = null;
  private throttlePointer: number | null = null;
  private throttlePointerType: string | null = null;
  private throttlePointerCommand: number | null = null;
  private pointerAxis = 0;
  private readonly buttonPointers = new Map<number, { name: ButtonName; type: string; id: number }>();
  private readonly keys = new Map<string, KeyHold>();
  private readonly focusedKeys = new Map<string, { axis: number; id: number }>();
  private readonly pending = new Map<number, Command>();
  private commandId = 0;
  private ownershipRevision = 0;
  private steeringRevision = 0;
  private turn = 0;
  private climb = 0;
  private origin = { x: 0, y: 0 };
  private mode: FlightMode = 'normal';
  private readonly abort = new AbortController();
  private readonly joystick: HTMLElement;
  private readonly unsubscribeKeys: () => void;

  constructor(private readonly surface: HTMLElement, private readonly buttons: FlightControlButtons,
    private readonly active: () => boolean, private readonly keyboard = new KeyboardSettings()) {
    this.unsubscribeKeys = keyboard.subscribe(() => this.clear());
    const app = surface.closest<HTMLElement>('#app') ?? document.getElementById('app') ?? surface;
    let joystick = app.querySelector<HTMLElement>('#joystick');
    if (!joystick) {
      joystick = document.createElement('div'); joystick.id = 'joystick';
      joystick.setAttribute('aria-hidden', 'true'); joystick.innerHTML = '<i></i>'; app.append(joystick);
    }
    this.joystick = joystick;
    const opts = { signal: this.abort.signal };
    surface.addEventListener('pointerdown', event => this.beginSteering(event, app), opts);
    window.addEventListener('pointermove', event => { this.moveSteering(event); this.moveThrottle(event); }, opts);
    window.addEventListener('pointerup', event => this.endPointer(event, true), opts);
    window.addEventListener('pointercancel', event => this.endPointer(event, false), opts);
    surface.addEventListener('lostpointercapture', event => this.endSteering(event.pointerId), opts);
    surface.addEventListener('contextmenu', event => event.preventDefault(), opts);
    for (const name of ['fire', 'loop'] as const) {
      const button = buttons[name];
      button.addEventListener('pointerdown', event => this.beginButton(name, event), opts);
      button.addEventListener('lostpointercapture', event => this.endButton(event.pointerId, false), opts);
      button.addEventListener('contextmenu', event => event.preventDefault(), opts);
      button.addEventListener('click', event => {
        if (event.detail === 0 && this.accepts(name) && !button.disabled && button.getAttribute('aria-disabled') !== 'true') this.enqueue({ action: name, source: 'button' });
      }, opts);
    }
    const lever = buttons.throttle;
    lever.setAttribute('role', 'slider'); lever.setAttribute('aria-orientation', 'vertical');
    lever.setAttribute('aria-label', '速度レバー'); lever.setAttribute('aria-valuemin', '-100'); lever.setAttribute('aria-valuemax', '100');
    if (!lever.hasAttribute('tabindex')) lever.tabIndex = 0;
    lever.addEventListener('pointerdown', event => this.beginThrottle(event), opts);
    lever.addEventListener('lostpointercapture', event => this.endThrottle(event.pointerId, false), opts);
    lever.addEventListener('contextmenu', event => event.preventDefault(), opts);
    lever.addEventListener('keydown', event => this.sliderKeyDown(event), opts);
    lever.addEventListener('keyup', event => this.sliderKeyUp(event), opts);
    lever.addEventListener('focusin', () => this.clearKeyboard(), opts);
    lever.addEventListener('focusout', () => this.clearFocused(), opts);
    window.addEventListener('keydown', event => this.keyDown(event), opts);
    window.addEventListener('keyup', event => this.keyUp(event), opts);
    for (const event of ['blur', 'pagehide', 'resize', 'orientationchange']) window.addEventListener(event, () => this.clear(), opts);
    window.visualViewport?.addEventListener('resize', () => this.clear(), opts);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); }, opts);
    this.renderThrottle();
  }

  sample(): InputFrame {
    if (!this.active()) { this.clear(); return this.neutral(); }
    const commands = [...this.pending.values()];
    const held = (action: KeyAction) => [...this.keys.values()].some(key => key.action === action)
      || commands.some(command => command.action === action);
    const buttonHeld = (name: ButtonName) => [...this.buttonPointers.values()].some(pointer => pointer.name === name);
    const normal = this.mode === 'normal';
    const pointer = this.throttlePointer === null ? commands.reduce((axis, command) => command.pointerAxis ?? axis, 0) : this.pointerAxis;
    const focusCommands = [...this.focusedKeys.values()].map(command => command.axis)
      .concat(commands.flatMap(command => command.focusedAxis === undefined ? [] : [command.focusedAxis]));
    const focused = Number(focusCommands.some(axis => axis > 0)) - Number(focusCommands.some(axis => axis < 0));
    return {
      turn: clampThrottleAxis(this.turn + Number(held('right')) - Number(held('left'))),
      climb: clampThrottleAxis(this.climb + Number(held('up')) - Number(held('down'))),
      fire: normal && (buttonHeld('fire') || held('fire')), loop: commands.some(command => command.action === 'loop'),
      throttle: normal ? combineThrottleAxes(pointer, held('accelerate'), held('brake'), focused) : 0,
      steeringRevision: this.steeringRevision, ownershipRevision: this.ownershipRevision,
      pendingInputIds: commands.map(command => command.id),
    };
  }

  /** Stale sampled frames cannot acknowledge a new gesture after clear/mode transitions. */
  acknowledge(frame: FlightInput): boolean {
    const sampled = frame as Partial<InputFrame>;
    if (sampled.ownershipRevision !== this.ownershipRevision || !sampled.pendingInputIds) return false;
    for (const id of sampled.pendingInputIds) this.pending.delete(id);
    return true;
  }
  consume(frame: FlightInput): boolean { return this.acknowledge(frame); }
  setMode(mode: FlightMode): void { if (mode !== this.mode) { this.clear(); this.mode = mode; } }
  peek() { return { turn: this.turn, climb: this.climb, steerPointer: this.steerPointer, throttle: this.pointerAxis,
    throttlePointer: this.throttlePointer, keys: [...this.keys.keys()], pending: [...this.pending.keys()] }; }

  clear(): void {
    this.ownershipRevision += 1;
    const steer = this.steerPointer; this.steerPointer = null; this.steerPointerType = null;
    this.turn = 0; this.climb = 0;
    this.keys.clear(); this.focusedKeys.clear(); this.pending.clear();
    this.hideJoystick();
    if (steer !== null) this.releaseCapture(this.surface, steer);
    this.releaseThrottle();
    for (const [pointer, held] of [...this.buttonPointers]) {
      this.buttonPointers.delete(pointer); this.releaseCapture(this.buttons[held.name], pointer);
    }
    for (const name of ['fire', 'loop'] as const) this.renderButton(name);
  }
  dispose(): void { this.clear(); this.unsubscribeKeys(); this.abort.abort(); }

  private neutral(): InputFrame { return { turn: 0, climb: 0, fire: false, loop: false, throttle: 0,
    steeringRevision: this.steeringRevision, ownershipRevision: this.ownershipRevision, pendingInputIds: [] }; }
  private enqueue(command: Omit<Command, 'id'>): number {
    const id = ++this.commandId; this.pending.set(id, { id, ...command }); return id;
  }
  private accepts(action: KeyAction): boolean { return this.active() && (this.mode === 'normal' || !NORMAL.has(action)); }
  private pointerAllowed(event: PointerEvent): boolean { return this.active() && event.button === 0; }
  private owned(pointer: number): boolean { return pointer === this.steerPointer || pointer === this.throttlePointer || this.buttonPointers.has(pointer); }

  private beginSteering(event: PointerEvent, app: HTMLElement): void {
    if (!this.pointerAllowed(event)) return;
    if (event.isPrimary) this.retireSameType(event.pointerType);
    if (this.steerPointer !== null || this.owned(event.pointerId)) return;
    event.preventDefault(); this.steerPointer = event.pointerId; this.steerPointerType = event.pointerType;
    if (!this.capture(this.surface, event.pointerId)) { this.endSteering(event.pointerId); return; }
    this.origin = { x: event.clientX, y: event.clientY };
    const rect = app.getBoundingClientRect();
    this.joystick.style.left = `${event.clientX - rect.left}px`; this.joystick.style.top = `${event.clientY - rect.top}px`;
    this.joystick.classList.add('visible'); this.joystick.style.setProperty('--joystick-x', '0px'); this.joystick.style.setProperty('--joystick-y', '0px');
  }
  private moveSteering(event: PointerEvent): void {
    if (event.pointerId !== this.steerPointer) return;
    if (!this.active() || (event.pointerType === 'mouse' && event.buttons === 0)) { this.endSteering(event.pointerId); return; }
    event.preventDefault();
    const dx = event.clientX - this.origin.x, dy = event.clientY - this.origin.y, distance = Math.hypot(dx, dy), radius = 36;
    const scale = distance > radius ? radius / distance : 1;
    const magnitude = Math.min(distance / radius, 1), response = magnitude <= .08 ? 0 : (magnitude - .08) / .92;
    const turn = distance === 0 ? 0 : dx / distance * response, climb = distance === 0 ? 0 : -dy / distance * response;
    if (Math.abs(turn - this.turn) > 1e-4 || Math.abs(climb - this.climb) > 1e-4) this.steeringRevision += 1;
    this.turn = turn; this.climb = climb;
    this.joystick.style.setProperty('--joystick-x', `${dx * scale}px`); this.joystick.style.setProperty('--joystick-y', `${dy * scale}px`);
  }
  private endSteering(pointer: number): void {
    if (pointer !== this.steerPointer) return;
    this.steerPointer = null; this.steerPointerType = null;
    if (Math.abs(this.turn) > 1e-4 || Math.abs(this.climb) > 1e-4) this.steeringRevision += 1;
    this.turn = 0; this.climb = 0; this.hideJoystick(); this.releaseCapture(this.surface, pointer);
  }
  private hideJoystick(): void { this.joystick.classList.remove('visible');
    this.joystick.style.removeProperty('--joystick-x'); this.joystick.style.removeProperty('--joystick-y'); }
  private beginButton(name: ButtonName, event: PointerEvent): void {
    if (!this.pointerAllowed(event) || !this.accepts(name) || this.buttons[name].disabled || this.buttons[name].getAttribute('aria-disabled') === 'true') return;
    if (event.isPrimary) this.retireSameType(event.pointerType);
    if (this.owned(event.pointerId)) return;
    event.preventDefault(); event.stopPropagation();
    const id = name === 'fire' ? this.enqueue({ action: 'fire', source: 'button' }) : ++this.commandId;
    this.buttonPointers.set(event.pointerId, { name, type: event.pointerType, id });
    if (!this.capture(this.buttons[name], event.pointerId)) { this.endButton(event.pointerId, false); return; }
    this.renderButton(name);
  }
  private endButton(pointer: number, completed: boolean): void {
    const held = this.buttonPointers.get(pointer); if (!held) return;
    this.buttonPointers.delete(pointer);
    if (!completed || !this.accepts(held.name)) this.pending.delete(held.id);
    else if (held.name === 'loop' && !this.buttons.loop.disabled && this.buttons.loop.getAttribute('aria-disabled') !== 'true') this.enqueue({ action: 'loop', source: 'button' });
    this.releaseCapture(this.buttons[held.name], pointer); this.renderButton(held.name);
  }
  private renderButton(name: ButtonName): void { const pressed = [...this.buttonPointers.values()].some(pointer => pointer.name === name);
    this.buttons[name].classList.toggle('is-pressed', pressed); this.buttons[name].setAttribute('aria-pressed', String(pressed)); }
  private beginThrottle(event: PointerEvent): void {
    if (!this.pointerAllowed(event) || this.mode !== 'normal' || this.buttons.throttle.getAttribute('aria-disabled') === 'true') return;
    if (this.throttlePointer !== null && !(event.isPrimary && event.pointerType === this.throttlePointerType)) return;
    if (event.isPrimary) this.retireSameType(event.pointerType);
    if (this.throttlePointer !== null || this.owned(event.pointerId)) return;
    event.preventDefault(); event.stopPropagation();
    this.throttlePointer = event.pointerId; this.throttlePointerType = event.pointerType;
    if (!this.capture(this.buttons.throttle, event.pointerId)) { this.releaseThrottle(); return; }
    this.updateThrottle(event.clientY); this.throttlePointerCommand = this.enqueue({ pointerAxis: this.pointerAxis });
  }
  private moveThrottle(event: PointerEvent): void {
    if (event.pointerId !== this.throttlePointer) return;
    if (!this.active() || (event.pointerType === 'mouse' && event.buttons === 0)) { this.endThrottle(event.pointerId, false); return; }
    event.preventDefault(); this.updateThrottle(event.clientY);
    if (this.throttlePointerCommand !== null && this.pending.has(this.throttlePointerCommand))
      this.pending.set(this.throttlePointerCommand, { id: this.throttlePointerCommand, pointerAxis: this.pointerAxis });
  }
  private updateThrottle(y: number): void {
    const rect = this.buttons.throttle.getBoundingClientRect();
    const scale = rect.height / (this.buttons.throttle.offsetHeight || rect.height), inset = 22 * scale;
    this.pointerAxis = rect.width > 0 && Number.isFinite(scale) && scale > 0
      ? throttleAxisFromClientY(y, rect.top + inset, rect.bottom - inset) : 0;
    this.renderThrottle();
  }
  private endThrottle(pointer: number, completed: boolean): void {
    if (pointer !== this.throttlePointer) return;
    if ((!completed || !this.active()) && this.throttlePointerCommand !== null) this.pending.delete(this.throttlePointerCommand);
    this.releaseThrottle();
  }
  private releaseThrottle(): void { const pointer = this.throttlePointer;
    this.throttlePointer = null; this.throttlePointerType = null; this.throttlePointerCommand = null; this.pointerAxis = 0;
    if (pointer !== null) this.releaseCapture(this.buttons.throttle, pointer); this.renderThrottle(); }
  private endPointer(event: PointerEvent, completed: boolean): void {
    this.endSteering(event.pointerId); this.endButton(event.pointerId, completed); this.endThrottle(event.pointerId, completed);
  }
  private retireSameType(type: string): void {
    if (this.steerPointerType === type && this.steerPointer !== null) this.endSteering(this.steerPointer);
    if (this.throttlePointerType === type && this.throttlePointer !== null) this.endThrottle(this.throttlePointer, false);
    for (const [pointer, held] of [...this.buttonPointers]) if (held.type === type) this.endButton(pointer, false);
  }

  private keyDown(event: KeyboardEvent): void {
    if (keyboardEventHasShortcutModifier(event) || event.code === 'Tab') { this.clearKeyboard(); this.clearFocused(); return; }
    const action = this.keyboard.action(event.code);
    const focused = event.target instanceof HTMLElement && event.target.closest('[role="slider"]') === this.buttons.throttle;
    const focusedThrottle = focused && (action === 'accelerate' || action === 'brake');
    if (!action || action === 'pause' || !this.accepts(action) || event.isComposing || (this.isEditing(event.target) && !focusedThrottle)) return;
    if (event.repeat && !this.keys.has(event.code)) return;
    event.preventDefault(); if (this.keys.has(event.code)) return;
    if (action === 'loop' && (this.buttons.loop.disabled || this.buttons.loop.getAttribute('aria-disabled') === 'true')) return;
    const id = this.enqueue({ action, source: 'key' }); this.keys.set(event.code, { action, id, focused });
    if (STEERING.has(action)) this.steeringRevision += 1;
  }
  private keyUp(event: KeyboardEvent): void {
    const key = this.keys.get(event.code); if (!key) return;
    this.keys.delete(event.code); if (STEERING.has(key.action)) this.steeringRevision += 1;
  }
  private clearKeyboard(): void {
    if ([...this.keys.values()].some(key => STEERING.has(key.action))) this.steeringRevision += 1;
    this.keys.clear();
    for (const [id, command] of this.pending) if (command.source === 'key') this.pending.delete(id);
  }
  private sliderKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); this.clearFocused(); return; }
    if (keyboardEventHasShortcutModifier(event)) { this.clearFocused(); return; }
    if (!POSITIVE.has(event.code) && !NEGATIVE.has(event.code)) return;
    if (event.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    if (!this.active() || this.mode !== 'normal' || this.buttons.throttle.getAttribute('aria-disabled') === 'true'
      || (event.repeat && !this.focusedKeys.has(event.code)) || this.focusedKeys.has(event.code)) return;
    const axis = POSITIVE.has(event.code) ? 1 : -1, id = this.enqueue({ focusedAxis: axis });
    this.focusedKeys.set(event.code, { axis, id }); this.renderThrottle();
  }
  private sliderKeyUp(event: KeyboardEvent): void {
    if (!POSITIVE.has(event.code) && !NEGATIVE.has(event.code)) return;
    event.preventDefault(); event.stopPropagation(); this.focusedKeys.delete(event.code); this.renderThrottle();
  }
  private clearFocused(): void { this.focusedKeys.clear();
    for (const [code, key] of this.keys) if (key.focused) { this.keys.delete(code); this.pending.delete(key.id); }
    for (const [id, command] of this.pending) if (command.focusedAxis !== undefined) this.pending.delete(id);
    this.renderThrottle(); }
  private renderThrottle(): void {
    const axes = [...this.focusedKeys.values()].map(key => key.axis);
    const value = combineThrottleAxes(this.pointerAxis, false, false, Number(axes.some(axis => axis > 0)) - Number(axes.some(axis => axis < 0)));
    const lever = this.buttons.throttle;
    lever.style.setProperty('--throttle-axis', String(value));
    const now = String(Math.round(value * 100)), text = value === 0 ? '保持（速度を維持）' : `${value > 0 ? '加速' : '減速'} ${Math.round(Math.abs(value) * 100)}%`;
    if (lever.getAttribute('aria-valuenow') !== now) lever.setAttribute('aria-valuenow', now);
    if (lever.getAttribute('aria-valuetext') !== text) lever.setAttribute('aria-valuetext', text);
    lever.classList.toggle('is-pressed', this.throttlePointer !== null || this.focusedKeys.size > 0);
  }
  private isEditing(target: EventTarget | null): boolean { return target instanceof HTMLElement &&
    (target.isContentEditable || Boolean(target.closest('input, textarea, select, button, a, dialog, [role="dialog"], [role="slider"]'))); }
  private capture(element: HTMLElement, pointer: number): boolean { try { element.setPointerCapture(pointer); return element.hasPointerCapture(pointer); } catch { return false; } }
  private releaseCapture(element: HTMLElement, pointer: number): void { try { if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer); } catch { /* Browser already released ownership. */ } }
}
