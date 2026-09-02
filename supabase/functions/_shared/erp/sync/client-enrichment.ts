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
import { type OwnerMap, resolveResponsible } from "./owner-map.ts";

/**
 * Campos que a sincronização escreve em `upsell_clients`.
 *
 * `undefined` some do objeto; `null` é gravado. A diferença importa: adapter que
 * não produz o campo (Omie) não deve apagar o que já está lá, mas ERP que
 * devolveu vazio deve limpar.
 */
export function clientEnrichmentColumns(
  client: CanonicalClient,
  /**
   * De-para de representante. **Ausente = não mexer em `responsible_id`.**
   *
   * `resolveResponsible` devolve `undefined` quando não há decisão registrada
   * para aquele `codigoRepresentante`, e o `put` abaixo faz `undefined` sumir do
   * objeto — é assim que mapa vazio deixa a base intocada. Só linha explícita
   * escreve, inclusive quando escreve `null`, que é como um canal
   * (`TORREFAÇÃO`) fica deliberadamente sem dono.
   */
  ownerMap?: OwnerMap,
): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined) cols[key] = value;
  };

  put("erp_company", client.erpCompany);
  put("erp_owner_name", client.ownerName);
  put("erp_owner_external_id", client.ownerExternalId);
  put("responsible_id", resolveResponsible(ownerMap, client.ownerExternalId));
  put("erp_status", client.erpStatus);
  put("erp_segment", client.segment);
  put("erp_registered_at", client.registeredAt);
  put("erp_last_order_at", client.lastOrderAt);
  put("erp_city", client.city);
  put("erp_uf", client.uf);
  put("erp_metadata", client.metadata);

  return cols;
}

/**
 * Data do ERP (`aaaa-mm-dd`) → instante para `upsell_clients.last_order_at`.
 *
 * **Meio-dia UTC, não meia-noite.** A coluna é `timestamptz` e a tela lê em
 * horário de Brasília (UTC-3): `2026-07-29T00:00:00Z` aparece como 28/07 às 21h,
 * e o cliente que comprou no dia 29 passa a "ter comprado no dia 28". Meio-dia
 * mantém a data íntegra em qualquer fuso do Brasil, e o erro máximo — 12 horas
 * numa medida contada em dias — não muda nenhuma decisão.
 */
export function erpDateToTimestamp(iso: string): string {
  return `${iso}T12:00:00.000Z`;
}

/**
 * Quando semear `last_order_at` com a data que o ERP conhece.
 *
 * `last_order_at` é a métrica da CARTEIRA — `calculate-portfolio-health` a
 * recalcula a partir dos pedidos registrados e, na ausência deles, preserva o
 * que estiver lá (é o mesmo caminho do import por CSV). Semear é o que faz
 * "dias sem pedido", ciclo de recompra e saúde existirem para a Café Jurerê
 * antes de haver endpoint de pedidos.
 *
 * Só semeia para FRENTE. Um pedido registrado no CRM depois da última fatura do
 * ERP é informação mais nova, e sobrescrevê-la com a data do ERP faria o cliente
 * envelhecer sozinho a cada sincronização.
 *
 * 🔴 A comparação é NUMÉRICA, nunca de texto. O Postgres devolve
 * `2026-07-29T12:00:00+00:00` e nós escrevemos `2026-07-29T12:00:00.000Z` — o
 * mesmo instante em duas grafias. Comparadas como string elas diferem sempre, e
 * o mesmo valor seria reescrito em toda sincronização: 12 mil UPDATEs idênticos,
 * que é exatamente o que estourou o teto de 150s do gateway em 20/08.
 */
export function seedLastOrderAt(
  erpLastOrderAt: string | null | undefined,
  currentLastOrderAt: string | null | undefined,
): string | null {
  if (!erpLastOrderAt) return null;
  const candidate = erpDateToTimestamp(erpLastOrderAt);
  if (!currentLastOrderAt) return candidate;

  const current = Date.parse(currentLastOrderAt);
  // Valor ilegível no banco: tratar como ausente perderia a data mais nova; o
  // seguro é não mexer e deixar o que já está lá.
  if (Number.isNaN(current)) return null;
  return Date.parse(candidate) > current ? candidate : null;
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
