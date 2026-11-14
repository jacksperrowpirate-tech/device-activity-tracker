import { chartDataFromProbes, mergeRecentProbes, probeQuality } from './telemetry';

test('restores chart points and confirmation quality from persisted probes', () => {
    const measurement = { id: '1', kind: 'measurement' as const, timestamp: 1000, rtt: 850, avg: 850, median: 900, threshold: 810, state: 'Standby' };
    const missing = { id: '2', kind: 'no-ack' as const, timestamp: 2000 };
    const probes = mergeRecentProbes([measurement], [measurement, missing]);
    expect(probes).toHaveLength(2);
    expect(chartDataFromProbes(probes)).toEqual([{ rtt: 850, avg: 850, median: 900, threshold: 810, state: 'Standby', timestamp: 1000 }]);
    expect(probeQuality(probes)).toEqual({ confirmed: 1, total: 2, rate: 50, lastConfirmedAt: 1000 });
});
