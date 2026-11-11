import { describe, expect, it } from "vitest";
import { pickLeadForNumber } from "./leadByPhone";

describe("pickLeadForNumber — só negócio aberto (espelho do leitor de borda)", () => {
  const d = (lead_id: string, deal_id: string, created_at: string) => ({ lead_id, deal_id, created_at });

  it("sem negócio aberto e 2 candidatos: ninguém, em qualquer ordem", () => {
    expect(pickLeadForNumber(["a", "b"], { openDeals: [] })).toBeNull();
    expect(pickLeadForNumber(["b", "a"], { openDeals: [] })).toBeNull();
  });

  it("negócio mais recente vence; empate decide pelo id do negócio", () => {
    const deals = [d("a", "d1", "2026-05-01"), d("b", "d2", "2026-06-01")];
    expect(pickLeadForNumber(["a", "b"], { openDeals: deals })).toBe("b");
    expect(pickLeadForNumber(["b", "a"], { openDeals: [...deals].reverse() })).toBe("b");
    const tie = [d("a", "d1", "2026-05-01"), d("b", "d2", "2026-05-01")];
    expect(pickLeadForNumber(["a", "b"], { openDeals: tie })).toBe("b");
    expect(pickLeadForNumber(["b", "a"], { openDeals: [...tie].reverse() })).toBe("b");
  });

  it("um candidato resolve para ele", () => {
    expect(pickLeadForNumber(["a"], { openDeals: [] })).toBe("a");
  });
});

describe("pickLeadForNumber (escolha > negócio aberto > vínculo anterior)", () => {
  const d = (lead_id: string, deal_id: string, created_at: string) => ({ lead_id, deal_id, created_at });

  it("1 candidato: ele, ignorando todos os sinais", () => {
    expect(pickLeadForNumber(["a"], { chosenLeadId: "x", lastLinkedLeadId: "y" })).toBe("a");
  });

  it("2+ com escolha explícita de candidato: a escolha", () => {
    expect(pickLeadForNumber(["a", "b", "c"], { chosenLeadId: "c" })).toBe("c");
  });

  it("escolha de lead que não é mais candidato é ignorada", () => {
    expect(pickLeadForNumber(["a", "b"], { chosenLeadId: "x" })).toBeNull();
    expect(pickLeadForNumber(["a", "b"], { chosenLeadId: "x", lastLinkedLeadId: "a" })).toBe("a");
  });

  it("escolha vence negócio aberto", () => {
    expect(pickLeadForNumber(["a", "b"], { chosenLeadId: "a", openDeals: [d("b", "d1", "2026-05-01")] })).toBe("a");
  });

  it("negócio aberto vence vínculo anterior", () => {
    expect(pickLeadForNumber(["a", "b"], { openDeals: [d("b", "d1", "2026-05-01")], lastLinkedLeadId: "a" })).toBe("b");
  });

  it("sem escolha nem negócio: vínculo anterior, se candidato", () => {
    expect(pickLeadForNumber(["a", "b", "c"], { lastLinkedLeadId: "a" })).toBe("a");
    expect(pickLeadForNumber(["a", "b"], { lastLinkedLeadId: "z" })).toBeNull();
  });

  it("nada decide: null, em qualquer ordem", () => {
    expect(pickLeadForNumber(["a", "b"])).toBeNull();
    expect(pickLeadForNumber(["b", "a"], { openDeals: [d("z", "d1", "2026-05-01")] })).toBeNull();
    expect(pickLeadForNumber([])).toBeNull();
  });
});
