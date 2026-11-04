import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';
import { RichContactBubble } from '@/modules/communication/components/chat/bubbles/RichContactBubble';
import { BolhaNormalizada } from '@/modules/communication/components/chat/bubbles/BolhaNormalizada';
afterEach(cleanup);
describe('rich contact display', () => {
  it.each([
    '📍 -27.5, -48.5',
    '📍 -27.5, -48.5\r\n  ',
    'QA\nhttps://www.google.com/maps?q=-27.5,-48.5',
    'QA\nhttps://www.google.com/maps/search/?api=1&query=-27.5%2C-48.5',
  ])('opens received and sent locations with a universal Maps URL: %s', content => {
    render(<RichContactBubble location content={content} />);
    const link = screen.getByRole('link', { name: 'Abrir no Google Maps' });
    expect(link.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=-27.5%2C-48.5');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link).toHaveClass('min-h-11');
  });
  it.each(['javascript:alert(1)', 'https://evil.example/maps?q=1,2', 'https://www.google.com.evil.example/maps?q=1,2', 'https://www.google.com/url?q=1,2', 'https://www.google.com/maps?q=100,200', '📍 91, 0', '📍 0, -181', '📍 NaN, 0', '📍 , 0'])('does not link untrusted coordinates/URLs %s', url => {
    render(<RichContactBubble location content={'QA\n'+url} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('preserves the location name and address', () => {
    render(<RichContactBubble location content={'Loja\nRua de exemplo, 10\nhttps://www.google.com/maps?q=0,0'} />);
    expect(screen.getByText(/Loja/)).toHaveTextContent('Loja Rua de exemplo, 10');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=0%2C0');
  });
  it('keeps coordinate precision in received locations', () => {
    render(<RichContactBubble location content={'📍 -23.55052012345678, -46.63330898765432'} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=-23.55052012345678%2C-46.63330898765432');
  });
  it('keeps an unavailable location readable without inventing a destination', () => {
    render(<RichContactBubble location content={null} />);
    expect(screen.getByText('Localização compartilhada')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('opens normalized channel locations with the same universal URL', () => {
    render(<BolhaNormalizada bolha={{ tipo: 'localizacao', latitude: 0, longitude: -48.5, nome: 'Loja', endereco: 'Rua de exemplo' }} />);
    expect(screen.getByRole('link', { name: 'Abrir no Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=0%2C-48.5');
    expect(screen.getByText('Rua de exemplo')).toBeInTheDocument();
  });
  it('does not generate a map from invalid normalized coordinates', () => {
    render(<BolhaNormalizada bolha={{ tipo: 'localizacao', latitude: 100, longitude: 0, nome: null, endereco: null }} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('copies only the validated phone', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<RichContactBubble location={false} content={'QA\n5511999998888\nqa@example.invalid'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar telefone' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('5511999998888'));
  });
});
