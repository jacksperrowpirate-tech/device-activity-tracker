import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';

test('shows username and password login when there is no session', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  render(<App />);
  expect(await screen.findByLabelText(/usuário/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/senha/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /entrar no console/i })).toBeInTheDocument();
  vi.unstubAllGlobals();
});
