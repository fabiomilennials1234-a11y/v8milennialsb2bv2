import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { notifyError } from "@/shared/errors";

export interface AcaoOtimista<V, D, S> {
  mutationKey: readonly unknown[];
  /** Ações com o mesmo scope rodam em fila, na ordem em que foram pedidas. */
  scope?: string;
  executar: (v: V) => Promise<D>;
  /** Muda o cache na hora e devolve o snapshot para o rollback. */
  aplicar: (qc: QueryClient, v: V) => S;
  reverter: (qc: QueryClient, snap: S, v: V) => void;
  /**
   * Chaves EXATAS que a ação mexe: canceladas antes de aplicar (um fetch em voo
   * não pode sobrescrever o otimismo) e invalidadas no fim. Nunca a raiz —
   * chave de um segmento é recusada.
   */
  alvos: (v: V) => readonly QueryKey[];
  /** Mensagem humana para o toast de falha (fallback do `notifyError`). */
  mensagemDeErro: (e: unknown, v: V) => string;
  aoConfirmar?: (d: D, v: V) => void;
}

export class AlvoRaizError extends Error {
  constructor() {
    super("useAcaoOtimista: alvo de invalidação é raiz — use a chave exata da tela.");
    this.name = "AlvoRaizError";
  }
}

/**
 * Ação otimista de escopo LOCAL: a tela muda antes da rede, a rede confirma por
 * trás, a falha devolve o que era e diz o porquê.
 *
 *   onMutate  → cancela os alvos em voo, aplica, guarda o snapshot
 *   executar  → só depois do aplicar (o card já está onde o usuário soltou)
 *   onError   → reverte o snapshot + `notifyError` com a mensagem da ação
 *   onSettled → invalida SÓ os alvos, com `exact: true`
 *
 * Retentativa fica com quem chama (padrão `retry: false` do cache de mutação):
 * repetir uma escrita otimista sem saber se a primeira gravou é pior que avisar.
 */
export function useAcaoOtimista<V, D = unknown, S = unknown>(
  c: AcaoOtimista<V, D, S>,
): UseMutationResult<D, unknown, V, { snap: S }> {
  const qc = useQueryClient();

  return useMutation<D, unknown, V, { snap: S }>({
    mutationKey: c.mutationKey,
    scope: c.scope ? { id: c.scope } : undefined,
    onMutate: async (v) => {
      const alvos = c.alvos(v);
      if (alvos.some((k) => k.length < 2)) throw new AlvoRaizError();
      await Promise.all(alvos.map((queryKey) => qc.cancelQueries({ queryKey, exact: true })));
      return { snap: c.aplicar(qc, v) };
    },
    mutationFn: (v) => c.executar(v),
    onError: (e, v, ctx) => {
      if (ctx) c.reverter(qc, ctx.snap, v);
      notifyError(e, { fallback: c.mensagemDeErro(e, v) });
    },
    onSuccess: (d, v) => c.aoConfirmar?.(d, v),
    onSettled: (_d, _e, v) => {
      let alvos: readonly QueryKey[];
      try {
        alvos = c.alvos(v);
      } catch {
        return;
      }
      for (const queryKey of alvos) {
        if (queryKey.length < 2) continue;
        void qc.invalidateQueries({ queryKey, exact: true });
      }
    },
  });
}
