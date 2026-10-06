/**
 * Contrato do reescalonamento de fase dos crons de prod (incidente 2026-10-02,
 * `too many clients` às 12:40:01 depois de ~30 jobs dispararem no mesmo segundo).
 *
 * Lê a migration como texto e prova, sobre o snapshot de cron.job de prod:
 *   - nenhum minuto da semana recebe mais que TETO disparos não-por-minuto;
 *   - só a fase muda: frequência semanal de todo job é a mesma;
 *   - as purgas já escalonadas (20270915000010) não são tocadas nem voltam a
 *     dividir minuto entre si;
 *   - a migration casa por jobname e não usa jobid fixo.
 *
 * TETO = 8. Justificativa: os jobs recorrentes somam ≈400 disparos/hora, o
 * que dá piso teórico de 7 por minuto (ceil(400/60)); com as purgas fixas e os
 * diários intocados, 8 foi o mínimo encontrado por busca (annealing, 4
 * sementes). Antes da migration o pico era 28. Subir o TETO exige refazer a
 * conta — não é ajuste de tolerância.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analisarAgenda,
  aplicar,
  cargaSemanal,
  disparosNaSemana,
  expandirCampo,
  frequenciaSemanal,
  lerAgendadosDepois,
  lerReescalonamento,
} from '../../scripts/cron/carga-por-minuto.mjs';

type Job = { jobid: number; jobname: string; schedule: string; avgSeconds: number | null };

const RAIZ = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(RAIZ, 'supabase/migrations');
const ARQUIVO = readdirSync(MIGRATIONS).find((f) =>
  f.endsWith('_escalonar_crons_por_fase_anti_rajada.sql'),
);
const SQL = readFileSync(path.join(MIGRATIONS, ARQUIVO ?? 'ausente'), 'utf8');
const { jobs } = JSON.parse(
  readFileSync(path.join(RAIZ, 'scripts/cron/prod-snapshot-2026-10-02.json'), 'utf8'),
) as { jobs: Job[] };

const TETO = 8;
const PICO_ANTES = 28;

/** Purgas e varreduras pesadas cujo escalonamento é pré-existente e deve ser preservado. */
const PURGAS_FIXAS = [
  'cron-health-monitor',
  'cleanup-audit-log-14d',
  'cleanup-wa-health-checks-7d',
  'cleanup-wa-media-jobs-14d',
  'purge-runtime-logs',
  'history-sync-budget-cleanup',
  'purge-copilot-midia-logs',
  'torquecalls-recording-maintenance',
  'summarize-conversations-batch',
  'oraculo-admin-briefing-shrinkage',
  'calculate-portfolio-health',
  'toth-sync-cobrancas',
];
/** Pesadas recorrentes (medidas em cron.job_run_details): não podem dividir minuto entre si. */
const PESADAS_RECORRENTES = [
  'purge-runtime-logs',
  'cron-health-monitor',
  'cleanup-wa-health-checks-7d',
  'cleanup-audit-log-14d',
  'cleanup-wa-media-jobs-14d',
  'purge-copilot-midia-logs',
  'avisos-varredura-reuniao-proxima',
];

const resc = lerReescalonamento(SQL);
const depois = aplicar(jobs, resc) as Job[];
const pico = (c: Uint16Array) => c.reduce((m, x) => Math.max(m, x), 0);

describe('parser de cron', () => {
  it('expande *, faixa, passo com início e lista', () => {
    expect([...expandirCampo('*/15', 0, 59)]).toEqual([0, 15, 30, 45]);
    expect([...expandirCampo('3-59/15', 0, 59)]).toEqual([3, 18, 33, 48]);
    expect([...expandirCampo('7,22', 0, 59)]).toEqual([7, 22]);
    expect([...expandirCampo('31', 0, 59)]).toEqual([31]);
  });

  it('recusa o que não sabe calcular em vez de errar em silêncio', () => {
    expect(() => analisarAgenda('30 seconds')).toThrow();
    expect(() => analisarAgenda('0 3 1 * *')).toThrow();
    expect(() => expandirCampo('70', 0, 59)).toThrow();
  });

  it('conta disparos por semana', () => {
    expect(frequenciaSemanal('*/5 * * * *')).toBe(12 * 24 * 7);
    expect(frequenciaSemanal('15 13 * * 1')).toBe(1);
    expect(disparosNaSemana('0 7 * * 0')).toEqual([7 * 60]);
  });
});

