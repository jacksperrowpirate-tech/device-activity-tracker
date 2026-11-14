import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Redis } from 'ioredis';
import type { Platform } from './contact-repository.js';

export interface HistorySubject {
    key: string;
    platform: Platform;
    number: string;
    label?: string;
    createdAt: number;
}

export interface ActivityPeriod {
    id: string;
    subjectKey: string;
    startedAt: number;
    endedAt: number | null;
    lastObservedAt: number;
    confirmedSamples: number;
    meanRttMs: number;
    source: 'rtt-estimate';
    endReason?: 'standby-estimate' | 'no-ack' | 'session-ended' | 'interrupted';
}

export interface ActivityHistoryStore {
    register(subject: HistorySubject): Promise<void>;
    subjects(): Promise<HistorySubject[]>;
    latest(subjectKey: string): Promise<ActivityPeriod | null>;
    save(period: ActivityPeriod): Promise<void>;
    periods(subjectKey: string, offset: number, limit: number): Promise<ActivityPeriod[]>;
    delete(subjectKey: string): Promise<void>;
}

export function historySubjectKey(platform: Platform, number: string): string {
    return `${platform}:${number}`;
}

export class RedisActivityHistoryStore implements ActivityHistoryStore {
    private constructor(private readonly redis: Redis) {}
    static async connect(): Promise<RedisActivityHistoryStore> {
        const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true }) : new Redis({
            host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || '6379'),
            username: process.env.REDIS_USERNAME || undefined, password: process.env.REDIS_PASSWORD || undefined,
            lazyConnect: true
        });
        await redis.connect();
        return new RedisActivityHistoryStore(redis);
    }
    private rows(key: string) { return `tracker:history:rows:${key}`; }
    private index(key: string) { return `tracker:history:index:${key}`; }
    async register(subject: HistorySubject): Promise<void> {
        const old = await this.redis.hget('tracker:history:subjects', subject.key);
        await this.redis.hset('tracker:history:subjects', subject.key, JSON.stringify({ ...subject, createdAt: old ? JSON.parse(old).createdAt : subject.createdAt }));
    }
    async subjects(): Promise<HistorySubject[]> {
        return Object.values(await this.redis.hgetall('tracker:history:subjects')).map(value => JSON.parse(value));
    }
    async latest(subjectKey: string): Promise<ActivityPeriod | null> {
        return (await this.periods(subjectKey, 0, 1))[0] || null;
    }
    async save(period: ActivityPeriod): Promise<void> {
        await this.redis.multi().hset(this.rows(period.subjectKey), period.id, JSON.stringify(period))
            .zadd(this.index(period.subjectKey), period.startedAt, period.id).exec();
    }
    async periods(subjectKey: string, offset: number, limit: number): Promise<ActivityPeriod[]> {
        const ids = await this.redis.zrevrange(this.index(subjectKey), offset, offset + limit - 1);
        if (!ids.length) return [];
        const rows = await this.redis.hmget(this.rows(subjectKey), ...ids);
        return rows.filter((value): value is string => Boolean(value)).map(value => JSON.parse(value));
    }
    async delete(subjectKey: string): Promise<void> {
        await this.redis.multi().hdel('tracker:history:subjects', subjectKey).del(this.rows(subjectKey)).del(this.index(subjectKey)).exec();
    }
}

