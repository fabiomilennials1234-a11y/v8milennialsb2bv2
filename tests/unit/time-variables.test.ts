import { describe, it, expect } from 'vitest';
import { getHourInTimezone, getGreeting, getTimeBasedVariables } from '../../supabase/functions/_shared/time-variables';

describe('time-variables — getGreeting()', () => {
  // Morning: 05:00 .. 11:59
  it('returns "Bom dia" at 05:00', () => {
    expect(getGreeting(5)).toBe('Bom dia');
  });
  it('returns "Bom dia" at 11:00', () => {
    expect(getGreeting(11)).toBe('Bom dia');
  });
  it('returns "Bom dia" at 11:59 (hour=11)', () => {
    expect(getGreeting(11)).toBe('Bom dia');
  });

  // Afternoon: 12:00 .. 17:59
  it('returns "Boa tarde" at 12:00', () => {
    expect(getGreeting(12)).toBe('Boa tarde');
  });
  it('returns "Boa tarde" at 17:00', () => {
    expect(getGreeting(17)).toBe('Boa tarde');
  });

  // Night: 18:00 .. 04:59
  it('returns "Boa noite" at 18:00', () => {
    expect(getGreeting(18)).toBe('Boa noite');
  });
  it('returns "Boa noite" at 23:00', () => {
    expect(getGreeting(23)).toBe('Boa noite');
  });
  it('returns "Boa noite" at 00:00', () => {
    expect(getGreeting(0)).toBe('Boa noite');
  });
  it('returns "Boa noite" at 04:00', () => {
    expect(getGreeting(4)).toBe('Boa noite');
  });

  // Edge boundaries
  it('edge: 04:59 (hour=4) → Boa noite', () => {
    expect(getGreeting(4)).toBe('Boa noite');
  });
  it('edge: 05:00 (hour=5) → Bom dia', () => {
    expect(getGreeting(5)).toBe('Bom dia');
  });
  it('edge: 11:59 (hour=11) → Bom dia', () => {
    expect(getGreeting(11)).toBe('Bom dia');
  });
  it('edge: 12:00 (hour=12) → Boa tarde', () => {
    expect(getGreeting(12)).toBe('Boa tarde');
  });
  it('edge: 17:59 (hour=17) → Boa tarde', () => {
    expect(getGreeting(17)).toBe('Boa tarde');
  });
  it('edge: 18:00 (hour=18) → Boa noite', () => {
    expect(getGreeting(18)).toBe('Boa noite');
  });
});

describe('time-variables — getHourInTimezone()', () => {
  it('returns a number 0-23', () => {
    const h = getHourInTimezone(new Date());
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });
});

describe('time-variables — getTimeBasedVariables()', () => {
  it('returns saudacao, data, and hora', () => {
    const result = getTimeBasedVariables();
    expect(result).toHaveProperty('saudacao');
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('hora');
    expect(['Bom dia', 'Boa tarde', 'Boa noite']).toContain(result.saudacao);
    // data format: dd/mm/yyyy
    expect(result.data).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    // hora format: HH:mm
    expect(result.hora).toMatch(/^\d{2}:\d{2}$/);
  });

  it('greeting is capitalized (starts with uppercase)', () => {
    const result = getTimeBasedVariables();
    expect(result.saudacao[0]).toMatch(/[A-Z]/);
  });
});
