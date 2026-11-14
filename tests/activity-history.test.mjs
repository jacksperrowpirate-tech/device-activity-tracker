import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ActivityHistoryRecorder, FileActivityHistoryStore, historySubjectKey } from '../dist/infra/activity-history.js';

test('records a debounced estimated Online period with start, end and RTT', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-history-'));
    try {
        const key = historySubjectKey('whatsapp', '491701234567');
        const store = new FileActivityHistoryStore(path.join(directory, 'history.json'));
        await store.register({ key, platform: 'whatsapp', number: '491701234567', label: 'Pessoa A', createdAt: 100 });
        const recorder = new ActivityHistoryRecorder(store, key);
        await recorder.initialize();
        const update = (state, rtt) => ({ eventKind: 'measurement', measuredJid: 'device@lid', devices: [{ jid: 'device@lid', state, rtt }] });
        await recorder.observe(update('Online', 600), 1000);
        await recorder.observe(update('Online', 900), 2000);
        assert.deepEqual(await store.periods(key, 0, 100), []);
        await recorder.observe(update('Online', 1200), 3000);
        await recorder.observe(update('Online', 1300), 3500);
        await recorder.observe(update('Standby', 1600), 4000);
        await recorder.observe(update('Standby', 1700), 5000);
        await recorder.observe(update('Standby', 1800), 6000);
        const [period] = await store.periods(key, 0, 100);
        assert.equal(period.startedAt, 1000);
        assert.equal(period.endedAt, 4000);
        assert.equal(period.confirmedSamples, 4);
        assert.equal(period.meanRttMs, 1000);
        assert.equal(period.source, 'rtt-estimate');
        const reopened = new FileActivityHistoryStore(path.join(directory, 'history.json'));
        assert.equal((await reopened.subjects())[0].label, 'Pessoa A');
        assert.equal((await reopened.periods(key, 0, 100))[0].id, period.id);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('closes an unfinished interval at its last observation after restart', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-history-'));
    const store = new FileActivityHistoryStore(path.join(directory, 'history.json'));
    const key = historySubjectKey('signal', '491701234568');
    try {
        const first = new ActivityHistoryRecorder(store, key);
        const update = { eventKind: 'measurement', measuredJid: 'device', devices: [{ jid: 'device', state: 'Online', rtt: 700 }] };
        for (let i = 0; i < 3; i++) await first.observe(update, 1000 + i * 1000);
        const resumed = new ActivityHistoryRecorder(store, key);
        await resumed.initialize();
        const [period] = await store.periods(key, 0, 1);
        assert.equal(period.endedAt, 3000);
        assert.equal(period.endReason, 'interrupted');
    } finally { await rm(directory, { recursive: true, force: true }); }
});
