/**
 * O cabeçalho e a lista precisam contar a MESMA história sobre a mesma conversa.
 *
 * Relatado em 02/09: o topo mostrava "6627 - Fernando Porto" (nome do CRM) e a
 * linha da lista, "Fernando Porto" (o perfil do WhatsApp). Decisão do CTO: na
 * Café Jurerê quem manda é o nome do WhatsApp, nas duas telas — e é a lista que
 * já resolvia assim, então a flag move o cabeçalho.
 */
import { describe, expect, it } from "vitest";

import {
  nomeCodContatoLead,
  nomeDaConversa,
  nomeDoPainelDeContexto,
  type FontesDoNomeCodContatoLead,
} from "./nomeDaConversa";

type FontesDoNomeDaConversa = FontesDoNomeCodContatoLead;

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

describe("nomeDaConversa — flag chat_nome_do_lead: manda o leads.name", () => {
  const COM_LEAD = { nomeDoLeadPrimeiro: true };

  it("o nome do lead ganha do nome salvo e do perfil", () => {
    expect(
      nomeDaConversa(
        fontes({ pushName: "Ana", savedContactName: "Ana Agenda", nomeDoLead: "0001-EMPRESA FICTICIA LTDA" }),
        COM_LEAD,
      ),
    ).toBe("0001-EMPRESA FICTICIA LTDA");
  });

  it("sem lead: nome salvo, depois perfil, depois telefone", () => {
    expect(nomeDaConversa(fontes({ pushName: "Ana", savedContactName: "Ana Agenda" }), COM_LEAD)).toBe("Ana Agenda");
    expect(nomeDaConversa(fontes({ pushName: "Ana" }), COM_LEAD)).toBe("Ana");
    expect(nomeDaConversa(fontes(), COM_LEAD)).toBe("553499254544");
  });

  it("lead só com espaços ou vazio conta como sem lead", () => {
    expect(nomeDaConversa(fontes({ nomeDoLead: "   ", pushName: "Ana" }), COM_LEAD)).toBe("Ana");
    expect(nomeDaConversa(fontes({ nomeDoLead: "", savedContactName: "Salvo" }), COM_LEAD)).toBe("Salvo");
  });

  it("a queda final esconde LID", () => {
    expect(nomeDaConversa(fontes({ telefone: "210028246085780" }), COM_LEAD)).toBe(
      "Contato sem número · 085780",
    );
  });

  it("vence a flag antiga se as duas vierem", () => {
    expect(
      nomeDaConversa(
        fontes({ pushName: "Ana", nomeDoLead: "Lead" }),
        { nomeDoWhatsappPrimeiro: true, nomeDoLeadPrimeiro: true },
      ),
    ).toBe("Lead");
  });

  it("sem a opção nova, nada muda (nome salvo vence, depois lead)", () => {
    expect(nomeDaConversa(fontes({ savedContactName: "Salvo", nomeDoLead: "Lead", pushName: "Ana" }))).toBe("Salvo");
    expect(nomeDaConversa(fontes({ nomeDoLead: "Lead", pushName: "Ana" }), { nomeDoLeadPrimeiro: false })).toBe("Lead");
  });
});

describe("nomeCodContatoLead — flag chat_nome_cod_contato_lead (Chamado 82c50502)", () => {
  const COD = { nomeCodContatoLead: true };

  it("Cód - Contato - Lead", () => {
    expect(
      nomeCodContatoLead(fontes({ nomeDoLead: "Padaria Um", erpCode: "6627", contato: "José Luiz - Compras" })),
    ).toBe("6627 - José Luiz - Compras - Padaria Um");
  });

  it("sem nome de contato: Cód - Lead", () => {
    expect(nomeCodContatoLead(fontes({ nomeDoLead: "Padaria Um", erpCode: "6627", contato: null }))).toBe(
      "6627 - Padaria Um",
    );
  });

  it("sem código: Contato - Lead", () => {
    expect(nomeCodContatoLead(fontes({ nomeDoLead: "Padaria Um", erpCode: null, contato: "Maria" }))).toBe(
      "Maria - Padaria Um",
    );
  });

  it("código já digitado no nome do lead não duplica — nem com o contato no meio", () => {
    expect(nomeCodContatoLead(fontes({ nomeDoLead: "6627 - Fernando Porto", erpCode: "6627" }))).toBe(
      "6627 - Fernando Porto",
    );
    expect(
      nomeCodContatoLead(fontes({ nomeDoLead: "6627-Fernando Porto", erpCode: "6627", contato: "Compras" })),
    ).toBe("6627 - Compras - Fernando Porto");
  });

  it("contato igual ao nome do lead (caixa e acento não contam) não se repete", () => {
    expect(
      nomeCodContatoLead(fontes({ nomeDoLead: "José Café", erpCode: "10", contato: "jose cafe" })),
    ).toBe("10 - José Café");
  });

  it("conversa sem lead cai na regra de nomeComLeadPrimeiro", () => {
    expect(nomeCodContatoLead(fontes({ nomeDoLead: null, pushName: "Ana", erpCode: "1", contato: "X" }))).toBe("Ana");
  });

  it("nomeDaConversa com a flag usa a regra nova e vence chat_nome_do_lead", () => {
    expect(
      nomeDaConversa(
        fontes({ nomeDoLead: "Padaria Um", erpCode: "6627", contato: "Compras", pushName: "Zé" }),
        { ...COD, nomeDoLeadPrimeiro: true, nomeDoWhatsappPrimeiro: true },
      ),
    ).toBe("6627 - Compras - Padaria Um");
  });

  it("sem a flag nova, nada muda: código e contato são ignorados", () => {
    const f = fontes({ nomeDoLead: "Padaria Um", erpCode: "6627", contato: "Compras", pushName: "Zé" });
    expect(nomeDaConversa(f)).toBe("Padaria Um");
    expect(nomeDaConversa(f, { nomeDoLeadPrimeiro: true })).toBe("Padaria Um");
    expect(nomeDaConversa(f, { nomeDoWhatsappPrimeiro: true })).toBe("Zé");
  });

  it("painel: com a flag mostra o MESMO nome do topo, não o leads.name cru", () => {
    const topo = nomeDaConversa(fontes({ nomeDoLead: "Padaria Um", erpCode: "6627", contato: "Compras" }), COD);
    expect(
      nomeDoPainelDeContexto({ leadName: "Padaria Um", nomeDaConversa: topo, nomeCodContatoLead: true }),
    ).toBe(topo);
    // Sem a flag, o painel segue com o leads.name.
    expect(nomeDoPainelDeContexto({ leadName: "Padaria Um", nomeDaConversa: topo })).toBe("Padaria Um");
  });
});
