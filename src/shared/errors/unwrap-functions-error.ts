import type { FunctionsErrorBody } from "./to-app-error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickMessage(body: unknown): string {
  if (typeof body === "string") return body.trim();
  if (!isRecord(body)) return "";
  for (const key of ["error", "message", "msg"] as const) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    // `{ error: { message, code } }`
    if (isRecord(value) && typeof value.message === "string") return value.message.trim();
  }
  return "";
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

  const unwrapped: FunctionsErrorBody = {
    kind: "functions_error_body",
    status,
    message: pickMessage(body),
    code: pickCode(body),
    original: error,
  };
  return unwrapped;
}
