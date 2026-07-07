import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "../../scripts/check-metric-antipatterns.sh");

interface LintResult {
  code: number;
  output: string;
}

function runLint(migDir: string, baselineFile?: string): LintResult {
  try {
    const output = execFileSync("bash", [SCRIPT, migDir], {
      encoding: "utf8",
      env: {
        ...process.env,
        METRIC_LINT_BASELINE: baselineFile ?? "/dev/null",
      },
    });
    return { code: 0, output };
  } catch (err: unknown) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { code: e.status, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("check-metric-antipatterns", () => {
  let migDir: string;

  beforeEach(() => {
    migDir = mkdtempSync(join(tmpdir(), "metric-lint-"));
  });

  afterEach(() => {
    rmSync(migDir, { recursive: true, force: true });
  });

  it("reprova migration nova com predicado type='system' em métrica (R3)", () => {
    writeFileSync(
      join(migDir, "20270301000000_new_metric_rpc.sql"),
      `CREATE OR REPLACE FUNCTION get_some_metric()
RETURNS TABLE(total bigint) AS $$
  SELECT count(*) FROM pipeline_entries pe
  JOIN pipelines p ON p.id = pe.pipeline_id
  WHERE p.type = 'system'
$$ LANGUAGE sql;`,
    );

    const result = runLint(migDir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/type\s*=\s*'system'/i);
    expect(result.output).toContain("ADR-0017");
    expect(result.output).toContain("20270301000000_new_metric_rpc.sql");
  });

  it("não flaga seed INSERT com valor 'system' nem migration limpa", () => {
    writeFileSync(
      join(migDir, "20270301000001_seed_pipelines.sql"),
      `INSERT INTO pipelines (organization_id, name, slug, type)
VALUES ('00000000-0000-0000-0000-000000000000', 'Vendas', 'vendas', 'system');
CREATE INDEX idx_foo ON pipelines (organization_id);`,
    );

    const result = runLint(migDir);

    expect(result.code).toBe(0);
  });

  it("ratchet: arquivo listado no baseline com violação passa (backlog congelado)", () => {
    writeFileSync(
      join(migDir, "20261114000011_old_dashboard_metrics.sql"),
      `SELECT count(*) FROM pipelines p WHERE p.type = 'system';`,
    );
    const baseline = join(migDir, "baseline.txt");
    writeFileSync(baseline, "20261114000011_old_dashboard_metrics.sql\n");

    const result = runLint(migDir, baseline);

    expect(result.code).toBe(0);
  });

  it("reprova COALESCE encadeando chaves de atribuição (R5)", () => {
    writeFileSync(
      join(migDir, "20270301000002_ranking_rpc.sql"),
      `SELECT COALESCE(l.sale_responsible_id, l.closer_id) AS seller_id
FROM leads l;`,
    );

    const result = runLint(migDir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/R5/);
    expect(result.output).toContain("ADR-0017");
  });

  it("não flaga COALESCE de uma única chave de atribuição com literal", () => {
    writeFileSync(
      join(migDir, "20270301000003_ok_coalesce.sql"),
      `SELECT COALESCE(l.sale_responsible_id, '00000000-0000-0000-0000-000000000000') FROM leads l;`,
    );

    const result = runLint(migDir);

    expect(result.code).toBe(0);
  });

  it("reprova updated_at usado como âncora temporal (R4)", () => {
    writeFileSync(
      join(migDir, "20270301000004_sales_period.sql"),
      `SELECT count(*) FROM pipe_propostas pp
WHERE COALESCE(pp.closed_at, pp.updated_at) >= p_start;`,
    );

    const result = runLint(migDir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/R4/);
  });

  it("não flaga updated_at em trigger de manutenção (SET updated_at = now())", () => {
    writeFileSync(
      join(migDir, "20270301000005_touch_trigger.sql"),
      `CREATE TRIGGER touch BEFORE UPDATE ON foo
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
UPDATE foo SET updated_at = now() WHERE id = '1';`,
    );

    const result = runLint(migDir);

    expect(result.code).toBe(0);
  });

  it("reprova SUM de receita em arquivo que não lê sale_events (ledger)", () => {
    writeFileSync(
      join(migDir, "20270301000006_revenue_from_state.sql"),
      `SELECT SUM(pp.sale_value) AS revenue FROM pipe_propostas pp
WHERE pp.stage_key = 'vendido';`,
    );

    const result = runLint(migDir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/ledger-revenue/);
  });

  it("aceita SUM de receita quando a fonte é o caderno sale_events", () => {
    writeFileSync(
      join(migDir, "20270301000007_revenue_from_ledger.sql"),
      `SELECT SUM(se.sale_value) AS revenue FROM sale_events se
WHERE se.event_type = 'sale_won';`,
    );

    const result = runLint(migDir);

    expect(result.code).toBe(0);
  });

  it("supressão consciente: '-- metric-lint-allow' na linha libera a exceção", () => {
    writeFileSync(
      join(migDir, "20270301000008_deliberate.sql"),
      `SELECT count(*) FROM pipelines p
WHERE p.type = 'system' -- metric-lint-allow: migração de dados one-off, não é métrica
;`,
    );

    const result = runLint(migDir);

    expect(result.code).toBe(0);
  });
});
