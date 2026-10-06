import { recordClientError } from "@/core/observability/client-error-buffer";

export type MediaPhase = "read" | "upload" | "connection";
export const MEDIA_READ_TIMEOUT_MS = 15_000;
export const MEDIA_UPLOAD_TIMEOUT_MS = 60_000;

/** Only phase/reason reach diagnostics: never filename, phone, URL or token. */
export class MediaOperationError extends Error {
  constructor(readonly phase: MediaPhase, readonly reason: "timeout" | "aborted" | "failed" | "unauthorized" | "forbidden") {
    const message = reason === "unauthorized"
      ? "Sua sessão expirou. Entre novamente para enviar o arquivo."
      : reason === "forbidden"
        ? "Você não tem permissão para enviar arquivos nesta organização. Peça ao administrador para revisar seu acesso."
        : phase === "read"
      ? "Não foi possível ler o arquivo. Salve uma cópia no computador e tente novamente."
      : phase === "upload"
        ? "O arquivo não terminou de carregar. Ele continua anexado; tente novamente."
        : "Não foi possível verificar a conexão do WhatsApp. Tente novamente.";
    super(message);
    this.name = `MediaOperation:${phase}:${reason}`;
  }
}

export async function withMediaDeadline<T>(
  phase: MediaPhase,
  work: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs = MEDIA_READ_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new MediaOperationError(phase, "timeout"));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } catch (cause) {
    const error = cause instanceof MediaOperationError ? cause : new MediaOperationError(phase, "failed");
    recordClientError(error, "handled");
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function readMediaAsDataUrl(file: Blob): Promise<string> {
  return withMediaDeadline("read", signal => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    const finish = (error?: MediaOperationError) => {
      signal.removeEventListener("abort", abort);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) reject(error);
      else if (typeof reader.result === "string") resolve(reader.result);
      else reject(new MediaOperationError("read", "failed"));
    };
    reader.onload = () => finish();
    reader.onerror = () => finish(new MediaOperationError("read", "failed"));
    reader.onabort = () => finish(new MediaOperationError("read", "aborted"));
    signal.addEventListener("abort", abort, { once: true });
    try { reader.readAsDataURL(file); }
    catch { finish(new MediaOperationError("read", "failed")); }
  }));
}
