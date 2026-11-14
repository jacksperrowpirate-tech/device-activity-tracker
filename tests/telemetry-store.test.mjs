import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileTelemetryStore, RECENT_PROBE_LIMIT } from '../dist/infra/telemetry-store.js';

test('recent telemetry survives a store restart and remains bounded', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-telemetry-'));
    const filename = path.join(directory, 'telemetry.json');
    try {
        const first = new FileTelemetryStore(filename);
        for (let i = 0; i < RECENT_PROBE_LIMIT + 3; i++) {
            await first.append('contact-a', { id: String(i), kind: i % 2 ? 'no-ack' : 'measurement', timestamp: i, rtt: i });
        }
        const second = new FileTelemetryStore(filename);
        const rows = await second.recent('contact-a');
        assert.equal(rows.length, RECENT_PROBE_LIMIT);
        assert.equal(rows[0].id, '3');
        assert.equal(rows.at(-1).id, String(RECENT_PROBE_LIMIT + 2));
        await second.clear('contact-a');
        assert.deepEqual(await new FileTelemetryStore(filename).recent('contact-a'), []);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
