import { TelemetrySample, TrackerData } from '../types/connections';

export function mergeRecentProbes(...groups: TelemetrySample[][]): TelemetrySample[] {
    const byId = new Map<string, TelemetrySample>();
    for (const group of groups) for (const sample of group) byId.set(sample.id, sample);
    return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-240);
}

export function chartDataFromProbes(samples: TelemetrySample[]): TrackerData[] {
    return samples.filter(sample => sample.kind === 'measurement' && Number.isFinite(sample.rtt) && (sample.rtt ?? 0) > 0)
        .slice(-120).map(sample => ({
            rtt: sample.rtt!, avg: sample.avg ?? sample.rtt!, median: sample.median ?? 0,
            threshold: sample.threshold ?? 0, state: sample.state ?? 'Sem classificação', timestamp: sample.timestamp
        }));
}

export function probeQuality(samples: TelemetrySample[]): { confirmed: number; total: number; rate: number | null; lastConfirmedAt: number | null } {
    const confirmed = samples.filter(sample => sample.kind === 'measurement');
    return {
        confirmed: confirmed.length,
        total: samples.length,
        rate: samples.length ? Math.round(confirmed.length / samples.length * 100) : null,
        lastConfirmedAt: confirmed.at(-1)?.timestamp ?? null
    };
}
