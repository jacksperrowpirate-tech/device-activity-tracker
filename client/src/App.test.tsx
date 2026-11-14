import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('requires the administrator token before connecting', () => {
  render(<App />);
  expect(screen.getByLabelText(/administrator token/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
});
