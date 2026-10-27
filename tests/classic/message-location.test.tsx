import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createWrapper } from '../helpers/hook-test-utils';
import { MessageBubble } from '@/modules/communication/components/chat/MessagePrimitives';
import type { WhatsAppMessage } from '@/modules/communication/hooks/useWhatsAppChat';

vi.mock('@/modules/communication/hooks/useMessageActions', () => ({
  useEditMessage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  isFeatureUnavailable: () => false,
}));

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('received locations in the chat thread', () => {
  it.each(['location', 'locationMessage', 'LocationMessage', 'livelocation', 'liveLocationMessage', 'LiveLocationMessage'])('opens %s in Google Maps', messageType => {
    const message: WhatsAppMessage = {
      id: 'location-1', organization_id: 'org-1', instance_id: 'instance-1',
      message_id: 'provider-1', remote_jid: '5511999999999@s.whatsapp.net',
      phone_number: '5511999999999', direction: 'incoming', message_type: messageType,
      content: '📍 -27.5, -48.5', media_url: null, push_name: null,
      status: 'received', lead_id: null, timestamp: '2026-10-26T14:08:27Z',
      created_at: '2026-10-26T14:08:27Z', sent_by_ai: false, sent_source: null,
    };
    render(<MessageBubble message={message} onImagePreview={() => {}} />, { wrapper: createWrapper() });
    expect(screen.getByRole('link', { name: 'Abrir no Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=-27.5%2C-48.5');
  });
});
