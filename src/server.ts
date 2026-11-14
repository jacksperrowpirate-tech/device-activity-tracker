/**
 * Device Activity Tracker - Web Server
 *
 * HTTP server with Socket.IO for real-time tracking visualization.
 * Provides REST API and WebSocket interface for the React frontend.
 *
 * For educational and research purposes only.
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { pino } from 'pino';
import { Boom } from '@hapi/boom';
import { WhatsAppTracker, ProbeMethod } from './tracker.js';
import { SignalTracker, getSignalAccounts, checkSignalNumber } from './signal-tracker.js';
import { isValidMonitorToken, normalizeConsentedNumber, resolveSessionDuration } from './security.js';
import { createContactRepository, type TrackedContact } from './infra/contact-repository.js';
import { AdminSessions, clearedSessionCookie, sessionCookie, verifyPassword } from './auth.js';
import { ActivityHistoryRecorder, createActivityHistoryStore, historySubjectKey, type HistorySubject } from './infra/activity-history.js';
import { createTelemetryStore, type TelemetrySample } from './infra/telemetry-store.js';
import { randomUUID } from 'node:crypto';

process.umask(0o077);

// Configuration
const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:8080';
const MONITOR_TOKEN = process.env.MONITOR_TOKEN;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
if (!ADMIN_PASSWORD_HASH) throw new Error('ADMIN_PASSWORD_HASH must be configured');
if (MONITOR_TOKEN && MONITOR_TOKEN.length < 24) throw new Error('Monitor token is too short');
const secureCookies = process.env.PUBLIC_HTTPS === 'true';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',').map(origin => origin.trim()).filter(Boolean);

const app = express();
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '2kb' }));
app.get('/health', (_request, response) => response.json({ status: 'ok' }));
const sessions = new AdminSessions();
const loginFailures = new Map<string, { count: number; until: number }>();
const loginWindowMs = 15 * 60_000;

app.use('/api/auth', (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
        response.status(403).json({ message: 'Origin not allowed' });
        return;
    }
    next();
});

app.get('/api/auth/session', async (request, response) => {
    try {
        if (await sessions.valid(request.headers.cookie)) response.json({ username: ADMIN_USERNAME });
        else response.status(401).json({ message: 'Not signed in' });
    } catch { response.status(503).json({ message: 'Session service unavailable' }); }
});

app.post('/api/auth/login', async (request, response) => {
    const key = request.ip || 'unknown';
    const now = Date.now();
    const failures = loginFailures.get(key);
    if (failures && failures.count >= 5 && failures.until > now) {
        response.status(429).json({ message: 'Too many attempts. Try again later.' });
        return;
    }
    const username = request.body?.username;
    const password = request.body?.password;
    try {
        const validPassword = await verifyPassword(password, ADMIN_PASSWORD_HASH);
        if (username !== ADMIN_USERNAME || !validPassword) {
            loginFailures.set(key, { count: (failures && failures.until > now ? failures.count : 0) + 1, until: now + loginWindowMs });
            response.status(401).json({ message: 'Invalid username or password' });
            return;
        }
        loginFailures.delete(key);
        const token = await sessions.create();
        response.setHeader('Set-Cookie', sessionCookie(token, secureCookies));
        response.json({ username: ADMIN_USERNAME });
    } catch { response.status(503).json({ message: 'Login unavailable' }); }
});

app.post('/api/auth/logout', async (request, response) => {
    try { await sessions.revoke(request.headers.cookie); } catch { /* Clear browser cookie even if Redis is unavailable. */ }
    response.setHeader('Set-Cookie', clearedSessionCookie(secureCookies));
    response.status(204).end();
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },
    allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        callback(null, !origin || allowedOrigins.includes(origin));
    }
});
io.use(async (socket, next) => {
    try {
        if (await sessions.valid(socket.handshake.headers.cookie)) return next();
        // Existing local experiment collectors use this temporary internal credential.
        if (MONITOR_TOKEN && isValidMonitorToken(socket.handshake.auth?.token, MONITOR_TOKEN)) return next();
    } catch { /* Fail closed when the session store is unavailable. */ }
    next(new Error('Unauthorized'));
});

