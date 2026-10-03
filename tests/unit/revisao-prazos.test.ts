import { describe, expect, it } from "vitest";

import { cortesDosPrazos, prazoDe } from "@/modules/engagement/lib/prazo-da-revisao";
import { estaAtrasado } from "@/modules/engagement/lib/follow-up-atraso";

const TZ = "America/Sao_Paulo";

describe("prazo da Revisão", () => {
  // Quarta, 30/09/2026, 15:00 em São Paulo (18:00 UTC).
  const agora = new Date("2026-09-30T18:00:00Z");
  const cortes = cortesDosPrazos(TZ, agora);
  const em = (iso: string) => prazoDe(new Date(iso), cortes);

  it("corta por dia no fuso da organização", () => {
    expect(em("2026-09-30T02:59:00Z")).toBe("atrasadas"); // 29/09 23:59 em SP
    expect(em("2026-09-30T03:00:00Z")).toBe("hoje"); // 30/09 00:00 em SP
    expect(em("2026-09-30T12:00:00Z")).toBe("hoje"); // hoje cedo NÃO é atrasado
    expect(em("2026-10-01T12:00:00Z")).toBe("amanha");
    expect(em("2026-10-02T12:00:00Z")).toBe("semana");
    expect(em("2026-10-04T23:00:00Z")).toBe("semana"); // domingo 20:00
    expect(em("2026-10-05T03:00:00Z")).toBe("depois"); // segunda 00:00
  });

  it("concorda com o selo de atrasado da lista", () => {
    for (const iso of ["2026-09-29T20:00:00Z", "2026-09-30T03:00:00Z", "2026-09-30T17:00:00Z"]) {
      expect(em(iso) === "atrasadas").toBe(estaAtrasado(iso, TZ, agora));
    }
  });

  it("no sábado, 'esta semana' não tem dia sobrando", () => {
    const sabado = cortesDosPrazos(TZ, new Date("2026-10-03T15:00:00Z"));
    expect(sabado.proximaSegunda.getTime()).toBe(sabado.depoisDeAmanha.getTime());
  });

  it("atravessa a virada do mês", () => {
    const c = cortesDosPrazos(TZ, new Date("2026-10-31T15:00:00Z"));
    expect(c.amanha.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
});
