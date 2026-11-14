import { Dispatch, SetStateAction, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { ContactInfo, DeviceInfo, TelemetrySample, TrackerData } from '../types/connections';
import { chartDataFromProbes, mergeRecentProbes } from '../utils/telemetry';

interface TrackerUpdate {
    jid?: string;
    eventKind?: 'measurement' | 'no-ack';
    measuredJid?: string;
    presence?: string | null;
    presenceUpdatedAt?: number | null;
    deviceCount?: number;
    devices?: DeviceInfo[];
    median?: number;
    threshold?: number;
    sample?: TelemetrySample;
}

export function useTrackerEvents(
    socket: Socket,
    setContacts: Dispatch<SetStateAction<Map<string, ContactInfo>>>
) {
    useEffect(() => {
        const onTrackerUpdate = (update: TrackerUpdate) => {
            const { jid, ...data } = update;
            if (!jid) return;
            setContacts(previous => {
                const contact = previous.get(jid);
                if (!contact) return previous;
                const next = new Map(previous);
                const updated = { ...contact };
                if (data.presence !== undefined) updated.presence = data.presence;
                if (data.presenceUpdatedAt !== undefined) updated.presenceUpdatedAt = data.presenceUpdatedAt;
                if (data.deviceCount !== undefined) updated.deviceCount = data.deviceCount;
                if (data.devices !== undefined) updated.devices = data.devices;
                if (data.eventKind !== undefined) updated.lastEventKind = data.eventKind;
                else if (data.sample) updated.lastEventKind = data.sample.kind;
                if (data.sample) {
                    updated.recentProbes = mergeRecentProbes(updated.recentProbes, [data.sample]);
                    updated.data = chartDataFromProbes(updated.recentProbes);
                }
                const device = data.devices?.find(item => item.jid === data.measuredJid && item.rtt > 0)
                    ?? data.devices?.find(item => item.rtt > 0);
                if (!data.sample && device && data.eventKind !== 'no-ack' && data.median !== undefined) {
                    const point: TrackerData = {
                        rtt: device.rtt,
                        avg: device.avg,
                        median: data.median,
                        threshold: data.threshold ?? 0,
                        state: device.state,
                        timestamp: Date.now()
                    };
                    updated.data = [...updated.data.slice(-119), point];
                }
                next.set(jid, updated);
                return next;
            });
        };
        socket.on('tracker-update', onTrackerUpdate);
        return () => { socket.off('tracker-update', onTrackerUpdate); };
    }, [socket, setContacts]);
}
