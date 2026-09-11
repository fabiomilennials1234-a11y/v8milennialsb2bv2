import { describe, expect, it } from 'vitest';
import { providerSendStatus } from '../../src/modules/communication/lib/providerSendStatus';
import { promoteOptimisticMessage } from '../../src/modules/communication/hooks/chat/shared/optimistic-messages';
import type { WhatsAppMessage } from '../../src/modules/communication/hooks/chat/types';
describe('UAZAPI acceptance in the composer', () => {
  it('keeps queued sends pending until a receipt arrives', () => {
    const status = providerSendStatus({ result: { message_id: 'real', status: 'queued' } });
    const optimistic = { id: 'local', message_id: 'optimistic_1', status: 'pending' } as WhatsAppMessage;
    expect(promoteOptimisticMessage([optimistic], 'local', 'real', status)[0]).toMatchObject({ message_id: 'real', status: 'pending' });
  });
  it('never regresses an already received delivery receipt', () => {
    const messages = [{ id: 'local', message_id: 'optimistic_1', status: 'pending' }, { id: 'stored', message_id: 'real', status: 'delivered' }] as WhatsAppMessage[];
    expect(promoteOptimisticMessage(messages, 'local', 'real', 'pending')).toEqual([messages[1]]);
  });
  it('preserves failure and legacy provider semantics', () => {
    expect(providerSendStatus({ result: { status: 'failed' } })).toBe('failed');
    expect(providerSendStatus({ key: { id: 'legacy' } })).toBe('sent');
  });
});
