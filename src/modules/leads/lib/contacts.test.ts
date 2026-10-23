import { describe, expect, it } from "vitest";
import {
  buildPhonesPayload,
  parseContactList,
  recusaDeContato,
  validateContactForm,
  type ContactFormValues,
} from "./contacts";

describe("buildPhonesPayload", () => {
  it("descarta linhas em branco e marca o primeiro como principal quando nenhum foi marcado", () => {
    expect(
      buildPhonesPayload([
        { phone: "  ", label: "", isPrimary: false },
        { phone: " (48) 99999-1111 ", label: " Celular ", isPrimary: false },
        { phone: "4833334444", label: "", isPrimary: false },
      ]),
    ).toEqual([
      { phone: "(48) 99999-1111", label: "Celular", is_primary: true },
      { phone: "4833334444", label: null, is_primary: false },
    ]);
  });

  it("respeita o principal escolhido e deixa só um", () => {
    const out = buildPhonesPayload([
      { phone: "48911112222", label: "", isPrimary: true },
      { phone: "48933334444", label: "", isPrimary: true },
    ]);
    expect(out.filter((p) => p.is_primary)).toHaveLength(1);
    expect(out[0].is_primary).toBe(true);
  });

  it("lista vazia vira []", () => {
    expect(buildPhonesPayload([])).toEqual([]);
  });
});

describe("validateContactForm", () => {
  const base: ContactFormValues = { name: "Maria", email: "", jobTitle: "", phones: [], leadIds: [] };

  it("só o nome é obrigatório: sem lead, sem empresa, sem telefone", () => {
    expect(validateContactForm(base)).toEqual({});
  });

  it("nome em branco é recusado", () => {
    expect(validateContactForm({ ...base, name: "   " }).name).toBe("Informe o nome do contato.");
  });

  it("e-mail sem arroba é recusado; e-mail válido passa", () => {
    expect(validateContactForm({ ...base, email: "maria" }).email).toBe("E-mail inválido.");
    expect(validateContactForm({ ...base, email: "maria@cafe.com" }).email).toBeUndefined();
  });

  it("telefone com menos de 8 dígitos é recusado, apontando a linha", () => {
    const erros = validateContactForm({
      ...base,
      phones: [
        { phone: "48999991111", label: "", isPrimary: true },
        { phone: "123", label: "", isPrimary: false },
      ],
    });
    expect(erros.phones).toEqual({ 1: "Telefone inválido." });
  });

  it("linha de telefone vazia não é erro (é descartada)", () => {
    expect(validateContactForm({ ...base, phones: [{ phone: "", label: "", isPrimary: false }] })).toEqual({});
  });
});

describe("parseContactList", () => {
  it("lê o jsonb de contact_list", () => {
    const out = parseContactList({
      total: 1,
      rows: [
        {
          id: "c1",
          organization_id: "o1",
          name: "Maria",
          email: null,
          job_title: null,
          created_at: "2026-10-19T00:00:00Z",
          updated_at: "2026-10-19T00:00:00Z",
          phones: [{ id: "p1", phone: "48999991111", label: null, is_primary: true }],
          leads: [{ lead_id: "l1", name: "Lead 1", papel: "comprador" }],
        },
      ],
    });
    expect(out.total).toBe(1);
    expect(out.rows[0].phones[0].isPrimary).toBe(true);
    expect(out.rows[0].leads[0]).toEqual({ leadId: "l1", name: "Lead 1", papel: "comprador" });
  });

  it("resposta torta vira lista vazia, sem estourar", () => {
    expect(parseContactList(null)).toEqual({ total: 0, rows: [] });
    expect(parseContactList({ rows: "x" })).toEqual({ total: 0, rows: [] });
  });
});

describe("recusaDeContato", () => {
  it.each([
    ["PT404", "Contato não encontrado. Atualize a lista."],
    ["PT422", "Confira os dados do contato."],
  ])("%s vira texto pt-BR", (code, texto) => {
    expect(recusaDeContato({ code, message: "raw" })).toBe(texto);
  });

  it("usa a frase pt-BR do banco no 42501 e no PT422 detalhado", () => {
    expect(recusaDeContato({ code: "42501", message: "Você não pode alterar este lead." })).toBe(
      "Você não pode alterar este lead.",
    );
    expect(recusaDeContato({ code: "PT422", message: "Telefone inválido: 123" })).toBe("Telefone inválido: 123");
  });

  it("42501 em inglês e códigos desconhecidos não vão para a tela", () => {
    expect(recusaDeContato({ code: "42501", message: "permission denied for table contacts" })).toBeUndefined();
    expect(recusaDeContato({ code: "XX000", message: "boom" })).toBeUndefined();
    expect(recusaDeContato(null)).toBeUndefined();
  });
});
