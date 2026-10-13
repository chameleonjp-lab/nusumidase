import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordsService, MAX_STATISTIC, recordFromResult, recordGroup } from '../src/records';
import { LocalStore, STORAGE_KEYS as K, type StorageLike, type ExclusiveLock } from '../src/storage';
import type { GameResult, GameMode } from '../src/types';
import { RULES_VERSION } from '../src/mission';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  writes = 0;
  rejectRecords = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, raw: string) {
    this.writes++;
    if (key === K.records && this.rejectRecords) throw new Error('quota');
    this.values.set(key, raw);
  }
  removeItem(key: string) { this.writes++; this.values.delete(key); }
}
const lock: ExclusiveLock = { async run(task) { return await task(); } };
function result(id: string, options: { mode?: GameMode; rulesVersion?: string; friendly?: number; enemy?: number;
  playTicks?: number; eligible?: boolean; outcome?: GameResult['outcome'] } = {}): GameResult {
  const friendly = options.friendly ?? 3;
  const enemy = options.enemy ?? 0;
  return {
    matchId: id, mode: options.mode ?? 'normal', rulesVersion: options.rulesVersion ?? 'nusumidase-ctf-v1',
    captures: { friendly, enemy }, scores: { friendly, enemy },
    outcome: options.outcome ?? (friendly > enemy ? 'victory' : friendly < enemy ? 'defeat' : 'draw'),
    reason: 'captures', playTicks: options.playTicks ?? 1000, time: (options.playTicks ?? 1000) / 60,
    recordEligible: options.eligible ?? true,
    stats: { captures: 2, returns: 1, kills: 5, deaths: 3, shots: 20, hits: 7, loops: 0, damageTaken: 9,
      teamKills: { friendly: 8, enemy: 3 }, teamReturns: { friendly: 1, enemy: 0 } },
  };
}
function setup() {
  const storage = new MemoryStorage();
  const service = new RecordsService(new LocalStore(storage, lock));
  return { storage, service };
}

test('read does not write, incomplete or ineligible result never creates a record', async () => {
  const { storage, service } = setup();
  assert.deepEqual(service.load().latest, []);
  assert.equal((await service.append(result('interrupted', { eligible: false }))).status, 'invalid');
  assert.equal(storage.writes, 0);
});

test('repeated result clicks and concurrent append calls save once by completedMatchId', async () => {
  const { storage, service } = setup();
  const completed = result('completed-once');
  const outcomes = await Promise.all([service.append(completed), service.append(completed), service.append(completed)]);
  assert.ok(outcomes.every(outcome => outcome.ok));
  assert.equal(storage.writes, 3);
  assert.equal(service.load().latest[0].completedMatchId, completed.matchId);
  assert.equal(service.load().latest.length, 1);
  await service.append(result('completed-once'));
  const reload = new RecordsService(new LocalStore(storage, lock));
  await reload.append(result('completed-once'));
  assert.equal(storage.writes, 3);
  assert.equal(reload.load().latest.length, 1);
});

test('twenty newest records remain while an older winning best is retained', async () => {
  const { service } = setup();
  await service.append(result('best-first', { playTicks: 100 }));
  for (let index = 1; index <= 24; index++) await service.append(result(`match-${index}`, { enemy: 2, playTicks: 500 + index }));
  const snapshot = service.load();
  assert.equal(snapshot.latest.length, 20);
  assert.equal(snapshot.latest[0].completedMatchId, 'match-24');
  assert.equal(snapshot.latest[19].completedMatchId, 'match-5');
  assert.equal(snapshot.best[recordGroup('normal', 'nusumidase-ctf-v1')].completedMatchId, 'best-first');
});