interface HistoryFile { subjects: Record<string, HistorySubject>; periods: Record<string, ActivityPeriod[]> }
export class FileActivityHistoryStore implements ActivityHistoryStore {
    private pending: Promise<void> = Promise.resolve();
    constructor(private readonly filename = path.join('data', 'activity-history.json')) {}
    private async read(): Promise<HistoryFile> {
        try { return JSON.parse(await readFile(this.filename, 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { subjects: {}, periods: {} }; throw error; }
    }
    private update(change: (file: HistoryFile) => void): Promise<void> {
        const work = this.pending.then(async () => {
            const file = await this.read(); change(file);
            await mkdir(path.dirname(this.filename), { recursive: true });
            const temporary = `${this.filename}.${process.pid}.tmp`;
            await writeFile(temporary, JSON.stringify(file), { mode: 0o600 });
            await rename(temporary, this.filename);
        });
        this.pending = work.catch(() => undefined);
        return work;
    }
    async register(subject: HistorySubject): Promise<void> { await this.update(file => { file.subjects[subject.key] = { ...subject, createdAt: file.subjects[subject.key]?.createdAt || subject.createdAt }; }); }
    async subjects(): Promise<HistorySubject[]> { await this.pending; return Object.values((await this.read()).subjects); }
    async latest(key: string): Promise<ActivityPeriod | null> { return (await this.periods(key, 0, 1))[0] || null; }
    async save(period: ActivityPeriod): Promise<void> { await this.update(file => {
        const rows = file.periods[period.subjectKey] ||= [];
        const index = rows.findIndex(row => row.id === period.id);
        if (index >= 0) rows[index] = period; else rows.push(period);
    }); }
    async periods(key: string, offset: number, limit: number): Promise<ActivityPeriod[]> {
        await this.pending;
        return ((await this.read()).periods[key] || []).slice().sort((a, b) => b.startedAt - a.startedAt).slice(offset, offset + limit);
    }
    async delete(key: string): Promise<void> { await this.update(file => { delete file.subjects[key]; delete file.periods[key]; }); }
}

export async function createActivityHistoryStore(): Promise<ActivityHistoryStore> {
    return process.env.CONTACT_STORE === 'file' ? new FileActivityHistoryStore() : RedisActivityHistoryStore.connect();
}

interface Observation {
    eventKind?: 'measurement' | 'no-ack';
    measuredJid?: string;
    devices?: { jid: string; state: string; rtt: number }[];
}

export class ActivityHistoryRecorder {
    private open: ActivityPeriod | null = null;
    private candidate: 'Online' | 'Standby' | 'No ACK' | null = null;
    private candidateCount = 0;
    private candidateStartedAt = 0;
    private candidateTotalRtt = 0;
    private pending: Promise<void> = Promise.resolve();
    constructor(private readonly store: ActivityHistoryStore, readonly subjectKey: string) {}

    async initialize(): Promise<void> {
        const latest = await this.store.latest(this.subjectKey);
        if (latest?.endedAt === null) {
            latest.endedAt = latest.lastObservedAt;
            latest.endReason = 'interrupted';
            await this.store.save(latest);
        }
    }

    observe(update: Observation, at = Date.now()): Promise<void> {
        const task = this.pending.then(() => this.process(update, at));
        this.pending = task.catch(() => undefined);
        return task;
    }

    private async process(update: Observation, at: number): Promise<void> {
        const device = update.devices?.find(item => item.jid === update.measuredJid);
        const state = update.eventKind === 'no-ack' ? 'No ACK' : update.eventKind === 'measurement' ? device?.state : undefined;
        if (state !== 'Online' && state !== 'Standby' && state !== 'No ACK') return;
        if (this.candidate === state) { this.candidateCount++; this.candidateTotalRtt += device?.rtt || 0; }
        else { this.candidate = state; this.candidateCount = 1; this.candidateStartedAt = at; this.candidateTotalRtt = device?.rtt || 0; }
        if (state === 'Online' && this.open) {
            const count = this.open.confirmedSamples + 1;
            this.open.meanRttMs = Math.round((this.open.meanRttMs * this.open.confirmedSamples + (device?.rtt || 0)) / count);
            this.open.confirmedSamples = count;
            this.open.lastObservedAt = at;
            await this.store.save(this.open);
        }
        if (this.candidateCount < 3) return;
        if (state === 'Online' && !this.open) {
            this.open = { id: randomUUID(), subjectKey: this.subjectKey, startedAt: this.candidateStartedAt,
                endedAt: null, lastObservedAt: at, confirmedSamples: 3,
                meanRttMs: Math.round(this.candidateTotalRtt / 3), source: 'rtt-estimate' };
            await this.store.save(this.open);
        } else if (state !== 'Online' && this.open) {
            this.open.endedAt = this.candidateStartedAt;
            this.open.endReason = state === 'No ACK' ? 'no-ack' : 'standby-estimate';
            await this.store.save(this.open);
            this.open = null;
        }
    }

    async stop(at = Date.now()): Promise<void> {
        await this.pending;
        if (!this.open) return;
        this.open.endedAt = Math.min(at, this.open.lastObservedAt);
        this.open.endReason = 'session-ended';
        await this.store.save(this.open);
        this.open = null;
    }
}
