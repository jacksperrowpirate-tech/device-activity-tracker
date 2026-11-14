import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Dashboard } from './Dashboard';
import { vi } from 'vitest';

const mockSocket = vi.hoisted(() => ({
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn()
}));

vi.mock('../providers/SocketProvider', () => ({
    useSocket: () => ({ socket: mockSocket })
}));

const connectionState = {
    whatsapp: true,
    signal: false,
    signalNumber: null,
    signalApiAvailable: false,
    signalQrImage: null,
    whatsappQr: null
};

test('requires consent and notification acknowledgement before requesting a timed session', () => {
    render(<Dashboard connectionState={connectionState} />);
    const addButton = screen.getByRole('button', { name: /adicionar contato/i });
    fireEvent.change(screen.getByPlaceholderText(/ex.: \+55/i), { target: { value: '491701234567' } });
    fireEvent.change(screen.getByPlaceholderText(/ana/i), { target: { value: 'Pessoa A' } });
    expect(addButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /autorizou explicitamente/i }));
    expect(addButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /sondas podem gerar notificações/i }));
    expect(addButton).toBeEnabled();
    fireEvent.click(addButton);
    expect(mockSocket.emit).toHaveBeenCalledWith('add-contact', {
        number: '491701234567', label: 'Pessoa A', platform: 'whatsapp', consent: true, notificationsAcknowledged: true, durationMinutes: 60
    });
});
