import { useEffect, useState } from 'react';
import { Download, History, Trash2, ChevronDown, Clock3, RefreshCcw } from 'lucide-react';
import { Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
interface Subject { key: string; platform: 'whatsapp' | 'signal'; number: string; label?: string; createdAt: number }
interface Period { id: string; startedAt: number; endedAt: number | null; confirmedSamples: number; meanRttMs: number; source: 'rtt-estimate'; endReason?: string }

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formatDuration(startedAt: number, endedAt: number | null): string {
    const seconds = Math.max(0, Math.round(((endedAt ?? Date.now()) - startedAt) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours ? `${hours}h ${minutes}min` : minutes ? `${minutes}min ${seconds % 60}s` : `${seconds}s`;
}

export function HistoryReport({ socket, activeSubjects, privacyMode }: { socket: Socket; activeSubjects: string[]; privacyMode: boolean }) {
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [selected, setSelected] = useState('');
    const [periods, setPeriods] = useState<Period[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const onSubjects = (rows: Subject[]) => {
            const ordered = rows.slice().sort((a, b) => b.createdAt - a.createdAt);
            setSubjects(ordered);
            setSelected(previous => ordered.some(row => row.key === previous) ? previous : ordered[0]?.key || '');
        };
        const onHistory = (data: { subjectKey: string; offset: number; periods: Period[]; hasMore: boolean }) => {
            if (data.subjectKey !== selected) return;
            setPeriods(previous => data.offset === 0 ? data.periods : [...previous, ...data.periods]);
            setHasMore(data.hasMore);
            setLoading(false);
        };
        const refresh = () => socket.emit('get-history-subjects');
        socket.on('history-subjects', onSubjects);
        socket.on('activity-history', onHistory);
        socket.on('history-deleted', refresh);
        socket.on('contact-added', refresh);
        socket.on('contact-label', refresh);
        refresh();
        return () => {
            socket.off('history-subjects', onSubjects);
            socket.off('activity-history', onHistory);
            socket.off('history-deleted', refresh);
            socket.off('contact-added', refresh);
            socket.off('contact-label', refresh);
        };
    }, [socket, selected]);

    useEffect(() => {
        if (!selected) { setPeriods([]); return; }
        setLoading(true);
        socket.emit('get-activity-history', { subjectKey: selected, offset: 0 });
    }, [selected, socket]);

    const subject = subjects.find(item => item.key === selected);
    const active = activeSubjects.includes(selected);
    const loadedSeconds = periods.reduce((total, period) => total + Math.max(0, Math.round(((period.endedAt ?? Date.now()) - period.startedAt) / 1000)), 0);
    function removeHistory() {
        if (!subject || active || !window.confirm(`Excluir todo o histórico de ${subject.label || subject.number}? Esta ação não pode ser desfeita.`)) return;
        socket.emit('delete-activity-history', selected);
        setPeriods([]);
    }

    return <section className="panel history-panel" aria-label="Relatório histórico">
        <div className="history-head"><div><p className="eyebrow"><History size={14} /> ARQUIVO DE ATIVIDADE</p><h2>Histórico de períodos <span>estimados</span></h2><p>Intervalos classificados como “Online” após três confirmações consecutivas. RTT não confirma se o aplicativo estava aberto.</p></div><div className="history-actions">{subject && <button type="button" className="button-ghost" onClick={() => { setPeriods([]); setLoading(true); socket.emit('get-activity-history', { subjectKey: selected, offset: 0 }); }}><RefreshCcw size={15} /> Atualizar</button>}{subject && <a className="button-ghost" href={`${API_URL}/api/history/export?subjectKey=${encodeURIComponent(selected)}`}><Download size={15} /> Exportar CSV</a>}{subject && <button type="button" className="button-ghost history-delete" disabled={active} title={active ? 'Encerre a sessão antes de excluir o histórico' : 'Excluir histórico'} onClick={removeHistory}><Trash2 size={15} /></button>}</div></div>
        {subjects.length === 0 ? <div className="history-empty"><Clock3 size={26} /><strong>Nenhum histórico registrado</strong><span>Os períodos estimados aparecerão aqui após as primeiras transições.</span></div> : <>
            <div className="history-filter"><label htmlFor="history-subject">CONTATO</label><div className="history-select"><select id="history-subject" value={selected} onChange={event => { setSelected(event.target.value); setPeriods([]); }}>{subjects.map(item => <option key={item.key} value={item.key}>{privacyMode ? 'Contato privado' : item.label || item.number} · {item.platform === 'whatsapp' ? 'WhatsApp' : 'Signal'}</option>)}</select><ChevronDown size={15} /></div><span>{periods.length} PERÍODOS EXIBIDOS</span></div>
            <div className="history-overview"><div><span>PERÍODOS CARREGADOS</span><strong>{periods.length.toString().padStart(2, '0')}</strong></div><div><span>TEMPO TOTAL ESTIMADO</span><strong>{formatDuration(0, loadedSeconds * 1000)}</strong></div><div><span>ÚLTIMA ESTIMATIVA</span><strong>{periods[0] ? formatDate(periods[0].startedAt) : '—'}</strong></div></div>
            <div className="history-table-wrap"><table className="history-table"><thead><tr><th>INÍCIO</th><th>FIM</th><th>DURAÇÃO</th><th>RTT MÉDIO</th><th>CONFIRMAÇÕES</th><th>ESTADO</th></tr></thead><tbody>{periods.map(period => <tr key={period.id}><td>{formatDate(period.startedAt)}</td><td>{period.endedAt ? formatDate(period.endedAt) : 'Em andamento'}</td><td>{formatDuration(period.startedAt, period.endedAt)}</td><td>{period.meanRttMs} ms</td><td>{period.confirmedSamples}</td><td><span className={`history-state ${period.endedAt ? '' : 'open'}`}>{period.endedAt ? 'Online estimado' : 'Em andamento'}</span></td></tr>)}</tbody></table>{!loading && periods.length === 0 && <div className="history-empty"><span>Nenhum período “Online” estimado para este contato.</span></div>}{loading && <div className="history-empty"><span>Carregando histórico...</span></div>}</div>
            {hasMore && <button type="button" className="history-more" onClick={() => { setLoading(true); socket.emit('get-activity-history', { subjectKey: selected, offset: periods.length }); }}>Carregar períodos anteriores</button>}
        </>}
    </section>;
}
