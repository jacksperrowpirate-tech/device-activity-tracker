import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Redis } from 'ioredis';

export const RECENT_PROBE_LIMIT = 240;

export interface TelemetrySample {
    id: string;
    kind: 'measurement' | 'no-ack';
    timestamp: number;
    rtt?: number;
    avg?: number;
    median?: number;
    threshold?: number;
    state?: string;
}

export interface TelemetryStore {
    append(contactId: string, sample: TelemetrySample): Promise<void>;
    recent(contactId: string): Promise<TelemetrySample[]>;
    clear(contactId: string): Promise<void>;
}

export class RedisTelemetryStore implements TelemetryStore {
    private pending: Promise<void> = Promise.resolve();
    private constructor(private readonly redis: Redis) {}
    static async connect(): Promise<RedisTelemetryStore> {
        const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true }) : new Redis({
            host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || '6379'),
            username: process.env.REDIS_USERNAME || undefined, password: process.env.REDIS_PASSWORD || undefined,
            lazyConnect: true
        });
        await redis.connect();
        return new RedisTelemetryStore(redis);
    }
    private key(contactId: string) { return `tracker:telemetry:${contactId}`; }
    private update(change: () => Promise<unknown>): Promise<void> {
        const task = this.pending.then(async () => { await change(); });
        this.pending = task.catch(() => undefined);
        return task;
    }
    async append(contactId: string, sample: TelemetrySample): Promise<void> {
        await this.update(() => this.redis.multi().lpush(this.key(contactId), JSON.stringify(sample))
            .ltrim(this.key(contactId), 0, RECENT_PROBE_LIMIT - 1).exec());
    }
    async recent(contactId: string): Promise<TelemetrySample[]> {
        await this.pending;
        return (await this.redis.lrange(this.key(contactId), 0, RECENT_PROBE_LIMIT - 1)).reverse().map(value => JSON.parse(value));
    }
    async clear(contactId: string): Promise<void> { await this.update(() => this.redis.del(this.key(contactId))); }
}

export class FileTelemetryStore implements TelemetryStore {
    private pending: Promise<void> = Promise.resolve();
    constructor(private readonly filename = path.join('data', 'telemetry.json')) {}
    private async read(): Promise<Record<string, TelemetrySample[]>> {
        try { return JSON.parse(await readFile(this.filename, 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
    }
    private update(change: (data: Record<string, TelemetrySample[]>) => void): Promise<void> {
        const task = this.pending.then(async () => {
            const data = await this.read();
            change(data);
            await mkdir(path.dirname(this.filename), { recursive: true });
            const temporary = `${this.filename}.${process.pid}.tmp`;
            await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
            await rename(temporary, this.filename);
        });
        this.pending = task.catch(() => undefined);
        return task;
    }
    async append(contactId: string, sample: TelemetrySample): Promise<void> {
        await this.update(data => { data[contactId] = [...(data[contactId] || []), sample].slice(-RECENT_PROBE_LIMIT); });
    }
    async recent(contactId: string): Promise<TelemetrySample[]> {
        await this.pending;
        return (await this.read())[contactId] || [];
    }
    async clear(contactId: string): Promise<void> { await this.update(data => { delete data[contactId]; }); }
}

export async function createTelemetryStore(): Promise<TelemetryStore> {
    return process.env.CONTACT_STORE === 'file' ? new FileTelemetryStore() : RedisTelemetryStore.connect();
}
