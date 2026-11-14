import { timingSafeEqual } from 'node:crypto';

export function isValidMonitorToken(candidate: unknown, expected: string): boolean {
    if (typeof candidate !== 'string') return false;
    const actual = Buffer.from(candidate);
    const secret = Buffer.from(expected);
    return actual.length === secret.length && timingSafeEqual(actual, secret);
}

export function normalizeConsentedNumber(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const digits = value.replace(/[\s()+.-]/g, '');
    return /^\d{8,15}$/.test(digits) ? digits : null;
}