let sock: any;
let isWhatsAppConnected = false;
let isSignalConnected = false;
let signalAccountNumber: string | null = null;
let globalProbeMethod: ProbeMethod = 'reaction';
let currentWhatsAppQr: string | null = null; // Store current QR code for new clients

// Platform type for contacts
type Platform = 'whatsapp' | 'signal';

interface TrackerEntry {
    tracker: WhatsAppTracker | SignalTracker;
    platform: Platform;
}

const trackers: Map<string, TrackerEntry> = new Map(); // JID/Number -> Tracker entry
const pendingContacts = new Set<string>();
const repository = await createContactRepository();
const historyStore = await createActivityHistoryStore();
const telemetryStore = await createTelemetryStore();
const activityRecorders = new Map<string, ActivityHistoryRecorder>();

app.get('/api/history/export', async (request, response) => {
    try {
        if (!(await sessions.valid(request.headers.cookie))) { response.status(401).end(); return; }
        const key = request.query.subjectKey;
        const subject = typeof key === 'string' ? (await historyStore.subjects()).find(item => item.key === key) : undefined;
        if (!subject) { response.status(404).end(); return; }
        const cell = (value: unknown) => {
            let text = String(value ?? '');
            if (/^[=+\-@]/.test(text)) text = `'${text}`;
            return `"${text.replace(/"/g, '""')}"`;
        };
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="activity-history.csv"');
        response.setHeader('Cache-Control', 'no-store');
        response.write('\ufeff');
        response.write('nome,plataforma,numero,inicio,fim,duracao_segundos,rtt_medio_ms,origem,motivo_fim\n');
        let offset = 0;
        while (true) {
            const rows = await historyStore.periods(subject.key, offset, 200);
            for (const period of rows) {
                const duration = period.endedAt === null ? '' : Math.max(0, Math.round((period.endedAt - period.startedAt) / 1000));
                response.write([subject.label, subject.platform, subject.number, new Date(period.startedAt).toISOString(), period.endedAt === null ? '' : new Date(period.endedAt).toISOString(), duration, period.meanRttMs, period.source, period.endReason].map(cell).join(',') + '\n');
            }
            if (rows.length < 200) break;
            offset += rows.length;
        }
        response.end();
    } catch { if (!response.headersSent) response.status(500).end(); else response.end(); }
});
const expiryTimers = new Map<string, NodeJS.Timeout>();
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelay = 2000;

async function removeTrackedContact(id: string) {
    const timer = expiryTimers.get(id);
    if (timer) clearTimeout(timer);
    expiryTimers.delete(id);
    const entry = trackers.get(id);
    if (entry) {
        entry.tracker.stopTracking();
        trackers.delete(id);
    }
    const recorder = activityRecorders.get(id);
    if (recorder) { await recorder.stop(); activityRecorders.delete(id); }
    await repository.remove(id);
    await telemetryStore.clear(id);
    io.emit('contact-removed', id);
}

async function prepareActivityRecorder(contact: TrackedContact): Promise<void> {
    const key = historySubjectKey(contact.platform, contact.consentedNumber);
    const subject: HistorySubject = { key, platform: contact.platform, number: contact.consentedNumber, label: contact.label, createdAt: Date.now() };
    await historyStore.register(subject);
    const recorder = new ActivityHistoryRecorder(historyStore, key);
    await recorder.initialize();
    activityRecorders.set(contact.id, recorder);
}

function publishTrackerUpdate(contact: TrackedContact, data: any): void {
    const device = data.devices?.find((item: any) => item.jid === data.measuredJid && item.rtt > 0)
        ?? data.devices?.find((item: any) => item.rtt > 0);
    let sample: TelemetrySample | undefined;
    if (data.eventKind === 'no-ack' || (!device && data.devices?.some((item: any) => item.state === 'No ACK'))) {
        sample = { id: randomUUID(), kind: 'no-ack', timestamp: Date.now() };
    } else if (device && data.eventKind !== 'no-ack' && Number.isFinite(device.rtt) && device.rtt > 0) {
        sample = { id: randomUUID(), kind: 'measurement', timestamp: Date.now(), rtt: device.rtt,
            avg: device.avg, median: data.median, threshold: data.threshold, state: device.state };
    }
    io.emit('tracker-update', { jid: contact.id, platform: contact.platform, ...data, sample });
    if (sample) void telemetryStore.append(contact.id, sample).catch(error => console.error('Could not save telemetry sample', error));
    const recorder = activityRecorders.get(contact.id);
    if (recorder) void recorder.observe(data).catch(error => console.error('Could not record activity estimate', error));
}

