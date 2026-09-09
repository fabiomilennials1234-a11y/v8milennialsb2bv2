// @vitest-environment node
/**
 * Stage Role Classifier — deterministic core (#991, ADR-0017 §1).
 *
 * Cobre o canônico Deno (`_shared/metrics/stage-role-classifier.ts`):
 * sinônimos pt-BR (incl. os casos de aceite da issue: Fechado→won,
 * Ganhou→won, Perdido→lost, Recomprou→won), negação de no-show, precedência
 * nome > flag, exclusão de chaves de sistema e — invariante de dinheiro —
 * won/lost NUNCA em auto_apply (sempre queue_review).
 */

import { describe, it, expect } from "vitest";

const {
  classifyStageNameDeterministic,
  classifyStageRole,
  decideStageRoleAction,
  normalizeStageName,
  isSystemStageKey,
  planStageRoleSuggestions,
} = await import(
  "../../supabase/functions/_shared/metrics/stage-role-classifier.ts"
);

describe("normalizeStageName", () => {
  it("lowercases, strips accents/emoji/punctuation and collapses spaces", () => {
    expect(normalizeStageName("Reunião Marcada ✓")).toBe("reuniao marcada");
    expect(normalizeStageName("  NÃO   Compareceu!! ")).toBe("nao compareceu");
    expect(normalizeStageName("Vendido 🏆")).toBe("vendido");
  });
});

describe("classifyStageNameDeterministic — casos de aceite da issue #991", () => {
  it("Fechado → won", () => {
    expect(classifyStageNameDeterministic("Fechado")).toBe("won");
  });
  it("Ganhou → won", () => {
    expect(classifyStageNameDeterministic("Ganhou")).toBe("won");
  });
  it("Perdido → lost", () => {
    expect(classifyStageNameDeterministic("Perdido")).toBe("lost");
  });
  it("Recomprou → won", () => {
    expect(classifyStageNameDeterministic("Recomprou")).toBe("won");
  });
});

describe("classifyStageNameDeterministic — sinônimos pt-BR", () => {
  it.each([
    ["Vendido ✓", "won"],
    ["Venda Fechada", "won"],
    ["Venda realizada", "won"], // won vence meeting_held ("realizada")
    ["Comprou", "won"],
    ["Contrato Assinado", "won"],
    ["Perdeu", "lost"],
    ["Desistiu", "lost"],
    ["Sem Interesse", "lost"],
    ["Desqualificado", "lost"],
    ["Reunião Marcada", "meeting_booked"],
    ["Reunião Agendada", "meeting_booked"],
    ["Agendado", "meeting_booked"],
    ["AGENDAMENTO", "meeting_booked"],
    ["Call marcada", "meeting_booked"],
    ["Compareceu", "meeting_held"],
    ["Reunião Realizada", "meeting_held"],
    ["Realizada", "meeting_held"],
  ] as const)("%s → %s", (name, expected) => {
    expect(classifyStageNameDeterministic(name)).toBe(expected);
  });

  /**
   * Este teste AFIRMAVA `lost` para os quatro nomes, e era a versão em teste do
   * próprio defeito: em prod, 140 leads da Milennials contavam como perdidos
   * por terem faltado a uma reunião. O teste passava porque descrevia o que o
   * código fazia, não o que ele devia fazer.
   *
   * O contrato certo: falta não sugere NADA. `SuggestableStageRole` exclui
   * `open` por tipo, então "sem sugestão" é `null` — e a etapa fica com o
   * `open` que já é o padrão. O que se preserva da intenção original é a
   * PRECEDÊNCIA: "não compareceu" contém "compareceu" e não pode cair na regra
   * de `meeting_held`.
   */
  it("falta não sugere papel nenhum — e não vira meeting_held", () => {
    expect(classifyStageNameDeterministic("Não Compareceu")).toBeNull();
    expect(classifyStageNameDeterministic("Sem comparecimento")).toBeNull();
    expect(classifyStageNameDeterministic("No-show")).toBeNull();
    expect(classifyStageNameDeterministic("No Show")).toBeNull();
  });

  it("'Compareceu' sozinho continua meeting_held — o veto não pode comer o positivo", () => {
    expect(classifyStageNameDeterministic("Compareceu")).toBe("meeting_held");
    expect(classifyStageNameDeterministic("Comparecimento")).toBe("meeting_held");
  });

  /**
   * O caso que produziu as duas linhas erradas em PROD: as etapas de falta
   * tinham `is_final_negative = true` junto com o nome. Vetar só o nome
   * deixaria o fallback de flag reconduzir ao mesmo `lost`.
   */
  it("falta com is_final_negative não vira lost pela flag", () => {
    expect(
      classifyStageRole({ name: "Não Compareceu", isFinalNegative: true }),
    ).toBeNull();
    expect(
      classifyStageRole({ name: "No-show", isFinalNegative: true }),
    ).toBeNull();
  });

  it("perda de verdade com a flag continua lost", () => {
    expect(classifyStageRole({ name: "Arquivado", isFinalNegative: true })).toEqual({
      role: "lost",
      source: "flag",
    });
  });

  it("nomes não-óbvios não classificam (resíduo pra IA)", () => {
    expect(classifyStageNameDeterministic("Negociando")).toBeNull();
    expect(classifyStageNameDeterministic("Proposta Gerada")).toBeNull();
    expect(classifyStageNameDeterministic("Follow-up")).toBeNull();
    expect(classifyStageNameDeterministic("")).toBeNull();
  });
});

