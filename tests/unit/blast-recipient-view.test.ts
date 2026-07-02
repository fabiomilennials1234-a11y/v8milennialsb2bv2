import { describe, it, expect } from "vitest";
import {
  awaitingLotLabel,
  deriveAwaitingLot,
  failureReasonLabel,
  recipientMatchesQuery,
  skipReasonLabel,
} from "@/modules/campaigns/lib/blast-recipient-view";

/**
 * Derivação pura do drill-down de Disparos (#944 / PRD #941).
 *
 * Semântica (blast-plan releaser, _shared/quick-blast/blast-plan.ts):
 *  - `lot_index` é 0-based; o releaser libera o lote `lots_released` na data
 *    `next_release_date` e avança 1 lote/dia.
 *  - Logo, um recipient `pending` do lote L tem data prevista
 *    `next_release_date + (L - lots_released)` dias.
 *  - Rótulo "previsto": deferral por pressão de budget pode empurrar (PRD).
 */
describe("blast-recipient-view", () => {
  describe("deriveAwaitingLot", () => {
    it("lote corrente (lot_index === lots_released) → previsto na próxima release", () => {
      const r = deriveAwaitingLot({
        lotIndex: 2,
        lotsReleased: 2,
        nextReleaseDate: "2026-07-03",
      });
      expect(r.lotNumber).toBe(3); // humano 1-based
      expect(r.expectedDate).toBe("2026-07-03");
    });

    it("lote futuro → offset em dias sobre a próxima release", () => {
      const r = deriveAwaitingLot({
        lotIndex: 4,
        lotsReleased: 2,
        nextReleaseDate: "2026-07-03",
      });
      expect(r.lotNumber).toBe(5);
      expect(r.expectedDate).toBe("2026-07-05");
    });

    it("offset cruza virada de mês sem quebrar", () => {
      const r = deriveAwaitingLot({
        lotIndex: 3,
        lotsReleased: 1,
        nextReleaseDate: "2026-07-30",
      });
      expect(r.expectedDate).toBe("2026-08-01");
    });

    it("pending residual em lote já liberado → clampa no próximo release (offset nunca negativo)", () => {
      const r = deriveAwaitingLot({
        lotIndex: 0,
        lotsReleased: 2,
        nextReleaseDate: "2026-07-03",
      });
      expect(r.lotNumber).toBe(1);
      expect(r.expectedDate).toBe("2026-07-03");
    });

    it("plano sem next_release_date (pausado drenado / terminal) → sem data", () => {
      const r = deriveAwaitingLot({
        lotIndex: 1,
        lotsReleased: 1,
        nextReleaseDate: null,
      });
      expect(r.lotNumber).toBe(2);
      expect(r.expectedDate).toBeNull();
    });

    it("next_release_date malformada → sem data (nunca lança)", () => {
      const r = deriveAwaitingLot({
        lotIndex: 1,
        lotsReleased: 0,
        nextReleaseDate: "not-a-date",
      });
      expect(r.expectedDate).toBeNull();
    });
  });

  describe("awaitingLotLabel", () => {
    it('com data → "Lote N · previsto DD/MM"', () => {
      expect(
        awaitingLotLabel({ lotIndex: 2, lotsReleased: 2, nextReleaseDate: "2026-07-03" }),
      ).toBe("Lote 3 · previsto 03/07");
    });

    it("sem data → só o lote", () => {
      expect(
        awaitingLotLabel({ lotIndex: 1, lotsReleased: 1, nextReleaseDate: null }),
      ).toBe("Lote 2");
    });
  });

  // Reasons granulares (`replied`/`recency`) chegam na slice do releaser (PRD
  // #941); a UI já mapeia. Legado `refined` e null caem no motivo genérico.
  describe("skipReasonLabel", () => {
    it('replied → "Respondeu"', () => {
      expect(skipReasonLabel("replied")).toBe("Respondeu");
    });

    it('recency → "Contato recente"', () => {
      expect(skipReasonLabel("recency")).toBe("Contato recente");
    });

    it("legado refined → motivo genérico", () => {
      expect(skipReasonLabel("refined")).toBe("Cortado pelas regras do disparo");
    });

    it("null → motivo genérico", () => {
      expect(skipReasonLabel(null)).toBe("Cortado pelas regras do disparo");
    });

    it("reason desconhecida → motivo genérico (nunca vaza código cru pra UI)", () => {
      expect(skipReasonLabel("whatever_new_code")).toBe("Cortado pelas regras do disparo");
    });
  });

  // Reasons canônicos do failure-sync (ADR-0016, #948): o poll grava
  // invalid_number | instance_disconnected | provider_rejected | provider_error
  // em blast_plan_recipients.reason ao reclassificar sent → failed.
  describe("failureReasonLabel", () => {
    it('invalid_number → "Número inválido"', () => {
      expect(failureReasonLabel("invalid_number")).toBe("Número inválido");
    });

    it('instance_disconnected → "Número desconectado"', () => {
      expect(failureReasonLabel("instance_disconnected")).toBe("Número desconectado");
    });

    it('provider_rejected → "Rejeitado pelo WhatsApp"', () => {
      expect(failureReasonLabel("provider_rejected")).toBe("Rejeitado pelo WhatsApp");
    });

    it('provider_error → "Erro no envio"', () => {
      expect(failureReasonLabel("provider_error")).toBe("Erro no envio");
    });

    it("null → genérico (nunca vaza código cru pra UI)", () => {
      expect(failureReasonLabel(null)).toBe("Erro no envio");
    });

    it("reason desconhecida → genérico", () => {
      expect(failureReasonLabel("whatever_new_code")).toBe("Erro no envio");
    });
  });

  describe("recipientMatchesQuery (busca client-side nome/telefone)", () => {
    const r = { name: "João da Silva", phone: "+55 (11) 98888-7777" };

    it("query vazia / whitespace → tudo passa", () => {
      expect(recipientMatchesQuery(r, "")).toBe(true);
      expect(recipientMatchesQuery(r, "   ")).toBe(true);
    });

    it("nome case-insensitive, substring", () => {
      expect(recipientMatchesQuery(r, "joão")).toBe(true);
      expect(recipientMatchesQuery(r, "SILVA")).toBe(true);
      expect(recipientMatchesQuery(r, "maria")).toBe(false);
    });

    it("telefone casa por dígitos, ignorando máscara nos dois lados", () => {
      expect(recipientMatchesQuery(r, "11988887777")).toBe(true);
      expect(recipientMatchesQuery(r, "(11) 98888")).toBe(true);
      expect(recipientMatchesQuery(r, "9999")).toBe(false);
    });

    it("lead excluído (name null) ainda casa por telefone", () => {
      expect(recipientMatchesQuery({ name: null, phone: "5511988887777" }, "8888")).toBe(true);
      expect(recipientMatchesQuery({ name: null, phone: "5511988887777" }, "joão")).toBe(false);
    });

    it("phone null não quebra", () => {
      expect(recipientMatchesQuery({ name: "Ana", phone: null }, "ana")).toBe(true);
      expect(recipientMatchesQuery({ name: "Ana", phone: null }, "1198")).toBe(false);
    });
  });
});
