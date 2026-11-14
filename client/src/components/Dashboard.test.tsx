import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
        number: '491701234567', label: 'Pessoa A', platform: 'whatsapp', consent: true, notificationsAcknowledged: true, durationMinutes: 60, indefiniteConsentAcknowledged: undefined
    });
});

test('requires separate acknowledgement for a session without a time limit', () => {
    render(<Dashboard connectionState={connectionState} />);
    fireEvent.change(screen.getByPlaceholderText(/ex.: \+55/i), { target: { value: '491701234567' } });
    fireEvent.change(screen.getByRole('combobox', { name: /duração/i }), { target: { value: 'unlimited' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /autorizou explicitamente/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /sondas podem gerar notificações/i }));
    const addButton = screen.getByRole('button', { name: /adicionar contato/i });
    expect(addButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /monitoramento sem prazo/i }));
    fireEvent.click(addButton);
    expect(mockSocket.emit).toHaveBeenCalledWith('add-contact', expect.objectContaining({
        durationMinutes: null, indefiniteConsentAcknowledged: true
    }));
});

test('restores chart data and probe quality from the server after remount', async () => {
    render(<Dashboard connectionState={connectionState} />);
    const handler = [...mockSocket.on.mock.calls].reverse().find(([event]) => event === 'tracked-contacts')?.[1];
    expect(handler).toBeDefined();
    await act(async () => handler([{
        id: '5561996677010@s.whatsapp.net', platform: 'whatsapp', consentedNumber: '5561996677010',
        notificationsAcknowledged: true, recentProbes: [
            { id: '1', kind: 'measurement', timestamp: 1000, rtt: 700, avg: 700, median: 800, threshold: 720, state: 'Standby' },
            { id: '2', kind: 'no-ack', timestamp: 2000 }
        ]
    }]));
    expect(await screen.findByText('1 AMOSTRAS')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/🇧🇷 Brasil/)).toBeInTheDocument();
});

test('keeps connection setup out of the way after a channel connects', () => {
    const disconnected = { ...connectionState, whatsapp: false };
    const view = render(<Dashboard connectionState={disconnected} />);
    expect(screen.getByRole('region', { name: 'Conexões' })).toBeInTheDocument();
    view.rerender(<Dashboard connectionState={connectionState} />);
    expect(screen.queryByRole('region', { name: 'Conexões' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /gerenciar conexões/i }));
    expect(screen.getByRole('region', { name: 'Conexões' })).toBeInTheDocument();
});
