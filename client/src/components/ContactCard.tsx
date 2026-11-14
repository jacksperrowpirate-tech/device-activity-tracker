import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Check, Clock3, MessageCircle, Pencil, Radio, Square, X } from 'lucide-react';
import { DeviceInfo, Platform, TelemetrySample, TrackerData } from '../types/connections';
import { phoneCountry } from '../utils/phone-country';
import { probeQuality } from '../utils/telemetry';

interface ContactCardProps {
    jid: string;
    label?: string;
    displayNumber: string;
    data: TrackerData[];
    recentProbes: TelemetrySample[];
    devices: DeviceInfo[];
    deviceCount: number;
    presence: string | null;
    profilePic: string | null;
    onRemove: () => void;
    onRename: (label: string) => void;
    privacyMode?: boolean;
    platform?: Platform;
    expiresAt?: number;
    lastEventKind?: 'measurement' | 'no-ack';
}

export function ContactCard({ label, displayNumber, data, recentProbes, devices, deviceCount, onRemove, onRename, privacyMode = false, platform = 'whatsapp', expiresAt, lastEventKind }: ContactCardProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(label || '');
    const latest = data.at(-1);
    const state = lastEventKind === 'no-ack' ? 'Sem confirmação' : devices.find(device => device.state === 'Online')?.state || devices.find(device => device.state === 'Standby')?.state || devices[0]?.state || 'Aguardando dados';
    const maskedNumber = privacyMode ? displayNumber.replace(/\d/g, '•') : displayNumber;
    const visibleLabel = privacyMode ? 'Contato privado' : label || 'Contato sem nome';
    const stateClass = state === 'Online' ? 'status-online' : state === 'Standby' ? 'status-standby' : 'status-unknown';
    const country = phoneCountry(displayNumber);
    const quality = probeQuality(recentProbes);

    function saveLabel() {
        onRename(draft.trim());
        setEditing(false);
    }

    return (
        <article className="contact-card">
            <div className="contact-head">
                <div className="contact-identity">
                    <div className={`avatar ${platform === 'signal' ? 'avatar-signal' : ''}`}>{label ? label.slice(0, 1).toUpperCase() : <MessageCircle size={20} />}</div>
                    <div className="contact-title">
                        {editing ? <form className="rename-form" onSubmit={event => { event.preventDefault(); saveLabel(); }}><input autoFocus aria-label="Nome do contato" maxLength={60} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Nome ou apelido" /><button type="submit" aria-label="Salvar nome"><Check size={15} /></button><button type="button" aria-label="Cancelar" onClick={() => setEditing(false)}><X size={15} /></button></form> : <div className="name-line"><h3>{visibleLabel}</h3><button type="button" className="rename-trigger" aria-label={`Renomear ${visibleLabel}`} title="Renomear contato" onClick={() => { setDraft(label || ''); setEditing(true); }}><Pencil size={14} /></button></div>}
                        <p>{maskedNumber} <span>•</span> {platform === 'whatsapp' ? 'WhatsApp' : 'Signal'} {!privacyMode && country && <span className="contact-country" title="País identificado pelo número, não pela localização atual">• {country.flag} {country.name}</span>}</p>
                    </div>
                </div>
                <span className={`status-badge ${stateClass}`}><i />{state}</span>
            </div>
            <div className="contact-meta"><span><Radio size={14} /> Sessão em tempo real</span>{expiresAt ? <span><Clock3 size={14} /> Encerra às {new Date(expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span> : <span><Clock3 size={14} /> Sem prazo · encerre manualmente</span>}</div>
            <div className="metrics-row">
                <div><span>ÚLTIMO RTT</span><strong>{latest ? latest.rtt.toFixed(0) : '—'}<small>ms</small></strong></div>
                <div><span>MÉDIA RECENTE</span><strong>{latest ? latest.avg.toFixed(0) : '—'}<small>ms</small></strong></div>
                <div><span>DISPOSITIVOS</span><strong>{deviceCount.toString().padStart(2, '0')}</strong></div>
            </div>
            <div className="chart-area"><div className="chart-heading"><span><Activity size={15} /> HISTÓRICO DE LATÊNCIA</span><span>{data.length} AMOSTRAS</span></div>
                {data.length ? <ResponsiveContainer width="100%" height={160}><LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -28 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#22314b" /><XAxis dataKey="timestamp" hide /><YAxis tick={{ fill: '#8295aa', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} /><Tooltip labelFormatter={value => new Date(Number(value)).toLocaleTimeString('pt-BR')} contentStyle={{ background: '#0d1427', border: '1px solid #384d75', borderRadius: 10, color: '#eef7ff' }} /><Line type="monotone" dataKey="avg" stroke="#7ce8ff" strokeWidth={2.5} dot={false} name="RTT médio" isAnimationActive={false} /><Line type="step" dataKey="threshold" stroke="#ad8aff" strokeDasharray="4 4" dot={false} name="Limite" isAnimationActive={false} /></LineChart></ResponsiveContainer> : <div className="chart-placeholder">Aguardando primeiras medições...</div>}
            </div>
            <div className="quality-strip"><span>SONDAS CONFIRMADAS <strong>{quality.rate === null ? '—' : `${quality.rate}%`}</strong> {quality.total > 0 && <small>({quality.confirmed}/{quality.total} recentes)</small>}</span><span>ÚLTIMA CONFIRMAÇÃO <strong>{quality.lastConfirmedAt ? new Date(quality.lastConfirmedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</strong></span></div>
            <div className="contact-footer"><span>Estimativa baseada no tempo de resposta; pode divergir da atividade real.</span><button type="button" onClick={onRemove}><Square size={13} /> Encerrar</button></div>
        </article>
    );
}
