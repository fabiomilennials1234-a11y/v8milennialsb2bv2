/**
 * Recusas que o banco da cobrança escreve de propósito.
 *
 * As RPCs levantam `42501` (sessão/flag/permissão), `PT404`, `PT409` e `PT422`
 * com uma frase em português na `message` e um código estável no `DETAIL`. A
 * tela passa a frase para `notifyError(err, { fallback, message })`; o que não
 * é nosso (rede, 500, texto técnico) cai no `fallback`.
 */
import { isHumanPortugueseMessage } from "@/shared/errors";

const CODIGOS_NOSSOS = new Set(["42501", "PT404", "PT409", "PT422"]);

export function recusaDaCobranca(
  error: { code?: string; message?: string } | null | undefined,
): string | undefined {
  if (!error?.code || !CODIGOS_NOSSOS.has(error.code)) return undefined;
  const msg = error.message ?? "";
  return msg && isHumanPortugueseMessage(msg) ? msg : undefined;
}
