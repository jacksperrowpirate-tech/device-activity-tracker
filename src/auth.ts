import { createHash, randomBytes, scrypt as callbackScrypt, timingSafeEqual } from 'node:crypto';
import { Redis } from 'ioredis';

const N = 16384;
const R = 8;
const P = 5;
const SESSION_SECONDS = 12 * 60 * 60;
const COOKIE_NAME = 'tracker_session';

function derive(password: string, salt: Buffer, length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => callbackScrypt(password, salt, length, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (error, result) => {
        if (error) reject(error);
        else resolve(result);
    }));
}

export async function hashPassword(password: string): Promise<string> {
    if (password.length < 12) throw new Error('Password must contain at least 12 characters');
    const salt = randomBytes(16);
    const derived = await derive(password, salt, 32);
    return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: unknown, encoded: string): Promise<boolean> {
    if (typeof password !== 'string' || password.length > 1024) return false;
    const parts = encoded.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltHex, hashHex] = parts;
    if (Number(n) !== N || Number(r) !== R || Number(p) !== P || !/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{64}$/.test(hashHex)) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await derive(password, Buffer.from(saltHex, 'hex'), expected.length);
    return timingSafeEqual(actual, expected);
}

function cookieValue(cookieHeader: string | undefined): string | null {
    const item = cookieHeader?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`));
    const value = item?.slice(COOKIE_NAME.length + 1);
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function sessionKey(token: string): string {
    return `admin:session:${createHash('sha256').update(token).digest('hex')}`;
}

export class AdminSessions {
    private readonly redis: Redis | null;
    private readonly local = new Map<string, number>();

    constructor() {
        this.redis = process.env.CONTACT_STORE === 'file' ? null : process.env.REDIS_URL
            ? new Redis(process.env.REDIS_URL)
            : new Redis({
                host: process.env.REDIS_HOST || '127.0.0.1',
                port: Number(process.env.REDIS_PORT || '6379'),
                username: process.env.REDIS_USERNAME || undefined,
                password: process.env.REDIS_PASSWORD || undefined
            });
    }

    async create(): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        if (this.redis) await this.redis.set(sessionKey(token), '1', 'EX', SESSION_SECONDS);
        else this.local.set(sessionKey(token), Date.now() + SESSION_SECONDS * 1000);
        return token;
    }

    async valid(cookieHeader: string | undefined): Promise<boolean> {
        const token = cookieValue(cookieHeader);
        if (!token) return false;
        if (this.redis) return (await this.redis.exists(sessionKey(token))) === 1;
        const expiry = this.local.get(sessionKey(token));
        if (!expiry || expiry <= Date.now()) { this.local.delete(sessionKey(token)); return false; }
        return true;
    }

    async revoke(cookieHeader: string | undefined): Promise<void> {
        const token = cookieValue(cookieHeader);
        if (!token) return;
        if (this.redis) await this.redis.del(sessionKey(token));
        else this.local.delete(sessionKey(token));
    }
}

export function sessionCookie(token: string, secure: boolean): string {
    return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(secure: boolean): string {
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
