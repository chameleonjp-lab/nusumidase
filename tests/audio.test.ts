/** WebAudio test doubles adapted from pinned Kaisen tests/audio.test.ts. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FlightAudio } from '../src/audio';
import { Quaternion, Vector3 } from 'three';
import type { Aircraft, GameEvent } from '../src/types';

interface ParamEvent {
  type: string;
  value: number;
  time: number;
}

class FakeAudioParam {
  value = 0;
  readonly events: ParamEvent[] = [];

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ type: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'exponential', value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number, constant: number): this {
    this.events.push({ type: `target:${constant}`, value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancel', value: this.value, time });
    return this;
  }
}

class FakeAudioNode {
  readonly connections: FakeAudioNode[] = [];
  disconnectCount = 0;

  connect(destination: FakeAudioNode): FakeAudioNode {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnectCount += 1;
    this.connections.length = 0;
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam();
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type = 'lowpass';
  readonly frequency = new FakeAudioParam();
}

abstract class FakeScheduledSource extends FakeAudioNode {
  onended: (() => void) | null = null;
  startAt: number | null = null;
  stopAt: number | null = null;
  readonly stopCalls: number[] = [];
  ended = false;

  start(when = 0): void {
    this.startAt = when;
  }

  stop(when = 0): void {
    this.stopAt = when;
    this.stopCalls.push(when);
  }

  finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.onended?.();
  }
}

class FakeOscillatorNode extends FakeScheduledSource {
  type = 'sine';
  readonly frequency = new FakeAudioParam();
}

class FakeBufferSourceNode extends FakeScheduledSource {
  buffer: FakeAudioBuffer | null = null;
  readonly playbackRate = new FakeAudioParam();
}

class FakeAudioBuffer {
  private readonly channel: Float32Array;

  constructor(length: number) {
    this.channel = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.channel;
  }
}

class FakeAudioContext {
  static latest: FakeAudioContext | null = null;

  state: AudioContextState = 'suspended';
  currentTime = 0;
  readonly sampleRate = 44100;
  readonly destination = new FakeAudioNode();
  readonly oscillators: FakeOscillatorNode[] = [];
  readonly bufferSources: FakeBufferSourceNode[] = [];
  readonly filters: FakeBiquadFilterNode[] = [];
  readonly gains: FakeGainNode[] = [];
  readonly panners: FakeStereoPannerNode[] = [];
  closeCalls = 0;
  resumeCalls = 0;

  constructor() {
    FakeAudioContext.latest = this;
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.bufferSources.push(node);
    return node;
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    const node = new FakeBiquadFilterNode();
    this.filters.push(node);
    return node;
  }

  createStereoPanner(): FakeStereoPannerNode {
    const node = new FakeStereoPannerNode();
    this.panners.push(node);
    return node;
  }

  createBuffer(_channels: number, length: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length);
  }

  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.closeCalls++;
    this.state = 'closed';
  }

  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const source of [...this.oscillators, ...this.bufferSources]) {
      if (source.stopAt !== null && source.stopAt <= this.currentTime) source.finish();
    }
  }
}

function installFakeAudioContext(): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    writable: true,
    value: FakeAudioContext,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'AudioContext', previous);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  };
}

async function createFixture(): Promise<{
  audio: FlightAudio;
  context: FakeAudioContext;
  restore: () => void;
}> {
  const restore = installFakeAudioContext();
  const audio = new FlightAudio();
  audio.active = true;
  await audio.unlock();
  const context = FakeAudioContext.latest;
  assert.ok(context);
  return { audio, context, restore };
}

function gameEvent(id: number, type: GameEvent['type'], owner = 1): GameEvent {
  return { id: `test-audio/${id}`, matchId: 'test-audio', roundEpoch: 0, tick: id, eventSeq: 0, type, position: new Vector3(), owner };
}

function rememberedIds(audio: FlightAudio): Set<string> {
  return Reflect.get(audio, 'seenEventIds') as Set<string>;
}

test('disabled audio creates no AudioContext and rejects combat/objective effects', async () => {
  const restore = installFakeAudioContext();
  FakeAudioContext.latest = null;
  const audio = new FlightAudio();
  try {
    audio.enabled = false;
    audio.active = true;
    await audio.unlock();
    audio.event(gameEvent(1, 'capture'), true);
    audio.event(gameEvent(2, 'damage'), true);
    assert.equal(FakeAudioContext.latest, null);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(audio.activeEffectVoiceCount, 0);
  } finally { audio.dispose(); restore(); }
});

test('engine keeps pinned harmonics and gains; speed updates and paused sync stop every source', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    assert.deepEqual(context.oscillators.map(oscillator => oscillator.frequency.value), [49, 98, 147]);
    assert.ok(context.gains[1].gain.events.some(event => event.type === 'target:0.035' && event.value === 0.0475));
    assert.ok(context.gains[0].gain.events.some(event => event.type === 'target:0.04' && event.value === 0.6));
    audio.update(110);
    [54.3, 108.6, 162.9].forEach((expected, index) =>
      assert.ok(Math.abs(context.oscillators[index].frequency.events.at(-1)!.value - expected) < 1e-10));
    audio.event(gameEvent(1, 'damage'), true);
    const liveSources = [...context.oscillators, ...context.bufferSources];
    audio.active = false;
    audio.sync();
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(audio.activeEffectVoiceCount, 0);
    assert.equal(context.gains[0].gain.value, 0);
    assert.equal(context.gains[1].gain.value, 0);
    assert.ok(liveSources.every(source => source.stopAt === context.currentTime));
    assert.ok(liveSources.every(source => source.disconnectCount > 0));
    const oscillatorCount = context.oscillators.length;
    audio.event(gameEvent(2, 'shot'), true);
    audio.event(gameEvent(3, 'damage'), true);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(context.oscillators.length, oscillatorCount);
    audio.active = true;
    audio.sync();
    assert.equal(context.oscillators.length, oscillatorCount + 3);
  } finally { audio.dispose(); restore(); }
});

test('effect capacity reserves damage sources, caps at ten and remembers at most 256 event IDs', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    for (let id = 0; id < 7; id++) audio.event(gameEvent(id, 'kill'), true);
    assert.equal(audio.activeEffectSourceCount, 7);
    audio.event(gameEvent(20, 'shot'), true);
    assert.equal(audio.activeEffectSourceCount, 7);
    audio.event(gameEvent(21, 'damage'), true);
    assert.equal(audio.activeEffectSourceCount, 10);
    audio.event(gameEvent(22, 'damage'), true);
    assert.equal(audio.activeEffectSourceCount, 10);
    context.currentTime = 0.13;
    audio.event(gameEvent(23, 'damage'), true);
    assert.equal(audio.activeEffectSourceCount, 10);
    assert.ok(context.bufferSources.some(source => source.stopCalls.length > 1), 'priority eviction stops a lower-priority voice');
    for (let id = 100; id < 500; id++) {
      audio.event(gameEvent(id, 'kill'), true);
      assert.ok(audio.activeEffectSourceCount <= 10);
    }
    assert.equal(rememberedIds(audio).size, 256);
    audio.event(gameEvent(501, 'kill'), false, true);
    audio.event(gameEvent(502, 'kill'), false, true);
    assert.ok(audio.activeEffectSourceCount <= 10);
    context.advance(2);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(audio.activeEffectVoiceCount, 0);
  } finally { audio.dispose(); restore(); }
});

test('effect completion disconnects nodes and duplicate events do not replay', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    const event = gameEvent(1, 'hit');
    audio.event(event, true);
    audio.event(event, true);
    assert.equal(audio.activeEffectSourceCount, 1);
    const effectSource = context.bufferSources.at(-1)!;
    const effectFilter = context.filters.at(-1)!;
    const effectGain = context.gains.at(-1)!;
    assert.equal(effectSource.stopAt, 0.14);
    assert.ok(effectGain.gain.events.some(event => event.type === 'linear' && event.value === 0.16));
    context.advance(0.14);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(audio.activeEffectVoiceCount, 0);
    assert.equal(effectSource.disconnectCount, 1);
    assert.equal(effectFilter.disconnectCount, 1);
    assert.equal(effectGain.disconnectCount, 1);
    audio.event(event, true);
    assert.equal(audio.activeEffectSourceCount, 0);
    audio.resetFlight();
    audio.active = true; audio.sync();
    audio.event(event, true);
    assert.equal(audio.activeEffectSourceCount, 1);
  } finally { audio.dispose(); restore(); }
});

test('capture after round reset/finish bypasses muted engine master, decays, and obeys enabled state', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    // This is the product ordering: invalidate/reset the engine, then notify capture.
    audio.resetFlight();
    audio.sync();
    assert.equal(audio.active, false);
    assert.equal(context.gains[0].gain.value, 0);
    const oscillatorsBefore = context.oscillators.length;
    audio.event(gameEvent(1, 'capture'), true);
    assert.equal(audio.activeEffectSourceCount, 1);
    assert.equal(context.oscillators.length, oscillatorsBefore + 1, 'objective cue does not restart the engine');
    const tone = context.oscillators.at(-1)!;
    const cueGain = context.gains.at(-2)!;
    assert.equal(tone.frequency.value, 660);
    assert.equal(tone.type, 'sine');
    assert.equal(cueGain.gain.value, 0.6);
    assert.deepEqual(cueGain.connections, [context.destination]);
    assert.equal(tone.stopAt, 0.26);
    context.advance(0.26);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(cueGain.disconnectCount, 1);

    audio.finishFlight();
    audio.event(gameEvent(2, 'return'), false);
    assert.equal(audio.activeEffectSourceCount, 1, 'terminal objective event remains audible');
    assert.equal(context.oscillators.at(-1)!.frequency.value, 440);
    audio.enabled = false; audio.sync();
    const count = context.oscillators.length;
    audio.event(gameEvent(3, 'respawn'), true);
    assert.equal(context.oscillators.length, count);
    assert.equal(audio.activeEffectSourceCount, 0);
  } finally { audio.dispose(); restore(); }
});

test('remaining-60-second and stagnation warning cues work with stopped engine and obey dedupe/mute', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    audio.active = false; audio.sync();
    const warning = { ...gameEvent(39600, 'warning', 0), tick: 39600, detail: '残り60秒' };
    const oscillatorsBefore = context.oscillators.length;
    const gainsBefore = context.gains.length;
    audio.event(warning, false);
    assert.equal(audio.activeEffectSourceCount, 1);
    assert.equal(context.oscillators.length, oscillatorsBefore + 1, 'warning does not restart the engine during a respawn wait');
    const tone = context.oscillators.at(-1)!;
    const output = context.gains[gainsBefore];
    assert.equal(tone.frequency.value, 440);
    assert.ok(tone.frequency.events.some(event => event.type === 'exponential' && event.value === 880));
    assert.equal(output.gain.value, 0.6);
    assert.deepEqual(output.connections, [context.destination]);
    audio.event(warning, false);
    assert.equal(audio.activeEffectSourceCount, 1, 'same remaining-time event cannot play twice');
    context.advance(0.26);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(audio.activeEffectVoiceCount, 0);
    assert.equal(output.disconnectCount, 1);
    audio.event({ ...gameEvent(40500, 'warning', 0), detail: 'コア奪還を優先' }, false);
    assert.equal(audio.activeEffectSourceCount, 1, '90-second stagnation reminder uses the same bounded cue');
    audio.enabled = false; audio.sync();
    const afterMute = context.oscillators.length;
    audio.event({ ...gameEvent(43200, 'warning', 0), detail: '残り60秒' }, false);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(context.oscillators.length, afterMute);
  } finally { audio.dispose(); restore(); }
});

test('finish allows death tail while reset/dispose cancel even scheduled future debris', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    audio.event(gameEvent(1, 'kill'), false, true);
    const explosion = context.bufferSources.slice(-5);
    assert.deepEqual(explosion.map(source => source.startAt), [0, 0, 0.18, 0.45, 0.72]);
    audio.finishFlight();
    assert.equal(audio.active, false);
    assert.equal(audio.activeEffectSourceCount, 5);
    audio.event(gameEvent(2, 'damage'), true);
    assert.equal(audio.activeEffectSourceCount, 5);
    assert.ok(context.gains[0].gain.events.some(event => event.type === 'linear' && event.value === 0 && event.time === 1.05));
    context.advance(0.95);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(audio.activeEffectVoiceCount, 0);
    audio.active = true; audio.sync();
    audio.event(gameEvent(3, 'kill'), false, true);
    const pending = context.bufferSources.slice(-5);
    audio.resetFlight();
    assert.ok(pending.every(source => source.stopAt === context.currentTime));
    assert.equal(audio.activeEffectSourceCount, 0);
    audio.active = true; audio.sync();
    audio.event(gameEvent(4, 'kill'), false, true);
    const beforeDispose = [...context.bufferSources, ...context.oscillators].filter(source => !source.ended);
    audio.dispose(); audio.dispose();
    assert.equal(context.closeCalls, 1);
    assert.equal(context.state, 'closed');
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(audio.activeEffectVoiceCount, 0);
    assert.ok(beforeDispose.every(source => source.stopAt === context.currentTime));
    assert.ok(beforeDispose.every(source => source.disconnectCount > 0));
  } finally { audio.dispose(); restore(); }
});

test('explicit player death remains audible after engine reset; unrelated AI deaths never use the player explosion', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    audio.event(gameEvent(1, 'kill', 6), false);
    assert.equal(audio.activeEffectSourceCount, 0, 'AI-versus-AI combat is not a player death');
    audio.event(gameEvent(2, 'kill', 1), true);
    assert.equal(audio.activeEffectSourceCount, 1, 'player-owned kill retains the original one-source enemy blast');
    audio.resetFlight(); audio.sync();
    assert.equal(context.gains[0].gain.value, 0);
    const gainsBefore = context.gains.length;
    audio.event(gameEvent(3, 'kill', 6), true, true);
    assert.equal(audio.active, false);
    assert.equal(audio.activeEffectSourceCount, 5);
    const output = context.gains[gainsBefore];
    assert.equal(output.gain.value, 0.6);
    assert.deepEqual(output.connections, [context.destination]);
    const debris = context.bufferSources.slice(-5);
    assert.deepEqual(debris.map(source => source.startAt), [0, 0, 0.18, 0.45, 0.72]);
    assert.deepEqual(debris.map(source => source.stopAt), [0.06, 0.84, 0.35, 0.62, 0.95]);
    assert.deepEqual(context.filters.slice(-5).map(filter => [filter.type, filter.frequency.value]), [
      ['highpass', 1500], ['lowpass', 260], ['bandpass', 1300], ['bandpass', 1900], ['lowpass', 760],
    ]);
    assert.deepEqual(context.gains.slice(-5).map(gain => gain.gain.events.find(event => event.type === 'linear')?.value),
      [0.24, 0.22, 0.11, 0.085, 0.06]);
    context.advance(0.95);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(output.disconnectCount, 1);
    audio.enabled = false;
    const count = context.bufferSources.length;
    audio.event(gameEvent(4, 'kill', 6), true, true);
    assert.equal(context.bufferSources.length, count, 'disabled sound suppresses even a terminal player-death cue');
  } finally { audio.dispose(); restore(); }
});

test('real relative aircraft passes remain at most two voices and pauses clear their baselines', async () => {
  const { audio, context, restore } = await createFixture();
  const plane = (id: number, x: number, age: number) => ({ id, position: new Vector3(x, 300, 0), quaternion: new Quaternion(), health: 80, speed: 110, age } as Aircraft);
  const player = plane(1, 0, 0);
  try {
    const others = [plane(2, 250, 0), plane(3, 300, 0), plane(4, 350, 0)];
    audio.updatePasses([player, ...others], player, 0);
    assert.equal(audio.activeEffectSourceCount, 0, 'initial nearby positions only establish a baseline');
    for (let tick = 1; tick <= 8; tick++) {
      context.currentTime = tick * 0.1;
      for (const other of others) { other.position.x -= 25; other.age += 0.1; }
      audio.updatePasses([player, ...others], player, tick * 0.1);
      assert.ok(audio.activeEffectVoiceCount <= 2);
      assert.ok(audio.activeEffectSourceCount <= 4);
    }
    assert.equal(audio.activeEffectVoiceCount, 2);
    assert.equal(audio.activeEffectSourceCount, 4);
    assert.ok(context.panners.length >= 2);
    audio.active = false; audio.sync();
    assert.equal(audio.activeEffectSourceCount, 0);
    audio.active = true; audio.sync();
    audio.updatePasses([player, ...others], player, 20);
    assert.equal(audio.activeEffectSourceCount, 0, 'resume cannot replay passes from an elapsed-time gap');
  } finally { audio.dispose(); restore(); }
});

test('resume rejection is reported without throwing, and disposal during a pending unlock cannot restart sound', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    audio.active = false; audio.sync();
    context.state = 'suspended';
    context.resume = async () => { throw new Error('browser activation denied'); };
    await assert.doesNotReject(() => audio.unlock());
    assert.equal(audio.failed, true);
    assert.equal(audio.activeEffectSourceCount, 0);
    let releaseResume!: () => void;
    let requests = 0;
    context.resume = () => {
      requests++;
      return new Promise<void>(resolve => { releaseResume = resolve; });
    };
    audio.active = true;
    const first = audio.unlock();
    const second = audio.unlock();
    assert.equal(requests, 1, 'overlapping gestures share one resume request');
    const oscillatorsBefore = context.oscillators.length;
    audio.dispose();
    releaseResume();
    await Promise.all([first, second]);
    assert.equal(context.closeCalls, 1);
    assert.equal(context.state, 'closed');
    assert.equal(context.oscillators.length, oscillatorsBefore);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(audio.activeEffectVoiceCount, 0);
  } finally { audio.dispose(); restore(); }
});
