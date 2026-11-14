import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidAdminToken, normalizeConsentedNumber } from '../dist/security.js';

test('administrator token requires an exact match', () => {
    const expected = 'a-unique-long-administrator-token';
    assert.equal(isValidAdminToken(expected, expected), true);
    assert.equal(isValidAdminToken('wrong', expected), false);
    assert.equal(isValidAdminToken(null, expected), false);
    assert.equal(isValidAdminToken(123, expected), false);
});

test('consented numbers are normalized and invalid input is rejected', () => {
    assert.equal(normalizeConsentedNumber('+49 (170) 123-4567'), '491701234567');
    assert.equal(normalizeConsentedNumber('123'), null);
    assert.equal(normalizeConsentedNumber('49170abc123'), null);
    assert.equal(normalizeConsentedNumber({ number: '491701234567' }), null);
});
