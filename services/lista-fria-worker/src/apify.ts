/**
 * Cliente mínimo da API da Apify (v2) para rodar um Actor e ler o dataset
 * ENQUANTO ele roda, do mesmo jeito que o worker lê o CSV parcial do gosom.
 *
 * Endpoints usados (documentados em docs.apify.com/api/v2):
 *   POST /v2/acts/{actorId}/runs            inicia (body = input do Actor)
 *   GET  /v2/actor-runs/{runId}             status, datasetId e custo
 *   GET  /v2/datasets/{datasetId}/items     itens, paginado por offset/limit
 *   POST /v2/actor-runs/{runId}/abort       aborta
 *
 * O token vai no header `Authorization: Bearer`, nunca na URL (URL vai para log).
 *
 * `maxTotalChargeUsd` é o freio de custo: nos Actors de cobrança por evento, a
 * Apify para a execução quando o gasto chega nesse valor. É a única defesa contra
 * uma busca grande demais custar mais do que o cliente paga em créditos.
 */

export interface ApifyCfg {
  token: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export type StatusDaExecucao =
  | "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMING-OUT" | "TIMED-OUT" | "ABORTING" | "ABORTED";

const TERMINAIS = new Set<string>(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);
export const execucaoTerminou = (s: string) => TERMINAIS.has(s);

async function chamar(cfg: ApifyCfg, caminho: string, init: RequestInit = {}): Promise<Response> {
  return await (cfg.fetch ?? fetch)(`${(cfg.baseUrl ?? "https://api.apify.com").replace(/\/+$/, "")}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
  });
}

async function json<T>(r: Response, o: string): Promise<T> {
  const texto = await r.text();
  if (!r.ok) throw new Error(`apify ${o} (${r.status}): ${texto.slice(0, 200)}`);
  return JSON.parse(texto) as T;
}

export interface Execucao {
  runId: string;
  datasetId: string;
}

export async function iniciarExecucao(
  cfg: ApifyCfg,
  actorId: string,
  input: Record<string, unknown>,
  opcoes: { maxTotalChargeUsd: number; timeoutS: number },
): Promise<Execucao> {
  const q = new URLSearchParams({
    maxTotalChargeUsd: String(opcoes.maxTotalChargeUsd),
    timeout: String(Math.max(1, Math.floor(opcoes.timeoutS))),
  });
  const r = await chamar(cfg, `/v2/acts/${encodeURIComponent(actorId)}/runs?${q}`, { method: "POST", body: JSON.stringify(input) });
  const d = (await json<{ data?: { id?: string; defaultDatasetId?: string } }>(r, "iniciar")).data;
  if (!d?.id || !d.defaultDatasetId) throw new Error("apify não devolveu o id da execução");
  return { runId: d.id, datasetId: d.defaultDatasetId };
}

export interface EstadoDaExecucao {
  status: StatusDaExecucao | string;
  /** Gasto até agora, em dólares (`usageTotalUsd`). */
  gastoUsd: number | null;
  statusMessage: string | null;
}

export async function lerExecucao(cfg: ApifyCfg, runId: string): Promise<EstadoDaExecucao | null> {
  const r = await chamar(cfg, `/v2/actor-runs/${encodeURIComponent(runId)}`);
  if (r.status === 404) return null;
  const d = (await json<{ data?: { status?: string; usageTotalUsd?: number; statusMessage?: string } }>(r, "ler execução")).data;
  return {
    status: d?.status ?? "FAILED",
    gastoUsd: typeof d?.usageTotalUsd === "number" ? d.usageTotalUsd : null,
    statusMessage: d?.statusMessage ?? null,
  };
}

/** Uma página do dataset a partir de `offset`. Vazia = nada novo ainda. */
export async function lerItens(cfg: ApifyCfg, datasetId: string, offset: number, limit = 500): Promise<Array<Record<string, unknown>>> {
  const q = new URLSearchParams({ offset: String(offset), limit: String(limit), format: "json", clean: "true" });
  const r = await chamar(cfg, `/v2/datasets/${encodeURIComponent(datasetId)}/items?${q}`);
  if (r.status === 404) return [];
  const itens = await json<unknown>(r, "ler itens");
  return Array.isArray(itens) ? (itens as Array<Record<string, unknown>>) : [];
}

export async function abortarExecucao(cfg: ApifyCfg, runId: string): Promise<void> {
  const r = await chamar(cfg, `/v2/actor-runs/${encodeURIComponent(runId)}/abort`, { method: "POST" });
  // 200 abortou; 400/404: já terminou ou não existe — o objetivo (não gastar mais) está cumprido.
  if (!r.ok && r.status !== 400 && r.status !== 404) throw new Error(`apify abortar (${r.status})`);
}
