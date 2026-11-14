import { useEffect, useState } from 'react';
import { useSocket } from '../providers/SocketProvider';
import { ConnectionState } from '../types/connections';

const initialState: ConnectionState = {
    whatsapp: false,
    signal: false,
    signalNumber: null,
    signalApiAvailable: false,
    signalQrImage: null,
    whatsappQr: null
};

export function useConnectionState() {
    const { socket } = useSocket();
    const [isConnected, setIsConnected] = useState(socket.connected);
    const [connectionState, setConnectionState] = useState<ConnectionState>(initialState);

    useEffect(() => {
        const onConnect = () => {
            setIsConnected(true);
            socket.emit('get-connection-state');
        };
        const onDisconnect = () => {
            setIsConnected(false);
            setConnectionState(initialState);
        };
        const onWhatsAppQr = (qr: string) => setConnectionState(prev => ({ ...prev, whatsappQr: qr, whatsapp: false }));
        const onWhatsAppOpen = () => setConnectionState(prev => ({ ...prev, whatsapp: true, whatsappQr: null }));
        const onWhatsAppClose = () => setConnectionState(prev => ({ ...prev, whatsapp: false }));
        const onSignalOpen = ({ number }: { number: string }) => setConnectionState(prev => ({ ...prev, signal: true, signalNumber: number, signalQrImage: null }));
        const onSignalClose = () => setConnectionState(prev => ({ ...prev, signal: false, signalNumber: null }));
        const onSignalStatus = ({ available }: { available: boolean }) => setConnectionState(prev => ({ ...prev, signalApiAvailable: available }));
        const onSignalQr = (image: string) => setConnectionState(prev => ({ ...prev, signalQrImage: image }));

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('qr', onWhatsAppQr);
        socket.on('connection-open', onWhatsAppOpen);
        socket.on('connection-closed', onWhatsAppClose);
        socket.on('signal-connection-open', onSignalOpen);
        socket.on('signal-disconnected', onSignalClose);
        socket.on('signal-api-status', onSignalStatus);
        socket.on('signal-qr-image', onSignalQr);
        if (socket.connected) onConnect();
        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('qr', onWhatsAppQr);
            socket.off('connection-open', onWhatsAppOpen);
            socket.off('connection-closed', onWhatsAppClose);
            socket.off('signal-connection-open', onSignalOpen);
            socket.off('signal-disconnected', onSignalClose);
            socket.off('signal-api-status', onSignalStatus);
            socket.off('signal-qr-image', onSignalQr);
        };
    }, [socket]);

    return { isConnected, connectionState };
}
