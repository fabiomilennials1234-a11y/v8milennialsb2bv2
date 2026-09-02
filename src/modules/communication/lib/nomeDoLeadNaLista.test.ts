/**
 * A LISTA precisa achar o nome do lead pelas duas portas — senão ela diverge do
 * cabeçalho, que já achava pelas duas (`resolveEffectiveLead` + `useLeadByPhone`).
 *
 * Medido em 02/09 (Envase Carolini): lead renomeado para "6627 - Fernando Porto"
 * aparecia no topo da conversa e não na linha da lista.
 */
import { describe, expect, it } from "vitest";

import { nomeDoLeadNaLista, type FontesDeNome } from "./nomeDoLeadNaLista";

const fontes = (over: Partial<FontesDeNome> = {}): FontesDeNome => ({
  porId: new Map(),
  porTelefone: new Map(),
  normalizadoPorTelefone: new Map(),
  ...over,
});

describe("nomeDoLeadNaLista", () => {
  it("usa o vínculo do resumo quando ele existe", () => {
    const nome = nomeDoLeadNaLista(
      { lead_id: "lead-1", phone_number: "553499254544" },
      fontes({ porId: new Map([["lead-1", "6627 - Fernando Porto"]]) }),
    );
    expect(nome).toBe("6627 - Fernando Porto");
  });

  it("sem vínculo no resumo, acha o lead pelo telefone", () => {
    // `whatsapp_conversation_summary.lead_id` fica NULL quando a mensagem entrou
    // antes do lead existir e o gatilho de adoção nunca rodou de novo.
    const nome = nomeDoLeadNaLista(
      { lead_id: null, phone_number: "+55 (34) 99925-4544" },
      fontes({
        normalizadoPorTelefone: new Map([["+55 (34) 99925-4544", "34999254544"]]),
        porTelefone: new Map([["34999254544", "6627 - Fernando Porto"]]),
      }),
    );
    expect(nome).toBe("6627 - Fernando Porto");
  });

  it("o vínculo do resumo ganha do match por telefone", () => {
    // Dois nomes disponíveis: vale o que o banco afirma, não o que inferimos.
    const nome = nomeDoLeadNaLista(
      { lead_id: "lead-1", phone_number: "553499254544" },
      fontes({
        porId: new Map([["lead-1", "Nome do vínculo"]]),
        normalizadoPorTelefone: new Map([["553499254544", "34999254544"]]),
        porTelefone: new Map([["34999254544", "Nome do telefone"]]),
      }),
    );
    expect(nome).toBe("Nome do vínculo");
  });

  it("vínculo apontando para lead que não voltou no lote devolve null", () => {
    // O enriquecimento é `soft`: falha vira lote vazio. A linha degrada para
    // `push_name` via `contactLabel` — não para uma linha sem título.
    expect(
      nomeDoLeadNaLista({ lead_id: "lead-sumiu", phone_number: "553499254544" }, fontes()),
    ).toBeNull();
  });

  it("sem lead por porta nenhuma, devolve null", () => {
    expect(
      nomeDoLeadNaLista({ lead_id: null, phone_number: "553499254544" }, fontes()),
    ).toBeNull();
  });

  it("telefone sem normalizado conhecido não tenta adivinhar", () => {
    // Normalizar no cliente com regra diferente da do banco casaria conversa com
    // o lead errado. Sem o valor que a RPC devolveu, não há match.
    const nome = nomeDoLeadNaLista(
      { lead_id: null, phone_number: "553499254544" },
      fontes({ porTelefone: new Map([["34999254544", "Fernando"]]) }),
    );
    expect(nome).toBeNull();
  });
});
