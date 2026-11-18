/**
 * Importação de planilha × card que o lead já tem no funil.
 *
 * Regressão do incidente Calçados SCORE (18/11): duplicados voltaram para a
 * primeira etapa e perderam o responsável. Planilha sem coluna Etapa não pode
 * mexer em card existente.
 */
import { describe, it, expect } from "vitest";
import { buildExistingEntryUpdates } from "../../supabase/functions/import-leads/existing-entry";

const base = {
  rowStage: "",
  resolvedStageKey: "novo_lead",
  currentStageKey: "proposta_enviada",
  assignedTo: null,
  notes: null,
  metadata: {},
};

describe("buildExistingEntryUpdates", () => {
  it("sem coluna Etapa: não move o card (caso Calçados SCORE)", () => {
    expect(buildExistingEntryUpdates(base)).toEqual({});
  });

  it("etapa só com espaços conta como vazia", () => {
    expect(buildExistingEntryUpdates({ ...base, rowStage: "   " })).toEqual({});
  });

  it("coluna Etapa explícita e diferente: move", () => {
    expect(
      buildExistingEntryUpdates({ ...base, rowStage: "Novo Lead" }),
    ).toEqual({ stageKey: "novo_lead" });
  });

  it("coluna Etapa explícita igual à atual: não reescreve", () => {
    expect(
      buildExistingEntryUpdates({
        ...base,
        rowStage: "Novo Lead",
        resolvedStageKey: "proposta_enviada",
      }),
    ).toEqual({});
  });

  it("responsável nulo nunca apaga o existente", () => {
    expect(buildExistingEntryUpdates({ ...base, assignedTo: null })).toEqual({});
    expect(buildExistingEntryUpdates({ ...base, assignedTo: undefined })).toEqual({});
  });

  it("responsável informado na linha é gravado", () => {
    expect(buildExistingEntryUpdates({ ...base, assignedTo: "u-1" })).toEqual({ assignedTo: "u-1" });
  });

  it("notas vazias/nulas nunca apagam as existentes", () => {
    expect(buildExistingEntryUpdates({ ...base, notes: null })).toEqual({});
    expect(buildExistingEntryUpdates({ ...base, notes: "  " })).toEqual({});
    expect(buildExistingEntryUpdates({ ...base, notes: "ligar amanhã" })).toEqual({ notes: "ligar amanhã" });
  });

  it("metadata: só chaves com valor entram", () => {
    expect(
      buildExistingEntryUpdates({
        ...base,
        metadata: { sdr_id: null, closer_id: undefined, calor: "quente", sale_value: 0 },
      }),
    ).toEqual({ metadata: { calor: "quente", sale_value: 0 } });
  });

  it("metadata só com nulos não gera update", () => {
    expect(buildExistingEntryUpdates({ ...base, metadata: { sdr_id: null } })).toEqual({});
  });
});

describe("fiação na edge import-leads", () => {
  it("consulta o card existente ANTES de qualquer upsert que sobrescreve", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/import-leads/index.ts", "utf8");
    const guard = src.indexOf("buildExistingEntryUpdates({");
    const upsert = src.indexOf("await upsertPipeEntryDetailed(supabase, {");
    expect(guard).toBeGreaterThan(-1);
    expect(upsert).toBeGreaterThan(guard);
    expect(src).toContain("getPipeEntry(supabase, leadId, organizationId, pipeline!.id)");
  });
});
