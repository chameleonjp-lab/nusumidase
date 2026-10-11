import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStore, STORAGE_KEYS as K, type ExclusiveLock, type StorageLike } from '../src/storage';

const lock: ExclusiveLock = { async run(task) { return await task(); } };
class FaultStorage implements StorageLike {
  readonly values = new Map<string, string>();
  readonly calls: { operation: string; key: string }[] = [];
  writeCount = 0;
  readCount = 0;
  rejectWrites = new Set<number>();
  rejectReads = new Set<number>();
  silentWrites = new Set<number>();
  afterWrite?: (key: string, count: number) => void;
  getItem(key: string): string | null {
    this.calls.push({ operation: 'get', key });
    if (this.rejectReads.has(++this.readCount)) throw new Error('read denied');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.calls.push({ operation: 'set', key });
    if (this.rejectWrites.has(++this.writeCount)) throw new Error('quota denied');
    if (!this.silentWrites.has(this.writeCount)) this.values.set(key, value);
    this.afterWrite?.(key, this.writeCount);
  }
  removeItem(key: string): void {
    this.calls.push({ operation: 'remove', key });
    if (this.rejectWrites.has(++this.writeCount)) throw new Error('remove denied');
    this.values.delete(key);
  }
}
const keys = [K.controls, K.easyControls, K.keyboard, K.legacyControls, K.legacyEasyControls];
const payload = { [K.controls]: JSON.stringify({ version: 2, placement: 'new-normal' }),
  [K.easyControls]: JSON.stringify({ version: 2, placement: 'new-easy' }),
  [K.keyboard]: JSON.stringify({ version: 1, binding: 'new-keyboard' }) };
function setup() {
  const storage = new FaultStorage();
  storage.values.set(K.controls, JSON.stringify({ version: 2, placement: 'old-normal' }));
  storage.values.set(K.easyControls, JSON.stringify({ version: 2, placement: 'old-easy' }));
  storage.values.set(K.keyboard, JSON.stringify({ version: 1, binding: 'old-keyboard' }));
  storage.values.set(K.legacyControls, ' {"version":1,"custom":"left"}\n');
  storage.values.set(K.legacyEasyControls, '{"version":1,"custom":"right"}');
  const store = new LocalStore(storage, lock);
  return { storage, store, old: store.snapshot(keys) };
}

test('read/preview/cancel never write, and allowlist prevents foreign reads/writes', async () => {
  const { storage, store, old } = setup();
  assert.equal(store.read(K.controls), old[K.controls]);
  assert.equal(storage.writeCount, 0);
  assert.throws(() => store.read('kaisen-controls-v1'), /allowlist/);
  assert.equal((await store.save(old, { 'faitofuraito-controls-v1': '{"version":1}' })).status, 'invalid');
  assert.equal(storage.writeCount, 0);
  assert.ok(storage.calls.every(call => call.key.startsWith('nusumidase-')));
});

test('verified multi-key save retains exact legacy bytes and a committed rollback backup', async () => {
  const { storage, store, old } = setup();
  assert.equal((await store.save(old, payload)).status, 'saved');
  assert.deepEqual(store.snapshot(Object.keys(payload)), payload);
  const journal = JSON.parse(storage.values.get(K.journal)!);
  assert.equal(journal.state, 'committed');
  for (const key of Object.keys(payload)) assert.equal(journal.old[key], old[key]);
  assert.equal(storage.values.get(K.legacyControls), old[K.legacyControls]);
  assert.equal(storage.values.get(K.legacyEasyControls), old[K.legacyEasyControls]);
  const reloaded = new LocalStore(storage, lock);
  assert.deepEqual(reloaded.snapshot(Object.keys(payload)), payload);
  assert.equal(storage.writeCount, 5);
});

for (const rejectedWrite of [1, 2, 3, 4, 5]) {
  test(`journal/data/commit rejection at write ${rejectedWrite} leaves the old active snapshot`, async () => {
    const { storage, store, old } = setup();
    storage.rejectWrites.add(rejectedWrite);
    assert.equal((await store.save(old, payload)).status, 'failed');
    assert.deepEqual(store.snapshot(keys), old);
    assert.deepEqual(new LocalStore(storage, lock).snapshot(keys), old);
    for (const key of Object.keys(payload)) assert.equal(storage.values.get(key), old[key]);
    if (rejectedWrite === 1) assert.equal(storage.writeCount, 1);
    else assert.equal(JSON.parse(storage.values.get(K.journal)!).state, 'pending');
  });
}

test('failed rollback retains journal and old snapshot across reload, then Save recovers', async () => {
  const { storage, store, old } = setup();
  // Journal, normal succeed; easy rejects; restoring normal rejects independently.
  storage.rejectWrites = new Set([3, 4]);
  assert.equal((await store.save(old, payload)).status, 'recovery-required');
  assert.equal(storage.values.get(K.controls), payload[K.controls]);
  assert.equal(JSON.parse(storage.values.get(K.journal)!).state, 'pending');
  assert.deepEqual(store.snapshot(keys), old);
  const reload = new LocalStore(storage, lock);
  const baseline = reload.snapshot(keys);
  assert.deepEqual(baseline, old);
  storage.rejectWrites.clear();
  assert.equal((await reload.save(baseline, payload)).status, 'saved');
  assert.deepEqual(reload.snapshot(Object.keys(payload)), payload);
});

