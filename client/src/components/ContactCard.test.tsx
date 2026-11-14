import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ContactCard } from './ContactCard';

test('renames a contact and masks the name in privacy mode', () => {
    const onRename = vi.fn();
    const props = {
        jid: 'test@s.whatsapp.net', displayNumber: '491701234567', data: [], recentProbes: [], devices: [],
        deviceCount: 0, presence: null, profilePic: null, onRemove: vi.fn(), onRename
    };
    const view = render(<ContactCard {...props} label="Pessoa A" />);
    fireEvent.click(screen.getByRole('button', { name: /renomear pessoa a/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /nome do contato/i }), { target: { value: 'Pessoa B' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar nome/i }));
    expect(onRename).toHaveBeenCalledWith('Pessoa B');
    view.rerender(<ContactCard {...props} label="Pessoa B" privacyMode />);
    expect(screen.getByRole('heading', { name: 'Contato privado' })).toBeInTheDocument();
    expect(screen.queryByText('491701234567')).not.toBeInTheDocument();
});
