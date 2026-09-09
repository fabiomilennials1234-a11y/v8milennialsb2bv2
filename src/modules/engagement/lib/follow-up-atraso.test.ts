import { describe, it, expect } from "vitest";

import { limitesDoDia } from "@/shared/time/dia-da-org";
import { estaAtrasado, situacaoDoFollowUp } from "./follow-up-atraso";

const BRT = "America/Sao_Paulo";

/** 02/09/2026 15:00 BRT = 18:00 UTC. */
const TARDE = new Date("2026-09-02T18:00:00.000Z");

describe("situacaoDoFollowUp", () => {
  it("follow-up que vence HOJE de manhã, visto à tarde, NÃO está atrasado", () => {
    // Este é o chamado. Vence 09:00 BRT, são 15:00 BRT: o KPI dizia "Atrasado"
    // (corte por instante) e a lista dizia "de hoje" (corte por dia). Mesma
    // linha, dois veredictos.
    expect(situacaoDoFollowUp("2026-09-02T12:00:00.000Z", BRT, TARDE)).toBe("hoje");
    expect(estaAtrasado("2026-09-02T12:00:00.000Z", BRT, TARDE)).toBe(false);
  });

  it("follow-up de ontem está atrasado", () => {
    expect(situacaoDoFollowUp("2026-09-01T12:00:00.000Z", BRT, TARDE)).toBe("atrasado");
  });

  it("follow-up de amanhã é futuro", () => {
    expect(situacaoDoFollowUp("2026-09-03T12:00:00.000Z", BRT, TARDE)).toBe("futuro");
  });

  it("as três situações são mutuamente exclusivas e cobrem tudo", () => {
    // A garantia que impede "Pendentes" de conter "Atrasados" de novo.
    const amostras = [
      "2026-08-30T10:00:00.000Z",
      "2026-09-02T02:59:00.000Z",
      "2026-09-02T23:00:00.000Z",
      "2026-09-10T10:00:00.000Z",
    ];
    const situacoes = amostras.map((d) => situacaoDoFollowUp(d, BRT, TARDE));
    expect(situacoes).toHaveLength(4);
    for (const s of situacoes) {
      expect(["atrasado", "hoje", "futuro"]).toContain(s);
    }
  });
});

describe("a fronteira do dia é a da ORG, não a do browser", () => {
  it("23:30 BRT ainda é hoje, mesmo já sendo o dia seguinte em UTC", () => {
    // 03/09 02:30 UTC = 02/09 23:30 BRT. Pelo corte UTC seria "de ontem";
    // pelo fuso da org é hoje. É a mesma fronteira que já mordeu o dashboard
    // (contagem UTC vs. lista BRT).
    const quaseMeiaNoite = new Date("2026-09-03T02:30:00.000Z");
    expect(
      situacaoDoFollowUp("2026-09-02T13:00:00.000Z", BRT, quaseMeiaNoite),
    ).toBe("hoje");
  });

  it("passada a meia-noite da ORG, o mesmo follow-up vira atrasado", () => {
    const depoisDaMeiaNoite = new Date("2026-09-03T03:30:00.000Z"); // 00:30 BRT
    expect(
      situacaoDoFollowUp("2026-09-02T13:00:00.000Z", BRT, depoisDaMeiaNoite),
    ).toBe("atrasado");
  });

  it("fuso ausente (primeiros renders) não quebra e erra para o lado seguro", () => {
    // Sem org resolvida, cai em UTC. No Brasil o corte UTC é mais CEDO, então
    // nunca acusa como atrasado um follow-up de hoje.
    expect(situacaoDoFollowUp("2026-09-02T12:00:00.000Z", null, TARDE)).toBe("hoje");
    expect(situacaoDoFollowUp("2026-09-02T12:00:00.000Z", undefined, TARDE)).toBe("hoje");
  });

  it("fuso IANA inválido degrada para UTC em vez de derrubar a tela", () => {
    // `organizations.timezone` aceita zonas que o Intl do browser pode recusar.
    // White-screen de UMA org é falha multi-tenant.
    expect(() => situacaoDoFollowUp("2026-09-02T12:00:00.000Z", "Marte/Olympus", TARDE))
      .not.toThrow();
  });
});

describe("limitesDoDia", () => {
  it("devolve um intervalo de 24h que contém o instante atual", () => {
    const { inicioDeHoje, inicioDeAmanha } = limitesDoDia(BRT, TARDE);
    expect(new Date(inicioDeHoje).getTime()).toBeLessThanOrEqual(TARDE.getTime());
    expect(new Date(inicioDeAmanha).getTime()).toBeGreaterThan(TARDE.getTime());
  });

  it("atravessa a virada do horário de verão sem produzir dia de 0h", () => {
    // O offset é amostrado no instante-alvo, então DST não colapsa o intervalo.
    const noDST = new Date("2026-10-18T12:00:00.000Z");
    const { inicioDeHoje, inicioDeAmanha } = limitesDoDia(BRT, noDST);
    const horas =
      (new Date(inicioDeAmanha).getTime() - new Date(inicioDeHoje).getTime()) /
      3_600_000;
    expect(horas).toBeGreaterThanOrEqual(23);
    expect(horas).toBeLessThanOrEqual(25);
  });
});
