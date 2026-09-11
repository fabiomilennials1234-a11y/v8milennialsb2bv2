import { describe, expect, it } from 'vitest';
import { parseLocation, validateContactPhone } from '../../src/modules/communication/lib/rich-message-input';
import { acceptedInteractiveRow } from '../../src/modules/communication/lib/accepted-interactive-message';

describe('location input', () => {
  it.each([['', ''], [' ', '1'], ['91', '0'], ['0', '-181'], ['Infinity', '0'], ['0x10', '0'], ['abc', '1']])('rejects invalid coordinates %s/%s', (lat, lng) => {
    expect(() => parseLocation(lat, lng)).toThrow();
  });
  it('accepts decimal comma and zero without confusing empty inputs', () => {
    expect(parseLocation('-27,5', '0')).toEqual({ latitude: -27.5, longitude: 0 });
  });
});
describe('contact input', () => {
  it('normalizes formatted phone without dropping country code', () => {
    expect(validateContactPhone('+55 (11) 99999-8888')).toBe('5511999998888');
  });
  it.each(['', '123', 'abc12345678', '1234567890123456', 'https://example.com'])('rejects invalid phone %s', value => {
    expect(() => validateContactPhone(value)).toThrow();
  });
});
describe('rich send display fallback', () => {
  const scope = { organizationId: 'org', instanceId: 'instance', phoneNumber: '5511999998888' };
  it('retains a safe Maps link, label and pending status', () => {
    const row = acceptedInteractiveRow(scope, { message_id: 'real', status: 'queued' }, { kind: 'location', latitude: -27.5, longitude: -48.5, name: 'QA', address: 'Praça pública' });
    expect(row).toMatchObject({ message_type: 'location', status: 'pending', content: 'QA\nPraça pública\nhttps://www.google.com/maps?q=-27.5,-48.5' });
  });
  it('keeps contact details readable after reload without raw provider payload', () => {
    const row = acceptedInteractiveRow(scope, { message_id: 'real', status: 'queued' }, { kind: 'contact', name: 'QA', phone: '5511999998888', email: 'qa@example.invalid' });
    expect(row).toMatchObject({ message_type: 'contact', status: 'pending', content: 'QA\n5511999998888\nqa@example.invalid' });
    expect(row).not.toHaveProperty('raw_payload');
  });
});
