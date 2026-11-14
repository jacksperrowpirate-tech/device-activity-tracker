import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface SocketContextValue {
    socket: Socket;
    authError: string | null;
}

const SocketContext = createContext<SocketContextValue | null>(null);
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function SocketProvider({ token, children }: { token: string; children: React.ReactNode }) {
    const socket = useMemo(() => io(API_URL, { autoConnect: false, auth: { token } }), [token]);
    const [authError, setAuthError] = useState<string | null>(null);

    useEffect(() => {
        const onConnectError = (error: Error) => setAuthError(error.message);
        const onConnect = () => setAuthError(null);
        socket.on('connect_error', onConnectError);
        socket.on('connect', onConnect);
        socket.connect();
        return () => {
            socket.off('connect_error', onConnectError);
            socket.off('connect', onConnect);
            socket.disconnect();
        };
    }, [socket]);

    return <SocketContext.Provider value={{ socket, authError }}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
    const context = useContext(SocketContext);
    if (!context) throw new Error('useSocket must be used within SocketProvider');
    return context;
}
