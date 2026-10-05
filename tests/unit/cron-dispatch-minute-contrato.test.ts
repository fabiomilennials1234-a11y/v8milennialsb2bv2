/**
 * Contrato do dispatcher único de minuto (20271107140002_cron_dispatch_minute.sql,
 * OOM de prod em 2026-10-05).
 *
 * Complementa tests/unit/cron-escalonamento-contrato.test.ts, que mede só os
 * jobs NÃO-por-minuto. Aqui, sobre o snapshot de cron.job de prod (2026-10-02)
 * já reescalonado:
 *   - o dispatcher consolida EXATAMENTE os jobs que disparavam ≥ 30×/h (todo
 *     minuto e a cada 2 min) — nenhum fica de fora, nenhum a mais;
 *   - a cadência de 2 em 2 min (`*\/2` → minuto par, `1-59/2` → ímpar) está no corpo;
 *   - conexões abertas pelo pg_cron por minuto caem de 17–19 para 1–3 numa
 *     hora comum (use_background_workers = off: um job = uma conexão);
 *   - o TETO de 8 do escalonamento continua valendo com as mudanças posteriores
 *     ao snapshot — todo cron.schedule de migration nova (lerAgendadosDepois,
 *     o mesmo leitor do contrato de escalonamento) e o alter_job do job 65
 *     (#2232), amarrado ao texto da migration — e cai para 6 sem os 4 jobs de
 *     2 em 2 min;
 *   - a migration casa por jobname, só DESATIVA (não unschedule), e só agenda
 *     o próprio dispatcher.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analisarAgenda,
  aplicar,
  cargaSemanal,
  disparosNaSemana,
  lerAgendadosDepois,
  lerReescalonamento,
} from '../../scripts/cron/carga-por-minuto.mjs';

type Job = { jobid?: number; jobname: string; schedule: string };

const RAIZ = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(RAIZ, 'supabase/migrations');
const ler = (sufixo: string) => {
  const f = readdirSync(MIGRATIONS).find((n) => n.endsWith(sufixo));
  return readFileSync(path.join(MIGRATIONS, f ?? 'ausente'), 'utf8');
};
const M3 = ler('_cron_dispatch_minute.sql');
const ROLLBACK = readFileSync(
  path.join(MIGRATIONS, 'rollback', readdirSync(path.join(MIGRATIONS, 'rollback')).find((n) => n.endsWith('_cron_dispatch_minute.sql')) ?? 'ausente'),
  'utf8',
);
const { jobs } = JSON.parse(
  readFileSync(path.join(RAIZ, 'scripts/cron/prod-snapshot-2026-10-02.json'), 'utf8'),
) as { jobs: Job[] };

const ESCALONAR = readdirSync(MIGRATIONS).find((n) => n.endsWith('_escalonar_crons_por_fase_anti_rajada.sql'));
const escalonado = aplicar(jobs, lerReescalonamento(ler('_escalonar_crons_por_fase_anti_rajada.sql'))) as Job[];
/** cron.schedule de toda migration posterior ao reescalonamento (inclui o dispatcher). */
const AGENDADOS_DEPOIS = lerAgendadosDepois(MIGRATIONS, ESCALONAR);
const DISPATCHER = AGENDADOS_DEPOIS.find((j) => j.jobname === 'cron-dispatch-minute');
/**
 * calculate-portfolio-health mudou por cron.alter_job (#2232), que
 * lerAgendadosDepois não lê: declarado aqui e amarrado ao texto da migration
 * no teste "mudanças pós-snapshot", para mudança futura não passar calada.
 */
const AGENDA_PORTFOLIO = '21 6,11-23/2 * * *';
/** Estado ANTES do dispatcher: snapshot reescalonado + mudanças pós-snapshot, sem o dispatcher. */
const atual: Job[] = [
  ...escalonado
    .filter((j) => !AGENDADOS_DEPOIS.some((n) => n.jobname === j.jobname))
    .map((j) => (j.jobname === 'calculate-portfolio-health' ? { ...j, schedule: AGENDA_PORTFOLIO } : j)),
  ...AGENDADOS_DEPOIS.filter((j) => j.jobname !== 'cron-dispatch-minute'),
];
/** Estado DEPOIS: sem os 19, com o dispatcher como a migration o agenda. */
const posM3 = (): Job[] => atual.filter((j) => !ANTIGOS.includes(j.jobname)).concat(DISPATCHER ? [DISPATCHER] : []);

