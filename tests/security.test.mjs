import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidMonitorToken, normalizeConsentedNumber } from '../dist/security.js';
import { AdminSessions, hashPassword, verifyPassword, sessionCookie } from '../dist/auth.js';

test('internal monitor token requires an exact match', () => {
    const expected = 'a-unique-long-administrator-token';
    assert.equal(isValidMonitorToken(expected, expected), true);
    assert.equal(isValidMonitorToken('wrong', expected), false);
    assert.equal(isValidMonitorToken(null, expected), false);
    assert.equal(isValidMonitorToken(123, expected), false);
});

test('password hashes verify and session cookie is protected', async () => {
    const hash = await hashPassword('a-long-unique-password');
    assert.equal(await verifyPassword('a-long-unique-password', hash), true);
    assert.equal(await verifyPassword('incorrect-password', hash), false);
    assert.match(sessionCookie('sample', true), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=/);
    assert.match(sessionCookie('sample', true), /; Secure$/);
});

test('session can be verified and revoked without exposing its secret', async () => {
    const previous = process.env.CONTACT_STORE;
    process.env.CONTACT_STORE = 'file';
    try {
        const sessions = new AdminSessions();
        const token = await sessions.create();
        const cookie = sessionCookie(token, false).split(';')[0];
        assert.equal(await sessions.valid(cookie), true);
        assert.equal(await sessions.valid('tracker_session=invalid'), false);
        await sessions.revoke(cookie);
        assert.equal(await sessions.valid(cookie), false);
    } finally {
        if (previous === undefined) delete process.env.CONTACT_STORE;
        else process.env.CONTACT_STORE = previous;
    }
});

test('consented numbers are normalized and invalid input is rejected', () => {
    assert.equal(normalizeConsentedNumber('+49 (170) 123-4567'), '491701234567');
    assert.equal(normalizeConsentedNumber('123'), null);
    assert.equal(normalizeConsentedNumber('49170abc123'), null);
    assert.equal(normalizeConsentedNumber({ number: '491701234567' }), null);
});