function scheduleExpiry(contact: TrackedContact) {
    if (!contact.expiresAt) return;
    const previous = expiryTimers.get(contact.id);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
        void removeTrackedContact(contact.id).catch(error => console.error('Could not expire tracked contact', error));
    }, Math.max(0, contact.expiresAt - Date.now()));
    expiryTimers.set(contact.id, timer);
}

function normalizeLabel(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') return null;
    const label = value.trim();
    return label.length <= 60 && !/[\x00-\x1f\x7f]/.test(label) ? label : null;
}

function scheduleWhatsAppReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connectToWhatsApp().catch(error => {
            console.error('WhatsApp reconnect failed', error);
            scheduleWhatsAppReconnect();
        });
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

async function stopPlatform(platform: Platform) {
    for (const [id, entry] of trackers) {
        if (entry.platform === platform) {
            entry.tracker.stopTracking();
            trackers.delete(id);
            const recorder = activityRecorders.get(id);
            if (recorder) { await recorder.stop(); activityRecorders.delete(id); }
        }
    }
}

async function rehydratePlatform(platform: Platform) {
    const contacts = await repository.list();
    for (const contact of contacts) {
        if (contact.platform !== platform || trackers.has(contact.id)) continue;
        if (contact.expiresAt && contact.expiresAt <= Date.now()) {
            await removeTrackedContact(contact.id);
            continue;
        }
        const number = contact.consentedNumber;
        try {
            if (platform === 'whatsapp' && isWhatsAppConnected) {
                const tracker = new WhatsAppTracker(sock, contact.id);
                tracker.setProbeMethod(contact.probeMethod || 'reaction');
                await prepareActivityRecorder(contact);
                tracker.onUpdate = data => publishTrackerUpdate(contact, data);
                trackers.set(contact.id, { tracker, platform });
                await tracker.startTracking();
            } else if (platform === 'signal' && isSignalConnected && signalAccountNumber) {
                const tracker = new SignalTracker(SIGNAL_API_URL, signalAccountNumber, `+${number}`);
                await prepareActivityRecorder(contact);
                tracker.onUpdate = data => publishTrackerUpdate(contact, data);
                trackers.set(contact.id, { tracker, platform });
                await tracker.startTracking();
            }
            if (trackers.has(contact.id)) {
                scheduleExpiry(contact);
                io.emit('contact-added', { jid: contact.id, number, label: contact.label, platform, expiresAt: contact.expiresAt });
            }
        } catch (error) {
            trackers.get(contact.id)?.tracker.stopTracking();
            trackers.delete(contact.id);
            activityRecorders.delete(contact.id);
            console.error(`Failed to restore ${platform} tracker`, error);
        }
    }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(process.env.BAILEYS_AUTH_DIR || 'auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: process.env.LOG_LEVEL || 'warn' }),
        markOnlineOnConnect: true,
        printQRInTerminal: false,
    });

    sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('QR Code generated');
            currentWhatsAppQr = qr; // Store the QR code
            io.emit('qr', qr);
        }

        if (connection === 'close') {
            isWhatsAppConnected = false;
            await stopPlatform('whatsapp');
            io.emit('connection-closed');
            currentWhatsAppQr = null; // Clear QR on close
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed, reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                scheduleWhatsAppReconnect();
            }
        } else if (connection === 'open') {
            reconnectDelay = 2000;
            isWhatsAppConnected = true;
            currentWhatsAppQr = null; // Clear QR on successful connection
            console.log('opened connection');
            io.emit('connection-open');
            await rehydratePlatform('whatsapp');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }: any) => {
        console.log(`[SESSION] History sync - Chats: ${chats.length}, Contacts: ${contacts.length}, Messages: ${messages.length}, Latest: ${isLatest}`);
    });

}

