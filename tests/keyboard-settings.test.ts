import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyboardSettings, KEY_ACTIONS, KEYBOARD_STORAGE_KEY, DEFAULT_KEY_BINDINGS, parseKeyBindings, validKeyBindings, captureKey, preferredControlEditor } from '../src/keyboard-settings';

function key(code: string, extra = {}) { return { code, repeat: false, isComposing: false, ctrlKey: false, altKey: false, metaKey: false, ...extra } as KeyboardEvent; }
test('keyboard has the accepted nine Normal / six Easy actions with complete distinct defaults', () => {
  assert.equal(KEYBOARD_STORAGE_KEY, 'nusumidase-keyboard-v1'); assert.equal(KEY_ACTIONS.length, 9);
  assert.deepEqual(KEY_ACTIONS, ['left','right','up','down','fire','loop','accelerate','brake','pause']);
  const reads: string[] = [];
  const keyboard = new KeyboardSettings({ read(name: string) { reads.push(name); return null; } } as any);
  assert.deepEqual(reads, [KEYBOARD_STORAGE_KEY]);
  assert.equal(keyboard.describe('normal').split(' · ').length, 9); assert.equal(keyboard.describe('easy').split(' · ').length, 6);
  assert.equal(validKeyBindings(DEFAULT_KEY_BINDINGS), true);
});

test('future, duplicate, incomplete and invalid binding data falls back without changing saved bytes', () => {
  const bindings = { ...DEFAULT_KEY_BINDINGS, fire: 'KeyF', pause: 'KeyP' };
  assert.deepEqual(parseKeyBindings(JSON.stringify({version:1,bindings})),bindings);
  for (const raw of ['bad json', JSON.stringify({version:2,bindings}), JSON.stringify({version:1,bindings:{fire:'KeyF'}}),
    JSON.stringify({version:1,bindings:{...bindings,loop:'KeyF'}}), JSON.stringify({version:1,bindings:{...bindings,fire:'Tab'}})])
    assert.deepEqual(parseKeyBindings(raw),DEFAULT_KEY_BINDINGS);
});

test('IME, repeats, browser shortcuts and Tab are excluded from key capture', () => {
  assert.equal(captureKey(key('KeyA',{isComposing:true})).kind,'ignore');
  assert.equal(captureKey(key('KeyA',{repeat:true})).kind,'ignore');
  assert.equal(captureKey(key('KeyA',{ctrlKey:true})).kind,'error');
  assert.equal(captureKey(key('Tab')).kind,'error'); assert.equal(captureKey(key('Escape')).kind,'cancel');
  assert.deepEqual(captureKey(key('Numpad1')),{kind:'key',code:'Numpad1'});
  assert.equal(preferredControlEditor(false,false,5),'touch'); assert.equal(preferredControlEditor(true,true,5),'keyboard');
});
