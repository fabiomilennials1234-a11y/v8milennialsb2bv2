import { describe, expect, it } from "vitest";
import { pickLeadByOpenDeal } from "./leadByPhone";

describe("pickLeadByOpenDeal (espelho do leitor de borda)", () => {
  const d = (lead_id: string, deal_id: string, created_at: string) => ({ lead_id, deal_id, created_at });

  it("sem negócio aberto e 2 candidatos: ninguém, em qualquer ordem", () => {
    expect(pickLeadByOpenDeal(["a", "b"], [])).toBeNull();
    expect(pickLeadByOpenDeal(["b", "a"], [])).toBeNull();
  });

  it("negócio mais recente vence; empate decide pelo id do negócio", () => {
    const deals = [d("a", "d1", "2026-05-01"), d("b", "d2", "2026-06-01")];
    expect(pickLeadByOpenDeal(["a", "b"], deals)).toBe("b");
    expect(pickLeadByOpenDeal(["b", "a"], [...deals].reverse())).toBe("b");
    const tie = [d("a", "d1", "2026-05-01"), d("b", "d2", "2026-05-01")];
    expect(pickLeadByOpenDeal(["a", "b"], tie)).toBe("b");
    expect(pickLeadByOpenDeal(["b", "a"], [...tie].reverse())).toBe("b");
  });

  it("um candidato resolve para ele", () => {
    expect(pickLeadByOpenDeal(["a"], [])).toBe("a");
  });
});
