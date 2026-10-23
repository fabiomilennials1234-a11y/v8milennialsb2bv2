import { describe, expect, it } from 'vitest';
import { buildResetEmail } from '../../supabase/functions/forgot-password/email';

describe('recovery email compatibility', () => {
  it('uses the deployed token route in HTML and plain text', () => {
    const token = 'ab'.repeat(32);
    const message = buildResetEmail(token);
    const destination = `https://torquecrm.com.br/reset-password/${token}`;
    expect(message.html).toContain(`href="${destination}"`);
    expect(message.text).toContain(destination);
    expect(message.html).not.toContain('ConfirmationURL');
    expect(message.html).not.toContain('app.torquecrm.com.br');
    expect(message.subject).toBe('Redefina sua senha — Torque CRM');
  });
  it.each(['', 'short', 'x'.repeat(64), '<script>', 'ab'.repeat(32) + '\"'])('rejects malformed token %s', token => {
    expect(() => buildResetEmail(token)).toThrow('Invalid recovery token format');
  });
});
