import { describe, expect, it } from "vitest";

import { separarCamposDaOrg } from "../useLeadCardData";

/**
 * O contrato que o card do Negócio depende: campo da organização JÁ RESPONDIDO
 * sobe para o "Perfil" (a primeira aba, a que abre), e só o nunca-tocado fica
 * em "Campos a preencher".
 *
 * O caso que dá nome à regra é o último: apagar o conteúdo de um campo NÃO o
 * faz pular de aba embaixo do cursor de quem acabou de editá-lo.
 */

const def = (id: string, nome: string) => ({ id, field_name: nome });

describe("separarCamposDaOrg", () => {
  it("põe no Perfil o campo que veio preenchido do formulário", () => {
    const { respondidos, aPreencher } = separarCamposDaOrg(
      [def("f1", "Comprador"), def("f2", "Transportadora")],
      [{ field_id: "f1", value: "Ellen (compras)" }],
    );

    expect(respondidos.map((c) => c.rotulo)).toEqual(["Comprador"]);
    expect(respondidos[0].valor).toBe("Ellen (compras)");
    expect(aPreencher.map((c) => c.rotulo)).toEqual(["Transportadora"]);
  });

  it("marca todo campo da org como personalizado — é o que escolhe a gravação", () => {
    // `LeadCardContainer.salvarCampo` decide entre `useUpdateLead` e
    // `useSaveCustomFieldValue` por esta flag. Sem ela, a chave (que é o id da
    // definição) iria para um `update` de coluna inexistente em `leads`.
    const { respondidos, aPreencher } = separarCamposDaOrg(
      [def("f1", "Comprador"), def("f2", "Transportadora")],
      [{ field_id: "f1", value: "Ellen" }],
    );

    for (const campo of [...respondidos, ...aPreencher]) {
      expect(campo.personalizado).toBe(true);
      expect(campo.chave).toMatch(/^f\d$/);
      // Nunca `somenteLeitura`: membro e admin gravam campo da org.
      expect(campo.somenteLeitura).toBeUndefined();
    }
  });

  it("não tipa o campo — `date` viraria input que apaga valor de webhook", () => {
    const { respondidos } = separarCamposDaOrg(
      [def("f1", "Data da visita")],
      [{ field_id: "f1", value: "31/12/2024" }],
    );

    expect(respondidos[0].tipo).toBeUndefined();
    expect(respondidos[0].valor).toBe("31/12/2024");
  });

  it("cada campo aparece em exatamente um dos dois grupos", () => {
    const definicoes = [def("f1", "A"), def("f2", "B"), def("f3", "C")];
    const { respondidos, aPreencher } = separarCamposDaOrg(definicoes, [
      { field_id: "f2", value: "x" },
    ]);

    const chaves = [...respondidos, ...aPreencher].map((c) => c.chave).sort();
    expect(chaves).toEqual(["f1", "f2", "f3"]);
    expect(new Set(chaves).size).toBe(3);
  });

  it("preserva a ordem de `display_order` que a query já devolveu", () => {
    const { respondidos } = separarCamposDaOrg(
      [def("f1", "Primeiro"), def("f2", "Segundo"), def("f3", "Terceiro")],
      [
        { field_id: "f3", value: "c" },
        { field_id: "f1", value: "a" },
      ],
    );

    expect(respondidos.map((c) => c.rotulo)).toEqual(["Primeiro", "Terceiro"]);
  });

  it("valor apagado FICA no Perfil — a linha existe, o campo não pula de aba", () => {
    for (const apagado of [null, ""]) {
      const { respondidos, aPreencher } = separarCamposDaOrg(
        [def("f1", "Comprador")],
        [{ field_id: "f1", value: apagado }],
      );

      expect(respondidos.map((c) => c.rotulo)).toEqual(["Comprador"]);
      expect(respondidos[0].valor).toBe(apagado === "" ? "" : null);
      expect(aPreencher).toEqual([]);
    }
  });

  it("campo vazio traz o convite no lugar do valor, não um traço", () => {
    const { aPreencher } = separarCamposDaOrg([def("f1", "Volume por pedido")], []);

    expect(aPreencher[0].valor).toBeNull();
    expect(aPreencher[0].vazio).toBe("Não informado");
  });

  it("org sem campo nenhum não inventa grupo", () => {
    expect(separarCamposDaOrg([], [])).toEqual({ respondidos: [], aPreencher: [] });
  });

  it("valor órfão (definição apagada) não vira campo fantasma", () => {
    const { respondidos, aPreencher } = separarCamposDaOrg(
      [def("f1", "Comprador")],
      [
        { field_id: "f1", value: "Ellen" },
        { field_id: "morto", value: "sobra de definição apagada" },
      ],
    );

    expect(respondidos).toHaveLength(1);
    expect(aPreencher).toHaveLength(0);
  });
});
