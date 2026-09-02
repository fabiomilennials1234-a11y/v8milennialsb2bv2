/**
 * F0 funis-unificacao §4.3 — contrato de coluna do LeadDetailSheet.
 *
 * A query de etapas filtrava `.eq("pipe_type", …)` em `pipeline_stages`, mas a
 * coluna real chama-se `pipeline_type` (medido em prod 2026-09-01 via
 * information_schema). Coluna inexistente → PostgREST devolve erro, a query
 * morre e a barra de etapas nunca tem dados. Teste-contrato no fonte (mesmo
 * padrão de comando-escopo-permissoes-contract): impede a regressão sem exigir
 * render do sheet inteiro.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = resolve(
  __dirname,
  "../../src/modules/leads/components/lead-detail/LeadDetailSheet.tsx",
);

describe("LeadDetailSheet — filtro de pipeline_stages usa a coluna real", () => {
  const src = readFileSync(SOURCE, "utf8");

  it("filtra por pipeline_type", () => {
    expect(src).toMatch(/\.eq\("pipeline_type",\s*"whatsapp"\)/);
  });

  it("não volta a filtrar pela coluna inexistente pipe_type", () => {
    // `pipe_type` não existe em pipeline_stages (existe em outras tabelas,
    // ex. pipe_dispatch_rules — este arquivo não as consulta).
    expect(src).not.toMatch(/\.eq\("pipe_type"/);
  });
});
