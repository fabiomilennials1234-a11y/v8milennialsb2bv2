/** Snapshot cadastral permitido. Nunca guardar o payload inteiro do fornecedor. */
export const TOTH_CADASTRO_FIELDS = [
  "codigoCliente", "codigoTipoMercado", "descricaoTipoMercado", "dataCadastro",
  "numeroInscricao", "razaoSocial", "nomeFantasia", "tipoPessoa", "situacaoParceiro",
  "codigoGrupoParceiro", "numeroRg", "nomeOrgaoExpedidorRg", "dataExpedicaoRg",
  "dataNascimento", "nomePai", "nomeMae", "sexo", "numeroInscricaoEstadual",
  "numeroInscricaoEstadualST", "numeroInscricaoMunicipal", "contribuinteIcms",
  "emailNfe", "cep", "logradouro", "numero", "complemento", "bairro", "cidade",
  "uf", "site", "temSuframa",
] as const;

export function buildTothCadastro(row: Record<string, unknown>): Record<string, string | null> {
  return Object.fromEntries(TOTH_CADASTRO_FIELDS.map((key) => {
    const value = row[key] ?? (key === "uf" ? row.UF ?? row.estado : undefined);
    return [key, typeof value === "string" ? value.trim() || null
      : typeof value === "number" || typeof value === "boolean" ? String(value) : null];
  }));
}
