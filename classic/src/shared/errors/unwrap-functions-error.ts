import { isHumanPortugueseMessage, type FunctionsErrorBody } from "./to-app-error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * As edge functions não concordam no formato. Metade responde
 * `{ error: "Conflict", message: "Este email já está cadastrado." }` — rótulo
 * HTTP em `error`, frase em `message`; outras põem a frase em `error`. Junta os
 * candidatos e escolhe: frase PT primeiro (é o que a tela mostra), identificador
 * de máquina depois (classifica o código), o primeiro não vazio por último.
 */
function pickMessage(body: unknown): string {
  if (typeof body === "string") return body.trim();
  if (!isRecord(body)) return "";
  const candidates: string[] = [];
  for (const key of ["message", "error", "msg"] as const) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) candidates.push(value.trim());
    // `{ error: { message, code } }`
    if (isRecord(value) && typeof value.message === "string" && value.message.trim()) {
      candidates.push(value.message.trim());
    }
  }
  return (
    candidates.find(isHumanPortugueseMessage) ??
    candidates.find((c) => /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?::.*)?$/.test(c)) ??
    candidates[0] ??
    ""
  );
}

function pickCode(body: unknown): string | null {
  if (!isRecord(body)) return null;
  if (typeof body.code === "string" && body.code.trim()) return body.code.trim();
  if (isRecord(body.error) && typeof body.error.code === "string") return body.error.code.trim();
  return null;
}

/**
 * `functions.invoke` embrulha toda resposta não-2xx num `FunctionsHttpError`
 * cuja mensagem é sempre "Edge Function returned a non-2xx status code"; o
 * motivo real fica no corpo, dentro de `error.context` (uma `Response` ainda
 * não lida). Esta função lê esse corpo uma vez e devolve algo que `toAppError`
 * entende. Qualquer outro erro passa intacto.
 *
 * Nunca lança: corpo já consumido, não-JSON ou ausente degrada para o status.
 */
export async function unwrapFunctionsError(error: unknown): Promise<unknown> {
  if (!isRecord(error) || error.name !== "FunctionsHttpError") return error;

  const context = error.context;
  if (!isRecord(context) || typeof context.status !== "number") return error;
  const status = context.status;

  let body: unknown = null;
  try {
    const response = context as unknown as Response;
    const text = response.bodyUsed ? "" : await response.clone().text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
  } catch {
    // corpo indisponível — o status ainda classifica
  }

  return functionsErrorFromResponse(status, body, error);
}

/**
 * O mesmo, para quem chama a edge function com `fetch` cru em vez de
 * `supabase.functions.invoke` e já leu o corpo:
 *
 * ```ts
 * if (!res.ok) notifyError(functionsErrorFromResponse(res.status, data), { fallback });
 * ```
 */
export function functionsErrorFromResponse(
  status: number,
  body: unknown,
  original: unknown = body,
): FunctionsErrorBody {
  return {
    kind: "functions_error_body",
    status,
    message: pickMessage(body),
    code: pickCode(body),
    original,
  };
}
