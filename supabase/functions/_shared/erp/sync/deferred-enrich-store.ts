/**
 * Store que ADIA o enriquecimento para escrever em paralelo depois.
 *
 * O laço de sincronização chama `upsertCanonicalClient` uma vez por cliente, e
 * cada chamada que encontra diferença faz um UPDATE — sequencial, um round-trip
 * de cada vez. Enquanto os enriquecimentos eram poucos isso não incomodava.
 *
 * Deixou de ser pouco quando a carteira ganhou as colunas de enriquecimento:
 * elas nascem NULL para os 11.179 clientes já existentes, então TODO cliente
 * muda de fato e o atalho de "não escreve quando nada muda" não ajuda. Onze mil
 * round-trips sequenciais estouram o teto de 150s do gateway — foi assim que a
 * re-sincronização morreu com HTTP 504 em 20/08.
 *
 * Aqui o `enrich` só ANOTA o patch. No fim, `flush` executa com concorrência
 * limitada: rápido o bastante para caber na execução, e comportado o bastante
 * para não abrir onze mil conexões contra o banco de uma vez.
 *
 * A decisão de QUAL campo escrever continua inteira em `upsertCanonicalClient`
 * — isto muda quando a escrita acontece, nunca o que ela contém.
 */

import { ClientStore } from "./upsert-client.ts";

/** Escritas simultâneas. Acima disso o ganho achata e o pool do banco sofre. */
export const DEFAULT_ENRICH_CONCURRENCY = 20;

export interface DeferredEnrich {
  store: ClientStore;
  /** Quantos patches estão na fila. */
  pending: () => number;
  /** Executa a fila. Devolve quantos foram aplicados e os erros encontrados. */
  flush: (concurrency?: number) => Promise<{ applied: number; failed: number; errors: string[] }>;
}

export function deferredEnrichStore(inner: ClientStore): DeferredEnrich {
  /**
   * Um patch por cliente, FUNDIDO por id.
   *
   * O mesmo cliente pode ser tocado duas vezes na mesma execução quando o ERP
   * devolve dois cadastros com o mesmo CNPJ. Guardar dois patches faria dois
   * UPDATEs na mesma linha, na ordem em que caíssem no pool — e a ordem de um
   * pool concorrente não é a ordem de leitura. Fundindo, a última informação
   * lida vence de forma determinística.
   */
  const queue = new Map<string, Record<string, unknown>>();

  const store: ClientStore = {
    findByExternalId: (org, externalId) => inner.findByExternalId(org, externalId),
    findByCnpj: (org, cnpj) => inner.findByCnpj(org, cnpj),
    createLead: (org, lead) => inner.createLead(org, lead),
    createClient: (row) => inner.createClient(row),

    enrich(id, patch) {
      const current = queue.get(id);
      queue.set(id, current ? { ...current, ...patch } : { ...patch });
      return Promise.resolve();
    },
  };

  async function flush(concurrency = DEFAULT_ENRICH_CONCURRENCY) {
    const entries = [...queue.entries()];
    queue.clear();

    const result = { applied: 0, failed: 0, errors: [] as string[] };
    let next = 0;

    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= entries.length) return;
        const [id, patch] = entries[index];
        try {
          await inner.enrich(id, patch);
          result.applied++;
        } catch (err) {
          result.failed++;
          // Três erros bastam para diagnosticar. Onze mil mensagens iguais
          // afogariam o log e o retorno da função.
          if (result.errors.length < 3) {
            result.errors.push(err instanceof Error ? err.message : String(err));
          }
        }
      }
    };

    const size = Math.max(1, Math.min(concurrency, entries.length));
    await Promise.all(Array.from({ length: size }, worker));
    return result;
  }

  return { store, pending: () => queue.size, flush };
}
