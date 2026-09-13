import { describe, expect, it } from 'vitest';
import { acceptedInteractiveRow } from '../../src/modules/communication/lib/accepted-interactive-message';
import { readUazapiMenu } from '../../src/modules/communication/lib/uazapiMenuDisplay';
import { readUazapiPix } from '../../src/modules/communication/lib/uazapiPixDisplay';
const scope = { organizationId: 'org', instanceId: 'instance', phoneNumber: '5511999998888' };
const menu = { kind: 'menu' as const, menu: { tipo: 'list' as const, texto: 'QA', opcoes: [{ title: 'Validar', description: 'Teste' }], rotuloDaLista: 'Abrir QA' } };
describe('accepted interactive message fallback', () => {
  it.each(['queued', 'pending', 'unknown', undefined])('does not claim delivery for %s', status => {
    expect(acceptedInteractiveRow(scope, { message_id: 'real', status }, menu)?.status).toBe('pending');
  });
  it.each(['sent', 'delivered', 'read', 'failed'])('preserves explicit status %s', status => {
    expect(acceptedInteractiveRow(scope, { message_id: 'real', status }, menu)?.status).toBe(status);
  });
  it('never invents an ID', () => {
    expect(acceptedInteractiveRow(scope, {}, menu)).toBeNull();
    expect(acceptedInteractiveRow(scope, { message_id: ' ' }, menu)).toBeNull();
  });
  it('retains provider time and metadata the chat can read before webhook', () => {
    const row = acceptedInteractiveRow(scope, { message_id: 'real', timestamp: 1789130000 }, menu)!;
    expect(row.timestamp).toBe(new Date(1789130000000).toISOString());
    expect(readUazapiMenu(row)).toMatchObject({ button: 'Abrir QA', sections: [{ rows: [{ title: 'Validar', description: 'Teste' }] }] });
  });
  it('makes PIX displayable immediately without persisting a full request', () => {
    const row = acceptedInteractiveRow(scope, { message_id: 'real', status: 'queued' }, { kind: 'pix', text: 'QA', key: 'qa@example.invalid', name: 'QA', keyType: 'email' })!;
    expect(row.status).toBe('pending');
    expect(readUazapiPix(row)).toEqual({ key: 'qa@example.invalid', name: 'QA', type: 'email' });
    expect(Object.keys(row.raw_payload!)).toEqual(['sendPayload']);
  });
});
