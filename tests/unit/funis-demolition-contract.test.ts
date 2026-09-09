import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20271015000000_demolicao_dos_espelhos.sql",
  ),
  "utf8",
);
const rollback = readFileSync(
  resolve(
    root,
    "supabase/migrations/rollback/20271015000000_demolicao_dos_espelhos.sql",
  ),
  "utf8",
);

const legacyViews = [
  "pipe_whatsapp",
  "pipe_confirmacao",
  "pipe_propostas",
  "custom_pipe_entries",
  "custom_pipelines",
  "custom_pipeline_stages",
] as const;

describe("SCRUM-639 demolition contract", () => {
  it("keeps apply and rollback atomic", () => {
    for (const sql of [migration, rollback]) {
      expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
      expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
      expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
      expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
      expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
    }
  });

  it("drops every compatibility view with RESTRICT and no temporal counter gate", () => {
    for (const view of legacyViews) {
      expect(migration).toContain(
        `DROP VIEW IF EXISTS public.${view} RESTRICT;`,
      );
    }

    expect(migration).not.toMatch(/DROP VIEW[^;]+CASCADE/i);
    expect(migration).not.toContain("_espelho_baseline");
    expect(migration).not.toMatch(/\bFROM\s+pg_stat_statements/i);
    expect(migration).toContain("DO $g0$");
    expect(migration).toContain("DO $g1$");
    expect(migration).toContain("DO $g2$");
  });

  it("restores adapters from the live post-reader migration", () => {
    expect(rollback).toContain(
      "NEW.id := public.fn_etapa_custom_criar(to_jsonb(NEW));",
    );
    expect(rollback).toContain(
      "NEW.id := public.fn_funil_custom_criar(to_jsonb(NEW));",
    );
    expect(rollback).not.toContain(
      "INSERT INTO public.pipeline_stages (",
    );
    expect(rollback).not.toContain("INSERT INTO public.pipelines (");
  });
});
