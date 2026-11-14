import { FormEvent, useEffect, useState } from 'react';
import { Activity, ArrowRight, LockKeyhole, LogOut, Radio, ShieldCheck } from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { useConnectionState } from './hooks/useConnectionState';
import { SocketProvider, useSocket } from './providers/SocketProvider';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function ConnectedApp({ username, onSignOut }: { username: string; onSignOut: () => void }) {
    const { authError } = useSocket();
    const { isConnected, connectionState } = useConnectionState();

    return (
        <div className="app-shell">
            <div className="ambient-grid" aria-hidden="true" />
            <header className="topbar container-wide">
                <div className="brand-mark"><Activity size={22} strokeWidth={2.5} /></div>
                <div className="brand-copy"><strong>PHANTOM<span>•</span>RTT</strong><small>RESEARCH CONSOLE / V1</small></div>
                <div className="topbar-right">
                    <span className={`system-indicator ${isConnected ? 'is-live' : ''}`}><i />{isConnected ? 'SISTEMA ONLINE' : 'DESCONECTADO'}</span>
                    <span className="operator-chip">{username}</span>
                    <button className="icon-button" type="button" onClick={onSignOut} title="Sair" aria-label="Sair"><LogOut size={18} /></button>
                </div>
            </header>
            <main className="container-wide app-main">
                <div className="page-heading">
                    <div><p className="eyebrow"><Radio size={14} /> PAINEL DE MONITORAMENTO</p><h1>Visão geral<span className="accent-dot">.</span></h1><p className="muted">Sinais em tempo real dos dispositivos autorizados.</p></div>
                    <div className="heading-visual"><div className="holo-radar" aria-hidden="true"><span className="radar-ring ring-one" /><span className="radar-ring ring-two" /><span className="radar-core"><Activity size={24} /></span><span className="radar-sweep" /></div><div className="heading-security"><ShieldCheck size={18} /><span>SIGNAL FEED<br /><strong>LIVE / SECURE</strong></span></div></div>
                </div>
                {authError && <p role="alert" className="alert-error">Falha na conexão: {authError}</p>}
                <Dashboard connectionState={connectionState} />
            </main>
        </div>
    );
}

function App() {
    const [username, setUsername] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [inputUsername, setInputUsername] = useState('admin');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetch(`${API_URL}/api/auth/session`, { credentials: 'include' })
            .then(response => response.ok ? response.json() : null)
            .then(data => setUsername(data?.username || null))
            .catch(() => setUsername(null))
            .finally(() => setLoading(false));
    }, []);

    async function signIn(event: FormEvent) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const response = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: inputUsername.trim(), password })
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(response.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : body.message === 'Login unavailable' ? 'Login indisponível no momento.' : 'Usuário ou senha inválidos.');
            }
            const body = await response.json();
            setUsername(body.username);
            setPassword('');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao entrar.'); }
        finally { setSubmitting(false); }
    }

    async function signOut() {
        await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
        setUsername(null);
    }

    if (loading) return <div className="auth-screen"><div className="auth-loading"><Activity size={28} /> Carregando console...</div></div>;
    if (username) return <SocketProvider><ConnectedApp username={username} onSignOut={signOut} /></SocketProvider>;

    return (
        <main className="auth-screen">
            <div className="ambient-grid" aria-hidden="true" />
            <section className="auth-story">
                <div className="auth-orbit" aria-hidden="true"><span /><span /><span /></div>
                <div className="brand-row"><div className="brand-mark"><Activity size={24} /></div><strong>PHANTOM<span>•</span>RTT</strong></div>
                <p className="eyebrow"><i className="pulse-dot" /> INTELIGÊNCIA DE SINAIS</p>
                <h1>Observe o sinal.<br /><em>Entenda o padrão.</em></h1>
                <p>Um console de pesquisa para acompanhar medições de dispositivos autorizados, com clareza e controle em tempo real.</p>
                <div className="auth-story-foot"><Radio size={18} /> TELEMETRIA AO VIVO <span>•</span> ACESSO PRIVADO</div>
            </section>
            <section className="auth-panel">
                <div className="auth-panel-head"><div className="auth-icon"><LockKeyhole size={22} /></div><p className="eyebrow">ÁREA RESTRITA</p><h2>Bem-vindo de volta</h2><p>Entre com sua conta para acessar o painel.</p></div>
                <form onSubmit={signIn} className="auth-form">
                    <label htmlFor="username">Usuário</label>
                    <input id="username" autoComplete="username" value={inputUsername} onChange={event => setInputUsername(event.target.value)} required />
                    <label htmlFor="password">Senha</label>
                    <input id="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
                    {error && <p role="alert" className="alert-error">{error}</p>}
                    <button className="button-primary auth-submit" type="submit" disabled={submitting}>{submitting ? 'Entrando...' : 'Entrar no console'}<ArrowRight size={18} /></button>
                </form>
                <div className="auth-panel-foot"><ShieldCheck size={16} /> Sessão privada protegida</div>
            </section>
        </main>
    );
}

export default App;
