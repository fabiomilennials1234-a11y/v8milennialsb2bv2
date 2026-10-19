/**
 * Contrato das migrations da alavanca 6 do plano de RAM/pool
 * (.specs/perf/fora-do-banco.md): purgas saem do expediente e as varreduras de
 * avisos passam de 1 para 2 min.
 *
 * Diferente do reescalonamento anti-rajada (20271103000900, só fase), estas
 * mudam FREQUÊNCIA — e só para baixo. O contrato prova, sobre o snapshot de
 * cron.job de prod de 2026-10-19:
 *   - toda agenda "antes" é a que prod tem hoje (senão a migration vira no-op);
 *   - nenhum job passa a disparar mais;
 *   - purge-runtime-logs sai do expediente (12–21 UTC) e cai na madrugada BRT;
 *   - purga pesada não divide minuto com outra purga pesada;
 *   - pico de disparos não-por-minuto continua ≤ TETO (8, do contrato anti-rajada);
 *   - as duas varreduras de avisos não dividem minuto entre si;
 *   - o corpo usa o mesmo contrato de execução (jobname, guarda antes/depois).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aplicar,
  analisarAgenda,
  cargaSemanal,
  disparosNaSemana,
  frequenciaSemanal,
  lerReescalonamento,
} from '../../scripts/cron/carga-por-minuto.mjs';

type Job = { jobid: number; jobname: string; schedule: string; avgSeconds: number | null };

const RAIZ = path.resolve(__dirname, '../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const PURGAS = 'supabase/migrations/20271127000000_crons_purga_fora_do_expediente.sql';
const AVISOS = 'supabase/migrations/20271127000001_avisos_varreduras_a_cada_2_min.sql';
const ROLLBACK_PURGAS = 'supabase/migrations/rollback/20271127000000_crons_purga_fora_do_expediente.sql';
const ROLLBACK_AVISOS = 'supabase/migrations/rollback/20271127000001_avisos_varreduras_a_cada_2_min.sql';

const { jobs } = JSON.parse(ler('scripts/cron/prod-snapshot-2026-10-19.json')) as { jobs: Job[] };

const TETO = 8;
const EXPEDIENTE_UTC = new Set([12, 13, 14, 15, 16, 17, 18, 19, 20]);

/** Purgas pesadas recorrentes vigentes em prod: não podem dividir minuto entre si. */
const PESADAS = [
  'purge-runtime-logs',
  'cron-health-monitor',
  'cleanup-wa-health-checks-7d',
  'cleanup-audit-log-14d',
  'cleanup-wa-media-jobs-14d',
  'purge-copilot-midia-logs',
];

const resPurgas = lerReescalonamento(ler(PURGAS));
const resAvisos = lerReescalonamento(ler(AVISOS));
const depois = aplicar(aplicar(jobs, resPurgas), resAvisos) as Job[];
const pico = (c: Uint16Array) => c.reduce((m, x) => Math.max(m, x), 0);
const job = (lista: Job[], nome: string) => {
  const j = lista.find((x) => x.jobname === nome);
  if (!j) throw new Error(`${nome} ausente`);
  return j;
};

describe('snapshot de prod 2026-10-19 (controle contra verde por ausência)', () => {
  it('as migrations declaram exatamente os jobs esperados', () => {
    expect([...resPurgas.keys()].sort()).toEqual(
      ['cleanup-audit-log-14d', 'cleanup-wa-health-checks-7d', 'purge-runtime-logs'],
    );
    expect([...resAvisos.keys()].sort()).toEqual(
      ['avisos-varredura-followups', 'avisos-varredura-reuniao-proxima'],
    );
  });

  it('tem os 54 jobs ativos e as agendas de hoje', () => {
    expect(jobs).toHaveLength(54);
    expect(job(jobs, 'purge-runtime-logs').schedule).toBe('9-59/10 * * * *');
    expect(job(jobs, 'avisos-varredura-followups').schedule).toBe('* * * * *');
  });
});

