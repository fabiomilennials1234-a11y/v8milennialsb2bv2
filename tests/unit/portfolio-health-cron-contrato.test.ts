/**
 * Agenda nova de calculate-portfolio-health (incidente 2026-10-05).
 *
 * A migration troca `21-59/30 * * * *` por `21 6,11-23/2 * * *`. Prova que a
 * agenda nova é SUBCONJUNTO da antiga — nenhum minuto da semana ganha disparo,
 * então o TETO de cron-escalonamento-contrato.test.ts continua valendo — e que
 * a migration casa por jobname.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { disparosNaSemana, frequenciaSemanal } from "../../scripts/cron/carga-por-minuto.mjs";

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");
const arquivo = readdirSync(MIGRATIONS).find((f) => f.endsWith("_portfolio_health_set_based.sql"));
const SQL = readFileSync(path.join(MIGRATIONS, arquivo ?? "ausente"), "utf8");

const ANTES = "21-59/30 * * * *";
const DEPOIS = "21 6,11-23/2 * * *";

describe("cron de calculate-portfolio-health", () => {
  it("a migration aplica a agenda nova por jobname, sem jobid fixo", () => {
    expect(SQL).toContain(`schedule => '${DEPOIS}'`);
    expect(SQL).toMatch(/WHERE j\.jobname = 'calculate-portfolio-health'/);
    expect(SQL).not.toMatch(/job_id\s*=>\s*\d/);
    expect(SQL).toMatch(/to_regclass\('cron\.job'\) IS NULL/);
  });

  it("é subconjunto da agenda antiga: nenhum minuto ganha disparo", () => {
    const antes = new Set(disparosNaSemana(ANTES));
    const depois = disparosNaSemana(DEPOIS);
    expect(depois.every((t: number) => antes.has(t))).toBe(true);
  });

  it("cai de 336 para 56 execuções por semana (8/dia)", () => {
    expect(frequenciaSemanal(ANTES)).toBe(336);
    expect(frequenciaSemanal(DEPOIS)).toBe(56);
  });
});