void connectToWhatsApp().catch(error => {
    console.error('WhatsApp connection failed', error);
    scheduleWhatsAppReconnect();
});

// Signal linking state
let signalLinkingInProgress = false;
let signalApiAvailable = false;
let currentSignalQrUrl: string | null = null;
let signalCheckInProgress = false;

// Check Signal API availability
async function checkSignalApiAvailable(): Promise<boolean> {
    try {
        const response = await fetch(`${SIGNAL_API_URL}/v1/about`, {
            signal: AbortSignal.timeout(2000)
        });
        return response.ok;
    } catch {
        return false;
    }
}

// Check Signal connection status
async function checkSignalConnection() {
    if (signalCheckInProgress) return;
    signalCheckInProgress = true;
    try {
        const available = await checkSignalApiAvailable();
        if (available !== signalApiAvailable) {
            signalApiAvailable = available;
            console.log(`[SIGNAL] API available: ${available}`);
            io.emit('signal-api-status', { available });
        }

        if (!available) {
            if (isSignalConnected) {
                isSignalConnected = false;
                await stopPlatform('signal');
                signalAccountNumber = null;
                io.emit('signal-disconnected');
            }
            return;
        }

        const accounts = await getSignalAccounts(SIGNAL_API_URL);
        if (accounts.length > 0) {
            if (!isSignalConnected) {
                isSignalConnected = true;
                signalAccountNumber = accounts[0];
                signalLinkingInProgress = false;
                console.log('[SIGNAL] Account connected');
                io.emit('signal-connection-open', { number: signalAccountNumber });
                await rehydratePlatform('signal');
            }
        } else {
            if (isSignalConnected) {
                isSignalConnected = false;
                await stopPlatform('signal');
                signalAccountNumber = null;
                console.log('[SIGNAL] Disconnected');
                io.emit('signal-disconnected');
            }
            // No accounts - need to link, start QR code process
            if (!signalLinkingInProgress) {
                startSignalLinking();
            }
        }
    } catch (err) {
        console.log('[SIGNAL] Error checking connection:', err);
        if (isSignalConnected) {
            isSignalConnected = false;
            await stopPlatform('signal');
            signalAccountNumber = null;
            io.emit('signal-disconnected');
        }
    } finally {
        signalCheckInProgress = false;
    }
}

