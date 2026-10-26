import { verifyMetaSignedRequest, metaPrivacyReceipt } from "./meta-signed-request.ts";

export type PrivacyKind = "deletion" | "deauthorization";
export interface MetaPrivacyStore {
  enqueue(input: { app_id: string; meta_user_id: string; kind: PrivacyKind; confirmation_code: string }): Promise<void>;
  status(code: string, appId: string): Promise<string | null>;
}

/** The queue is an intake, not a claim of completed erasure. Fulfilment is an audited operator task. */
export function createMetaPrivacyHandler(options: {
  kind: PrivacyKind;
  appId: string;
  secret: string;
  callbackUrl: string;
  store: MetaPrivacyStore;
}) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
  const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
  return async (req: Request): Promise<Response> => {
    if (!options.appId || !options.secret) return json(503, { error: "not_configured" });
    if (req.method === "GET" && options.kind === "deletion") {
      const code = new URL(req.url).searchParams.get("code") ?? "";
      if (!/^[a-f0-9]{64}$/.test(code)) return json(400, { error: "invalid_confirmation_code" });
      try {
        const status = await options.store.status(code, options.appId);
        return status ? json(200, { status }) : json(404, { error: "not_found" });
      } catch { return json(503, { error: "temporarily_unavailable" }); }
    }
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: options.kind === "deletion" ? "GET, POST" : "POST" } });
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") return json(415, { error: "unsupported_media_type" });
    // Bound actual bytes even if Content-Length is missing or dishonest.
    const reader = req.body?.getReader();
    if (!reader) return json(400, { error: "missing_body" });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 20_000) { await reader.cancel(); return json(413, { error: "body_too_large" }); }
        chunks.push(value);
      }
    } catch { return json(400, { error: "invalid_body" }); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const fields = new URLSearchParams(new TextDecoder().decode(bytes));
    if (fields.getAll("signed_request").length !== 1) return json(400, { error: "invalid_body" });
    const userId = await verifyMetaSignedRequest(fields.get("signed_request") ?? "", options.secret);
    if (!userId) return json(401, { error: "invalid_signature" });
    const code = await metaPrivacyReceipt(options.secret, options.appId, userId, options.kind, fields.get("signed_request")!);
    try {
      await options.store.enqueue({ app_id: options.appId, meta_user_id: userId, kind: options.kind, confirmation_code: code });
    } catch { return json(503, { error: "temporarily_unavailable" }); }
    if (options.kind === "deauthorization") return json(200, { received: true });
    const url = new URL(options.callbackUrl);
    url.search = new URLSearchParams({ code }).toString();
    return json(200, { url: url.toString(), confirmation_code: code });
  };
}
