import { describe, it, expect } from 'vitest';
import {
  resolveActiveWindow,
  getDayKeyInTimezone,
  getHourMinutesInTimezone,
  buildDateInTimezone,
  computeNextWindowStart,
  formatTemporalAnchor,
  formatDateTimeInTz,
  formatDateInTz,
} from '../../supabase/functions/_shared/copilot/time-context';

const TZ_BR = 'America/Sao_Paulo';

// Helper: Date em horário Brasil específico (offset -03:00 sem DST recente)
function brDate(iso: string): Date {
  return new Date(`${iso}-03:00`);
}

describe('time-context — getDayKeyInTimezone', () => {
  it('domingo BR', () => {
    // 2026-04-26 é domingo
    expect(getDayKeyInTimezone(brDate('2026-04-26T12:00'), TZ_BR)).toBe('sun');
  });
  it('segunda BR', () => {
    expect(getDayKeyInTimezone(brDate('2026-04-27T12:00'), TZ_BR)).toBe('mon');
  });
  it('vira o dia em TZ diferente', () => {
    // 2026-04-27 02:00 BR = 2026-04-27 05:00 UTC = ainda mesmo dia em UTC
    const d = brDate('2026-04-27T02:00');
    expect(getDayKeyInTimezone(d, TZ_BR)).toBe('mon');
    expect(getDayKeyInTimezone(d, 'UTC')).toBe('mon');
  });
});

describe('time-context — getHourMinutesInTimezone', () => {
  it('extrai 14:30', () => {
    expect(getHourMinutesInTimezone(brDate('2026-04-26T14:30'), TZ_BR)).toEqual({ hour: 14, minute: 30 });
  });
  it('extrai 23:59', () => {
    expect(getHourMinutesInTimezone(brDate('2026-04-26T23:59'), TZ_BR)).toEqual({ hour: 23, minute: 59 });
  });
  it('00:00', () => {
    expect(getHourMinutesInTimezone(brDate('2026-04-26T00:00'), TZ_BR)).toEqual({ hour: 0, minute: 0 });
  });
});