describe("classifyStageRole — flags como sinal fraco", () => {
  it("flag positivo sem nome óbvio → sugestão won com source=flag", () => {
    expect(classifyStageRole({ name: "Etapa Final", isFinalPositive: true }))
      .toEqual({ role: "won", source: "flag" });
  });
  it("flag negativo sem nome óbvio → sugestão lost com source=flag", () => {
    expect(classifyStageRole({ name: "Fim de linha", isFinalNegative: true }))
      .toEqual({ role: "lost", source: "flag" });
  });
  it("nome sempre vence a flag", () => {
    expect(classifyStageRole({ name: "Reunião Marcada", isFinalPositive: true }))
      .toEqual({ role: "meeting_booked", source: "deterministic" });
  });
  it("sem nome óbvio e sem flag → null", () => {
    expect(classifyStageRole({ name: "Negociando" })).toBeNull();
  });
});

describe("decideStageRoleAction — won/lost = dinheiro = revisão humana, SEMPRE", () => {
  it("won e lost vão pra fila de revisão", () => {
    expect(decideStageRoleAction("won")).toBe("queue_review");
    expect(decideStageRoleAction("lost")).toBe("queue_review");
  });
  it("meeting_booked e meeting_held auto-aplicam", () => {
    expect(decideStageRoleAction("meeting_booked")).toBe("auto_apply");
    expect(decideStageRoleAction("meeting_held")).toBe("auto_apply");
  });
});

describe("isSystemStageKey — mapa do #990 (classifier nunca toca sistema)", () => {
  it("chaves de sistema são reconhecidas", () => {
    expect(isSystemStageKey("propostas", "vendido")).toBe(true);
    expect(isSystemStageKey("propostas", "perdido")).toBe(true);
    expect(isSystemStageKey("whatsapp", "nao_compareceu")).toBe(true);
    expect(isSystemStageKey("confirmacao", "confirmar_d3")).toBe(true);
    expect(isSystemStageKey("upsell_gestao", "campeoes")).toBe(true);
  });
  it("chaves custom não são", () => {
    expect(isSystemStageKey("propostas", "fechado_cliente")).toBe(false);
    expect(isSystemStageKey("whatsapp", "vendido")).toBe(false); // chave de outro pipe
    expect(isSystemStageKey("pipe_custom", "vendido")).toBe(false);
  });
});

describe("planStageRoleSuggestions — plano puro consumido pela edge function", () => {
  const stage = (over: Partial<Parameters<typeof planStageRoleSuggestions>[0][number]>) => ({
    id: "s1",
    pipelineType: "propostas",
    stageKey: "etapa_custom",
    name: "Etapa",
    ...over,
  });

  it("etapa de sistema nunca entra no plano", () => {
    const plan = planStageRoleSuggestions([
      stage({ id: "sys", stageKey: "vendido", name: "Vendido ✓" }),
    ]);
    expect(plan.items).toHaveLength(0);
    expect(plan.skippedSystem).toBe(1);
  });

  it("custom won/lost SEMPRE saem como queue_review — nunca auto_apply", () => {
    const plan = planStageRoleSuggestions([
      stage({ id: "a", stageKey: "fechou", name: "Fechado" }),
      stage({ id: "b", stageKey: "perdeu", name: "Perdido" }),
      stage({ id: "c", stageKey: "flagged", name: "Fim", isFinalPositive: true }),
    ]);
    expect(plan.items).toHaveLength(3);
    for (const item of plan.items) {
      expect(item.action).toBe("queue_review");
      expect(["won", "lost"]).toContain(item.role);
    }
  });

  it("meeting roles auto-aplicam", () => {
    const plan = planStageRoleSuggestions([
      stage({ id: "a", stageKey: "reuniao", name: "Reunião Marcada" }),
      stage({ id: "b", stageKey: "compareceu_x", name: "Compareceu na call" }),
    ]);
    expect(plan.items.map((i) => [i.role, i.action])).toEqual([
      ["meeting_booked", "auto_apply"],
      ["meeting_held", "auto_apply"],
    ]);
  });

  it("resíduo não resolvido vai pra unresolved; IA resolve na 2ª passada com source=ai", () => {
    const stages = [stage({ id: "x", stageKey: "negociando", name: "Negociando" })];
    const pass1 = planStageRoleSuggestions(stages);
    expect(pass1.items).toHaveLength(0);
    expect(pass1.unresolved.map((u) => u.id)).toEqual(["x"]);

    const pass2 = planStageRoleSuggestions(stages, { x: "lost" });
    expect(pass2.items).toEqual([
      { id: "x", role: "lost", action: "queue_review", source: "ai" },
    ]);
  });

  it("IA sugerindo won/lost também vai pra revisão — nunca auto_apply", () => {
    const stages = [stage({ id: "x", stageKey: "misterio", name: "Cliente ativo" })];
    const plan = planStageRoleSuggestions(stages, { x: "won" });
    expect(plan.items[0].action).toBe("queue_review");
  });

  it("determinístico vence a IA quando ambos existem", () => {
    const stages = [stage({ id: "x", stageKey: "fechou", name: "Fechado" })];
    const plan = planStageRoleSuggestions(stages, { x: "meeting_booked" });
    expect(plan.items[0]).toMatchObject({ role: "won", source: "deterministic" });
  });
});
