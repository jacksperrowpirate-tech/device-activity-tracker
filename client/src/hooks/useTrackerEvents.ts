import { Dispatch, SetStateAction, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { ContactInfo, DeviceInfo, TrackerData } from '../types/connections';

interface TrackerUpdate {
    jid?: string;
    presence?: string | null;
    deviceCount?: number;
    devices?: DeviceInfo[];
    median?: number;
    threshold?: number;
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
                if (data.deviceCount !== undefined) updated.deviceCount = data.deviceCount;
                if (data.devices !== undefined) updated.devices = data.devices;
                const device = data.devices?.[0];
                if (device && data.median !== undefined) {
                    const point: TrackerData = {
                        rtt: device.rtt,
                        avg: device.avg,
                        median: data.median,
                        threshold: data.threshold ?? 0,
                        state: data.devices?.find(item => item.state.includes('Online'))?.state ?? device.state,
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
