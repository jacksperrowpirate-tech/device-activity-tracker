import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Redis } from 'ioredis';

export interface WhatsAppProfile {
    photoUrl?: string;
    sharedName?: string;
    nameSource?: 'contact' | 'business';
    about?: string;
    aboutSetAt?: number;
    business?: { description?: string; category?: string; website?: string; email?: string; address?: string };
    fetchedAt: number;
}

export interface ProfileStore {
    get(id: string): Promise<WhatsAppProfile | null>;
    save(id: string, profile: WhatsAppProfile): Promise<void>;
    remove(id: string): Promise<void>;
}

export class FileProfileStore implements ProfileStore {
    private pending: Promise<void> = Promise.resolve();
    constructor(private readonly filename = path.join('data', 'profiles.json')) {}
    private async read(): Promise<Record<string, WhatsAppProfile>> {
        try { return JSON.parse(await readFile(this.filename, 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
    }
    async get(id: string): Promise<WhatsAppProfile | null> {
        await this.pending;
        return (await this.read())[id] ?? null;
    }
    private update(change: (profiles: Record<string, WhatsAppProfile>) => void): Promise<void> {
        const operation = this.pending.then(async () => {
            const profiles = await this.read();
            change(profiles);
            await mkdir(path.dirname(this.filename), { recursive: true });
            const temporary = `${this.filename}.${process.pid}.tmp`;
            await writeFile(temporary, JSON.stringify(profiles, null, 2), { mode: 0o600 });
            await rename(temporary, this.filename);
        });
        this.pending = operation.catch(() => undefined);
        return operation;
    }
    save(id: string, profile: WhatsAppProfile): Promise<void> { return this.update(profiles => { profiles[id] = profile; }); }
    remove(id: string): Promise<void> { return this.update(profiles => { delete profiles[id]; }); }
}

export class RedisProfileStore implements ProfileStore {
    private constructor(private readonly redis: Redis) {}
    static async connect(): Promise<RedisProfileStore> {
        const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true }) : new Redis({
            host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || '6379'),
            username: process.env.REDIS_USERNAME || undefined, password: process.env.REDIS_PASSWORD || undefined,
            lazyConnect: true
        });
        await redis.connect();
        return new RedisProfileStore(redis);
    }
    async get(id: string): Promise<WhatsAppProfile | null> {
        const value = await this.redis.hget('tracker:profiles', id);
        return value ? JSON.parse(value) : null;
    }
    async save(id: string, profile: WhatsAppProfile): Promise<void> {
        await this.redis.hset('tracker:profiles', id, JSON.stringify(profile));
    }
    async remove(id: string): Promise<void> { await this.redis.hdel('tracker:profiles', id); }
}

export async function createProfileStore(): Promise<ProfileStore> {
    return process.env.CONTACT_STORE === 'file' ? new FileProfileStore() : RedisProfileStore.connect();
}