test('rollback of a newly created key restores null without deleting legacy bytes', async () => {
  const storage = new FaultStorage();
  const legacy = ' {"version":1,"position":0.41} ';
  storage.values.set(K.legacyControls, legacy);
  const store = new LocalStore(storage, lock);
  const old = store.snapshot(keys);
  storage.rejectWrites.add(3);
  assert.equal((await store.save(old, payload)).status, 'failed');
  assert.equal(storage.values.has(K.controls), false);
  assert.equal(storage.values.get(K.legacyControls), legacy);
  assert.deepEqual(new LocalStore(storage, lock).snapshot(keys), old);
});

test('silent journal denial prevents all data writes; silent data denial is rolled back', async () => {
  for (const silentWrite of [1, 2, 5]) {
    const { storage, store, old } = setup();
    storage.silentWrites.add(silentWrite);
    assert.equal((await store.save(old, payload)).status, 'failed');
    assert.deepEqual(store.snapshot(keys), old);
    if (silentWrite === 1) assert.equal(storage.writeCount, 1);
  }
});

test('readback failure at every transaction read preserves old active/reloaded snapshot', async () => {
  const reference = setup();
  const start = reference.storage.readCount;
  assert.equal((await reference.store.save(reference.old, payload)).ok, true);
  const readTotal = reference.storage.readCount - start;
  for (let offset = 1; offset <= readTotal; offset++) {
    const { storage, store, old } = setup();
    storage.rejectReads.add(storage.readCount + offset);
    const outcome = await store.save(old, payload);
    assert.equal(outcome.ok, false, `read offset ${offset}`);
    assert.deepEqual(store.snapshot(keys), old, `active at read offset ${offset}`);
    assert.deepEqual(new LocalStore(storage, lock).snapshot(keys), old, `reload at read offset ${offset}`);
  }
});

test('stale tab baseline and revision change refuse writes even when raw was reverted', async () => {
  const { storage, store, old } = setup();
  storage.values.set(K.keyboard, '{"version":1,"binding":"other-tab"}');
  assert.equal((await store.save(old, payload)).status, 'conflict');
  assert.equal(storage.writeCount, 0);
  storage.values.set(K.keyboard, old[K.keyboard]!);
  const other = new LocalStore(storage, lock);
  assert.equal((await other.save(other.snapshot(keys), {
    [K.controls]: old[K.controls]!, [K.easyControls]: old[K.easyControls]!, [K.keyboard]: old[K.keyboard]!,
  })).ok, true);
  const writesBefore = storage.writeCount;
  assert.equal((await store.save(old, payload)).status, 'conflict');
  assert.equal(storage.writeCount, writesBefore);
});

test('no exclusive lock or busy lock refuses persistence', async () => {
  const { storage, old } = setup();
  const unavailable: ExclusiveLock = { async run() { return null; } };
  for (const store of [new LocalStore(storage, null), new LocalStore(storage, unavailable)]) {
    assert.equal((await store.save(old, payload)).status, 'unavailable');
  }
  assert.equal(storage.writeCount, 0);
});

test('future v2/legacy and unknown journal remain byte-identical', async () => {
  for (const key of [K.controls, K.legacyControls, K.journal]) {
    const { storage } = setup();
    if (key === K.legacyControls) storage.values.delete(K.controls);
    const future = ' {"version":99,"unknown":"preserve"} ';
    storage.values.set(key, future);
    const store = new LocalStore(storage, lock);
    const outcome = await store.save(store.snapshot(keys), payload);
    assert.equal(outcome.status, 'invalid');
    assert.equal(storage.values.get(key), future);
    assert.equal(storage.writeCount, 0);
    if (key === K.journal) assert.equal(store.read(K.controls), null);
  }
});

test('corrupt raw is backed up unchanged when explicit Save replaces it', async () => {
  const { storage, store } = setup();
  const damaged = ' {"version":2, BROKEN!\n';
  storage.values.set(K.controls, damaged);
  const old = store.snapshot(keys);
  assert.equal((await store.save(old, payload)).ok, true);
  assert.equal(JSON.parse(storage.values.get(K.journal)!).old[K.controls], damaged);
});

test('foreign future raw during failure is preserved, never overwritten by rollback', async () => {
  const { storage, store, old } = setup();
  const future = '{"version":3,"otherTransaction":true}';
  storage.afterWrite = (_key, count) => {
    if (count === 2) storage.values.set(K.controls, future);
  };
  storage.rejectWrites.add(3);
  assert.equal((await store.save(old, payload)).status, 'recovery-required');
  assert.equal(storage.values.get(K.controls), future);
  assert.deepEqual(new LocalStore(storage, lock).snapshot(keys), old);
  const count = storage.writeCount;
  assert.equal((await store.save(store.snapshot(keys), payload)).status, 'recovery-required');
  assert.equal(storage.writeCount, count);
});

test('crash after each partially written key reloads a coherent old snapshot with zero writes', () => {
  for (let written = 0; written <= 3; written++) {
    const { storage, old } = setup();
    const oldProposed: Record<string, string | null> = {};
    for (const key of Object.keys(payload)) oldProposed[key] = old[key];
    storage.values.set(K.journal, JSON.stringify({ version: 1, transactionId: 'crash-fixture',
      state: 'pending', old: oldProposed, proposed: payload }));
    for (const key of Object.keys(payload).slice(0, written)) storage.values.set(key, payload[key as keyof typeof payload]);
    assert.deepEqual(new LocalStore(storage, lock).snapshot(keys), old);
    assert.equal(storage.writeCount, 0);
  }
});
