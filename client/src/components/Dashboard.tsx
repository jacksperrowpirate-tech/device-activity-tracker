import React, { Suspense, useEffect, useState } from 'react';
import { Activity, Eye, EyeOff, MessageCircle, Plus, Radio, Settings2, ShieldCheck, Users, Zap } from 'lucide-react';
import { Platform, ConnectionState, ContactInfo, ProbeMethod } from '../types/connections';
import { Login } from './Login';
import { useSocket } from '../providers/SocketProvider';
import { useTrackerEvents } from '../hooks/useTrackerEvents';
import { HistoryReport } from './HistoryReport';

const ContactCard = React.lazy(() => import('./ContactCard').then(module => ({ default: module.ContactCard })));

export function Dashboard({ connectionState }: { connectionState: ConnectionState }) {
    const { socket } = useSocket();
    const [inputNumber, setInputNumber] = useState('');
    const [inputLabel, setInputLabel] = useState('');
    const [durationMinutes, setDurationMinutes] = useState<number | null>(60);
    const [indefiniteAcknowledged, setIndefiniteAcknowledged] = useState(false);
    const [selectedPlatform, setSelectedPlatform] = useState<Platform>(connectionState.whatsapp ? 'whatsapp' : 'signal');
    const [contacts, setContacts] = useState<Map<string, ContactInfo>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [privacyMode, setPrivacyMode] = useState(false);
    const [probeMethod, setProbeMethod] = useState<ProbeMethod>('reaction');
    const [showConnections, setShowConnections] = useState(!connectionState.whatsapp && !connectionState.signal);
    const [consentConfirmed, setConsentConfirmed] = useState(false);
    const [notificationsAcknowledged, setNotificationsAcknowledged] = useState(false);
    const entries = Array.from(contacts.values());
    const hasActiveSession = entries.length > 0;
    const liveSamples = entries.reduce((sum, contact) => sum + contact.data.length, 0);

    useTrackerEvents(socket, setContacts);

    useEffect(() => {
        if (selectedPlatform === 'whatsapp' && !connectionState.whatsapp && connectionState.signal) setSelectedPlatform('signal');
        if (selectedPlatform === 'signal' && !connectionState.signal && connectionState.whatsapp) setSelectedPlatform('whatsapp');
        if (!connectionState.whatsapp && !connectionState.signal) setShowConnections(true);
    }, [connectionState.whatsapp, connectionState.signal, selectedPlatform]);

    useEffect(() => {
        const onProfilePic = ({ jid, url }: { jid: string; url: string | null }) => setContacts(prev => {
            const next = new Map(prev); const item = next.get(jid);
            if (item) next.set(jid, { ...item, profilePic: url });
            return next;
        });
        const onContactName = ({ jid, name }: { jid: string; name: string }) => setContacts(prev => {
            const next = new Map(prev); const item = next.get(jid);
            if (item) next.set(jid, { ...item, contactName: name });
            return next;
        });
        const onContactLabel = ({ jid, label }: { jid: string; label?: string }) => setContacts(prev => {
            const next = new Map(prev); const item = next.get(jid);
            if (item) next.set(jid, { ...item, label });
            return next;
        });
        const onContactAdded = ({ jid, number, label, platform = 'whatsapp', expiresAt }: { jid: string; number: string; label?: string; platform?: Platform; expiresAt?: number }) => {
            setContacts(prev => {
                const next = new Map(prev);
                const existing = next.get(jid);
                next.set(jid, existing ? { ...existing, label: label ?? existing.label, expiresAt } : {
                    jid, displayNumber: number, contactName: number, label, data: [], devices: [],
                    deviceCount: 0, presence: null, profilePic: null, platform, expiresAt
                });
                return next;
            });
            setInputNumber(''); setInputLabel(''); setConsentConfirmed(false); setNotificationsAcknowledged(false); setIndefiniteAcknowledged(false);
        };
        const onContactRemoved = (jid: string) => setContacts(prev => {
            const next = new Map(prev); next.delete(jid); return next;
        });
        const onError = (data: { message: string }) => setError(data.message);
        const onTrackedContacts = (saved: { id: string; platform: Platform; consentedNumber?: string; label?: string; expiresAt?: number }[]) => setContacts(prev => {
            const next = new Map<string, ContactInfo>();
            for (const { id, platform, consentedNumber, label, expiresAt } of saved) {
                const previous = prev.get(id);
                const number = consentedNumber || (platform === 'signal' ? id.replace('signal:', '') : id.split('@')[0]);
                next.set(id, previous ? { ...previous, label, expiresAt } : {
                    jid: id, displayNumber: number, contactName: number, label, data: [], devices: [],
                    deviceCount: 0, presence: null, profilePic: null, platform, expiresAt
                });
            }
            return next;
        });

        socket.on('profile-pic', onProfilePic);
        socket.on('contact-name', onContactName);
        socket.on('contact-label', onContactLabel);
        socket.on('contact-added', onContactAdded);
        socket.on('contact-removed', onContactRemoved);
        socket.on('error', onError);
        socket.on('probe-method', setProbeMethod);
        socket.on('tracked-contacts', onTrackedContacts);
        socket.emit('get-tracked-contacts');
        return () => {
            socket.off('profile-pic', onProfilePic);
            socket.off('contact-name', onContactName);
            socket.off('contact-label', onContactLabel);
            socket.off('contact-added', onContactAdded);
            socket.off('contact-removed', onContactRemoved);
            socket.off('error', onError);
            socket.off('probe-method', setProbeMethod);
            socket.off('tracked-contacts', onTrackedContacts);
        };
    }, [socket]);

    function handleAdd(event: React.FormEvent) {
        event.preventDefault();
        if (!socket.connected || !inputNumber.trim() || !consentConfirmed || !notificationsAcknowledged || (durationMinutes === null && !indefiniteAcknowledged)) return;
        setError(null);
        socket.emit('add-contact', {
            number: inputNumber.trim(), label: inputLabel.trim(), platform: selectedPlatform,
            consent: true, notificationsAcknowledged: true, durationMinutes,
            indefiniteConsentAcknowledged: durationMinutes === null ? indefiniteAcknowledged : undefined
        });
    }

    return (
        <div className="dashboard-stack">
            <section className="stats-grid" aria-label="Resumo">
                <div className="stat-panel"><div className="stat-icon"><Users size={19} /></div><span>CONTATOS ATIVOS</span><strong>{entries.length.toString().padStart(2, '0')}</strong><small>Sessões monitoradas</small></div>
                <div className="stat-panel"><div className="stat-icon"><Activity size={19} /></div><span>AMOSTRAS NESTA TELA</span><strong>{liveSamples.toString().padStart(2, '0')}</strong><small>RTT confirmado</small></div>
                <div className="stat-panel"><div className="stat-icon"><Radio size={19} /></div><span>CANAIS CONECTADOS</span><strong>{Number(connectionState.whatsapp) + Number(connectionState.signal)}<em>/ 2</em></strong><small>WhatsApp e Signal</small></div>
            </section>

            <section className="panel control-panel">
                <div className="panel-heading"><div><p className="eyebrow">OPERAÇÃO / NOVA SESSÃO</p><h2>Adicionar contato</h2><p>Monitore apenas números com autorização explícita.</p></div><button type="button" className="button-ghost" onClick={() => setShowConnections(value => !value)}><Settings2 size={16} /> {showConnections ? 'Ocultar conexões' : 'Gerenciar conexões'}</button></div>
                <form onSubmit={handleAdd}>
                    <div className="control-grid">
                        <label className="field"><span>NÚMERO INTERNACIONAL</span><input type="tel" placeholder="Ex.: +55 11 99999-9999" value={inputNumber} onChange={event => setInputNumber(event.target.value)} required /></label>
                        <label className="field"><span>NOME / APELIDO</span><input type="text" placeholder="Ex.: Ana — teste 01" maxLength={60} value={inputLabel} onChange={event => setInputLabel(event.target.value)} /></label>
                        <label className="field"><span>DURAÇÃO</span><select value={durationMinutes ?? 'unlimited'} onChange={event => setDurationMinutes(event.target.value === 'unlimited' ? null : Number(event.target.value))}><option value={1}>1 minuto</option><option value={15}>15 minutos</option><option value={60}>1 hora</option><option value="unlimited">Sem prazo</option></select></label>
                    </div>
                    <div className="control-bottom">
                        <div className="platform-toggle" role="group" aria-label="Plataforma">
                            <button type="button" className={selectedPlatform === 'whatsapp' ? 'selected' : ''} disabled={!connectionState.whatsapp} onClick={() => setSelectedPlatform('whatsapp')}><MessageCircle size={16} /> WhatsApp</button>
                            <button type="button" className={selectedPlatform === 'signal' ? 'selected' : ''} disabled={!connectionState.signal} onClick={() => setSelectedPlatform('signal')}><Radio size={16} /> Signal</button>
                        </div>
                        <button className="button-primary" type="submit" disabled={!consentConfirmed || !notificationsAcknowledged || (durationMinutes === null && !indefiniteAcknowledged) || !inputNumber.trim() || !socket.connected}><Plus size={17} /> Adicionar contato</button>
                    </div>
                    <div className="consent-box">
                        <label><input type="checkbox" checked={consentConfirmed} onChange={event => setConsentConfirmed(event.target.checked)} /> Confirmo que a pessoa autorizou explicitamente esta sessão.</label>
                        <label><input type="checkbox" checked={notificationsAcknowledged} onChange={event => setNotificationsAcknowledged(event.target.checked)} /> Entendo que as sondas podem gerar notificações no celular a cada 2 segundos, mesmo com esta página fechada, até o término da sessão.</label>
                        {durationMinutes === null && <label><input type="checkbox" checked={indefiniteAcknowledged} onChange={event => setIndefiniteAcknowledged(event.target.checked)} /> Confirmo que a pessoa autorizou monitoramento sem prazo; ele continuará após reinícios até eu encerrar manualmente.</label>}
                    </div>
                </form>
                {error && <p role="alert" className="alert-error">{error}</p>}
            </section>

            <section className="dashboard-tools">
                <div className="tool-group"><span>MÉTODO DE SONDA</span><div className="segmented"><button type="button" className={probeMethod === 'reaction' ? 'active' : ''} disabled={hasActiveSession} onClick={() => socket.emit('set-probe-method', 'reaction')}><Zap size={14} /> Reação</button><button type="button" className={probeMethod === 'delete' ? 'active' : ''} disabled={hasActiveSession} onClick={() => socket.emit('set-probe-method', 'delete')}>Exclusão</button></div>{hasActiveSession && <small>Bloqueado durante sessões ativas</small>}</div>
                <button type="button" className={`button-ghost privacy-button ${privacyMode ? 'privacy-on' : ''}`} onClick={() => setPrivacyMode(value => !value)}>{privacyMode ? <EyeOff size={16} /> : <Eye size={16} />} Privacidade {privacyMode ? 'ativada' : 'desativada'}</button>
            </section>

            {showConnections && <Login connectionState={connectionState} />}

            <section className="contacts-section"><div className="section-heading"><div><p className="eyebrow"><i className="pulse-dot" /> TELEMETRIA AO VIVO</p><h2>Contatos monitorados <span>{entries.length}</span></h2></div><div className="section-note"><ShieldCheck size={15} /> Medições são estimativas de latência</div></div>
                {entries.length === 0 ? <div className="empty-state"><Radio size={32} /><h3>Nenhuma sessão ativa</h3><p>Adicione um contato autorizado para ver os sinais aqui.</p></div> : <Suspense fallback={<div className="empty-state">Carregando sinais...</div>}><div className="contacts-grid">{entries.map(contact => <ContactCard key={contact.jid} jid={contact.jid} label={contact.label} displayNumber={contact.displayNumber} data={contact.data} devices={contact.devices} deviceCount={contact.deviceCount} presence={contact.presence} profilePic={contact.profilePic} onRemove={() => socket.emit('remove-contact', contact.jid)} onRename={label => socket.emit('set-contact-label', { jid: contact.jid, label })} privacyMode={privacyMode} platform={contact.platform} expiresAt={contact.expiresAt} lastEventKind={contact.lastEventKind} />)}</div></Suspense>}
            </section>
            <HistoryReport socket={socket} activeSubjects={entries.map(contact => `${contact.platform}:${contact.displayNumber}`)} privacyMode={privacyMode} />
        </div>
    );
}
