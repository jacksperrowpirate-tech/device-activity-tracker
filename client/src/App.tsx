import React, { FormEvent, useState } from 'react';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { useConnectionState } from './hooks/useConnectionState';
import { SocketProvider, useSocket } from './providers/SocketProvider';

function ConnectedApp({ onSignOut }: { onSignOut: () => void }) {
    const { authError } = useSocket();
    const { isConnected, connectionState } = useConnectionState();
    const isAnyPlatformReady = connectionState.whatsapp || connectionState.signal;

    return (
        <div className="min-h-screen bg-gray-100 p-4 md:p-8">
            <div className="max-w-6xl mx-auto">
                <header className="mb-8 flex flex-wrap justify-between items-center gap-4">
                    <h1 className="text-3xl font-bold text-gray-900">Activity Tracker</h1>
                    <div className="flex items-center gap-3 text-sm text-gray-600">
                        <span>{isConnected ? 'Server Connected' : 'Disconnected'}</span>
                        {isConnected && <span>WhatsApp: {connectionState.whatsapp ? 'Connected' : 'Waiting'} · Signal: {connectionState.signal ? 'Connected' : 'Waiting'}</span>}
                        <button type="button" onClick={onSignOut} className="underline">Sign out</button>
                    </div>
                </header>
                {authError && <p role="alert" className="mb-4 text-red-700">Connection failed: {authError}</p>}
                <main>{isAnyPlatformReady ? <Dashboard connectionState={connectionState} /> : <Login connectionState={connectionState} />}</main>
            </div>
        </div>
    );
}

function App() {
    const [token, setToken] = useState('');
    const [tokenInput, setTokenInput] = useState('');
    const signIn = (event: FormEvent) => {
        event.preventDefault();
        if (tokenInput.trim()) setToken(tokenInput.trim());
    };

    if (!token) {
        return (
            <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
                <form onSubmit={signIn} className="w-full max-w-sm bg-white rounded-xl border p-6 space-y-4">
                    <h1 className="text-2xl font-semibold">Activity Tracker</h1>
                    <p className="text-sm text-gray-600">Enter the administrator token configured on the server.</p>
                    <label htmlFor="admin-token" className="block text-sm font-medium">Administrator token</label>
                    <input id="admin-token" type="password" autoComplete="current-password" value={tokenInput} onChange={event => setTokenInput(event.target.value)} className="w-full border rounded-lg px-3 py-2" required />
                    <button type="submit" className="w-full rounded-lg bg-blue-600 text-white px-4 py-2">Connect</button>
                </form>
            </main>
        );
    }

    return <SocketProvider token={token}><ConnectedApp onSignOut={() => { setToken(''); setTokenInput(''); }} /></SocketProvider>;
}

export default App;
