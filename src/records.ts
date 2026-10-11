import { hasFutureVersion, LocalStore, STORAGE_KEYS, type SaveResult } from './storage';
import type { GameMode, GameResult } from './types';

export const MAX_RECORDS = 20;
export const MAX_STATISTIC = 1_000_000;
export interface RecordStatistics {
  readonly captures: number;
  readonly returns: number;
  readonly kills: number;
  readonly deaths: number;
}
export interface MatchRecord {
  readonly completedMatchId: string;
  readonly rulesVersion: string;
  readonly mode: GameMode;
  readonly outcome: 'victory' | 'defeat' | 'draw';
  readonly captures: Readonly<{ friendly: number; enemy: number }>;
  readonly playTicks: number;
  readonly stats: Readonly<RecordStatistics>;
}
export interface RecordsSnapshot {
  readonly version: 1;
  /** Newest first. */
  readonly latest: readonly MatchRecord[];
  readonly best: Readonly<Record<string, MatchRecord>>;
}

const boundedStatistic = (value: number): number => Number.isFinite(value)
  ? Math.min(MAX_STATISTIC, Math.max(0, Math.floor(value))) : 0;
const integer = (value: unknown, max = MAX_STATISTIC): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const objectValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200;

export function recordGroup(mode: GameMode, rulesVersion: string): string {
  return `${mode}:${rulesVersion}`;
}

function freezeRecord(record: MatchRecord): MatchRecord {
  return Object.freeze({ ...record,
    captures: Object.freeze({ ...record.captures }),
    stats: Object.freeze({ ...record.stats }),
  });
}
function emptyRecords(): RecordsSnapshot {
  return Object.freeze({ version: 1, latest: Object.freeze([]), best: Object.freeze({}) });
}

/** Detach the terminal result from the live simulation before any async save. */
export function recordFromResult(result: Readonly<GameResult>): MatchRecord | null {
  if (!result.recordEligible || !identifier(result.matchId) || !identifier(result.rulesVersion) ||
      (result.mode !== 'normal' && result.mode !== 'easy') ||
      !['victory', 'defeat', 'draw'].includes(result.outcome) ||
      !integer(result.playTicks, Number.MAX_SAFE_INTEGER) ||
      !integer(result.captures.friendly) || !integer(result.captures.enemy)) return null;
  return freezeRecord({
    completedMatchId: result.matchId,
    rulesVersion: result.rulesVersion,
    mode: result.mode,
    outcome: result.outcome,
    captures: { friendly: result.captures.friendly, enemy: result.captures.enemy },
    playTicks: result.playTicks,
    stats: {
      captures: boundedStatistic(result.stats.captures),
      returns: boundedStatistic(result.stats.returns),
      kills: boundedStatistic(result.stats.kills),
      deaths: boundedStatistic(result.stats.deaths),
    },
  });
}

function parseRecord(value: unknown): MatchRecord | null {
  if (!objectValue(value) || !identifier(value.completedMatchId) || !identifier(value.rulesVersion) ||
      (value.mode !== 'normal' && value.mode !== 'easy') ||
      (value.outcome !== 'victory' && value.outcome !== 'defeat' && value.outcome !== 'draw') ||
      !integer(value.playTicks, Number.MAX_SAFE_INTEGER) || !objectValue(value.captures) ||
      !integer(value.captures.friendly) || !integer(value.captures.enemy) || !objectValue(value.stats) ||
      !['captures', 'returns', 'kills', 'deaths'].every(key => integer((value.stats as Record<string, unknown>)[key]))) return null;
  return freezeRecord({
    completedMatchId: value.completedMatchId, rulesVersion: value.rulesVersion,
    mode: value.mode, outcome: value.outcome, playTicks: value.playTicks,
    captures: { friendly: value.captures.friendly, enemy: value.captures.enemy },
    stats: { captures: value.stats.captures as number, returns: value.stats.returns as number,
      kills: value.stats.kills as number, deaths: value.stats.deaths as number },
  });
}

function parseRecords(raw: string | null): RecordsSnapshot | null {
  if (raw === null) return emptyRecords();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!objectValue(value) || value.version !== 1 || !Array.isArray(value.latest) ||
      value.latest.length > MAX_RECORDS || !objectValue(value.best)) return null;
  const latest: MatchRecord[] = [];
  const ids = new Set<string>();
  for (const item of value.latest) {
    const record = parseRecord(item);
    if (!record || ids.has(record.completedMatchId)) return null;
    ids.add(record.completedMatchId);
    latest.push(record);
  }
  const best: Record<string, MatchRecord> = Object.create(null);
  for (const [key, item] of Object.entries(value.best)) {
    const record = parseRecord(item);
    if (!record || record.outcome !== 'victory' || key !== recordGroup(record.mode, record.rulesVersion)) return null;
    best[key] = record;
  }
  return Object.freeze({ version: 1, latest: Object.freeze(latest), best: Object.freeze(best) });
}

function better(candidate: MatchRecord, previous: MatchRecord | undefined): boolean {
  if (candidate.outcome !== 'victory') return false;
  if (!previous) return true;
  const difference = candidate.captures.friendly - candidate.captures.enemy;
  const previousDifference = previous.captures.friendly - previous.captures.enemy;
  return difference > previousDifference || (difference === previousDifference && candidate.playTicks < previous.playTicks);
}

const duplicateResult: SaveResult = Object.freeze({ ok: true, status: 'saved', message: 'この試合の記録は保存済みです。' });
const invalidResult: SaveResult = Object.freeze({ ok: false, status: 'invalid', message: '完了記録を保存できません。元のデータを保持しました。' });

/** No match in progress is persisted, and failed saves never modify the loaded records. */
export class RecordsService {
  private readonly attempts = new WeakMap<object, Promise<SaveResult>>();
  private queue: Promise<unknown> = Promise.resolve();
  private message = '';

  constructor(private readonly store = new LocalStore()) {}
  get warning(): string { return this.message || this.store.warning; }

  load(): RecordsSnapshot {
    const raw = this.store.read(STORAGE_KEYS.records);
    const records = parseRecords(raw);
    if (!records) this.message = '記録の保存形式を読み取れません。元のデータを保持しました。';
    return records ?? emptyRecords();
  }

  append(result: Readonly<GameResult>): Promise<SaveResult> {
    const previousAttempt = this.attempts.get(result);
    if (previousAttempt) return previousAttempt;
    const record = recordFromResult(result);
    if (!record) return Promise.resolve(invalidResult);
    const operation = this.queue.then(() => this.appendRecord(record));
    this.queue = operation.catch(() => undefined);
    this.attempts.set(result, operation);
    return operation;
  }

  private async appendRecord(record: MatchRecord): Promise<SaveResult> {
    const expected = this.store.snapshot([STORAGE_KEYS.records]);
    const raw = expected[STORAGE_KEYS.records];
    const records = parseRecords(raw);
    if (!records || hasFutureVersion(raw, 1)) {
      this.message = invalidResult.message;
      return invalidResult;
    }
    if (records.latest.some(item => item.completedMatchId === record.completedMatchId) ||
        Object.values(records.best).some(item => item.completedMatchId === record.completedMatchId)) return duplicateResult;
    const best = { ...records.best };
    const group = recordGroup(record.mode, record.rulesVersion);
    if (better(record, best[group])) best[group] = record;
    const proposed = JSON.stringify({ version: 1,
      latest: [record, ...records.latest].slice(0, MAX_RECORDS), best,
    });
    const outcome = await this.store.save(expected, { [STORAGE_KEYS.records]: proposed });
    this.message = outcome.ok ? '' : outcome.message;
    return outcome;
  }
}
