import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ClientPurchaseHistory } from './ClientPurchaseHistory';
it('histórico completo pagina sem perder compras e mantém o cliente', () => {
  const purchases = Array.from({ length: 45 }, (_, i) => ({ id: String(i), date: '2026-09-16', value: i + 1, source: 'CRM' as const }));
  render(<ClientPurchaseHistory name="Aurora" purchases={purchases} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ver todas' }));
  expect(screen.getByRole('dialog', { name: 'Compras de Aurora' })).toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(21);
  fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
  fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
  expect(screen.getAllByRole('row')).toHaveLength(6);
  expect(screen.getByText('Página 3 de 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
});
