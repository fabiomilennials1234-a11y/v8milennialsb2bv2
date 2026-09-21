/** Narrow server-side boundary; never instantiate with a browser service key. */
export interface TothPreorderRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

export { TOTH_PREORDER_PILOT_ORG_ID as TOTH_PREORDER_PILOT_ID } from "./contracts.ts";
