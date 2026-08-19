/**
 * Tests for _shared/erp/toth-dry-run.ts.
 *
 * A prévia só tem valor se disser a verdade sobre o que a execução real faria.
 * Dois contratos são travados aqui:
 *   1. a decisão espelha `upsertCanonicalClient` — enrich_only NUNCA cria;
 *   2. o telefone "em risco" sai só de quem SERIA CRIADO, porque só a criação
 *      de lead dispara a adoção de conversas órfãs.
 */
import { describe, it, expect } from "vitest";
import {
  previewAction,
  summarize,
  phonesAtRisk,
  sampleForReview,
  type PreviewedClient,
} from "../../supabase/functions/_shared/erp/toth-dry-run";
import { normalizePhoneForSearch } from "../../supabase/functions/_shared/lead-service";
import type { CanonicalClient } from "../../supabase/functions/_shared/erp/types";

const cliente = (over: Partial<CanonicalClient> = {}): CanonicalClient => ({
  externalId: "293",
  externalRef: null,
  cnpj: "11222333000144",
  name: "TORREFACAO EXEMPLO LTDA",
  company: "EXEMPLO",
  email: "a@b.com",
  phone: "4832631404",
  ...over,
});

const preview = (over: Partial<PreviewedClient> = {}): PreviewedClient => ({
  externalId: "293",
  action: "create",
  reason: "unmatched_canonical",
  normalizedPhone: "48932631404",
  ...over,
});

describe("previewAction — espelha o upsert sem escrever", () => {
  const base = { client: cliente(), matchedByExternalId: false, matchedByCnpj: false };

  it("enrich_only NUNCA cria — é o que o torna seguro e inútil em carteira vazia", () => {
    const r = previewAction({ ...base, syncMode: "enrich_only" });
    expect(r.action).toBe("skip");
    expect(r.reason).toBe("unmatched");
  });

  it("canonical cria quando não casa — e criar lead é o que acorda gatilho", () => {
    expect(previewAction({ ...base, syncMode: "canonical" }).action).toBe("create");
  });

  it("casou por external_id: enriquece nos dois modos, nunca cria", () => {
    for (const mode of ["enrich_only", "canonical"] as const) {
      const r = previewAction({ ...base, syncMode: mode, matchedByExternalId: true });
      expect(r.action).toBe("enrich");
      expect(r.reason).toBe("match_external_id");
    }
  });

  it("casou por CNPJ: enriquece, e a razão distingue do casamento por id", () => {
    const r = previewAction({ ...base, syncMode: "canonical", matchedByCnpj: true });
    expect(r.action).toBe("enrich");
    expect(r.reason).toBe("match_cnpj");
  });

  it("external_id vence CNPJ quando os dois casam", () => {
    const r = previewAction({
      ...base,
      syncMode: "canonical",
      matchedByExternalId: true,
      matchedByCnpj: true,
    });
    expect(r.reason).toBe("match_external_id");
  });

  it("modo off não faz nada, nem enriquece", () => {
    const r = previewAction({ ...base, syncMode: "off", matchedByExternalId: true });
    expect(r.action).toBe("skip");
    expect(r.reason).toBe("mode_off");
  });
});

describe("phonesAtRisk — só a criação adota conversa órfã", () => {
  it("ignora quem seria apenas enriquecido", () => {
    // Enriquecer não cria lead, e o lead existente já adotou o que tinha.
    const previews = [
      preview({ externalId: "1", action: "create", normalizedPhone: "48911111111" }),
      preview({ externalId: "2", action: "enrich", normalizedPhone: "48922222222" }),
      preview({ externalId: "3", action: "skip", normalizedPhone: "48933333333" }),
    ];
    expect(phonesAtRisk(previews)).toEqual(["48911111111"]);
  });

  it("descarta quem não tem telefone e deduplica repetidos", () => {
    const previews = [
      preview({ externalId: "1", normalizedPhone: null }),
      preview({ externalId: "2", normalizedPhone: "48911111111" }),
      preview({ externalId: "3", normalizedPhone: "48911111111" }),
    ];
    expect(phonesAtRisk(previews)).toEqual(["48911111111"]);
  });

  it("sem candidatos a criação, nenhuma conversa é adotada", () => {
    expect(phonesAtRisk([preview({ action: "enrich" })])).toEqual([]);
    expect(phonesAtRisk([])).toEqual([]);
  });
});

describe("normalização usada na previsão bate com a do banco", () => {
  it("insere o 9 em número de 10 dígitos — inclusive em FIXO", () => {
    // Peculiaridade de `normalize_brazilian_phone`: 10 dígitos vira 11 com o 9
    // no meio, mesmo sendo fixo. Prever "melhor" que o banco daria número
    // bonito e errado, e a contagem de órfãs mentiria.
    expect(normalizePhoneForSearch("4832631404")).toBe("48932631404");
    expect(normalizePhoneForSearch("(48) 3263-1404")).toBe("48932631404");
  });

  it("tira o prefixo internacional e mantém celular de 11 dígitos", () => {
    expect(normalizePhoneForSearch("5548999750303")).toBe("48999750303");
    expect(normalizePhoneForSearch("48999750303")).toBe("48999750303");
  });

  it("vazio vira null", () => {
    expect(normalizePhoneForSearch("")).toBeNull();
    expect(normalizePhoneForSearch(null)).toBeNull();
  });
});

describe("summarize", () => {
  it("conta ações e preenchimento de campo", () => {
    const clients = [
      cliente({ externalId: "1" }),
      cliente({ externalId: "2", cnpj: null, phone: null }),
      cliente({ externalId: "3", email: null }),
    ];
    const previews = [
      preview({ externalId: "1", action: "create" }),
      preview({ externalId: "2", action: "skip" }),
      preview({ externalId: "3", action: "enrich" }),
    ];

    expect(summarize(clients, previews)).toEqual({
      mapped: 3,
      wouldCreate: 1,
      wouldEnrich: 1,
      wouldSkip: 1,
      withCnpj: 2,
      withPhone: 2,
      withEmail: 2,
    });
  });

  it("aguenta prévia vazia", () => {
    expect(summarize([], [])).toEqual({
      mapped: 0,
      wouldCreate: 0,
      wouldEnrich: 0,
      wouldSkip: 0,
      withCnpj: 0,
      withPhone: 0,
      withEmail: 0,
    });
  });
});

describe("sampleForReview", () => {
  it("devolve valor legível para conferência humana, com a ação de cada um", () => {
    const clients = [cliente()];
    const sample = sampleForReview(clients, [preview()]);
    expect(sample[0]).toMatchObject({
      external_id: "293",
      cnpj: "11222333000144",
      telefone_normalizado: "48932631404",
      acao: "create",
    });
  });

  it("limita o tamanho — é amostra, não exportação da base", () => {
    const clients = Array.from({ length: 50 }, (_, i) => cliente({ externalId: String(i) }));
    const previews = clients.map((c) => preview({ externalId: c.externalId }));
    expect(sampleForReview(clients, previews)).toHaveLength(5);
    expect(sampleForReview(clients, previews, 2)).toHaveLength(2);
  });
});
