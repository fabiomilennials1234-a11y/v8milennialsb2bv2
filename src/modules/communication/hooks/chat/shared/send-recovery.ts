/** One logical send, bounded recovery. Ambiguous delivery is checked, never replayed blindly. */
export const MAX_SEND_RETRIES = 10;
export type SendResponse = { data: Record<string, unknown> | null; error: unknown };
export class SendRetriesExhausted extends Error {
  readonly retryAttempts = MAX_SEND_RETRIES;
  constructor() { super("Falha no envio"); }
}

async function waitForResult<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function sendWithBoundedRecovery(options: {
  send: () => Promise<SendResponse>;
  confirm: () => Promise<SendResponse | null>;
  onRetry: (attempt: number) => void;
  timeoutMs: number;
  retryDelayMs?: number;
}): Promise<SendResponse> {
  const launch = () => options.send().catch(error => ({ data: null, error }));
  let pending = launch();
  let result = await waitForResult(pending, options.timeoutMs);
  const successful = (r: SendResponse | undefined) => {
    const status = (r?.data?.result as { status?: string } | undefined)?.status ?? r?.data?.status;
    return !!r?.data && !r.error && !r.data.error && status !== "failed" && status !== "error";
  };
  const httpStatus = (r: SendResponse | undefined) =>
    (r?.error as { context?: { status?: number } } | null)?.context?.status;
  // These responses reject the request before delivery. Preserve the provider's
  // actionable error and allow a new attempt after the user fixes its cause.
  const rejected = (r: SendResponse | undefined) =>
    [400, 401, 403, 404, 405, 413, 415, 422].includes(httpStatus(r) ?? 0);
  if (successful(result)) return result!;
  if (rejected(result)) return result!;
  for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
    options.onRetry(attempt);
    const confirmed = await waitForResult(options.confirm().catch(() => null), options.retryDelayMs ?? 3000);
    if (confirmed) return confirmed;
    // Only a pre-delivery rate-limit rejection is safe to POST again. A timeout,
    // network error or 5xx can mean the provider already accepted the message.
    const status = httpStatus(result);
    if (status === 429 && attempt < MAX_SEND_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 3000));
      pending = launch();
      result = await waitForResult(pending, options.timeoutMs);
    } else if (result === undefined) {
      result = await waitForResult(pending, options.retryDelayMs ?? 3000);
    } else {
      await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 3000));
    }
    if (successful(result)) return result!;
    if (rejected(result)) return result!;
  }
  const confirmed = await waitForResult(options.confirm().catch(() => null), options.retryDelayMs ?? 3000);
  if (confirmed) return confirmed;
  // All ten attempts were rate limited, so none was accepted for delivery.
  if (httpStatus(result) === 429) return result!;
  throw new SendRetriesExhausted();
}