describe('time-context — resolveActiveWindow', () => {
  const baseAvail = { timezone: TZ_BR };

  it('retorna null se behavior_windows vazio', () => {
    const ctx = resolveActiveWindow({ behavior_windows: [], availability: baseAvail }, brDate('2026-04-27T10:00'));
    expect(ctx).toBeNull();
  });

  it('retorna null se behavior_windows undefined (legacy)', () => {
    const ctx = resolveActiveWindow({ availability: baseAvail }, brDate('2026-04-27T10:00'));
    expect(ctx).toBeNull();
  });

  it('match janela comercial seg-sex 09-18', () => {
    const agent = {
      availability: baseAvail,
      behavior_windows: [
        { id: 'a', name: 'Comercial', days: ['mon','tue','wed','thu','fri'], start: '09:00', end: '18:00', behavior: 'tom formal' },
      ],
    };
    const ctx = resolveActiveWindow(agent, brDate('2026-04-27T10:00')); // segunda 10h
    expect(ctx).not.toBeNull();
    expect(ctx!.window.name).toBe('Comercial');
    expect(ctx!.hasBehavior).toBe(true);
    expect(ctx!.formatted).toContain('Comercial');
    expect(ctx!.formatted).toContain('tom formal');
  });

  it('não match comercial fora horário', () => {
    const agent = {
      availability: baseAvail,
      behavior_windows: [
        { id: 'a', name: 'Comercial', days: ['mon','tue','wed','thu','fri'], start: '09:00', end: '18:00', behavior: 'tom formal' },
      ],
    };
    const ctx = resolveActiveWindow(agent, brDate('2026-04-27T20:00'));
    expect(ctx).toBeNull();
  });

  it('não match comercial no domingo', () => {
    const agent = {
      availability: baseAvail,
      behavior_windows: [
        { id: 'a', name: 'Comercial', days: ['mon','tue','wed','thu','fri'], start: '09:00', end: '18:00', behavior: 'x' },
      ],
    };
    const ctx = resolveActiveWindow(agent, brDate('2026-04-26T10:00')); // domingo
    expect(ctx).toBeNull();
  });

  it('first-match wins (precedence por ordem)', () => {
    const agent = {
      availability: baseAvail,
      behavior_windows: [
        { id: 'a', name: 'Específica', days: ['mon'], start: '10:00', end: '11:00', behavior: 'A' },
        { id: 'b', name: 'Genérica', days: ['mon','tue'], start: '00:00', end: '23:59', behavior: 'B' },
      ],
    };
    const ctx = resolveActiveWindow(agent, brDate('2026-04-27T10:30'));
    expect(ctx!.window.name).toBe('Específica');
  });

  it('janela 7d/24h cobre tudo (backfill default)', () => {
    const agent = {
      availability: baseAvail,
      behavior_windows: [
        { id: 'a', name: 'Padrão', days: ['mon','tue','wed','thu','fri','sat','sun'], start: '00:00', end: '23:59', behavior: '' },
      ],
    };
    const ctx = resolveActiveWindow(agent, brDate('2026-04-26T23:00'));
    expect(ctx).not.toBeNull();
    expect(ctx!.hasBehavior).toBe(false); // behavior vazio
    expect(ctx!.formatted).toContain('Padrão');
    expect(ctx!.formatted).toContain('Sem instrução específica');
  });

  it('wrap midnight (22h-06h cobre 23h hoje)', () => {
    const agent = {
      availability: baseAvail,
      behavior_windows: [
        { id: 'a', name: 'Madrugada', days: ['sun'], start: '22:00', end: '06:00', behavior: 'tom casual' },
      ],
    };
    // domingo 23h → cai dentro
    const ctx = resolveActiveWindow(agent, brDate('2026-04-26T23:00'));
    expect(ctx).not.toBeNull();
    expect(ctx!.window.name).toBe('Madrugada');
  });

  it('wrap midnight cobre 03h dia seguinte', () => {
    const agent = {
      availability: baseAvail,
      behavior_windows: [
        { id: 'a', name: 'Madrugada', days: ['sun'], start: '22:00', end: '06:00', behavior: 'x' },
      ],
    };
    // segunda 03h — cobertura vem de domingo (start day)
    const ctx = resolveActiveWindow(agent, brDate('2026-04-27T03:00'));
    expect(ctx).not.toBeNull();
    expect(ctx!.window.name).toBe('Madrugada');
  });

  it('wrap midnight não cobre 14h do mesmo dia', () => {
    const agent = {
      availability: baseAvail,
      behavior_windows: [
        { id: 'a', name: 'Madrugada', days: ['sun'], start: '22:00', end: '06:00', behavior: 'x' },
      ],
    };
    const ctx = resolveActiveWindow(agent, brDate('2026-04-26T14:00'));
    expect(ctx).toBeNull();
  });

  it('formatted contém data/hora pt-BR e timezone', () => {
    const agent = {
      availability: baseAvail,
      behavior_windows: [
        { id: 'a', name: 'X', days: ['mon'], start: '00:00', end: '23:59', behavior: 'Y' },
      ],
    };
    const ctx = resolveActiveWindow(agent, brDate('2026-04-27T10:00'));
    expect(ctx!.formatted).toContain('segunda-feira');
    expect(ctx!.formatted).toContain('27/04/2026');
    expect(ctx!.formatted).toContain('America/Sao_Paulo');
  });

  it('respeita timezone customizado do agente', () => {
    const agent = {
      availability: { timezone: 'UTC' },
      behavior_windows: [
        { id: 'a', name: 'X', days: ['mon'], start: '13:00', end: '14:00', behavior: 'Y' },
      ],
    };
    // 13h UTC = 10h BR — janela é 13-14 UTC, então deve casar
    const ctx = resolveActiveWindow(agent, brDate('2026-04-27T10:30')); // 13:30 UTC
    expect(ctx).not.toBeNull();
  });

  it('agente sem timezone usa America/Sao_Paulo default', () => {
    const agent = {
      availability: null,
      behavior_windows: [
        { id: 'a', name: 'X', days: ['mon'], start: '10:00', end: '11:00', behavior: 'Y' },
      ],
    };
    const ctx = resolveActiveWindow(agent as any, brDate('2026-04-27T10:30'));
    expect(ctx).not.toBeNull();
  });

  it('janelas malformadas são ignoradas', () => {
    const agent = {
      availability: baseAvail,
      behavior_windows: [
        null,
        { id: 'a', name: 'NoDays' /* days ausente */ } as any,
        { id: 'b', name: 'OK', days: ['mon'], start: '10:00', end: '11:00', behavior: '' },
      ],
    };
    const ctx = resolveActiveWindow(agent as any, brDate('2026-04-27T10:30'));
    expect(ctx!.window.name).toBe('OK');
  });
});

