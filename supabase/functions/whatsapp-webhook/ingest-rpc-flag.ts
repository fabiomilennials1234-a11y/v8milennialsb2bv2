/**
 * Rollout por org das RPCs `ingest_uazapi_message` / `apply_uazapi_receipt`
 * (migration 20271201000000). Env `UAZAPI_INGEST_RPC_ORGS`: csv de org_ids ou
 * `*`. Vazio/ausente (default) = caminho antigo, idêntico ao anterior.
 * Mesmo formato de COPILOT_QUEUE_ENABLED_ORGS. Sem runtime Deno (módulo
 * importado por testes/serviço Node) = desligado, nunca exceção.
 */
export function uazapiIngestRpcEnabled(organizationId: string): boolean {
  const env = (globalThis as { Deno?: { env?: { get?: (key: string) => string | undefined } } }).Deno?.env;
  const orgs = (env?.get?.("UAZAPI_INGEST_RPC_ORGS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return orgs.includes("*") || orgs.includes(organizationId);
}