describe('migration de reescalonamento de fase', () => {
  it('existe e é única', () => {
    expect(ARQUIVO).toBeDefined();
    expect(
      readdirSync(MIGRATIONS).filter((f) => f.endsWith('_escalonar_crons_por_fase_anti_rajada.sql')),
    ).toHaveLength(1);
  });

  it('casa por jobname, nunca por jobid fixo', () => {
    expect(SQL).toMatch(/WHERE jobname = alvo\.nome/);
    expect(SQL).toMatch(/cron\.alter_job\(job_id := achado\.jobid, schedule := alvo\.depois\)/);
    expect(SQL).not.toMatch(/job_id\s*:?=>?\s*\d/);
    // só schedule muda: nenhum outro parâmetro de alter_job aparece
    expect(SQL).not.toMatch(/command\s*:=|database\s*:=|username\s*:=|active\s*:=/);
  });

  it('é tolerante a job ausente e não sobrescreve agenda divergente', () => {
    expect(SQL).toMatch(/IF n = 0 THEN\s+RAISE NOTICE/);
    expect(SQL).toMatch(/ELSIF achado\.schedule = alvo\.antes THEN/);
    expect(SQL).toMatch(/agenda inesperada/);
  });

  it('todo job da migration existe no snapshot com a agenda "antes" declarada', () => {
    for (const [nome, { antes }] of resc) {
      const job = jobs.find((j) => j.jobname === nome);
      expect(job, nome).toBeDefined();
      expect(job?.schedule, nome).toBe(antes);
    }
  });

  it('só muda fase: frequência semanal idêntica e nenhum job por-minuto tocado', () => {
    for (const [nome, { antes, depois: novo }] of resc) {
      expect(frequenciaSemanal(novo), nome).toBe(frequenciaSemanal(antes));
      expect(analisarAgenda(antes).porMinuto, nome).toBe(false);
      // mesmas horas e dias: só o minuto se desloca
      expect([...analisarAgenda(novo).horas], nome).toEqual([...analisarAgenda(antes).horas]);
      expect([...analisarAgenda(novo).dias], nome).toEqual([...analisarAgenda(antes).dias]);
      expect(novo, nome).not.toBe(antes);
    }
  });

  it('não toca as purgas já escalonadas', () => {
    for (const nome of PURGAS_FIXAS) expect(resc.has(nome), nome).toBe(false);
  });

  it(`pico de disparos não-por-minuto cai de ${PICO_ANTES} para no máximo ${TETO}`, () => {
    expect(pico(cargaSemanal(jobs))).toBe(PICO_ANTES);
    expect(pico(cargaSemanal(depois))).toBeLessThanOrEqual(TETO);
  });

  it('TETO está a 1 do piso teórico', () => {
    const recorrentes = depois.filter((j) => !analisarAgenda(j.schedule).porMinuto);
    const porSemana = recorrentes.reduce((s, j) => s + frequenciaSemanal(j.schedule), 0);
    const piso = Math.ceil(porSemana / (7 * 24 * 60));
    expect(TETO - piso).toBeLessThanOrEqual(1);
  });

  it('nenhum minuto da hora concentra disparos: :00 deixa de ser a rajada', () => {
    const c = cargaSemanal(depois);
    // em toda hora da semana, :00 fica no máximo no TETO (antes chegava a 28)
    for (let t = 0; t < c.length; t += 60) expect(c[t]).toBeLessThanOrEqual(TETO);
  });

  it('pesadas recorrentes não dividem minuto entre si', () => {
    const ocupado = new Map<number, string>();
    for (const nome of PESADAS_RECORRENTES) {
      const job = depois.find((j) => j.jobname === nome);
      expect(job, nome).toBeDefined();
      for (const t of disparosNaSemana(job!.schedule)) {
        expect(ocupado.get(t), `${nome} colide no minuto ${t}`).toBeUndefined();
        ocupado.set(t, nome);
      }
    }
  });
});

/**
 * Jobs AGENDADOS por migrations posteriores ao reescalonamento. Sem isto o
 * contrato fica verde por ausência: o snapshot de prod é de 2026-10-02 e não
 * conhece job criado depois. Cada `cron.schedule('nome', 'agenda', ...)` de
 * migration mais nova entra (ou substitui o homônimo) na carga medida.
 */
const AGENDADOS_DEPOIS = lerAgendadosDepois(MIGRATIONS, ARQUIVO);

describe('jobs agendados por migrations novas', () => {
  const comNovos = [
    ...depois.filter((j) => !AGENDADOS_DEPOIS.some((n) => n.jobname === j.jobname)),
    ...AGENDADOS_DEPOIS.map(({ jobname, schedule }) => ({ jobid: 0, jobname, schedule, avgSeconds: null })),
  ] as Job[];

  it('o parser enxerga os agendamentos (controle contra verde por ausência)', () => {
    expect(AGENDADOS_DEPOIS.map((j) => j.jobname)).toContain('purge-system-alerts-resolvidos');
  });

  it(`pico de disparos não-por-minuto continua no máximo ${TETO}`, () => {
    expect(pico(cargaSemanal(comNovos))).toBeLessThanOrEqual(TETO);
  });

  it('job novo não divide minuto com purga pesada recorrente', () => {
    const pesados = new Set<number>();
    for (const nome of PESADAS_RECORRENTES) {
      const job = depois.find((j) => j.jobname === nome);
      for (const t of disparosNaSemana(job!.schedule)) pesados.add(t);
    }
    // Job por-minuto (`* * * * *`) não tem fase a escolher: colide com toda purga
    // por definição, e é por isso que fica fora da carga medida (cargaSemanal).
    // Hoje o único é cron-dispatch-minute (20271107140002), que roda as 19
    // subtarefas em UMA conexão e substitui 19 jobs (≈1.020 → 60 conexões/h);
    // tests/unit/cron-dispatch-minute-contrato.test.ts mede o efeito dele. Para
    // todo job com fase, o check segue integral.
    for (const novo of AGENDADOS_DEPOIS) {
      if (analisarAgenda(novo.schedule).porMinuto) continue;
      for (const t of disparosNaSemana(novo.schedule)) {
        expect(pesados.has(t), `${novo.jobname} (${novo.arquivo}) colide no minuto ${t}`).toBe(false);
      }
    }
  });
});
