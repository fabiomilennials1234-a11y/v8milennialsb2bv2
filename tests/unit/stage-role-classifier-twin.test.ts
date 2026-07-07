// @vitest-environment node
/**
 * stage-role-classifier twin parity (#991).
 *
 * Pina o twin frontend (`src/modules/pipelines/lib/stage-role-classifier.ts`)
 * ao core canônico Deno — head-to-head sobre um corpus amplo, para as duas
 * implementações jamais divergirem silenciosamente (mesmo precedente do
 * blast-planning-twin, #904).
 */

import { describe, it, expect } from "vitest";
import {
  classifyStageNameDeterministic as twinClassifyName,
  classifyStageRole as twinClassifyRole,
  decideStageRoleAction as twinDecide,
  normalizeStageName as twinNormalize,
} from "@/modules/pipelines/lib/stage-role-classifier";

const canonical = await import(
  "../../supabase/functions/_shared/metrics/stage-role-classifier.ts"
);

const NAME_CORPUS = [
  // aceite da issue
  "Fechado", "Ganhou", "Perdido", "Recomprou",
  // won
  "Vendido ✓", "Venda Fechada", "Venda realizada", "Comprou", "Recompra",
  "Contrato Assinado", "Fechada", "Ganho", "GANHAMOS",
  // lost
  "Perdeu", "Perdemos", "Perda", "Desistiu", "Desistência", "Sem Interesse",
  "Não tem interesse", "Recusou", "Declinou", "Churn", "Desqualificado",
  // no-show / negações
  "Não Compareceu", "Nao compareceu", "Sem comparecimento", "No-show", "No Show",
  // meetings
  "Reunião Marcada", "Reunião Agendada", "Agendado", "Agendada", "Agendamento",
  "Call marcada", "Visita agendada", "Demo confirmada", "Marcou reunião",
  "Compareceu", "Comparecimento", "Reunião Realizada", "Reunião feita",
  "Call concluída", "Realizada", "Realizado",
  // não-óbvios (null nos dois lados)
  "Negociando", "Proposta Gerada", "Proposta Enviada", "Novo Lead", "Abordado",
  "Esfriou", "Futuro", "Follow-up", "Em análise", "Onboarding", "Pós-venda", "",
  // ruído de formatação
  "  FECHADO!!  ", "reunião marcada 📅", "pèrdído",
];

describe("twin parity — classifyStageNameDeterministic", () => {
  it.each(NAME_CORPUS.map((n) => [n]))("%j", (name) => {
    expect(twinClassifyName(name)).toBe(
      canonical.classifyStageNameDeterministic(name),
    );
  });
});

describe("twin parity — normalizeStageName", () => {
  it("produces identical normalization across the corpus", () => {
    for (const name of NAME_CORPUS) {
      expect(twinNormalize(name)).toBe(canonical.normalizeStageName(name));
    }
  });
});

describe("twin parity — classifyStageRole (flags como sinal)", () => {
  const flagCombos = [
    { isFinalPositive: false, isFinalNegative: false },
    { isFinalPositive: true, isFinalNegative: false },
    { isFinalPositive: false, isFinalNegative: true },
  ];
  it("matches for every name × flag combination", () => {
    for (const name of NAME_CORPUS) {
      for (const flags of flagCombos) {
        expect(twinClassifyRole({ name, ...flags })).toEqual(
          canonical.classifyStageRole({ name, ...flags }),
        );
      }
    }
  });
});

describe("twin parity — decideStageRoleAction", () => {
  it("matches for all suggestable roles", () => {
    for (const role of ["won", "lost", "meeting_booked", "meeting_held"] as const) {
      expect(twinDecide(role)).toBe(canonical.decideStageRoleAction(role));
    }
  });
});
