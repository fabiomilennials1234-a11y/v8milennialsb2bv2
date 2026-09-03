import { describe, it, expect } from "vitest";
import { appendMeetingStages } from "@/contracts/pipe/merged-funnel";
import type { DefaultStage } from "@/contracts/pipe/pipe-defaults";

describe("appendMeetingStages", () => {
  it("appends the 4 meeting stages after a custom funnel, leaving custom stages untouched", () => {
    const custom: DefaultStage[] = [
      { id: "lead_novo", title: "Lead Novo", color: "#111111" },
      { id: "em_contato", title: "Em Contato", color: "#222222" },
      { id: "quente", title: "Quente", color: "#333333" },
    ];

    const result = appendMeetingStages(custom);

    // custom stages preserved, in the same order, byte-for-byte
    expect(result.slice(0, 3)).toEqual(custom);
    // meeting lifecycle appended at the end, in canonical order
    expect(result.map((s) => s.id)).toEqual([
      "lead_novo",
      "em_contato",
      "quente",
      "agendado",
      "remarcar",
      "compareceu",
      "nao_compareceu",
    ]);
  });

  it("normalizes an existing 'agendado' (no longer terminal/handoff) and appends only the missing 3", () => {
    const legacyWhatsapp: DefaultStage[] = [
      { id: "novo", title: "Novo", color: "#6366f1" },
      { id: "abordado", title: "Abordado", color: "#f59e0b" },
      { id: "respondeu", title: "Respondeu", color: "#3b82f6" },
      { id: "esfriou", title: "Esfriou", color: "#ef4444" },
      { id: "agendado", title: "Agendado ✓", color: "#22c55e", is_final_positive: true, target_pipe_type: "confirmacao", target_stage_key: "reuniao_marcada" },
    ];

    const result = appendMeetingStages(legacyWhatsapp);

    // no duplicate agendado
    expect(result.filter((s) => s.id === "agendado")).toHaveLength(1);
    expect(result.map((s) => s.id)).toEqual([
      "novo",
      "abordado",
      "respondeu",
      "esfriou",
      "agendado",
      "remarcar",
      "compareceu",
      "nao_compareceu",
    ]);

    // existing agendado is normalized: no longer a positive terminal, no handoff target
    const agendado = result.find((s) => s.id === "agendado")!;
    expect(agendado.is_final_positive).toBeFalsy();
    expect(agendado.target_pipe_type).toBeUndefined();
    expect(agendado.target_stage_key).toBeUndefined();
  });

  /**
   * `nao_compareceu` afirmava `is_final_negative === true` e essa asserção era
   * o defeito escrito em teste.
   *
   * A flag não era rótulo: `PipeWhatsapp` deriva o destino do "Marcar perdido"
   * pegando a PRIMEIRA etapa `is_final_negative` da lista ordenada por
   * posição, e a etapa de falta vem antes da etapa de perda. Em produção isso
   * fazia o botão "Perdido" mover o card para a etapa onde ele já estava —
   * gravava o motivo e não saía do lugar. Só faltar não encerra negócio
   * nenhum: o lead segue vivo e precisa de nova data.
   */
  it("compareceu é o terminal positivo; nenhuma etapa de reunião é terminal negativo", () => {
    const result = appendMeetingStages([]);
    const byId = Object.fromEntries(result.map((s) => [s.id, s]));

    expect(byId.compareceu.is_final_positive).toBe(true);
    expect(byId.nao_compareceu.is_final_negative).toBeFalsy();
    // agendado/remarcar são meio de funil — nenhum dos dois é terminal
    expect(byId.agendado.is_final_positive).toBeFalsy();
    expect(byId.agendado.is_final_negative).toBeFalsy();
    expect(byId.remarcar.is_final_positive).toBeFalsy();
    expect(byId.remarcar.is_final_negative).toBeFalsy();
  });

  it("nenhuma etapa anexada carrega is_final_negative", () => {
    // Guarda de conjunto: pega a flag voltando em QUALQUER das quatro, não só
    // na que já causou o defeito.
    for (const stage of appendMeetingStages([])) {
      expect(stage.is_final_negative ?? false).toBe(false);
    }
  });

  it("is idempotent — applying twice yields the same funnel (no duplicates)", () => {
    const legacy: DefaultStage[] = [
      { id: "novo", title: "Novo", color: "#6366f1" },
      { id: "agendado", title: "Agendado ✓", color: "#22c55e", is_final_positive: true, target_pipe_type: "confirmacao", target_stage_key: "reuniao_marcada" },
    ];

    const once = appendMeetingStages(legacy);
    const twice = appendMeetingStages(once);

    expect(twice).toEqual(once);
  });
});
