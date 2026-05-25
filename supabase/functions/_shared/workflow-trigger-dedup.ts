/**
 * workflow-trigger-dedup — chave determinística para dedup em
 * `workflow_executions.trigger_dedup_key`.
 *
 * Origem: investigação Bertin 2026-05-22. Workflow `c60fd533` rodou 142x
 * para 78 leads únicos — alguns disparam até 7x. Sem janela de dedup,
 * stage_changed em sequência reexecuta workflow.
 *
 * Key = `${triggerType}:${hash(payloadNormalized)}:${windowBucket}`. Hash
 * via send-dedup.hashContent (sha256, 32 hex). Window bucket = floor(now /
 * window) — duas chamadas dentro do mesmo bucket geram a mesma key.
 *
 * Pure function — caller (workflow-trigger.ts) anexa o resultado ao insert.
 * Partial unique index em (workflow_id, lead_id, trigger_dedup_key) garante
 * dedup atômico via ON CONFLICT DO NOTHING.
 */

import { hashContent } from "./send-dedup.ts";

export interface ComputeKeyArgs {
  triggerType: string;
  payload: Record<string, unknown>;
  now: Date;
  windowSeconds: number;
}

/**
 * Stable, sorted JSON serialization so `{a:1,b:2}` and `{b:2,a:1}` hash to
 * the same value.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export async function computeTriggerDedupKey(args: ComputeKeyArgs): Promise<string> {
  const payloadHash = await hashContent(stableStringify(args.payload));
  const bucketSeconds = Math.floor(args.now.getTime() / 1000 / args.windowSeconds);
  return `${args.triggerType}:${payloadHash.slice(0, 16)}:${bucketSeconds}`;
}
