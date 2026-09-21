import type { TothPreorderProcessResult } from "./contracts.ts";

export interface TothPreorderWorkerDependencies {
  authorize(request: Request): boolean;
  headers(request: Request): Record<string, string>;
  process(operationId: string): Promise<TothPreorderProcessResult>;
}

/** Authenticated internal worker only. Browser users cannot submit provider observations. */
export function createTothPreorderWorkerHandler(dependencies: TothPreorderWorkerDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = { ...dependencies.headers(request), "Content-Type": "application/json", "Cache-Control": "no-store" };
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (!dependencies.authorize(request)) return json(401, { error: "unauthorized" });
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json(415, { error: "json_required" });
    }

    let body: unknown;
    try {
      // The body only needs one UUID. Bound streamed bodies as well as declared lengths.
      const reader = request.body?.getReader();
      if (!reader) return json(400, { error: "invalid_request" });
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 1024) {
            await reader.cancel();
            return json(413, { error: "request_too_large" });
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return json(400, { error: "invalid_request" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "invalid_request" });
    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).length !== 1 || typeof fields.operation_id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fields.operation_id)) {
      return json(400, { error: "invalid_request" });
    }
    try {
      const result = await dependencies.process(fields.operation_id);
      // Never serialize snapshots, provider payloads, credentials or arbitrary exceptions.
      return json(result.disposition === "blocked" ? 409 : 200, {
        operation_id: result.operation_id,
        disposition: result.disposition,
        ...(result.reason_code ? { reason_code: result.reason_code } : {}),
      });
    } catch {
      return json(503, { error: "toth_preorder_processing_failed" });
    }
  };
}
