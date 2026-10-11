/** Only these game-owned keys may be accessed; legacy settings are read-only. */
export const STORAGE_KEYS = Object.freeze({
  controls: 'nusumidase-controls-v2',
  easyControls: 'nusumidase-controls-easy-v2',
  keyboard: 'nusumidase-keyboard-v1',
  legacyControls: 'nusumidase-controls-v1',
  legacyEasyControls: 'nusumidase-controls-easy-v1',
  records: 'nusumidase-records-v1',
  journal: 'nusumidase-transaction-v1',
});

export type DataKey = Exclude<typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS], typeof STORAGE_KEYS.journal>;
export type RawSnapshot = Record<string, string | null>;
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
/** Returning null means no exclusive transaction lease was available. */
export interface ExclusiveLock {
  run<T>(task: () => Promise<T>): Promise<T | null>;
}
export type SaveStatus = 'saved' | 'conflict' | 'unavailable' | 'invalid' | 'failed' | 'recovery-required';
export interface SaveResult {
  ok: boolean;
  status: SaveStatus;
  message: string;
}

interface Journal {
  version: 1;
  transactionId: string;
  state: 'pending' | 'committed';
  old: RawSnapshot;
  proposed: Record<string, string>;
}
const dataKeys = new Set<string>(Object.values(STORAGE_KEYS).filter(key => key !== STORAGE_KEYS.journal));
const writableVersions: Readonly<Record<string, number>> = Object.freeze({
  [STORAGE_KEYS.controls]: 2,
  [STORAGE_KEYS.easyControls]: 2,
  [STORAGE_KEYS.keyboard]: 1,
  [STORAGE_KEYS.records]: 1,
});
const messages: Record<SaveStatus, string> = {
  saved: '保存しました。',
  conflict: '別のタブで設定が変わりました。開き直して確認してください。',
  unavailable: '安全な保存ロックを取得できません。「今回だけ使う」を選べます。',
  invalid: '未知の保存形式または不正な値があります。元のデータを保持しました。',
  failed: '保存できませんでした。元の設定を保持しました。',
  'recovery-required': '保存の復元未完了です。元の設定で続行します。',
};
const result = (status: SaveStatus): SaveResult => ({ ok: status === 'saved', status, message: messages[status] });
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const objectValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

/** Malformed JSON can be replaced by an explicit Save; a declared unknown version cannot. */
export function hasFutureVersion(raw: string | null, supportedVersion: number): boolean {
  if (raw === null) return false;
  const value = parse(raw);
  if (!objectValue(value) || !owns(value, 'version')) return false;
  return !Number.isInteger(value.version) || (value.version as number) > supportedVersion || (value.version as number) < 1;
}

function parseJournal(raw: string | null): Journal | null {
  if (raw === null) return null;
  const value = parse(raw);
  if (!objectValue(value) || value.version !== 1 || typeof value.transactionId !== 'string' ||
      value.transactionId.length === 0 || value.transactionId.length > 200 ||
      (value.state !== 'pending' && value.state !== 'committed') || !objectValue(value.old) ||
      !objectValue(value.proposed)) return null;
  const keys = Object.keys(value.proposed);
  if (keys.length === 0 || keys.length > Object.keys(writableVersions).length ||
      Object.keys(value.old).length !== keys.length) return null;
  for (const key of keys) {
    if (!owns(writableVersions, key) || !owns(value.old, key) ||
        (value.old[key] !== null && typeof value.old[key] !== 'string') ||
        typeof value.proposed[key] !== 'string') return null;
    const proposed = parse(value.proposed[key] as string);
    if (!objectValue(proposed) || proposed.version !== writableVersions[key]) return null;
  }
  return value as unknown as Journal;
}

function browserStorage(): StorageLike | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}
function browserLock(): ExclusiveLock | undefined {
  if (typeof navigator === 'undefined' || !navigator.locks) return undefined;
  return {
    run: async task => await navigator.locks.request('nusumidase-storage-transaction',
      { mode: 'exclusive', ifAvailable: true }, async lock => lock ? await task() : null),
  };
}

/**
 * Reads never mutate storage. A pending journal supplies its coherent old snapshot,
 * even after a partial write or failed rollback. Only Save attempts recovery/write.
 */
