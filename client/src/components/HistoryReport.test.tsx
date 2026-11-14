import { act, render, screen } from '@testing-library/react';
import { Socket } from 'socket.io-client';
import { vi } from 'vitest';
import { HistoryReport } from './HistoryReport';

test('shows persisted estimated periods with start, end and duration', () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const socket = {
        on: vi.fn((event: string, listener: (...args: any[]) => void) => { listeners.set(event, listener); }),
        off: vi.fn(), emit: vi.fn()
    } as unknown as Socket;
    render(<HistoryReport socket={socket} activeSubjects={[]} privacyMode={false} />);
    act(() => listeners.get('history-subjects')?.([{ key: 'whatsapp:491701234567', platform: 'whatsapp', number: '491701234567', label: 'Pessoa A', createdAt: 1000 }]));
    act(() => listeners.get('activity-history')?.({ subjectKey: 'whatsapp:491701234567', offset: 0, hasMore: false, periods: [{ id: 'period-1', startedAt: 1000, endedAt: 61000, confirmedSamples: 8, meanRttMs: 760, source: 'rtt-estimate' }] }));
    expect(screen.getByRole('combobox', { name: /contato/i })).toHaveValue('whatsapp:491701234567');
    expect(screen.getAllByText('1min 0s')).toHaveLength(2);
    expect(screen.getByText('760 ms')).toBeInTheDocument();
    expect(screen.getByText(/não confirma se o aplicativo estava aberto/i)).toBeInTheDocument();
});