describe('time-context — buildDateInTimezone (F5b)', () => {
  it('constrói Date a partir de YYYY-MM-DD + HH:MM em America/Sao_Paulo', () => {
    const d = buildDateInTimezone('2026-04-27', '14:00', 'America/Sao_Paulo');
    expect(d).not.toBeNull();
    // 14:00 BR = 17:00 UTC (offset -3)
    expect(d!.toISOString()).toMatch(/^2026-04-27T17:00:00/);
  });

  it('respeita timezone UTC', () => {
    const d = buildDateInTimezone('2026-04-27', '14:00', 'UTC');
    expect(d!.toISOString()).toMatch(/^2026-04-27T14:00:00/);
  });

  it('retorna null para input inválido', () => {
    expect(buildDateInTimezone('invalid', '14:00', 'America/Sao_Paulo')).toBeNull();
    expect(buildDateInTimezone('2026-04-27', 'no-time', 'America/Sao_Paulo')).toBeNull();
  });

  it('Date construída casa janela do agente correta', () => {
    const agent = {
      availability: { timezone: 'America/Sao_Paulo' },
      behavior_windows: [
        { id: 'a', name: 'Comercial', days: ['mon'], start: '09:00', end: '18:00', behavior: 'tom formal' },
      ],
    };
    // segunda 14h BR
    const target = buildDateInTimezone('2026-04-27', '14:00', 'America/Sao_Paulo');
    const ctx = resolveActiveWindow(agent, target!);
    expect(ctx).not.toBeNull();
    expect(ctx!.window.name).toBe('Comercial');
    expect(ctx!.hasBehavior).toBe(true);
  });

  it('Date fora janela retorna null', () => {
    const agent = {
      availability: { timezone: 'America/Sao_Paulo' },
      behavior_windows: [
        { id: 'a', name: 'Comercial', days: ['mon','tue','wed','thu','fri'], start: '09:00', end: '18:00', behavior: 'tom formal' },
      ],
    };
    // domingo 14h
    const target = buildDateInTimezone('2026-04-26', '14:00', 'America/Sao_Paulo');
    const ctx = resolveActiveWindow(agent, target!);
    expect(ctx).toBeNull();
  });
});

