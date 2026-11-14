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
import { isValidAdminToken, normalizeConsentedNumber } from './security.js';
import { createContactRepository, type TrackedContact } from './infra/contact-repository.js';

process.umask(0o077);

// Configuration
const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:8080';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 24) {
    throw new Error('ADMIN_TOKEN must be configured with at least 24 characters');
}
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',').map(origin => origin.trim()).filter(Boolean);
const consentedNumbers = new Set((process.env.CONSENTED_NUMBERS || '')
    .split(',').map(normalizeConsentedNumber).filter((number): number is string => number !== null));

const app = express();
app.use(cors({ origin: allowedOrigins }));
app.get('/health', (_request, response) => response.json({ status: 'ok' }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    },
    allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        callback(null, !origin || allowedOrigins.includes(origin));
    }
});
io.use((socket, next) => {
    if (isValidAdminToken(socket.handshake.auth?.token, ADMIN_TOKEN)) return next();
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
    await repository.remove(id);
    io.emit('contact-removed', id);
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

function stopPlatform(platform: Platform) {
    for (const [id, entry] of trackers) {
        if (entry.platform === platform) {
            entry.tracker.stopTracking();
            trackers.delete(id);
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
        const number = contact.id.startsWith('signal:')
            ? contact.id.slice('signal:'.length)
            : contact.id.split('@')[0];
        if (!consentedNumbers.has(number)) continue;
        try {
            if (platform === 'whatsapp' && isWhatsAppConnected) {
                const tracker = new WhatsAppTracker(sock, contact.id);
                tracker.setProbeMethod(contact.probeMethod || 'reaction');
                tracker.onUpdate = data => io.emit('tracker-update', { jid: contact.id, platform, ...data });
                trackers.set(contact.id, { tracker, platform });
                await tracker.startTracking();
            } else if (platform === 'signal' && isSignalConnected && signalAccountNumber) {
                const tracker = new SignalTracker(SIGNAL_API_URL, signalAccountNumber, `+${number}`);
                tracker.onUpdate = data => io.emit('tracker-update', { jid: contact.id, platform, ...data });
                trackers.set(contact.id, { tracker, platform });
                await tracker.startTracking();
            }
            if (trackers.has(contact.id)) {
                scheduleExpiry(contact);
                io.emit('contact-added', { jid: contact.id, number, platform, expiresAt: contact.expiresAt });
            }
        } catch (error) {
            trackers.get(contact.id)?.tracker.stopTracking();
            trackers.delete(contact.id);
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
            stopPlatform('whatsapp');
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
                stopPlatform('signal');
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
                stopPlatform('signal');
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
            stopPlatform('signal');
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
            socket.emit('tracked-contacts', (await repository.list()).filter(contact => trackers.has(contact.id)));
        } catch (error) {
            console.error('Failed to list saved contacts', error);
            socket.emit('error', { message: 'Could not load saved contacts.' });
        }
    });

    // Add contact - supports both WhatsApp and Signal
    socket.on('add-contact', async (data: { number?: unknown; platform?: unknown; consent?: unknown; notificationsAcknowledged?: unknown; durationMinutes?: unknown } | null) => {
        const cleanNumber = normalizeConsentedNumber(data?.number);
        const platform = data?.platform;
        if (!cleanNumber || (platform !== 'signal' && platform !== 'whatsapp')) {
            socket.emit('error', { message: 'Enter a valid international number and platform.' });
            return;
        }
        if (data?.consent !== true || !consentedNumbers.has(cleanNumber)) {
            socket.emit('error', { message: 'This number requires recorded consent and inclusion in CONSENTED_NUMBERS.' });
            return;
        }
        if (data.notificationsAcknowledged !== true) {
            socket.emit('error', { message: 'Confirm that probes can trigger notifications before tracking.' });
            return;
        }
        const durationMinutes = data.durationMinutes;
        if (durationMinutes !== undefined &&
            (typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 60)) {
            socket.emit('error', { message: 'Session duration must be 1 to 60 minutes.' });
            return;
        }
        const expiresAt = durationMinutes === undefined ? undefined : Date.now() + durationMinutes * 60_000;
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

                    trackers.set(signalId, { tracker, platform: 'signal' });

                    tracker.onUpdate = (updateData) => {
                        io.emit('tracker-update', {
                            jid: signalId,
                            platform: 'signal',
                            ...updateData
                        });
                    };

                    await tracker.startTracking();
                    const contact: TrackedContact = { id: signalId, platform: 'signal', notificationsAcknowledged: true, expiresAt };
                    await repository.save(contact);
                    scheduleExpiry(contact);

                    io.emit('contact-added', {
                        jid: signalId,
                        number: cleanNumber,
                        platform: 'signal',
                        expiresAt
                    });

                    io.emit('contact-name', { jid: signalId, name: cleanNumber });
                } catch (err) {
                    trackers.get(signalId)?.tracker.stopTracking();
                    trackers.delete(signalId);
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
                        trackers.set(result.jid, { tracker, platform: 'whatsapp' });
                        startedJid = result.jid;

                        tracker.onUpdate = (updateData) => {
                            io.emit('tracker-update', {
                                jid: result.jid,
                                platform: 'whatsapp',
                                ...updateData
                            });
                        };

                        await tracker.startTracking();
                        const contact: TrackedContact = {
                            id: result.jid,
                            platform: 'whatsapp',
                            notificationsAcknowledged: true,
                            expiresAt,
                            probeMethod: globalProbeMethod
                        };
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

    socket.on('set-probe-method', async (method: ProbeMethod) => {
        console.log(`Request to change probe method to: ${method}`);
        if (method !== 'delete' && method !== 'reaction') {
            socket.emit('error', { message: 'Invalid probe method' });
            return;
        }

        try {
            const contacts = await repository.list();
            if (contacts.some(contact => contact.expiresAt && trackers.has(contact.id))) {
                socket.emit('error', { message: 'Probe method is locked during a timed session.' });
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
