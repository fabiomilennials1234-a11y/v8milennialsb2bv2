/**
 * Tests for _shared/erp/toth-probe-shape.ts.
 *
 * O contrato desta ferramenta tem duas metades e as duas são testadas aqui:
 *  1. identificar campo (tipo, formato, se varia entre linhas);
 *  2. NÃO devolver o valor. A segunda é a que impede que uma tela de
 *     diagnóstico vire exportação da base de clientes.
 */
import { describe, it, expect } from "vitest";
import {
  describePayload,
  describeEnvelope,
} from "../../supabase/functions/_shared/erp/toth-probe-shape";

const ROWS = [
  {
    codigo: "1042",
    razaoSocial: "Café Jurerê Indústria LTDA",
    cnpj: "12.345.678/0001-90",
    email: "financeiro@cafejurere.com.br",
    telefone: "48999750303",
    ativo: true,
    tipo: "cliente",
  },
  {
    codigo: "1043",
    razaoSocial: "Distribuidora Litoral ME",
    cnpj: "98.765.432/0001-10",
    email: "compras@litoral.com.br",
    telefone: "48988391171",
    ativo: true,
    tipo: "cliente",
  },
];

describe("describePayload — identificação de campo", () => {
  it("reconhece CNPJ, e-mail e telefone pelo formato", () => {
    const byName = Object.fromEntries(
      describePayload(ROWS).fields.map((f) => [f.name, f.looksLike]),
    );
    expect(byName.cnpj).toBe("CNPJ (14 díg.)");
    expect(byName.email).toBe("e-mail");
    expect(byName.telefone).toBe("CPF ou telefone (11 díg.)");
  });

  it("marca como constante o campo que não varia entre linhas", () => {
    const byName = Object.fromEntries(
      describePayload(ROWS).fields.map((f) => [f.name, f.constantAcrossRows]),
    );
    // `tipo` é igual nas duas linhas → não serve de identificador.
    expect(byName.tipo).toBe(true);
    // `codigo` muda a cada linha → candidato a id imutável.
    expect(byName.codigo).toBe(false);
  });

  it("reporta taxa de preenchimento por campo", () => {
    const rows = [{ id: "1", email: "a@b.com" }, { id: "2" }, { id: "3", email: "" }];
    const fields = describePayload(rows).fields;
    expect(fields.find((f) => f.name === "id")?.fillRate).toBe(1);
    expect(fields.find((f) => f.name === "email")?.fillRate).toBeCloseTo(1 / 3);
  });

  it("coleta campos que só aparecem em algumas linhas", () => {
    const names = describePayload([{ a: 1 }, { b: 2 }]).fields.map((f) => f.name);
    expect(names).toEqual(["a", "b"]);
  });

  it("aguenta lista vazia", () => {
    expect(describePayload([])).toEqual({ rowCount: 0, sampled: 0, fields: [] });
  });
});

describe("describePayload — sigilo", () => {
  it("não devolve nenhum valor das linhas", () => {
    const serialized = JSON.stringify(describePayload(ROWS));
    for (const leak of [
      "Café Jurerê Indústria",
      "12.345.678/0001-90",
      "12345678000190",
      "financeiro@cafejurere.com.br",
      "48999750303",
      "1042",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("informa só o comprimento de um campo de texto", () => {
    const field = describePayload([{ nome: "Café Jurerê" }]).fields[0];
    expect(field.length).toBe("Café Jurerê".length);
    expect(JSON.stringify(field)).not.toContain("Café");
  });
});

describe("describeEnvelope", () => {
  it("revela escalar de paginação, que é metadado e não PII", () => {
    const env = describeEnvelope({ clientes: [{ id: 1 }], total: 4820, pagina: 1 });
    expect(env.clientes).toBe("lista[1]");
    expect(env.total).toBe("inteiro = 4820");
    expect(env.pagina).toBe("inteiro = 1");
  });

  it("marca a raiz quando a resposta é um array cru", () => {
    expect(describeEnvelope([{ id: 1 }])).toEqual({ _raiz: "array" });
  });
});
