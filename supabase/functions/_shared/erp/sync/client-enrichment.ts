/**
 * Colunas de enriquecimento derivadas de um `CanonicalClient`.
 *
 * Vive separado porque os DOIS caminhos de escrita precisam do mesmo mapa —
 * `bulkCreateClients` (carga inicial, INSERT em lote) e `upsertCanonicalClient`
 * (reconciliação, um a um). Duplicar o mapa garantiria que um dia eles
 * divergissem, e a divergência seria invisível: o cliente criado teria campos
 * que o cliente atualizado não tem.
 */

import { CanonicalClient } from "../types.ts";

/**
 * Campos que a sincronização escreve em `upsell_clients`.
 *
 * `undefined` some do objeto; `null` é gravado. A diferença importa: adapter que
 * não produz o campo (Omie) não deve apagar o que já está lá, mas ERP que
 * devolveu vazio deve limpar.
 */
export function clientEnrichmentColumns(client: CanonicalClient): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined) cols[key] = value;
  };

  put("erp_company", client.erpCompany);
  put("erp_owner_name", client.ownerName);
  put("erp_owner_external_id", client.ownerExternalId);
  put("erp_status", client.erpStatus);
  put("erp_segment", client.segment);
  put("erp_registered_at", client.registeredAt);
  put("erp_city", client.city);
  put("erp_uf", client.uf);
  put("erp_metadata", client.metadata);

  return cols;
}

/**
 * Campos que a sincronização escreve no LEAD correspondente.
 *
 * Bem menos que no cliente da carteira, e de propósito: o lead é a entidade
 * comercial e a maioria dos seus campos é curada por gente. Só entram os que o
 * ERP conhece melhor que o CRM — segmento e UF, que alimentam filtro de funil e
 * territorialização.
 *
 * `uf_source` carimba a procedência para que um dado do ERP não seja confundido
 * com UF inferida de DDD — o trigger `set_uf_from_ddd` só sobrescreve UF nula
 * ou vinda de `'ddd'`.
 *
 * 🔴 O valor é `'erp'`, seco. `leads.uf_source` tem CHECK com vocabulário
 * fechado (`manual | webhook | ddd | ai | erp`), e `erp_${source}` estourava a
 * restrição: quatro criações de cliente falharam na carga da Café Jurerê antes
 * disso ser percebido. Qual ERP é informação de `upsell_clients.external_source`,
 * não desta coluna.
 *
 * `source` fica no parâmetro porque a assinatura é compartilhada com o resto da
 * camada de sync — e para o dia em que o vocabulário distinguir integradores.
 */
export function leadEnrichmentColumns(
  client: CanonicalClient,
  _source: string,
): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  if (client.segment !== undefined && client.segment !== null) cols.segment = client.segment;
  if (client.uf) {
    cols.uf = client.uf;
    cols.uf_source = "erp";
  }
  return cols;
}