// Start Signal device linking - signal-cli-rest-api returns QR as PNG image
async function startSignalLinking() {
    if (signalLinkingInProgress || isSignalConnected) return;

    signalLinkingInProgress = true;
    console.log('[SIGNAL] Starting device linking...');

    try {
        // Check if the QR endpoint is available
        const response = await fetch(`${SIGNAL_API_URL}/v1/qrcodelink?device_name=activity-tracker`, {
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
            console.log('[SIGNAL] Failed to start linking:', response.status);
            signalLinkingInProgress = false;
            return;
        }

        // Send the image itself; internal Docker hostnames are not reachable by browsers.
        const qrBytes = Buffer.from(await response.arrayBuffer());
        currentSignalQrUrl = `data:image/png;base64,${qrBytes.toString('base64')}`;
        io.emit('signal-qr-image', currentSignalQrUrl);

        // Keep polling to check if linking completed
        pollSignalLinkingStatus();
    } catch (err) {
        console.log('[SIGNAL] Error starting linking:', err);
        signalLinkingInProgress = false;
    }
}

// Poll to check if Signal linking has completed
async function pollSignalLinkingStatus() {
    const checkInterval = setInterval(async () => {
        try {
            const accounts = await getSignalAccounts(SIGNAL_API_URL);
            if (accounts.length > 0) {
                // Linking completed!
                clearInterval(checkInterval);
                signalLinkingInProgress = false;
                currentSignalQrUrl = null;
                isSignalConnected = true;
                signalAccountNumber = accounts[0];
                console.log('[SIGNAL] Linking completed');
                io.emit('signal-connection-open', { number: signalAccountNumber });
                await rehydratePlatform('signal');
            }
        } catch (err) {
            // Keep polling
        }
    }, 2000);

    // Stop polling after 5 minutes
    setTimeout(() => {
        clearInterval(checkInterval);
        signalLinkingInProgress = false;
    }, 300000);
}

// Check Signal connection periodically
checkSignalConnection();
setInterval(checkSignalConnection, 5000);

io.on('connection', (socket) => {
    console.log('Client connected');

    const sendConnectionState = () => {
        if (currentWhatsAppQr) socket.emit('qr', currentWhatsAppQr);
        socket.emit(isWhatsAppConnected ? 'connection-open' : 'connection-closed');
        if (isSignalConnected && signalAccountNumber) {
            socket.emit('signal-connection-open', { number: signalAccountNumber });
        } else {
            socket.emit('signal-disconnected');
        }
        socket.emit('signal-api-status', { available: signalApiAvailable });
        if (signalLinkingInProgress && currentSignalQrUrl) socket.emit('signal-qr-image', currentSignalQrUrl);
        socket.emit('probe-method', globalProbeMethod);
    };
    sendConnectionState();
    socket.on('get-connection-state', sendConnectionState);

    // Handle request to get tracked contacts (for page refresh)
    socket.on('get-tracked-contacts', async () => {
        try {
            const contacts = (await repository.list()).filter(contact => trackers.has(contact.id));
            socket.emit('tracked-contacts', await Promise.all(contacts.map(async contact => ({
                ...contact, recentProbes: await telemetryStore.recent(contact.id)
            }))));
        } catch (error) {
            console.error('Failed to list saved contacts', error);
            socket.emit('error', { message: 'Could not load saved contacts.' });
        }
    });

    socket.on('get-history-subjects', async () => {
        try { socket.emit('history-subjects', await historyStore.subjects()); }
        catch { socket.emit('error', { message: 'Could not load activity history.' }); }
    });

    socket.on('get-activity-history', async (request: { subjectKey?: unknown; offset?: unknown } | null) => {
        const subjectKey = request?.subjectKey;
        const offset = request?.offset;
        if (typeof subjectKey !== 'string' || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 100_000) return;
        try {
            if (!(await historyStore.subjects()).some(subject => subject.key === subjectKey)) return;
            const periods = await historyStore.periods(subjectKey, offset, 101);
            socket.emit('activity-history', { subjectKey, offset, periods: periods.slice(0, 100), hasMore: periods.length > 100 });
        } catch { socket.emit('error', { message: 'Could not load activity periods.' }); }
    });

    socket.on('delete-activity-history', async (subjectKey: unknown) => {
        if (typeof subjectKey !== 'string') return;
        const subjects = await historyStore.subjects().catch(() => []);
        const subject = subjects.find(item => item.key === subjectKey);
        if (!subject) return;
        const contacts = await repository.list().catch(() => []);
        if (contacts.some(contact => historySubjectKey(contact.platform, contact.consentedNumber) === subjectKey && trackers.has(contact.id))) {
            socket.emit('error', { message: 'End the active session before deleting its history.' });
            return;
        }
        try {
            await historyStore.delete(subjectKey);
            io.emit('history-deleted', subjectKey);
        } catch { socket.emit('error', { message: 'Could not delete activity history.' }); }
    });

    // Add contact - supports both WhatsApp and Signal
    socket.on('add-contact', async (data: { number?: unknown; platform?: unknown; label?: unknown; consent?: unknown; notificationsAcknowledged?: unknown; indefiniteConsentAcknowledged?: unknown; durationMinutes?: unknown } | null) => {
        const cleanNumber = normalizeConsentedNumber(data?.number);
        const label = normalizeLabel(data?.label);
        const platform = data?.platform;
        if (!cleanNumber || label === null || (platform !== 'signal' && platform !== 'whatsapp')) {
            socket.emit('error', { message: 'Enter a valid international number, name and platform.' });
            return;
        }
        if (data?.consent !== true) {
            socket.emit('error', { message: 'Confirm that this contact authorized the session before tracking.' });
            return;
        }
        if (data.notificationsAcknowledged !== true) {
            socket.emit('error', { message: 'Confirm that probes can trigger notifications before tracking.' });
            return;
        }
        const duration = resolveSessionDuration(data?.durationMinutes, data?.indefiniteConsentAcknowledged);
        if (!duration.valid) {
            socket.emit('error', { message: duration.message });
            return;
        }
        const expiresAt = duration.expiresAt;
        const contactId = platform === 'signal' ? `signal:${cleanNumber}` : `${cleanNumber}@s.whatsapp.net`;
        if (pendingContacts.has(contactId) || trackers.has(contactId)) {
            socket.emit('error', { message: 'This contact is already being added or tracked.' });
            return;
        }
        if (trackers.size + pendingContacts.size >= 10) {
            socket.emit('error', { message: 'The research session is limited to 10 contacts.' });
            return;
        }
        pendingContacts.add(contactId);

        try {
            if (platform === 'signal') {
                // Signal tracking
                if (!isSignalConnected || !signalAccountNumber) {
                    socket.emit('error', { message: 'Signal is not connected. Please link Signal first.' });
                    return;
                }

                const signalId = `signal:${cleanNumber}`;
                if (trackers.has(signalId)) {
                    socket.emit('error', { jid: signalId, message: 'Already tracking this contact on Signal' });
                    return;
                }

                try {
                    const targetNumber = cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;

                    // Check if number is registered and discoverable on Signal
                    console.log('[SIGNAL] Checking target registration');
                    const checkResult = await checkSignalNumber(SIGNAL_API_URL, signalAccountNumber, targetNumber);

                    if (!checkResult.registered) {
                        console.log(`[SIGNAL] Target is not discoverable: ${checkResult.error}`);
                        socket.emit('error', {
                            jid: signalId,
                            message: checkResult.error || 'Number is not registered on Signal'
                        });
                        return;
                    }

                    console.log('[SIGNAL] Target registered; starting tracking');
                    const tracker = new SignalTracker(SIGNAL_API_URL, signalAccountNumber, targetNumber);
                    const contact: TrackedContact = { id: signalId, platform: 'signal', consentedNumber: cleanNumber, label: label || undefined, notificationsAcknowledged: true, indefiniteConsentAcknowledged: duration.indefinite ? true : undefined, expiresAt };
                    await prepareActivityRecorder(contact);

                    trackers.set(signalId, { tracker, platform: 'signal' });
                    tracker.onUpdate = updateData => publishTrackerUpdate(contact, updateData);

                    await tracker.startTracking();
                    await repository.save(contact);
                    scheduleExpiry(contact);

                    io.emit('contact-added', {
                        jid: signalId,
                        number: cleanNumber,
                        label: label || undefined,
                        platform: 'signal',
                        expiresAt
                    });

                    io.emit('contact-name', { jid: signalId, name: cleanNumber });
                } catch (err) {
                    trackers.get(signalId)?.tracker.stopTracking();
                    trackers.delete(signalId);
                    await activityRecorders.get(signalId)?.stop();
                    activityRecorders.delete(signalId);
                    console.error(err);
                    socket.emit('error', { message: 'Failed to start Signal tracking' });
                }
            } else {
                // WhatsApp tracking (original logic)
                const targetJid = cleanNumber + '@s.whatsapp.net';

                if (!isWhatsAppConnected) {
                    socket.emit('error', { message: 'WhatsApp is not connected.' });
                    return;
                }

                if (trackers.has(targetJid)) {
                    socket.emit('error', { jid: targetJid, message: 'Already tracking this contact' });
                    return;
                }

                let startedJid: string | null = null;
                try {
                    const results = await sock.onWhatsApp(targetJid);
                    const result = results?.[0];

                    if (result?.exists) {
                        const tracker = new WhatsAppTracker(sock, result.jid);
                        tracker.setProbeMethod(globalProbeMethod);
                        const contact: TrackedContact = {
                            id: result.jid,
                            platform: 'whatsapp',
                            consentedNumber: cleanNumber,
                            label: label || undefined,
                            notificationsAcknowledged: true,
                            indefiniteConsentAcknowledged: duration.indefinite ? true : undefined,
                            expiresAt,
                            probeMethod: globalProbeMethod
                        };
                        await prepareActivityRecorder(contact);
                        trackers.set(result.jid, { tracker, platform: 'whatsapp' });
                        startedJid = result.jid;
                        tracker.onUpdate = updateData => publishTrackerUpdate(contact, updateData);

                        await tracker.startTracking();
                        await repository.save(contact);
                        scheduleExpiry(contact);

                        const ppUrl = await tracker.getProfilePicture();

                        let contactName = cleanNumber;
                        try {
                            const contactInfo = await sock.onWhatsApp(result.jid);
                            if (contactInfo && contactInfo[0]?.notify) {
                                contactName = contactInfo[0].notify;
                            }
                        } catch (err) {
                            console.log('[NAME] Could not fetch contact name, using number');
                        }

                        io.emit('contact-added', {
                            jid: result.jid,
                            number: cleanNumber,
                            label: label || undefined,
                            platform: 'whatsapp',
                            expiresAt
                        });

                        io.emit('profile-pic', { jid: result.jid, url: ppUrl });
                        io.emit('contact-name', { jid: result.jid, name: contactName });
                    } else {
                        socket.emit('error', { jid: targetJid, message: 'Number not on WhatsApp' });
                    }
                } catch (err) {
                    if (startedJid) {
                        trackers.get(startedJid)?.tracker.stopTracking();
                        trackers.delete(startedJid);
                        await activityRecorders.get(startedJid)?.stop();
                        activityRecorders.delete(startedJid);
                    }
                    console.error(err);
                    socket.emit('error', { jid: targetJid, message: 'Verification failed' });
                }
            }
        } finally {
            pendingContacts.delete(contactId);
        }
    });

    socket.on('remove-contact', async (jid: string) => {
        if (typeof jid !== 'string') return;
        try {
            await removeTrackedContact(jid);
        } catch (error) {
            console.error('Failed to remove saved contact', error);
            socket.emit('error', { message: 'Could not remove saved contact.' });
        }
    });

    socket.on('set-contact-label', async (data: { jid?: unknown; label?: unknown } | null) => {
        const label = normalizeLabel(data?.label);
        if (typeof data?.jid !== 'string' || label === null || !trackers.has(data.jid)) {
            socket.emit('error', { message: 'Choose an active contact and a name of up to 60 characters.' });
            return;
        }
        try {
            const contact = (await repository.list()).find(item => item.id === data.jid);
            if (!contact) throw new Error('Contact unavailable');
            await repository.save({ ...contact, label: label || undefined });
            await historyStore.register({ key: historySubjectKey(contact.platform, contact.consentedNumber), platform: contact.platform, number: contact.consentedNumber, label: label || undefined, createdAt: Date.now() });
            io.emit('contact-label', { jid: data.jid, label: label || undefined });
        } catch { socket.emit('error', { message: 'Could not save contact name.' }); }
    });

    socket.on('set-probe-method', async (method: ProbeMethod) => {
        console.log(`Request to change probe method to: ${method}`);
        if (method !== 'delete' && method !== 'reaction') {
            socket.emit('error', { message: 'Invalid probe method' });
            return;
        }

        try {
            const contacts = await repository.list();
            if (contacts.some(contact => trackers.has(contact.id))) {
                socket.emit('error', { message: 'Probe method is locked during an active session.' });
                return;
            }
            await Promise.all(contacts.filter(contact => contact.platform === 'whatsapp' && trackers.has(contact.id))
                .map(contact => repository.save({ ...contact, probeMethod: method })));
        } catch (error) {
            console.error('Failed to save probe method', error);
            socket.emit('error', { message: 'Could not change probe method.' });
            return;
        }
        globalProbeMethod = method;

        for (const entry of trackers.values()) {
            // Only WhatsApp trackers support the delete method
            if (entry.platform === 'whatsapp') {
                (entry.tracker as WhatsAppTracker).setProbeMethod(method);
            }
            // Signal trackers always use reaction method
        }

        io.emit('probe-method', method);
        console.log(`Probe method changed to: ${method}`);
    });
});

const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