export class LocalStore {
  private readonly storage: StorageLike | undefined;
  private readonly locks: ExclusiveLock | undefined;
  private memoryJournal: Journal | null = null;
  private readonly snapshotRevisions = new WeakMap<RawSnapshot, string | null>();
  private message = '';

  constructor(storage: StorageLike | undefined = browserStorage(), locks: ExclusiveLock | null | undefined = browserLock()) {
    this.storage = storage;
    this.locks = locks ?? undefined;
  }

  get warning(): string { return this.message; }

  private raw(key: string): string | null {
    if (!this.storage) throw new Error('Storage unavailable');
    return this.storage.getItem(key);
  }

  private checkKey(key: string): void {
    if (!dataKeys.has(key)) throw new Error('Storage key is outside the nusumidase allowlist');
  }

  private inspect(): { journal: Journal | null; blocked: boolean; raw: string | null } {
    const raw = this.raw(STORAGE_KEYS.journal);
    const journal = parseJournal(raw);
    if (raw !== null && journal === null) {
      this.message = messages.invalid;
      return { journal: this.memoryJournal, blocked: true, raw };
    }
    if (this.memoryJournal && raw === null) {
      this.message = messages['recovery-required'];
      return { journal: this.memoryJournal, blocked: true, raw };
    }
    if (this.memoryJournal && journal?.transactionId === this.memoryJournal.transactionId) {
      // A failed committed-marker verification must retain the old active snapshot.
      this.message = messages['recovery-required'];
      return { journal: this.memoryJournal, blocked: false, raw };
    }
    if (journal?.state === 'committed' && Object.keys(journal.proposed).some(key => this.raw(key) !== journal.proposed[key])) {
      this.message = messages['recovery-required'];
      return { journal: { ...journal, state: 'pending' }, blocked: false, raw };
    }
    if (journal?.state === 'pending') this.message = messages['recovery-required'];
    return { journal, blocked: false, raw };
  }

  read(key: string): string | null {
    return this.snapshot([key])[key];
  }

  snapshot(keys: readonly string[]): RawSnapshot {
    for (const key of keys) this.checkKey(key);
    const values: RawSnapshot = {};
    try {
      const inspection = this.inspect();
      this.snapshotRevisions.set(values, inspection.raw);
      for (const key of keys) {
        if (inspection.journal?.state === 'pending' && owns(inspection.journal.old, key)) {
          values[key] = inspection.journal.old[key];
        } else {
          values[key] = inspection.blocked ? null : this.raw(key);
        }
      }
    } catch {
      this.message = messages.unavailable;
      for (const key of keys) values[key] = this.memoryJournal && owns(this.memoryJournal.old, key)
        ? this.memoryJournal.old[key] : null;
    }
    return values;
  }

  private write(key: string, raw: string | null): void {
    if (!this.storage) throw new Error('Storage unavailable');
    if (raw === null) this.storage.removeItem(key);
    else this.storage.setItem(key, raw);
  }

  /** Compare before every restore so future/foreign raw is never overwritten. */
  private rollback(journal: Journal, journalRaw: string): boolean {
    this.memoryJournal = { ...journal, state: 'pending' };
    try {
      if (this.raw(STORAGE_KEYS.journal) !== journalRaw) return false;
      for (const key of Object.keys(journal.old)) {
        const current = this.raw(key);
        if (current !== journal.old[key] && current !== journal.proposed[key]) return false;
      }
      // Restore a durable pending marker before restoring data, so a crash or
      // rejected rollback still reloads the old coherent snapshot.
      if (parseJournal(journalRaw)?.state === 'committed') {
        const pendingRaw = JSON.stringify({ ...journal, state: 'pending' });
        this.write(STORAGE_KEYS.journal, pendingRaw);
        if (this.raw(STORAGE_KEYS.journal) !== pendingRaw) return false;
        journalRaw = pendingRaw;
      }
      for (const key of Object.keys(journal.old)) {
        if (this.raw(STORAGE_KEYS.journal) !== journalRaw) return false;
        const current = this.raw(key);
        if (current === journal.old[key]) continue;
        if (current !== journal.proposed[key]) return false;
        this.write(key, journal.old[key]);
        if (this.raw(key) !== journal.old[key]) return false;
      }
      // Keep the pending journal and raw backup until the next complete transaction.
      return true;
    } catch { return false; }
  }

