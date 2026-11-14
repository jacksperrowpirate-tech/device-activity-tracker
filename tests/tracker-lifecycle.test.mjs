import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsAppTracker } from '../dist/tracker.js';
import { SignalTracker } from '../dist/signal-tracker.js';

test('stopping a WhatsApp tracker removes its socket listeners', async () => {
    const events = new EventEmitter();
    const receipts = new EventEmitter();
    const socket = {
        ev: events,
        ws: receipts,
        presenceSubscribe: async () => undefined,
        sendMessage: async () => null
    };
    const tracker = new WhatsAppTracker(socket, '491701234567@s.whatsapp.net');
    await tracker.startTracking();
    assert.equal(events.listenerCount('messages.update'), 1);
    assert.equal(events.listenerCount('presence.update'), 1);
    assert.equal(receipts.listenerCount('CB:receipt'), 1);
    tracker.stopTracking();
    assert.equal(events.listenerCount('messages.update'), 0);
    assert.equal(events.listenerCount('presence.update'), 0);
    assert.equal(receipts.listenerCount('CB:receipt'), 0);
});

test('a failed Signal send does not classify the target as offline', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('failed', { status: 500 });
    try {
        const tracker = new SignalTracker('http://localhost:8080', '+491700000000', '+491701234567');
        const updates = [];
        tracker.onUpdate = update => updates.push(update);
        await tracker.sendSerializedProbe();
        assert.deepEqual(updates, []);
    } finally {
        globalThis.fetch = previousFetch;
    }
});
