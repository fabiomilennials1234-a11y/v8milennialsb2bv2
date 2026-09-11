import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20271019000008_funil_projeta_valor_do_negocio.sql",
  ),
  "utf8",
);

describe("get_pipeline_page projeta o valor canônico do negócio", () => {
  it("sobrepõe metadata.sale_value com deals.value no payload do kanban", () => {
    expect(migration).toMatch(
      /jsonb_set\(COALESCE\(pe\.metadata, '\{\}'::jsonb\), '\{sale_value\}', to_jsonb\(d\.value\), true\)/,
    );
  });

  it("restringe o join do negócio à organização da entrada", () => {
    expect(migration).toContain(
      "LEFT JOIN public.deals d ON d.id = pe.deal_id AND d.organization_id = pe.organization_id AND d.deleted_at IS NULL",
    );
  });

  it("preserva o metadata original quando o negócio não tem valor", () => {
    expect(migration).toContain("WHEN d.value IS NULL THEN pe.metadata");
  });
});
