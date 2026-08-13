import { describe, it, expect } from "vitest";

import {
  matchesCustomPipeResponsible,
  resolveCustomPipeResponsibleId,
} from "@/modules/pipelines/lib/kanbanFilterParams";

// ─────────────────────────────────────────────────────────────────────────────
// Filtro "Responsável" dos funis personalizados (client-side).
//
// A regra que este teste protege: a resolução do responsável precisa ser a
// MESMA de `CustomPipelineKanban.transformToCard` — responsible → closer → sdr
// → assigned_to. Se as duas divergirem, o operador filtra por um nome e some um
// card que está escrito com esse nome (ou sobra um escrito com outro).
//
// Caso real que motivou o filtro (HGE Iluminação, funil "Prospecção", 673
// entries em prod): 641 entries têm `assigned_to`; 673 leads têm
// `responsible_id`; onde os dois existem eles BATEM. As 32 sem `assigned_to`
// só têm o vínculo pelo lead — por isso o fallback não pode ser o único campo.
// ─────────────────────────────────────────────────────────────────────────────

const ELENA = "7d79d49d-e2e6-4ede-bb43-a62323ce959b";
const JOSE = "d6157296-23b8-4b46-8c60-7fd54d813432";

describe("resolveCustomPipeResponsibleId — mesma ordem do card do kanban", () => {
  it("responsible do lead ganha de todo o resto", () => {
    expect(
      resolveCustomPipeResponsibleId({
        assigned_to: JOSE,
        lead: {
          responsible: { id: ELENA },
          closer: { id: JOSE },
          sdr: { id: JOSE },
        },
      }),
    ).toBe(ELENA);
  });

  it("sem responsible, cai pro closer; sem closer, pro sdr", () => {
    expect(
      resolveCustomPipeResponsibleId({ lead: { closer: { id: ELENA }, sdr: { id: JOSE } } }),
    ).toBe(ELENA);
    expect(resolveCustomPipeResponsibleId({ lead: { sdr: { id: JOSE } } })).toBe(JOSE);
  });

  it("sem nenhum vínculo no lead, cai pro assigned_to da entry", () => {
    expect(resolveCustomPipeResponsibleId({ assigned_to: JOSE, lead: {} })).toBe(JOSE);
    // …inclusive quando o lead nem veio (RLS de `leads` é mais estreita que a
    // de `custom_pipe_entries`: o card renderiza como "Sem nome").
    expect(resolveCustomPipeResponsibleId({ assigned_to: JOSE, lead: null })).toBe(JOSE);
  });

  it("entry sem responsável nenhum devolve null", () => {
    expect(resolveCustomPipeResponsibleId({ assigned_to: null, lead: {} })).toBeNull();
    expect(resolveCustomPipeResponsibleId(null)).toBeNull();
    expect(resolveCustomPipeResponsibleId(undefined)).toBeNull();
  });
});

describe("matchesCustomPipeResponsible — 'all' colapsa o filtro", () => {
  const entry = { assigned_to: JOSE, lead: { responsible: { id: ELENA } } };

  it("'all' / vazio / null = sem filtro (espelha o SelectItem value='all')", () => {
    expect(matchesCustomPipeResponsible(entry, "all")).toBe(true);
    expect(matchesCustomPipeResponsible(entry, "")).toBe(true);
    expect(matchesCustomPipeResponsible(entry, null)).toBe(true);
    expect(matchesCustomPipeResponsible(entry, undefined)).toBe(true);
    // Entry sem responsável também passa quando não há filtro ativo.
    expect(matchesCustomPipeResponsible({ assigned_to: null, lead: {} }, "all")).toBe(true);
  });

  it("casa pelo responsável EFETIVO, não por 'qualquer campo que bata'", () => {
    // O card mostra Elena (responsible vence). Filtrar por Elena mantém…
    expect(matchesCustomPipeResponsible(entry, ELENA)).toBe(true);
    // …e filtrar por José remove, mesmo com assigned_to = José. Senão o card
    // apareceria escrito "Elena" dentro do filtro "José".
    expect(matchesCustomPipeResponsible(entry, JOSE)).toBe(false);
  });

  it("entry só com assigned_to casa por ele (as 32 da HGE)", () => {
    expect(matchesCustomPipeResponsible({ assigned_to: JOSE, lead: {} }, JOSE)).toBe(true);
    expect(matchesCustomPipeResponsible({ assigned_to: JOSE, lead: {} }, ELENA)).toBe(false);
  });

  it("entry sem responsável nunca casa com uma seleção ativa (regra do NULL)", () => {
    expect(matchesCustomPipeResponsible({ assigned_to: null, lead: {} }, ELENA)).toBe(false);
    expect(matchesCustomPipeResponsible(null, ELENA)).toBe(false);
  });
});
