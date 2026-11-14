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

test('requires consent and notification acknowledgement before requesting contact tracking', () => {
    render(<Dashboard connectionState={connectionState} />);
    const addButton = screen.getByRole('button', { name: /add contact/i });
    fireEvent.change(screen.getByPlaceholderText(/enter phone number/i), { target: { value: '491701234567' } });
    expect(addButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /explicitly consented/i }));
    expect(addButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /probes can trigger phone notifications/i }));
    expect(addButton).toBeEnabled();
    fireEvent.click(addButton);
    expect(mockSocket.emit).toHaveBeenCalledWith('add-contact', {
        number: '491701234567', platform: 'whatsapp', consent: true, notificationsAcknowledged: true
    });
});
