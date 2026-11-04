/**
 * Recusas que o banco da Lista Fria escreve de propósito (ver `lista_fria_*`
 * na migration 20271217000000): `42501` (sessão, flag, permissão), `PT404` e
 * `PT422` com frase em português na `message`. O que não é nosso (rede, 500)
 * cai no `fallback` do `notifyError`.
 */
import { isHumanPortugueseMessage } from "@/shared/errors";

const CODIGOS_NOSSOS = new Set(["42501", "PT404", "PT422"]);

export function recusaDaListaFria(
  error: { code?: string; message?: string } | null | undefined,
): string | undefined {
  if (!error?.code || !CODIGOS_NOSSOS.has(error.code)) return undefined;
  const msg = error.message ?? "";
  return msg && isHumanPortugueseMessage(msg) ? msg : undefined;
}
