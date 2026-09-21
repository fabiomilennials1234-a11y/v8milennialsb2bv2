import { parseTothPreorderOperation, type TothPreorderStore } from "./contracts.ts";
import type { TothPreorderRpcClient } from "./rpc-client.ts";

/** Only service RPCs can mutate operations; all identity/snapshot checks also live in SQL. */
export function createTothPreorderStore(client: TothPreorderRpcClient): TothPreorderStore {
  async function invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const { data, error } = await client.rpc(name, args);
      if (error) throw new Error("toth_preorder_storage_failed");
      return data;
    } catch {
      // Rejected transports may contain request URLs or credential details too.
      throw new Error("toth_preorder_storage_failed");
    }
  }
  async function operationRpc(name: string, args: Record<string, unknown>) {
    const data = await invoke(name, args);
    if (data === null) return null;
    const operation = parseTothPreorderOperation(data);
    if (!operation || operation.id !== args.p_operation_id) {
      throw new Error("toth_preorder_invalid_storage_result");
    }
    return operation;
  }
  const leaseArgs = (id: string, token: string) => ({ p_operation_id: id, p_lease_token: token });
  return {
    claim: (id) => operationRpc("toth_claim_preorder_operation", { p_operation_id: id }),
    mark_sending: (id, token) => operationRpc("toth_mark_preorder_sending", leaseArgs(id, token)),
    record_observation: (id, token, observation) => operationRpc("toth_record_preorder_observation", {
      ...leaseArgs(id, token), p_observation: observation,
    }),
    mark_uncertain: (id, token, code) => operationRpc("toth_mark_preorder_uncertain", {
      ...leaseArgs(id, token), p_error_code: code,
    }),
    block: (id, token, code) => operationRpc("toth_block_preorder_operation", {
      ...leaseArgs(id, token), p_error_code: code,
    }),
    reconcile: (id, token) => operationRpc("toth_reconcile_preorder_operation", leaseArgs(id, token)),
    async release(id, token) {
      await invoke("toth_release_preorder_operation", leaseArgs(id, token));
    },
  };
}
