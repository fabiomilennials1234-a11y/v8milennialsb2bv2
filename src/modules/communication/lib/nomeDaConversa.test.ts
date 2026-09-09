/**
 * O cabeçalho e a lista precisam contar a MESMA história sobre a mesma conversa.
 *
 * Relatado em 02/09: o topo mostrava "6627 - Fernando Porto" (nome do CRM) e a
 * linha da lista, "Fernando Porto" (o perfil do WhatsApp). Decisão do CTO: na
 * Café Jurerê quem manda é o nome do WhatsApp, nas duas telas — e é a lista que
 * já resolvia assim, então a flag move o cabeçalho.
 */
import { describe, expect, it } from "vitest";

import { nomeDaConversa, type FontesDoNomeDaConversa } from "./nomeDaConversa";

const fontes = (over: Partial<FontesDoNomeDaConversa> = {}): FontesDoNomeDaConversa => ({
  pushName: null,
  nomeDoLead: null,
  telefone: "553499254544",
  ...over,
});

const COM_FLAG = { nomeDoWhatsappPrimeiro: true };

describe("nomeDaConversa — COM a flag: manda o WhatsApp", () => {
  it("o push_name ganha do nome do lead", () => {
    expect(
      nomeDaConversa(
        fontes({ pushName: "Fernando Porto", nomeDoLead: "6627 - Fernando Porto" }),
        COM_FLAG,
      ),
    ).toBe("Fernando Porto");
  });

  it("mesma ordem que a LISTA já usa", () => {
    // `contactLabel` resolve `push_name || lead_name || telefone`. Com a flag,
    // cabeçalho e linha passam a escolher a mesma fonte.
    expect(nomeDaConversa(fontes({ pushName: "Zap", nomeDoLead: "CRM" }), COM_FLAG)).toBe("Zap");
  });

  it("sem push_name, o nome do lead aparece", () => {
    // Conversa que só teve saída (nós mandamos primeiro) nunca recebeu perfil.
    expect(nomeDaConversa(fontes({ nomeDoLead: "6627 - Fernando Porto" }), COM_FLAG)).toBe(
      "6627 - Fernando Porto",
    );
  });

  it("sem nome nenhum, cai no telefone", () => {
    expect(nomeDaConversa(fontes(), COM_FLAG)).toBe("553499254544");
  });

  it("sem nada, devolve string vazia", () => {
    expect(nomeDaConversa({ pushName: null, nomeDoLead: null, telefone: null }, COM_FLAG)).toBe("");
  });
});

describe("nomeDaConversa — SEM a flag: nada muda", () => {
  // A entrega é por org. Para as outras ~30, o cabeçalho tem que ser byte-a-byte
  // o `effectiveLeadName ?? push_name ?? phone ?? ""` que estava inline.

  it("o nome do lead continua ganhando", () => {
    expect(
      nomeDaConversa(fontes({ pushName: "Fernando Porto", nomeDoLead: "6627 - Fernando Porto" })),
    ).toBe("6627 - Fernando Porto");
  });

  it("sem lead, mostra o push_name", () => {
    expect(nomeDaConversa(fontes({ pushName: "Fernando Porto" }))).toBe("Fernando Porto");
  });

  it("sem nome nenhum, cai no telefone", () => {
    expect(nomeDaConversa(fontes())).toBe("553499254544");
  });
});

describe("nomeDaConversa — string vazia é valor, não ausência", () => {
  // `??` e não `||`, dos dois lados. O cabeçalho fazia `??` antes desta função;
  // trocar por `||` mudaria a tela de org que não pediu mudança.

  it("nome de lead vazio vence o push_name quando o lead manda", () => {
    expect(nomeDaConversa(fontes({ nomeDoLead: "", pushName: "Fernando" }))).toBe("");
  });

  it("push_name vazio vence o nome do lead quando o WhatsApp manda", () => {
    expect(nomeDaConversa(fontes({ pushName: "", nomeDoLead: "Fernando" }), COM_FLAG)).toBe("");
  });
});

describe("nomeDaConversa — sem número de verdade", () => {
  // A queda para o telefone era crua: o cabeçalho da thread se chamava
  // `210028246085780`. Ver `identificadorOculto.ts`.
  it("LID vira rótulo nas duas ordens", () => {
    const fontes = { pushName: null, nomeDoLead: null, telefone: "210028246085780" };
    expect(nomeDaConversa(fontes)).toBe("Contato sem número · 085780");
    expect(nomeDaConversa(fontes, { nomeDoWhatsappPrimeiro: true }))
      .toBe("Contato sem número · 085780");
  });

  it("com nome, nada muda", () => {
    expect(nomeDaConversa({ pushName: "Ana", nomeDoLead: null, telefone: "210028246085780" }))
      .toBe("Ana");
  });

  it("telefone de verdade segue intocado", () => {
    expect(nomeDaConversa({ pushName: null, nomeDoLead: null, telefone: "5548999998888" }))
      .toBe("5548999998888");
  });
});
