/**
 * Unit tests for `computeChatDeepLinkPlan` — traduz os query params de entrada
 * do chat (`?phone=`, `?instance=`, `?box=`, `?lead=`) no que a tela precisa
 * fazer antes de abrir uma conversa.
 *
 * Motivação: três call sites da carteira navegam para `/chat?lead=<uuid>`
 * (`CarteiraClientPreview.tsx:267`, `ClienteDetailPage.tsx:263`,
 * `Upsell.tsx:260`) e o `ChatShellWithContext` lia apenas `phone`, `instance` e
 * `box`. O parâmetro era descartado em silêncio e a tela abria vazia — e o
 * botão só aparece quando `lead_id` existe (`client?.lead_id &&`), então o
 * fallback `wa.me` do próprio call site nunca disparava. O caminho feliz da
 * carteira estava quebrado por inteiro.
 */

import { describe, it, expect } from "vitest";
import { computeChatDeepLinkPlan } from "@/modules/communication/lib/computeChatDeepLinkPlan";

const LEAD_ID = "9f8c1e4a-0b2d-4c6e-8a1f-3d5b7c9e1a2b";

describe("computeChatDeepLinkPlan", () => {
  it("?lead=<uuid> → plano de lead, a resolver para telefone", () => {
    const plan = computeChatDeepLinkPlan({
      phone: null,
      instance: null,
      box: null,
      lead: LEAD_ID,
    });

    expect(plan).toEqual({
      kind: "lead",
      leadId: LEAD_ID,
      instance: null,
      box: null,
    });
  });

  it("?phone= sozinho → plano de telefone, sem consulta a lead", () => {
    const plan = computeChatDeepLinkPlan({
      phone: "5548999887766",
      instance: null,
      box: null,
      lead: null,
    });

    expect(plan).toEqual({
      kind: "phone",
      phone: "5548999887766",
      instance: null,
      box: null,
    });
  });

  it("?phone= e ?lead= juntos → telefone vence, é o mais específico e dispensa consulta", () => {
    const plan = computeChatDeepLinkPlan({
      phone: "5548999887766",
      instance: "inst-1",
      box: null,
      lead: LEAD_ID,
    });

    expect(plan).toEqual({
      kind: "phone",
      phone: "5548999887766",
      instance: "inst-1",
      box: null,
    });
  });

  it("sem alvo → nada a abrir, mas instance e box continuam sendo honrados", () => {
    // Nenhum call site produz `?instance=` ou `?box=` isolado com alvo ausente
    // hoje, mas o ChatShell sempre honrou os dois para pré-selecionar a caixa.
    // Descartá-los aqui repetiria em silêncio o defeito que esta função corrige.
    const plan = computeChatDeepLinkPlan({
      phone: null,
      instance: "inst-7",
      box: "box-3",
      lead: null,
    });

    expect(plan).toEqual({ kind: "none", instance: "inst-7", box: "box-3" });
  });

  it("?lead= com ?box= → o box escolhido acompanha o plano de lead", () => {
    const plan = computeChatDeepLinkPlan({
      phone: null,
      instance: null,
      box: "box-3",
      lead: LEAD_ID,
    });

    expect(plan).toEqual({
      kind: "lead",
      leadId: LEAD_ID,
      instance: null,
      box: "box-3",
    });
  });
});
