import { describe, expect, it } from "vitest";
import { buildTothCadastro } from "../../supabase/functions/_shared/erp/toth-cadastro";
import { planCadastroVisivel } from "../../supabase/functions/_shared/erp/cafe-jurere-cadastro";
import { mapTothClienteToCanonical } from "../../supabase/functions/_shared/erp/toth-mappers";
import { aplicarCadastroCafeJurere } from "../../src/modules/leads/lib/cafe-jurere-cadastro";

describe("cadastro ERP da Café Jurerê", () => {
  const row = { codigoCliente: "1206", numeroInscricao: "00123456789", razaoSocial: "Empresa teste", nomeFantasia: "Loja", situacaoParceiro: "3", dataCadastro: "2019-02-14", dataNascimento: null, UF: "SC", numero: 0, numeroInscricaoEstadualST: " 00123 ", emailNfe: "fiscal@example.com", nomeMae: null, token: "never-copy", unknown: "never-copy" };
  it("preserva zeros, códigos e campos nulos, sem copiar segredos ou chaves desconhecidas", () => {
    const snapshot = buildTothCadastro(row);
    expect(snapshot).toMatchObject({ numeroInscricao: "00123456789", numero: "0", uf: "SC", numeroInscricaoEstadualST: "00123", nomeMae: null });
    expect(snapshot).not.toHaveProperty("token");
    expect(snapshot).not.toHaveProperty("unknown");
  });
  it("não adiciona o snapshot na importação das demais organizações", () => {
    expect(mapTothClienteToCanonical(row).metadata).not.toHaveProperty("cadastro");
    expect(mapTothClienteToCanonical(row, { includeCadastro: true }).metadata).toHaveProperty("cadastro.numeroInscricao", "00123456789");
  });
  it("enriquece só os IDs visíveis, preservando metadados e sem criar clientes", () => {
    const plan = planCadastroVisivel([{ id: "visible", external_id: "1206", erp_metadata: { representanteEmails: ["rep@example.com"] } }, { id: "missing", external_id: "404", erp_metadata: null }], [row, { codigoCliente: "hidden" }]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: "visible", erp_metadata: { representanteEmails: ["rep@example.com"] } });
    expect(Object.keys(plan.updates[0])).toEqual(["id", "erp_metadata"]);
    expect(plan.missing).toBe(1);
    expect(planCadastroVisivel([{ id: "visible", external_id: "1206", erp_metadata: plan.updates[0].erp_metadata }], [row])).toMatchObject({ updates: [], unchanged: 1 });
    const reordered = Object.fromEntries(Object.entries(buildTothCadastro(row)).reverse());
    expect(planCadastroVisivel([{ id: "visible", external_id: "1206", erp_metadata: { cadastro: reordered } }], [row])).toMatchObject({ updates: [], unchanged: 1 });
  });
  it("recusa resposta ambígua e não apaga dados de cliente ausente no ERP", () => {
    expect(() => planCadastroVisivel([], [row, row])).toThrow("duplicados");
    expect(planCadastroVisivel([{ id: "v", external_id: "1206", erp_metadata: { cadastro: row } }], [])).toMatchObject({ updates: [], missing: 1 });
  });
  it("mostra cadastro real, distingue nascimento de cadastro, não expõe edição ERP", () => {
    const groups = aplicarCadastroCafeJurere([{ titulo: "Perfil", campos: [{ chave: "documento", rotulo: "CPF/CNPJ", valor: null }, { chave: "nascimento", rotulo: "Nascimento", valor: null }, { chave: "documento", rotulo: "Custom", valor: "Preservado", personalizado: true }] }], { cnpj: "stale", erp_metadata: { cadastro: buildTothCadastro(row) } });
    const fields = groups.flatMap(g => g.campos);
    // O documento não é mais travado aqui: a trava vem da permissão (`leads.edit_document`).
    expect(fields.find(f => f.chave === "documento")).toMatchObject({ valor: "00123456789", origemErp: true, alteradoLocalmente: false });
    expect(fields.find(f => f.chave === "documento")?.somenteLeitura).toBeUndefined();
    expect(fields.find(f => f.chave === "nascimento")?.valor).toBeNull();
    expect(fields.find(f => f.chave === "erp_cadastro")?.valor).toBe("14/02/2019");
    expect(fields.find(f => f.chave === "erp_situacao")?.valor).toBe("Inconsistente");
    expect(fields.find(f => f.personalizado)?.valor).toBe("Preservado");
  });
  it("não ressuscita valor antigo quando o ERP informou vazio", () => {
    const fields = aplicarCadastroCafeJurere([{ titulo: "Perfil", campos: [{ chave: "documento", rotulo: "Documento", valor: null }] }], { cnpj: "old", erp_metadata: { cadastro: buildTothCadastro({ codigoCliente: "1", numeroInscricao: null }) } });
    expect(fields[0].campos[0].valor).toBeNull();
  });

  describe("CPF/CNPJ (Chamado 93027ffb)", () => {
    // Sintéticos: só formato importa aqui, a regra de DV tem teste próprio.
    const OVERRIDE = "10203040506070";
    const ERP_DOC = "70605040302010";
    const perfil = (somenteLeitura: boolean) => [{ titulo: "Perfil", campos: [
      { chave: "documento", rotulo: "CPF / CNPJ", valor: null, tipo: "documento" as const, somenteLeitura },
      { chave: "site", rotulo: "Site", valor: null },
    ] }];
    const doc = (groups: ReturnType<typeof aplicarCadastroCafeJurere>) => groups.flatMap(g => g.campos).find(f => f.chave === "documento");

    it("placeholder de zeros do Toth vira vazio, em vez de aparecer como CNPJ", () => {
      const groups = aplicarCadastroCafeJurere(perfil(false), { cnpj: null, erp_metadata: { cadastro: buildTothCadastro({ codigoCliente: "9", numeroInscricao: "0".repeat(14) }) } });
      expect(doc(groups)).toMatchObject({ valor: null, valorErp: null, alteradoLocalmente: false });
    });

    it("sem snapshot, cai na coluna do cliente, também sanitizada", () => {
      expect(doc(aplicarCadastroCafeJurere(perfil(false), { cnpj: ERP_DOC, erp_metadata: {} }))?.valor).toBe(ERP_DOC);
      expect(doc(aplicarCadastroCafeJurere(perfil(false), { cnpj: "1".repeat(11), erp_metadata: {} }))?.valor).toBeNull();
    });

    it("override vence o ERP, com selo e o valor do ERP ao lado", () => {
      const groups = aplicarCadastroCafeJurere(perfil(false), { cnpj: ERP_DOC, erp_metadata: { cadastro: buildTothCadastro({ codigoCliente: "9", numeroInscricao: ERP_DOC }) } }, OVERRIDE);
      expect(doc(groups)).toMatchObject({ valor: OVERRIDE, alteradoLocalmente: true, valorErp: ERP_DOC, origemErp: false, somenteLeitura: false });
    });

    it("override sem documento no ERP mantém o ERP vazio ao lado", () => {
      expect(doc(aplicarCadastroCafeJurere(perfil(false), { cnpj: null, erp_metadata: {} }, OVERRIDE))).toMatchObject({ valor: OVERRIDE, valorErp: null, alteradoLocalmente: true });
    });

    it("a trava do documento é a permissão que chega no campo, não o ERP", () => {
      expect(doc(aplicarCadastroCafeJurere(perfil(true), { cnpj: ERP_DOC, erp_metadata: {} }))?.somenteLeitura).toBe(true);
      expect(doc(aplicarCadastroCafeJurere(perfil(false), { cnpj: ERP_DOC, erp_metadata: {} }))?.somenteLeitura).toBe(false);
    });

    it("os demais campos do ERP seguem travados, com ou sem override", () => {
      const fields = aplicarCadastroCafeJurere(perfil(false), { cnpj: ERP_DOC, erp_metadata: { cadastro: buildTothCadastro(row) } }, OVERRIDE).flatMap(g => g.campos);
      const travados = fields.filter(f => f.chave !== "documento");
      expect(travados.length).toBeGreaterThan(20);
      for (const f of travados) expect(f).toMatchObject({ somenteLeitura: true, origemErp: true });
    });
  });
});
