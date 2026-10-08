import type { LeadCardField, LeadCardFieldGroup } from "../components/lead-card/types";

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string | null => typeof value === "string" ? value.trim() || null : typeof value === "number" ? String(value) : null;
const date = (value: string | null) => value?.replace(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/, "$3/$2/$1") ?? null;
const label = (value: string | null, labels: Record<string, string>) => value === null ? null : labels[value] ?? value;

/** Preenche somente os campos ERP; as respostas personalizadas permanecem intactas. */
export function aplicarCadastroCafeJurere(groups: LeadCardFieldGroup[], client: Row): LeadCardFieldGroup[] {
  const meta = record(client.erp_metadata);
  const snapshot = record(meta.cadastro);
  const completo = Object.keys(snapshot).length > 0;
  const value = (key: string, fallback?: unknown) => text(completo ? snapshot[key] : meta[key] ?? fallback);
  const erp = (key: string, rotulo: string, valor: string | null): LeadCardField => ({
    chave: `erp_${key}`, rotulo, valor, somenteLeitura: true, origemErp: true, vazio: "Não informado no ERP",
  });
  const address = [value("logradouro"), value("numero")].filter(Boolean).join(", ") || null;
  const replacements: Record<string, string | null> = {
    documento: value("numeroInscricao", client.cnpj), site: value("site"),
    nascimento: date(value("dataNascimento")), cidade: value("cidade", client.erp_city),
    uf: value("uf", client.erp_uf), logradouro: address, cep: value("cep"),
  };
  return [
    ...groups.map(group => ({ ...group, campos: group.campos.map(field =>
      !field.personalizado && Object.prototype.hasOwnProperty.call(replacements, field.chave)
        ? { ...field, valor: replacements[field.chave], somenteLeitura: true, origemErp: true, vazio: "Não informado no ERP" }
        : field) })),
    { titulo: "Cadastro no ERP", campos: [
      erp("codigo", "Código do cliente", value("codigoCliente", client.external_id)),
      erp("razao", "Razão social", value("razaoSocial", client.name)),
      erp("fantasia", "Nome fantasia", value("nomeFantasia", client.company)),
      erp("pessoa", "Tipo de pessoa", label(value("tipoPessoa"), { J: "Jurídica", F: "Física" })),
      erp("situacao", "Situação no ERP", label(value("situacaoParceiro", client.erp_status), { "0": "Ativo", "1": "Inativo", "2": "Bloqueado", "3": "Inconsistente" })),
      erp("cadastro", "Data de cadastro", date(value("dataCadastro", client.erp_registered_at))),
      erp("mercado", "Tipo de mercado", value("descricaoTipoMercado", client.erp_segment)),
      erp("mercado_codigo", "Código do mercado", value("codigoTipoMercado")),
      erp("grupo", "Grupo do parceiro", value("codigoGrupoParceiro")),
      erp("representante", "Representante", text(client.erp_owner_name)),
      erp("representante_codigo", "Código do representante", text(client.erp_owner_external_id)),
      erp("bairro", "Bairro", value("bairro")),
      erp("complemento", "Complemento", value("complemento")),
    ] },
    { titulo: "Dados fiscais do ERP", campos: [
      erp("ie", "Inscrição estadual", value("numeroInscricaoEstadual")),
      erp("ie_st", "Inscrição estadual ST", value("numeroInscricaoEstadualST")),
      erp("im", "Inscrição municipal", value("numeroInscricaoMunicipal")),
      erp("icms", "Contribuinte ICMS", label(value("contribuinteIcms"), { S: "Sim", N: "Não" })),
      erp("email_nfe", "E-mail da NF-e", value("emailNfe")),
      erp("suframa", "Suframa", label(value("temSuframa"), { S: "Sim", N: "Não" })),
    ] },
    { titulo: "Dados pessoais do ERP", campos: [
      erp("rg", "RG", value("numeroRg")),
      erp("orgao_rg", "Órgão expedidor", value("nomeOrgaoExpedidorRg")),
      erp("emissao_rg", "Emissão do RG", date(value("dataExpedicaoRg"))),
      erp("pai", "Nome do pai", value("nomePai")),
      erp("mae", "Nome da mãe", value("nomeMae")),
      erp("sexo", "Sexo", label(value("sexo"), { M: "Masculino", F: "Feminino" })),
    ] },
  ];
}