for (const [rotulo, arquivo, res] of [
  ['purgas fora do expediente', PURGAS, resPurgas],
  ['avisos a cada 2 min', AVISOS, resAvisos],
] as const) {
  describe(`migration: ${rotulo}`, () => {
    const sql = ler(arquivo);

    it('casa por jobname, só muda schedule, guarda antes/depois', () => {
      expect(sql).toMatch(/WHERE jobname = alvo\.nome/);
      expect(sql).toMatch(/cron\.alter_job\(job_id := achado\.jobid, schedule := alvo\.depois\)/);
      expect(sql).not.toMatch(/job_id\s*:?=>?\s*\d/);
      expect(sql).not.toMatch(/command\s*:=|database\s*:=|username\s*:=|active\s*:=/);
      expect(sql).toMatch(/IF n = 0 THEN\s+RAISE NOTICE/);
      expect(sql).toMatch(/ELSIF achado\.schedule = alvo\.antes THEN/);
      expect(sql).toMatch(/agenda inesperada/);
    });

    it('todo "antes" é a agenda de prod hoje', () => {
      for (const [nome, { antes }] of res) expect(job(jobs, nome).schedule, nome).toBe(antes);
    });

    it('frequência só cai, e cai de fato', () => {
      for (const [nome, { antes, depois: novo }] of res) {
        expect(frequenciaSemanal(novo), nome).toBeLessThan(frequenciaSemanal(antes));
      }
    });
  });
}

describe('rollback', () => {
  it('é o inverso exato de cada migration', () => {
    for (const [mig, rb] of [
      [resPurgas, lerReescalonamento(ler(ROLLBACK_PURGAS))],
      [resAvisos, lerReescalonamento(ler(ROLLBACK_AVISOS))],
    ] as const) {
      expect([...rb.keys()].sort()).toEqual([...mig.keys()].sort());
      for (const [nome, { antes, depois: novo }] of mig) {
        expect(rb.get(nome), nome).toEqual({ antes: novo, depois: antes });
      }
    }
  });
});

describe('carga depois das duas migrations', () => {
  it('purge-runtime-logs roda 1×/dia, fora do expediente, na madrugada BRT', () => {
    const disparos = disparosNaSemana(job(depois, 'purge-runtime-logs').schedule);
    expect(disparos).toHaveLength(7);
    for (const t of disparos) {
      const horaUtc = Math.floor((t % (24 * 60)) / 60);
      expect(EXPEDIENTE_UTC.has(horaUtc)).toBe(false);
      expect(horaUtc).toBeGreaterThanOrEqual(3); // 00h BRT
      expect(horaUtc).toBeLessThanOrEqual(8); // 05h BRT
    }
  });

  it(`pico de disparos não-por-minuto ≤ ${TETO}`, () => {
    expect(pico(cargaSemanal(jobs))).toBeLessThanOrEqual(TETO);
    expect(pico(cargaSemanal(depois))).toBeLessThanOrEqual(TETO);
  });

  it('purga pesada não divide minuto com outra purga pesada', () => {
    const ocupado = new Map<number, string>();
    for (const nome of PESADAS) {
      for (const t of disparosNaSemana(job(depois, nome).schedule)) {
        expect(ocupado.get(t), `${nome} colide no minuto ${t}`).toBeUndefined();
        ocupado.set(t, nome);
      }
    }
  });

  it('as duas varreduras de avisos não dividem minuto e cobrem a janela de 20 min', () => {
    const reuniao = job(depois, 'avisos-varredura-reuniao-proxima').schedule;
    const followups = job(depois, 'avisos-varredura-followups').schedule;
    expect(analisarAgenda(reuniao).porMinuto).toBe(false);
    const a = new Set(disparosNaSemana(reuniao));
    for (const t of disparosNaSemana(followups)) expect(a.has(t), `minuto ${t}`).toBe(false);
    // passo máximo entre execuções ≤ 2 min: nenhuma janela de aviso (≥ 20 min) fica sem varredura
    for (const agenda of [reuniao, followups]) {
      const d = disparosNaSemana(agenda);
      for (let i = 1; i < d.length; i++) expect(d[i] - d[i - 1]).toBeLessThanOrEqual(2);
    }
  });
});
