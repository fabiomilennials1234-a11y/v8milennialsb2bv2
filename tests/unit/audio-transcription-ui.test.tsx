import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AudioTranscription } from '../../src/modules/communication/components/chat/media/AudioTranscription';
import { transcribeAudio } from '../../src/modules/communication/lib/whatsappApi';
import type { WhatsAppMessage } from '../../src/modules/communication/hooks/chat/types';
vi.mock('../../src/modules/communication/hooks/useInstanceCapabilities', () => ({ useInstanceCapabilities: () => ({ canUseUazapiActions: true }) }));
vi.mock('../../src/modules/communication/lib/whatsappApi', () => ({ transcribeAudio: vi.fn() }));
afterEach(cleanup);
const message = { id: '11111111-1111-4111-8111-111111111111', instance_id: 'instance', organization_id: 'org' } as WhatsAppMessage;
it.each([
  'whatsapp-api-proxy: A UAZAPI retornou este áudio sem transcrição. Nenhum texto foi salvo.',
  'whatsapp-api-proxy: Este áudio não está mais disponível para transcrição.',
  'private provider response',
])('displays one safe transcription error, never naming the vendor: %s', async (error) => {
  vi.mocked(transcribeAudio).mockRejectedValue(new Error(error));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><AudioTranscription message={message} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Transcrever áudio' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('Não conseguimos transcrever este áudio. Tente novamente em instantes.');
  expect(alert.textContent).not.toMatch(/uazapi/i);
});
