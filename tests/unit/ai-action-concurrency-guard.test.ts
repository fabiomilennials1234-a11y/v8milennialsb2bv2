/**
 * Guarda de concorrência por lead — quem passa e quem é isento.
 *
 * Regressão de 2026-09-03 (Forever Bella): `send_document` estava sujeito ao
 * guarda, e como `claim_pending_ai_actions` marca o lote inteiro como
 * `processing` antes do laço, cada mídia via a irmã do próprio lote e voltava
 * para `pending` com +30s. Saía uma mídia por lead por ciclo de cron — a foto
 * anunciada chegava de 2 a 8 minutos depois do texto, com `retry_count = 0` e
 * `status = completed` escondendo o atraso.
 *
 * Importa o módulo de produção de propósito: um teste que reimplementa a regra
 * não cai quando alguém reverte a regra.
 */

import { describe, it, expect } from "vitest";
import {
  CONCURRENCY_GUARD_EXEMPT_ACTIONS,
  needsConcurrencyGuard,
} from "../../supabase/functions/_shared/copilot/concurrency-guard.ts";

describe("needsConcurrencyGuard", () => {
  it("isenta send_document — duas fotos do mesmo turno não são uma corrida", () => {
    expect(needsConcurrencyGuard("send_document")).toBe(false);
  });

  it.each([
    "update_pipeline_stage",
    "update_lead",
    "transfer_to_human",
    "schedule_followup",
  ])("mantém o guarda para %s — essas disputam escrita no mesmo lead", (actionType) => {
    expect(needsConcurrencyGuard(actionType)).toBe(true);
  });

  it("trata tipo desconhecido como protegido (fail-safe)", () => {
    expect(needsConcurrencyGuard("acao_que_ainda_nao_existe")).toBe(true);
  });

  it("isenta APENAS o envio de documento", () => {
    expect([...CONCURRENCY_GUARD_EXEMPT_ACTIONS]).toEqual(["send_document"]);
  });
});
