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

export function resolveSessionDuration(value: unknown, indefiniteAcknowledged: unknown, now = Date.now()):
    | { valid: true; expiresAt: number | undefined; indefinite: boolean }
    | { valid: false; message: string } {
    if (value === null) {
        return indefiniteAcknowledged === true
            ? { valid: true, expiresAt: undefined, indefinite: true }
            : { valid: false, message: 'Confirm that this contact authorized monitoring without a time limit.' };
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 60) {
        return { valid: false, message: 'Choose a duration from 1 to 60 minutes or no time limit.' };
    }
    return { valid: true, expiresAt: now + value * 60_000, indefinite: false };
}
