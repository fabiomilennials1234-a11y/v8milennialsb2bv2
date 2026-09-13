import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readUazapiButtons } from '../../src/modules/communication/lib/uazapiButtonsDisplay';
import { UazapiButtonsBubble } from '../../src/modules/communication/components/chat/bubbles/UazapiButtonsBubble';

describe('Uazapi button display', () => {
  const nativeButtons = [{ name: 'quick_reply', buttonParamsJSON: JSON.stringify({ display_text: 'Validar', id: 'internal-route' }) }];
  it('reads native labels from both realtime and history without routing IDs', () => {
    const realtime = readUazapiButtons({ raw_payload: { content: { InteractiveMessage: { NativeFlowMessage: { buttons: nativeButtons } } } } });
    expect(realtime).toEqual({ text: '', options: ['Validar'] });
    expect(readUazapiButtons({ uazapi_native_buttons: nativeButtons })).toEqual(realtime);
  });

  it('ignores malformed, oversized and payment metadata', () => {
    expect(readUazapiButtons({ uazapi_native_buttons: [null, { name: 'quick_reply', buttonParamsJSON: '{' },
      { name: 'quick_reply', buttonParamsJSON: 'x'.repeat(16385) },
      { name: 'payment_info', buttonParamsJSON: '{"display_text":"PIX"}' },
      { name: 'quick_reply', buttonParamsJSON: '{"display_text":42}' },
    ] })).toBeNull();
    expect(readUazapiButtons({ uazapi_interactive_display: { type: 'button', options: [null, 42, 'x'.repeat(257)] } })).toBeNull();
  });

  it('renders labels as inert text, including HTML-looking labels', () => {
    const { container } = render(<UazapiButtonsBubble text="Escolha" options={['<img src=x onerror=alert(1)>', 'Validar']} />);
    expect(screen.getByRole('list', { name: 'Botões da mensagem' })).toBeTruthy();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
