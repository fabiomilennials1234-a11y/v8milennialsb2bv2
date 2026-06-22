import { dispatch, type DispatchContext } from "./dispatch.ts";
import type { JsonRpcRequest, JsonRpcResponse } from "./types.ts";

/**
 * Constant-time secret comparison for the x-mcp-secret gate.
 * Avoids early-exit timing leaks; rejects null / length-mismatch up front.
 */
export function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Handle a JSON-RPC payload (single or batch). Notifications produce no
 * response; a batch of only notifications resolves to null (HTTP 202, no body).
 */
export async function handleRpcPayload(
  payload: JsonRpcRequest | JsonRpcRequest[],
  ctx: DispatchContext,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    const out: JsonRpcResponse[] = [];
    for (const req of payload) {
      const r = await dispatch(req, ctx);
      if (r) out.push(r);
    }
    return out.length ? out : null;
  }
  return await dispatch(payload, ctx);
}