test('best ranks victory capture differential then time and separates mode/rulesVersion', async () => {
  const { service } = setup();
  await service.append(result('small-margin', { enemy: 2, playTicks: 100 }));
  await service.append(result('larger-margin', { enemy: 1, playTicks: 300 }));
  await service.append(result('faster-margin', { enemy: 1, playTicks: 200 }));
  await service.append(result('same-time', { enemy: 1, playTicks: 200 }));
  await service.append(result('draw', { friendly: 2, enemy: 2, playTicks: 1 }));
  await service.append(result('loss', { friendly: 0, enemy: 3, playTicks: 1 }));
  await service.append(result('easy-win', { mode: 'easy' }));
  await service.append(result('previous-rules', { rulesVersion: 'nusumidase-ctf-v0' }));
  const snapshot = service.load();
  assert.equal(snapshot.best[recordGroup('normal', 'nusumidase-ctf-v1')].completedMatchId, 'faster-margin');
  assert.equal(snapshot.best[recordGroup('easy', 'nusumidase-ctf-v1')].completedMatchId, 'easy-win');
  assert.equal(snapshot.best[recordGroup('normal', 'nusumidase-ctf-v0')].completedMatchId, 'previous-rules');
  assert.equal(Object.keys(snapshot.best).length, 3);
});

test('result is copied and deeply frozen before async append; bounded stats do not affect best', async () => {
  const { service } = setup();
  const completed = result('detached');
  (completed.stats as { kills: number }).kills = Infinity;
  (completed.stats as { returns: number }).returns = MAX_STATISTIC + 4;
  (completed.stats as { deaths: number }).deaths = -6;
  const pending = service.append(completed);
  (completed.captures as { friendly: number }).friendly = 0;
  (completed.stats as { captures: number }).captures = 999;
  assert.equal((await pending).ok, true);
  const snapshot = service.load();
  const record = snapshot.latest[0];
  assert.equal(record.captures.friendly, 3);
  assert.equal(record.stats.captures, 2);
  assert.equal(record.stats.kills, 0);
  assert.equal(record.stats.returns, MAX_STATISTIC);
  assert.equal(record.stats.deaths, 0);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.latest));
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.captures));
  assert.ok(Object.isFrozen(record.stats));
  assert.throws(() => { (record.stats as { kills: number }).kills = 2; }, TypeError);
});

test('record append failure preserves loaded raw/result and reload reads the journal old snapshot', async () => {
  const { storage, service } = setup();
  await service.append(result('existing'));
  const existingRaw = storage.values.get(K.records);
  const completed = result('save-failed');
  const copied = recordFromResult(completed);
  storage.rejectRecords = true;
  assert.equal((await service.append(completed)).status, 'failed');
  assert.equal(storage.values.get(K.records), existingRaw);
  assert.equal(service.load().latest.length, 1);
  const reload = new RecordsService(new LocalStore(storage, lock));
  assert.equal(reload.load().latest[0].completedMatchId, 'existing');
  assert.deepEqual(recordFromResult(completed), copied);
  const writesAfterFailure = storage.writes;
  await service.append(completed);
  assert.equal(storage.writes, writesAfterFailure);
});

test('future and malformed record raw remain exact and never receive automatic writes', async () => {
  for (const raw of [' {"version":99,"important":"future"} ', '{"version":1,"latest":"invalid"}', '{broken json']) {
    const { storage, service } = setup();
    storage.values.set(K.records, raw);
    assert.deepEqual(service.load().latest, []);
    assert.equal((await service.append(result('current'))).status, 'invalid');
    assert.equal(storage.values.get(K.records), raw);
    assert.equal(storage.writes, 0);
  }
});

test('one-core rules keep their best record separate from existing three-core records', async () => {
  const { service } = setup();
  assert.equal((await service.append(result('legacy-three-core'))).ok, true);
  const current = result('current-one-core', { rulesVersion: RULES_VERSION, friendly: 1 });
  assert.equal((await service.append(current)).ok, true);
  const snapshot = service.load();
  assert.equal(snapshot.best[recordGroup('normal', 'nusumidase-ctf-v1')].completedMatchId, 'legacy-three-core');
  assert.equal(snapshot.best[recordGroup('normal', RULES_VERSION)].completedMatchId, 'current-one-core');
});
