import React, { Suspense, useEffect, useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, Zap, MessageCircle, Settings } from 'lucide-react';
import { Platform, ConnectionState, ContactInfo } from '../types/connections';
import { Login } from './Login';
import { useSocket } from '../providers/SocketProvider';
import { useTrackerEvents } from '../hooks/useTrackerEvents';

const ContactCard = React.lazy(() => import('./ContactCard').then(module => ({ default: module.ContactCard })));

type ProbeMethod = 'delete' | 'reaction';

interface DashboardProps {
    connectionState: ConnectionState;
}

export function Dashboard({ connectionState }: DashboardProps) {
    const { socket } = useSocket();
    const [inputNumber, setInputNumber] = useState('');
    const [selectedPlatform, setSelectedPlatform] = useState<Platform>(
        connectionState.whatsapp ? 'whatsapp' : 'signal'
    );
    const [contacts, setContacts] = useState<Map<string, ContactInfo>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [privacyMode, setPrivacyMode] = useState(false);
    const [probeMethod, setProbeMethod] = useState<ProbeMethod>('reaction');
    const [showConnections, setShowConnections] = useState(false);
    const [consentConfirmed, setConsentConfirmed] = useState(false);
    const [notificationsAcknowledged, setNotificationsAcknowledged] = useState(false);
    const hasTimedSession = Array.from(contacts.values()).some(contact => Boolean(contact.expiresAt));

    useTrackerEvents(socket, setContacts);

    useEffect(() => {
        if (selectedPlatform === 'whatsapp' && !connectionState.whatsapp && connectionState.signal) setSelectedPlatform('signal');
        if (selectedPlatform === 'signal' && !connectionState.signal && connectionState.whatsapp) setSelectedPlatform('whatsapp');
    }, [connectionState.whatsapp, connectionState.signal, selectedPlatform]);

    useEffect(() => {
        function onProfilePic(data: { jid: string, url: string | null }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    next.set(data.jid, { ...contact, profilePic: data.url });
                }
                return next;
            });
        }

        function onContactName(data: { jid: string, name: string }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    next.set(data.jid, { ...contact, contactName: data.name });
                }
                return next;
            });
        }

        function onContactAdded(data: { jid: string, number: string, platform?: Platform, expiresAt?: number }) {
            setContacts(prev => {
                const next = new Map(prev);
                next.set(data.jid, {
                    jid: data.jid,
                    displayNumber: data.number,
                    contactName: data.number,
                    data: [],
                    devices: [],
                    deviceCount: 0,
                    presence: null,
                    profilePic: null,
                    platform: data.platform || 'whatsapp',
                    expiresAt: data.expiresAt
                });
                return next;
            });
            setInputNumber('');
            setConsentConfirmed(false);
            setNotificationsAcknowledged(false);
        }

        function onContactRemoved(jid: string) {
            setContacts(prev => {
                const next = new Map(prev);
                next.delete(jid);
                return next;
            });
        }

        function onError(data: { jid?: string, message: string }) {
            setError(data.message);
            setTimeout(() => setError(null), 3000);
        }

        function onProbeMethod(method: ProbeMethod) {
            setProbeMethod(method);
        }

        function onTrackedContacts(contacts: { id: string, platform: Platform, expiresAt?: number }[]) {
            setContacts(prev => {
                const next = new Map<string, ContactInfo>();
                contacts.forEach(({ id, platform, expiresAt }) => {
                    if (prev.has(id)) {
                        next.set(id, { ...prev.get(id)!, expiresAt });
                    } else {
                        // Extract display number from id
                        let displayNumber = id;
                        if (platform === 'signal') {
                            displayNumber = id.replace('signal:', '');
                        } else {
                            // WhatsApp JID format: number@s.whatsapp.net
                            displayNumber = id.split('@')[0];
                        }
                        next.set(id, {
                            jid: id,
                            displayNumber,
                            contactName: displayNumber,
                            data: [],
                            devices: [],
                            deviceCount: 0,
                            presence: null,
                            profilePic: null,
                            platform,
                            expiresAt
                        });
                    }
                });
                return next;
            });
        }

        socket.on('profile-pic', onProfilePic);
        socket.on('contact-name', onContactName);
        socket.on('contact-added', onContactAdded);
        socket.on('contact-removed', onContactRemoved);
        socket.on('error', onError);
        socket.on('probe-method', onProbeMethod);
        socket.on('tracked-contacts', onTrackedContacts);

        socket.emit('get-tracked-contacts');

        return () => {
            socket.off('profile-pic', onProfilePic);
            socket.off('contact-name', onContactName);
            socket.off('contact-added', onContactAdded);
            socket.off('contact-removed', onContactRemoved);
            socket.off('error', onError);
            socket.off('probe-method', onProbeMethod);
            socket.off('tracked-contacts', onTrackedContacts);
        };
    }, [socket]);

    const handleAdd = () => {
        if (!socket.connected || !inputNumber || !consentConfirmed || !notificationsAcknowledged) return;
        socket.emit('add-contact', {
            number: inputNumber,
            platform: selectedPlatform,
            consent: true,
            notificationsAcknowledged: true
        });
    };

    const handleRemove = (jid: string) => {
        if (!socket) return;
        socket.emit('remove-contact', jid);
    };

    const handleProbeMethodChange = (method: ProbeMethod) => {
        if (!socket) return;
        socket.emit('set-probe-method', method);
    };

    return (
        <div className="space-y-6">
            {/* Add Contact Form */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-semibold text-gray-900">Track Contacts</h2>
                        {/* Manage Connections button */}
                        <button
                            onClick={() => setShowConnections(!showConnections)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-1 ${
                                showConnections
                                    ? 'bg-gray-700 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            <Settings size={14} />
                            {showConnections ? 'Hide Connections' : 'Manage Connections'}
                        </button>
                    </div>
                    <div className="flex items-center gap-4">
                        {/* Probe Method Toggle */}
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">Probe Method:</span>
                            <div className="flex rounded-lg overflow-hidden border border-gray-300">
                                <button
                                    onClick={() => handleProbeMethodChange('delete')}
                                    disabled={hasTimedSession}
                                    className={`px-3 py-1.5 text-sm font-medium transition-all duration-200 flex items-center gap-1 ${
                                        probeMethod === 'delete'
                                            ? 'bg-purple-600 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                    title="Delete probes can trigger notifications on the recipient's phone"
                                >
                                    <Trash2 size={14} />
                                    Delete
                                </button>
                                <button
                                    onClick={() => handleProbeMethodChange('reaction')}
                                    disabled={hasTimedSession}
                                    className={`px-3 py-1.5 text-sm font-medium transition-all duration-200 flex items-center gap-1 ${
                                        probeMethod === 'reaction'
                                            ? 'bg-yellow-500 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                    title="Reaction probes can trigger notifications on the recipient's phone"
                                >
                                    <Zap size={14} />
                                    Reaction
                                </button>
                            </div>
                            {hasTimedSession && <span className="text-xs text-gray-500">Locked for timed test</span>}
                        </div>
                        {/* Privacy Mode Toggle */}
                        <button
                            onClick={() => setPrivacyMode(!privacyMode)}
                            className={`px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-all duration-200 ${
                                privacyMode 
                                    ? 'bg-green-600 text-white hover:bg-green-700 shadow-md' 
                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                            title={privacyMode ? 'Privacy Mode: ON (Click to disable)' : 'Privacy Mode: OFF (Click to enable)'}
                        >
                            {privacyMode ? (
                                <>
                                    <EyeOff size={20} />
                                    <span>Privacy ON</span>
                                </>
                            ) : (
                                <>
                                    <Eye size={20} />
                                    <span>Privacy OFF</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
                <div className="flex gap-4">
                    {/* Platform Selector */}
                    <div className="flex rounded-lg overflow-hidden border border-gray-300">
                        <button
                            onClick={() => setSelectedPlatform('whatsapp')}
                            disabled={!connectionState.whatsapp}
                            className={`px-4 py-2 text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                                selectedPlatform === 'whatsapp'
                                    ? 'bg-green-600 text-white'
                                    : connectionState.whatsapp
                                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                            title={connectionState.whatsapp ? 'WhatsApp' : 'WhatsApp not connected'}
                        >
                            <MessageCircle size={16} />
                            WhatsApp
                        </button>
                        <button
                            onClick={() => setSelectedPlatform('signal')}
                            disabled={!connectionState.signal}
                            className={`px-4 py-2 text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                                selectedPlatform === 'signal'
                                    ? 'bg-blue-600 text-white'
                                    : connectionState.signal
                                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                            title={connectionState.signal ? 'Signal' : 'Signal not connected'}
                        >
                            <MessageCircle size={16} />
                            Signal
                        </button>
                    </div>
                    <input
                        type="text"
                        placeholder="Enter phone number (e.g. 491701234567)"
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        value={inputNumber}
                        onChange={(e) => setInputNumber(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                    />
                    <button
                        onClick={handleAdd}
                        disabled={!consentConfirmed || !notificationsAcknowledged || !inputNumber.trim() || !socket.connected}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium transition-colors"
                    >
                        <Plus size={20} /> Add Contact
                    </button>
                </div>
                <label className="flex items-center gap-2 mt-3 text-sm text-gray-700">
                    <input type="checkbox" checked={consentConfirmed} onChange={event => setConsentConfirmed(event.target.checked)} />
                    I confirm this person explicitly consented to this research session.
                </label>
                <label className="flex items-center gap-2 mt-2 text-sm text-red-700">
                    <input type="checkbox" checked={notificationsAcknowledged} onChange={event => setNotificationsAcknowledged(event.target.checked)} />
                    I understand probes can trigger phone notifications and may repeat as often as every 2 seconds, even if I close this page, until I remove this contact.
                </label>
                {error && <p className="mt-2 text-red-500 text-sm">{error}</p>}
            </div>

            {/* Connections Panel */}
            {showConnections && (
                <Login connectionState={connectionState} />
            )}

            {/* Contact Cards */}
            {contacts.size === 0 ? (
                <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
                    <p className="text-gray-500 text-lg">No contacts being tracked</p>
                    <p className="text-gray-400 text-sm mt-2">Add a contact above to start tracking</p>
                </div>
            ) : (
                <Suspense fallback={<p>Loading contact details...</p>}>
                    <div className="space-y-6">
                        {Array.from(contacts.values()).map(contact => (
                            <ContactCard
                                key={contact.jid}
                                jid={contact.jid}
                                displayNumber={contact.contactName}
                                data={contact.data}
                                devices={contact.devices}
                                deviceCount={contact.deviceCount}
                                presence={contact.presence}
                                profilePic={contact.profilePic}
                                onRemove={() => handleRemove(contact.jid)}
                                privacyMode={privacyMode}
                                platform={contact.platform}
                                expiresAt={contact.expiresAt}
                            />
                        ))}
                    </div>
                </Suspense>
            )}
        </div>
    );
}
