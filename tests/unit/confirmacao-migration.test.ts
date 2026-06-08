import { describe, it, expect } from "vitest";
import { mapConfirmacaoStage, resolveDedup } from "@/modules/pipelines/lib/confirmacao-migration";

describe("mapConfirmacaoStage", () => {
  it("maps the 6 reminder stages to agendado, deriving confirmation from is_confirmed", () => {
    const reminders = [
      "reuniao_marcada",
      "confirmar_d5",
      "confirmar_d3",
      "confirmar_d2",
      "confirmar_d1",
      "confirmacao_no_dia",
    ];
    for (const stage of reminders) {
      expect(mapConfirmacaoStage(stage, false)).toEqual({
        stageKey: "agendado",
        confirmationStatus: "pendente",
        lost: false,
      });
      expect(mapConfirmacaoStage(stage, true)).toEqual({
        stageKey: "agendado",
        confirmationStatus: "confirmado",
        lost: false,
      });
    }
  });

  it("keeps remarcar and compareceu as-is", () => {
    expect(mapConfirmacaoStage("remarcar", false)).toEqual({
      stageKey: "remarcar",
      confirmationStatus: "pendente",
      lost: false,
    });
    expect(mapConfirmacaoStage("compareceu", true)).toEqual({
      stageKey: "compareceu",
      confirmationStatus: "confirmado",
      lost: false,
    });
  });

  it("maps perdido to a lost marker (org routes to its final_negative stage)", () => {
    expect(mapConfirmacaoStage("perdido", false)).toEqual({
      stageKey: null,
      confirmationStatus: "pendente",
      lost: true,
    });
  });
});

describe("resolveDedup", () => {
  const wpp = { id: "w1", stageKey: "agendado", metadata: { sdr_id: "s1", meeting_date: "old" } };
  const conf = { id: "c1", stageKey: "confirmar_d1", metadata: { meeting_date: "new", closer_id: "x1" } };

  it("when only the whatsapp entry exists, it survives unchanged", () => {
    expect(resolveDedup(wpp, null)).toEqual({ survivingId: "w1", dropId: null, metadata: wpp.metadata });
  });

  it("when only the confirmacao entry exists, it survives (to be repointed)", () => {
    expect(resolveDedup(null, conf)).toEqual({ survivingId: "c1", dropId: null, metadata: conf.metadata });
  });

  it("when both exist, the whatsapp row survives but confirmacao data wins; confirmacao row is dropped", () => {
    const r = resolveDedup(wpp, conf);
    expect(r.survivingId).toBe("w1");
    expect(r.dropId).toBe("c1");
    // confirmacao wins on overlapping keys (meeting_date), whatsapp fills the gaps (sdr_id)
    expect(r.metadata).toEqual({ sdr_id: "s1", meeting_date: "new", closer_id: "x1" });
  });

  it("throws when neither entry exists", () => {
    expect(() => resolveDedup(null, null)).toThrow();
  });
});
