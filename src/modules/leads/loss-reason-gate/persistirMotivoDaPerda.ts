import { patchEntryMetadata } from "@/integrations/supabase/entry-metadata";
import { patchDaPerda, type PerdaResolvida } from "@/contracts/pipe/perda";

/** Escritas simultâneas no lote — cada uma é um read-modify-write (2 idas). */
const LOTE = 5;

/**
 * Grava o motivo (id do catálogo + rótulo snapshotado) no `metadata` de cada
 * entrada — a MESMA escrita que o `/funil` faz antes do move (ADR-0017 §2:
 * o rótulo é snapshot, o catálogo é editável).
 *
 * Lança na primeira falha: quem chama não move. Num lote, as entradas que já
 * receberam o motivo ficam com ele — inofensivo (negócio aberto com motivo
 * anotado) e é a mesma propriedade do `/funil`, que também grava antes.
 */
export async function persistirMotivoDaPerda(
  entryIds: readonly string[],
  perda: PerdaResolvida,
): Promise<void> {
  const patch = patchDaPerda(perda);
  if (Object.keys(patch).length === 0) return;
  const ids = [...new Set(entryIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += LOTE) {
    await Promise.all(ids.slice(i, i + LOTE).map((id) => patchEntryMetadata(id, patch)));
  }
}
