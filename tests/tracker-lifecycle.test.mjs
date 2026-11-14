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

test('reaction probes refer to a message from the linked account', async () => {
    const sent = [];
    const socket = {
        ev: new EventEmitter(),
        ws: new EventEmitter(),
        sendMessage: async (jid, message) => { sent.push({ jid, message }); return null; }
    };
    const tracker = new WhatsAppTracker(socket, '491701234567@s.whatsapp.net');
    await tracker.sendReactionProbe();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.react.key.fromMe, true);
    assert.equal(sent[0].message.react.key.remoteJid, sent[0].jid);
    tracker.stopTracking();
});

test('an ACK arriving during sendMessage is measured and a timeout is not reported as offline', async () => {
    const events = new EventEmitter();
    const socket = {
        ev: events,
        ws: new EventEmitter(),
        user: { id: '491700000000@s.whatsapp.net' },
        presenceSubscribe: async () => undefined,
        sendMessage: async (jid, _message, options) => {
            events.emit('messages.update', [{
                key: { id: options.messageId, remoteJid: 'device-identifier@lid', fromMe: true },
                update: { status: 3 }
            }]);
            return { key: { id: options.messageId, remoteJid: jid } };
        }
    };
    const tracker = new WhatsAppTracker(socket, '491701234567@s.whatsapp.net');
    const updates = [];
    tracker.onUpdate = update => updates.push(update);
    await tracker.startTracking();
    tracker.stopTracking();
    assert.ok(updates.some(update => update.devices?.some(device => device.rtt > 0)));
    assert.equal(tracker.probeTimeouts.size, 0);

    tracker.markProbeUnconfirmed('491701234567@s.whatsapp.net', 10000);
    const unconfirmed = updates.at(-1).devices.find(device => device.state === 'No ACK');
    assert.equal(unconfirmed?.rtt, 0);
});

test('RTT estimate replaces a placeholder JID', () => {
    const socket = { ev: new EventEmitter(), ws: new EventEmitter() };
    const tracker = new WhatsAppTracker(socket, '491701234567@s.whatsapp.net');
    const updates = [];
    tracker.onUpdate = update => updates.push(update);
    tracker.markProbeUnconfirmed('491701234567@s.whatsapp.net', 10000);
    for (let i = 0; i < 3; i++) tracker.addMeasurementForDevice('device-identifier@lid', 1000);
    const latest = updates.at(-1);
    assert.equal(latest.devices.length, 1);
    assert.equal(latest.devices[0].state, 'Standby');
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