function lista(sql: string): string[] {
  const m = /v_antigos text\[\] := ARRAY\[([\s\S]*?)\];/.exec(sql);
  if (!m) throw new Error('v_antigos ausente');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
const ANTIGOS = lista(M3);
const altaFrequencia = (j: Job) => {
  const a = analisarAgenda(j.schedule);
  return a.minutos.size >= 30 && a.horas.size === 24 && a.dias.size === 7;
};
const pico = (c: Uint16Array) => c.reduce((m, x) => Math.max(m, x), 0);

/** Conexões do pg_cron por minuto numa hora comum (terça 14h), contando os por-minuto. */
function conexoesHoraComum(js: Job[]): number[] {
  const base = 2 * 1440 + 14 * 60;
  const out = new Array(60).fill(0);
  for (const j of js) for (const t of disparosNaSemana(j.schedule)) if (t >= base && t < base + 60) out[t - base] += 1;
  return out;
}

describe('dispatcher único de minuto', () => {
  it('consolida exatamente os 19 jobs de alta frequência do snapshot', () => {
    expect(ANTIGOS).toHaveLength(19);
    expect(new Set(ANTIGOS).size).toBe(19);
    expect([...ANTIGOS].sort()).toEqual(escalonado.filter(altaFrequencia).map((j) => j.jobname).sort());
    expect(lista(ROLLBACK)).toEqual(ANTIGOS);
  });

  it('de 2 em 2 min: par continua par, ímpar continua ímpar', () => {
    const corpo = M3.slice(M3.indexOf('IF v_minuto % 2 = 0 THEN'));
    const par = corpo.slice(0, corpo.indexOf('\n  ELSE\n'));
    const impar = corpo.slice(corpo.indexOf('\n  ELSE\n'), corpo.indexOf('END IF;\n\n  -- ── Minuto 7'));
    for (const j of escalonado.filter((x) => altaFrequencia(x) && !analisarAgenda(x.schedule).porMinuto)) {
      const minutos = [...analisarAgenda(j.schedule).minutos];
      const bloco = minutos.every((m) => m % 2 === 0) ? par : minutos.every((m) => m % 2 === 1) ? impar : null;
      expect(bloco, `${j.jobname} ${j.schedule}`).not.toBeNull();
      expect(bloco, j.jobname).toContain(`'${j.jobname}'`);
    }
    // todo-minuto fica fora dos blocos de paridade
    for (const j of escalonado.filter((x) => analisarAgenda(x.schedule).porMinuto)) {
      expect(M3.indexOf(`'sub', '${j.jobname}'`), j.jobname).toBeLessThan(M3.indexOf('IF v_minuto % 2 = 0 THEN'));
    }
    expect(M3).toMatch(/extract\(minute FROM p_now AT TIME ZONE 'UTC'\)/);
  });

  it('conexões do pg_cron por minuto caem de 17–19 para 1–3 numa hora comum', () => {
    const antes = conexoesHoraComum(atual);
    const depois = conexoesHoraComum(posM3());
    expect(Math.min(...antes)).toBeGreaterThanOrEqual(17);
    expect(Math.max(...depois)).toBeLessThanOrEqual(Math.max(...antes) - 16);
    // 15 jobs × 60 + 4 jobs × 30 = 1.020 disparos/h viram 60 do dispatcher.
    const soma = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
    expect(soma(antes) - soma(depois)).toBe(1020 - 60);
  });

  it('mudanças pós-snapshot estão enxergadas (controle contra verde por ausência)', () => {
    expect(DISPATCHER).toEqual(expect.objectContaining({ schedule: '* * * * *' }));
    expect(AGENDADOS_DEPOIS.map((j) => j.jobname)).toContain('purge-system-alerts-resolvidos');
    expect(ler('_portfolio_health_set_based.sql')).toContain(`schedule => '${AGENDA_PORTFOLIO}'`);
    expect(atual.find((j) => j.jobname === 'calculate-portfolio-health')?.schedule).toBe(AGENDA_PORTFOLIO);
  });

  it('TETO 8 do escalonamento segue valendo com as mudanças pós-snapshot; sem os de 2 em 2 min cai para 6', () => {
    expect(pico(cargaSemanal(atual))).toBeLessThanOrEqual(8);
    expect(pico(cargaSemanal(posM3()))).toBeLessThanOrEqual(6);
  });

  it('casa por jobname, só desativa, só agenda o próprio dispatcher; rollback reativa', () => {
    expect(M3).toMatch(/FOR v_job IN SELECT jobid, active FROM cron\.job WHERE jobname = v_nome LOOP/);
    expect(M3).toMatch(/cron\.alter_job\(job_id := v_job\.jobid, active := false\)/);
    expect(M3).not.toMatch(/cron\.unschedule/);
    expect(M3).not.toMatch(/job_id\s*:=\s*\d/);
    expect([...M3.matchAll(/cron\.schedule\('([^']+)'/g)].map((m) => m[1])).toEqual(['cron-dispatch-minute']);
    expect(M3).toMatch(/to_regnamespace\('cron'\) IS NULL/);
    expect(ROLLBACK).toMatch(/cron\.alter_job\(job_id := v_job\.jobid, active := true\)/);
    expect(ROLLBACK).toMatch(/cron\.unschedule\('cron-dispatch-minute'\)/);
  });
});
