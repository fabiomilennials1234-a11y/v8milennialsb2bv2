/**
 * ClientStore com a carteira pré-carregada em memória.
 *
 * O store direto faz DUAS consultas por cliente do ERP (`findByExternalId` e
 * `findByCnpj`), sequenciais. Numa carga inicial de alguns milhares de
 * registros isso vira dezenas de milhares de idas ao banco — e foi metade do
 * motivo de o sync real morrer com "CPU Time exceeded" aos 60 segundos (20/08).
 *
 * Aqui a carteira inteira da organização entra em memória numa consulta só, e o
 * casamento por `external_id` e por CNPJ vira lookup de Map. A escrita continua
 * indo ao banco — o que é cacheado é a BUSCA, não o efeito.
 *
 * Cabe em memória com folga: são cinco colunas por cliente de carteira, e uma
 * organização com 50 mil clientes ficaria na casa de poucos MB. Se algum dia não
 * couber, o caminho é paginar a pré-carga, não voltar a consultar por linha.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ClientStore, ExistingClient } from "./upsert-client.ts";

const SELECT = "id, cnpj, phone, email, company, name, external_source, external_id, external_ref";
/** Teto por página da pré-carga — o PostgREST limita a resposta. */
const PRELOAD_PAGE = 1000;

interface PreloadedRow extends ExistingClient {
  external_id: string | null;
}

/**
 * Carrega a carteira da org e devolve um store que casa em memória.
 *
 * `writeThrough` é o store real: tudo que ESCREVE é delegado a ele, e o índice
 * é atualizado junto para que dois registros do ERP apontando para o mesmo CNPJ
 * na mesma execução não criem duas linhas.
 */
export async function cachedClientStore(
  admin: SupabaseClient,
  organizationId: string,
  source: string,
  writeThrough: ClientStore,
): Promise<ClientStore & { preloaded: number }> {
  const byExternalId = new Map<string, ExistingClient>();
  const byCnpj = new Map<string, ExistingClient>();
  let preloaded = 0;

  for (let from = 0; ; from += PRELOAD_PAGE) {
    const { data, error } = await admin
      .from("upsell_clients")
      .select(SELECT)
      .eq("organization_id", organizationId)
      .range(from, from + PRELOAD_PAGE - 1);

    if (error) throw new Error(`Falha ao pré-carregar a carteira: ${error.message}`);
    const rows = (data ?? []) as PreloadedRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      preloaded++;
      // Guarda a linha INTEIRA, com `external_*`. Uma versão anterior removia o
      // `external_id` por destructuring, e sem ele `upsertCanonicalClient` não
      // consegue comparar o carimbo — voltaria a escrever em todo registro,
      // que é justamente o que estoura o tempo na re-sincronização.
      if (row.external_id) byExternalId.set(`${source}:${row.external_id}`, row);
      if (row.cnpj) {
        const digits = row.cnpj.replace(/\D/g, "");
        if (digits && !byCnpj.has(digits)) byCnpj.set(digits, row);
      }
    }

    if (rows.length < PRELOAD_PAGE) break;
  }

  return {
    preloaded,

    findByExternalId(_organizationId, externalId) {
      return Promise.resolve(byExternalId.get(`${source}:${externalId}`) ?? null);
    },

    findByCnpj(_organizationId, cnpj) {
      return Promise.resolve(byCnpj.get(cnpj.replace(/\D/g, "")) ?? null);
    },

    async enrich(id, patch) {
      await writeThrough.enrich(id, patch);
    },

    createLead(orgId, lead) {
      return writeThrough.createLead(orgId, lead);
    },

    async createClient(row) {
      const id = await writeThrough.createClient(row);

      // Mantém o índice coerente dentro da própria execução: sem isto, dois
      // registros do ERP com o mesmo CNPJ criariam duas linhas na carteira.
      const created: ExistingClient = {
        id,
        cnpj: (row.cnpj as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        company: (row.company as string | null) ?? null,
        name: (row.name as string | null) ?? null,
        external_source: (row.external_source as string | null) ?? null,
        external_id: (row.external_id as string | null) ?? null,
        external_ref: (row.external_ref as string | null) ?? null,
      };
      const externalId = row.external_id as string | null;
      if (externalId) byExternalId.set(`${source}:${externalId}`, created);
      if (created.cnpj) {
        const digits = created.cnpj.replace(/\D/g, "");
        if (digits) byCnpj.set(digits, created);
      }
      return id;
    },
  };
}
