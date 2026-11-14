export type Platform = 'whatsapp' | 'signal';
export type ProbeMethod = 'delete' | 'reaction';

export interface ConnectionState {
    whatsapp: boolean;
    signal: boolean;
    signalNumber: string | null;
    signalApiAvailable: boolean;
    signalQrImage: string | null;
    whatsappQr: string | null;
}

export interface TrackerData {
    rtt: number;
    avg: number;
    median: number;
    threshold: number;
    state: string;
    timestamp: number;
}

export interface TelemetrySample {
    id: string;
    kind: 'measurement' | 'no-ack';
    timestamp: number;
    rtt?: number;
    avg?: number;
    median?: number;
    threshold?: number;
    state?: string;
}

export interface DeviceInfo {
    jid: string;
    state: string;
    rtt: number;
    avg: number;
}

export interface ContactInfo {
    jid: string;
    displayNumber: string;
    contactName: string;
    label?: string;
    data: TrackerData[];
    recentProbes: TelemetrySample[];
    devices: DeviceInfo[];
    deviceCount: number;
    presence: string | null;
    profilePic: string | null;
    platform: Platform;
    expiresAt?: number;
    lastEventKind?: 'measurement' | 'no-ack';
}
