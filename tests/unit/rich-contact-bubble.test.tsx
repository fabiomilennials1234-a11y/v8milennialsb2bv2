import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';
import { RichContactBubble } from '../../src/modules/communication/components/chat/bubbles/RichContactBubble';
afterEach(cleanup);
describe('rich contact display', () => {
  it('opens valid coordinates with safe external link attributes', () => {
    render(<RichContactBubble location content={'QA\nhttps://www.google.com/maps?q=-27.5,-48.5'} />);
    const link = screen.getByRole('link', { name: 'Abrir no mapa' });
    expect(link.getAttribute('href')).toBe('https://www.google.com/maps?q=-27.5,-48.5');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
  it.each(['javascript:alert(1)', 'https://evil.example/maps?q=1,2', 'https://www.google.com/maps?q=100,200'])('does not link untrusted coordinates/URLs %s', url => {
    render(<RichContactBubble location content={'QA\n'+url} />);
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
