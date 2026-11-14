import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Redis } from 'ioredis';

export type Platform = 'whatsapp' | 'signal';
export interface TrackedContact {
    id: string;
    platform: Platform;
    consentedNumber: string;
    label?: string;
    notificationsAcknowledged: true;
    expiresAt?: number;
    probeMethod?: 'delete' | 'reaction';
}

function isAcknowledgedContact(item: any): item is TrackedContact {
    return typeof item?.id === 'string' &&
        (item.platform === 'whatsapp' || item.platform === 'signal') &&
        typeof item.consentedNumber === 'string' && /^\d{8,15}$/.test(item.consentedNumber) &&
        (item.label === undefined || (typeof item.label === 'string' && item.label.length <= 60)) &&
        item.notificationsAcknowledged === true &&
        (item.expiresAt === undefined || (Number.isFinite(item.expiresAt) && item.expiresAt > 0)) &&
        (item.probeMethod === undefined || item.probeMethod === 'delete' || item.probeMethod === 'reaction');
}

export interface ContactRepository {
    list(): Promise<TrackedContact[]>;
    save(contact: TrackedContact): Promise<void>;
    remove(id: string): Promise<void>;
    close(): Promise<void>;
}

export class FileContactRepository implements ContactRepository {
    private pending: Promise<void> = Promise.resolve();
    constructor(private readonly filename = path.join('data', 'contacts.json')) {}

    async list(): Promise<TrackedContact[]> {
        await this.pending;
        try {
            const parsed: unknown = JSON.parse(await readFile(this.filename, 'utf8'));
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(isAcknowledgedContact);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
    }

    private update(change: (items: TrackedContact[]) => TrackedContact[]): Promise<void> {
        const operation = this.pending.then(async () => {
            const items = await this.readWithoutPending();
            await mkdir(path.dirname(this.filename), { recursive: true });
            const temporary = `${this.filename}.${process.pid}.tmp`;
            await writeFile(temporary, JSON.stringify(change(items), null, 2), { mode: 0o600 });
            await rename(temporary, this.filename);
        });
        this.pending = operation.catch(() => undefined);
        return operation;
    }

    private async readWithoutPending(): Promise<TrackedContact[]> {
        try {
            const parsed: unknown = JSON.parse(await readFile(this.filename, 'utf8'));
            return Array.isArray(parsed) ? parsed.filter(isAcknowledgedContact) : [];
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
    }

    save(contact: TrackedContact): Promise<void> {
        return this.update(items => [...items.filter(item => item.id !== contact.id), contact]);
    }

    remove(id: string): Promise<void> {
        return this.update(items => items.filter(item => item.id !== id));
    }

    async close(): Promise<void> { await this.pending; }
}

export class RedisContactRepository implements ContactRepository {
    private constructor(private readonly redis: Redis) {}

    static async connect(): Promise<RedisContactRepository> {
        const redis = process.env.REDIS_URL
            ? new Redis(process.env.REDIS_URL, { lazyConnect: true })
            : new Redis({
                host: process.env.REDIS_HOST || '127.0.0.1',
                port: Number(process.env.REDIS_PORT || '6379'),
                username: process.env.REDIS_USERNAME,
                password: process.env.REDIS_PASSWORD,
                lazyConnect: true
            });
        await redis.connect();
        return new RedisContactRepository(redis);
    }

    async list(): Promise<TrackedContact[]> {
        const stored = await this.redis.hgetall('tracker:contacts');
        return Object.entries(stored).flatMap(([id, value]) => {
            try {
                const parsed: unknown = JSON.parse(value);
                const contact = { ...(typeof parsed === 'object' && parsed !== null ? parsed : {}), id };
                return isAcknowledgedContact(contact) ? [contact] : [];
            } catch {
                // Legacy values only stored the platform; their consent must be renewed.
                return [];
            }
        });
    }

    async save({ id, platform, consentedNumber, label, notificationsAcknowledged, expiresAt, probeMethod }: TrackedContact): Promise<void> {
        await this.redis.hset('tracker:contacts', id, JSON.stringify({ platform, consentedNumber, label, notificationsAcknowledged, expiresAt, probeMethod }));
    }

    async remove(id: string): Promise<void> {
        await this.redis.hdel('tracker:contacts', id);
    }

    async close(): Promise<void> { this.redis.disconnect(); }
}

export async function createContactRepository(): Promise<ContactRepository> {
    return process.env.CONTACT_STORE === 'file'
        ? new FileContactRepository()
        : RedisContactRepository.connect();
}