  async save(expected: RawSnapshot, proposed: RawSnapshot): Promise<SaveResult> {
    const keys = Object.keys(proposed);
    if (keys.length === 0 || Object.keys(expected).some(key => !dataKeys.has(key))) return result('invalid');
    for (const key of keys) {
      if (!owns(writableVersions, key) || !owns(expected, key) || typeof proposed[key] !== 'string') return result('invalid');
      const value = parse(proposed[key] as string);
      if (!objectValue(value) || value.version !== writableVersions[key]) return result('invalid');
    }
    if (!this.storage || !this.locks) return result('unavailable');
    try {
      const saved = await this.locks.run(async () => this.saveExclusive(expected, proposed as Record<string, string>));
      const outcome = saved ?? result('unavailable');
      if (!outcome.ok) this.message = outcome.message;
      return outcome;
    } catch {
      this.message = messages.failed;
      return result('failed');
    }
  }

  private saveExclusive(expected: RawSnapshot, proposed: Record<string, string>): SaveResult {
    const inspection = this.inspect();
    if (inspection.blocked) return result('invalid');
    if (this.snapshotRevisions.has(expected) && this.snapshotRevisions.get(expected) !== inspection.raw) return result('conflict');
    if (inspection.journal?.state === 'pending') {
      if (!this.rollback(inspection.journal, inspection.raw as string)) return result('recovery-required');
    }
    for (const key of Object.keys(expected)) {
      if (this.raw(key) !== expected[key]) return result('conflict');
    }
    for (const key of Object.keys(proposed)) {
      if (hasFutureVersion(expected[key], writableVersions[key])) return result('invalid');
      const legacy = key === STORAGE_KEYS.controls ? STORAGE_KEYS.legacyControls
        : key === STORAGE_KEYS.easyControls ? STORAGE_KEYS.legacyEasyControls : null;
      if (legacy && expected[key] === null && hasFutureVersion(this.raw(legacy), 1)) return result('invalid');
    }
    const old: RawSnapshot = {};
    for (const key of Object.keys(proposed)) old[key] = expected[key];
    const journal: Journal = {
      version: 1,
      transactionId: globalThis.crypto?.randomUUID?.() ?? `txn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      state: 'pending', old, proposed,
    };
    const pendingRaw = JSON.stringify(journal);
    let lastJournalRaw = pendingRaw;
    let journalVerified = false;
    try {
      this.write(STORAGE_KEYS.journal, pendingRaw);
      if (this.raw(STORAGE_KEYS.journal) !== pendingRaw) throw new Error('Journal readback mismatch');
      journalVerified = true;
      this.memoryJournal = journal;
      // The lock coordinates participating tabs. This second comparison also catches
      // writers that changed a baseline while the journal was being persisted.
      for (const key of Object.keys(expected)) {
        if (this.raw(key) !== expected[key]) throw new Error('Concurrent storage change');
      }
      for (const key of Object.keys(proposed)) {
        if (this.raw(STORAGE_KEYS.journal) !== pendingRaw || this.raw(key) !== old[key]) throw new Error('Concurrent storage change');
        this.write(key, proposed[key]);
      }
      for (const key of Object.keys(proposed)) {
        if (this.raw(key) !== proposed[key]) throw new Error('Data readback mismatch');
      }
      if (this.raw(STORAGE_KEYS.journal) !== pendingRaw) throw new Error('Journal changed');
      const committedRaw = JSON.stringify({ ...journal, state: 'committed' });
      // If a write succeeds but its readback throws, rollback must compare against
      // the marker that might actually have been installed.
      lastJournalRaw = committedRaw;
      this.write(STORAGE_KEYS.journal, committedRaw);
      if (this.raw(STORAGE_KEYS.journal) !== committedRaw) throw new Error('Commit readback mismatch');
      for (const key of Object.keys(proposed)) {
        if (this.raw(key) !== proposed[key]) throw new Error('Final data readback mismatch');
      }
      this.memoryJournal = null;
      this.message = '';
      return result('saved');
    } catch {
      if (!journalVerified) return result('failed');
      // A rejected marker write leaves the pending marker; an accepted write leaves
      // the committed marker. Either is our transaction, never a foreign marker.
      try {
        const present = this.raw(STORAGE_KEYS.journal);
        const ownMarker = present === pendingRaw || present === lastJournalRaw;
        if (ownMarker && this.rollback(journal, present as string)) return result('failed');
      } catch { /* retain journal and the old in-memory snapshot */ }
      return result('recovery-required');
    }
  }
}
