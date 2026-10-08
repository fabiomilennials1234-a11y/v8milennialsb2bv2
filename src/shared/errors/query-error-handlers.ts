import { MutationCache, QueryCache, type QueryKey } from "@tanstack/react-query";
import { notifyError } from "./notify";
import { reportError } from "./report";
import { toAppError } from "./to-app-error";

/**
 * Tratamento global de erro do React Query (ADR-0038, S3).
 *
 * **Só relata; não mostra toast por conta própria.** A tela continua dona do que
 * o usuário vê: query com erro já mostra o estado inline, e mutation com erro é
 * tratada no `onError` ou no `catch` de quem chamou. Um toast global aqui daria
 * toast duplo — no TanStack v5, `mutate(vars, { onError })` e `try/catch` em
 * volta de `mutateAsync` não aparecem em `mutation.options`, então não há como
 * saber daqui se alguém mais vai tratar.
 *
 * O que muda é que **nenhum erro some**: mesmo a mutation sem tratamento, que
 * antes falhava em silêncio, passa a deixar rastro. Como o `MutationCache` roda
 * antes do `onError` local, o relatório sai daqui e o `notifyError` da tela
 * reaproveita a mesma referência sem relatar de novo.
 *
 * Toast global é opt-in, por `meta`:
 *
 * ```ts
 * useQuery({ queryKey: ["leads", orgId], queryFn, meta: { errorToast: "Não foi possível carregar os leads." } });
 * useMutation({ mutationFn, meta: { errorMessage: "Não foi possível mover o card." } });
 * ```
 *
 * Use o `meta` só onde **não** há tratamento local, senão o toast sai duas vezes.
 */

/** Primeiro segmento da chave, se for um nome seguro ("leads", "pipeline_entries"). */
function safeKeyName(key: QueryKey | undefined): string {
  const head = key?.[0];
  return typeof head === "string" && /^[\w:.-]{1,60}$/.test(head) ? head : "anonymous";
}

function metaString(meta: Record<string, unknown> | undefined, field: string): string | null {
  const value = meta?.[field];
  return typeof value === "string" && value.trim() ? value : null;
}

const QUERY_FALLBACK = "Não foi possível carregar os dados.";
const MUTATION_FALLBACK = "Não foi possível concluir a ação.";

export function createQueryErrorHandlers(): { queryCache: QueryCache; mutationCache: MutationCache } {
  const queryCache = new QueryCache({
    onError: (error, query) => {
      const context = { source: "query", query: safeKeyName(query.queryKey) };
      const toastMessage = metaString(query.meta, "errorToast");
      if (toastMessage) {
        notifyError(error, { fallback: toastMessage, context });
        return;
      }
      reportError(toAppError(error, QUERY_FALLBACK), context);
    },
  });

  const mutationCache = new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const context = { source: "mutation", mutation: safeKeyName(mutation.options.mutationKey) };
      const toastMessage = metaString(mutation.meta, "errorMessage");
      if (toastMessage) {
        notifyError(error, { fallback: toastMessage, context });
        return;
      }
      reportError(toAppError(error, MUTATION_FALLBACK), context);
    },
  });

  return { queryCache, mutationCache };
}