describe('time-context — computeNextWindowStart (Onda 5 workflow)', () => {
  const tz = 'America/Sao_Paulo';
  const windows = [
    { id: 'w1', name: 'Comercial', days: ['mon','tue','wed','thu','fri'], start: '09:00', end: '18:00', behavior: '' } as any,
    { id: 'w2', name: 'Madrugada', days: ['mon','tue','wed','thu','fri','sat','sun'], start: '22:00', end: '06:00', behavior: '' } as any,
  ];

  it('domingo 14h → próxima Comercial = segunda 09:00 BR', () => {
    const from = new Date('2026-04-26T14:00-03:00');
    const next = computeNextWindowStart(windows, 'Comercial', tz, from);
    expect(next).not.toBeNull();
    // 09:00 BR = 12:00 UTC
    expect(next!.toISOString()).toMatch(/^2026-04-27T12:00/);
  });

  it('segunda 10h (já dentro Comercial) → retorna mesmo instante', () => {
    const from = new Date('2026-04-27T10:00-03:00');
    const next = computeNextWindowStart(windows, 'Comercial', tz, from);
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toMatch(/^2026-04-27T13:00/);
  });

  it('segunda 13h → próxima Madrugada = mesma noite 22h', () => {
    const from = new Date('2026-04-27T13:00-03:00');
    const next = computeNextWindowStart(windows, 'Madrugada', tz, from);
    expect(next).not.toBeNull();
    // 22:00 BR = 01:00 UTC dia seguinte
    expect(next!.toISOString()).toMatch(/^2026-04-28T01:00/);
  });

  it('janela inexistente retorna null', () => {
    const next = computeNextWindowStart(windows, 'Inexistente', tz);
    expect(next).toBeNull();
  });

  it('respeita timezone diferente', () => {
    const winUTC = [
      { id: 'w', name: 'Test', days: ['mon'], start: '15:00', end: '16:00', behavior: '' } as any,
    ];
    const from = new Date('2026-04-27T10:00Z'); // segunda 10:00 UTC
    const next = computeNextWindowStart(winUTC, 'Test', 'UTC', from);
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toMatch(/^2026-04-27T15:00/);
  });
});

describe('time-context — formatTemporalAnchor (RC 2026-06-24 data errada)', () => {
  it('caso Marcio: hoje quarta 24/06/2026 → amanhã quinta 25/06/2026, ano 2026', () => {
    const out = formatTemporalAnchor(brDate('2026-06-24T09:47'), TZ_BR);
    expect(out).toContain('Hoje é quarta-feira, 24/06/2026');
    expect(out).toContain('Amanhã é quinta-feira, 25/06/2026');
    expect(out).toContain('O ano atual é 2026');
    // regressão dura: jamais a data alucinada do treino
    expect(out).not.toContain('2024');
    expect(out).not.toContain('26 de junho');
  });

  it('vira o ano: 31/12 → amanhã 01/01 do ano seguinte', () => {
    const out = formatTemporalAnchor(brDate('2026-12-31T22:00'), TZ_BR);
    expect(out).toContain('Hoje é quinta-feira, 31/12/2026');
    expect(out).toContain('Amanhã é sexta-feira, 01/01/2027');
  });

  it('inclui instrução anti-memória + agora com fuso', () => {
    const out = formatTemporalAnchor(brDate('2026-06-24T09:47'), TZ_BR);
    expect(out).toMatch(/NUNCA invente uma data/);
    expect(out).toContain('America/Sao_Paulo');
    expect(out).toContain('- Agora: quarta-feira, 24/06/2026 09:47');
  });
});

describe('time-context — formatDateTimeInTz / formatDateInTz (UTC → fuso do agente)', () => {
  it('reunião UTC 17:00Z vira 14:00 BRT (não vaza UTC pro copilot)', () => {
    expect(formatDateTimeInTz('2026-07-15T17:00:00Z', TZ_BR)).toBe('15/07/2026 14:00');
  });
  it('vira o dia: 02:00Z é 23:00 BRT do dia anterior', () => {
    expect(formatDateInTz('2026-07-15T02:00:00Z', TZ_BR)).toBe('14/07/2026');
  });
  it('data-only sem hora', () => {
    expect(formatDateInTz('2026-07-15T17:00:00Z', TZ_BR)).toBe('15/07/2026');
  });
  it('null/undefined/inválido/vazio → string vazia (sem crash)', () => {
    expect(formatDateTimeInTz(null, TZ_BR)).toBe('');
    expect(formatDateTimeInTz(undefined, TZ_BR)).toBe('');
    expect(formatDateTimeInTz('nao-e-data', TZ_BR)).toBe('');
    expect(formatDateInTz('', TZ_BR)).toBe('');
  });
  it('default é America/Sao_Paulo', () => {
    expect(formatDateTimeInTz('2026-07-15T17:00:00Z')).toBe('15/07/2026 14:00');
  });
});
