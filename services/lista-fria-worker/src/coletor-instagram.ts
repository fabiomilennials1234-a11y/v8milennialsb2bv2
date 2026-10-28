/**
 * Cliente do `instagram-coletor` (serviço Python com login real). Implementa a MESMA
 * interface que a Apify (`ApifyApi`), então a fonte do Instagram não sabe de onde vêm os
 * perfis: só muda quem coleta.
 *
 *   POST /v1/jobs                  {handle, max_seguidores} -> 201 {id}
 *   GET  /v1/jobs/{id}                                      -> {status, mensagem, total}
 *   GET  /v1/jobs/{id}/itens?offset&limit                   -> [item]
 *   POST /v1/jobs/{id}/abort
 *
 * `status` usa os nomes da Apify (RUNNING, SUCCEEDED, FAILED, ABORTED). Os itens têm os
 * mesmos campos do Actor (`instagram.ts` lê os dois). Job e itens ficam na memória do
 * coletor: reinício dele = 404 aqui, e o worker conclui a busca com o que já ingeriu.
 */
import type { EstadoDaExecucao, Execucao } from "./apify.ts";
import type { ApifyApi } from "./fonte-instagram.ts";

export interface ColetorCfg {
  baseUrl: string;
  segredo?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

async function chamar(cfg: ColetorCfg, caminho: string, init: RequestInit = {}): Promise<Response> {
  return await (cfg.fetch ?? fetch)(`${cfg.baseUrl.replace(/\/+$/, "")}${caminho}`, {
    ...init,
    headers: {
      ...(cfg.segredo ? { Authorization: `Bearer ${cfg.segredo}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
  });
}

export function coletorApi(cfg: ColetorCfg): ApifyApi {
  return {
    async iniciar(_actorId, input): Promise<Execucao> {
      const r = await chamar(cfg, "/v1/jobs", {
        method: "POST",
        body: JSON.stringify({ handle: input.username, max_seguidores: input.maxItems }),
      });
      const texto = await r.text();
      if (r.status !== 201) throw new Error(`coletor recusou o job (${r.status}): ${texto.slice(0, 200)}`);
      const id = (JSON.parse(texto) as { id?: unknown }).id;
      if (typeof id !== "string" || !id) throw new Error("coletor não devolveu o id do job");
      // O dataset é o próprio job: itens e status moram na mesma chave.
      return { runId: id, datasetId: id };
    },

    async execucao(runId): Promise<EstadoDaExecucao | null> {
      const r = await chamar(cfg, `/v1/jobs/${encodeURIComponent(runId)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`coletor: ler job falhou (${r.status})`);
      const j = (await r.json()) as { status?: unknown; mensagem?: unknown };
      return {
        status: typeof j.status === "string" ? j.status : "FAILED",
        gastoUsd: null,
        statusMessage: typeof j.mensagem === "string" ? j.mensagem : null,
      };
    },

    async itens(datasetId, offset, limit) {
      const q = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      const r = await chamar(cfg, `/v1/jobs/${encodeURIComponent(datasetId)}/itens?${q}`);
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`coletor: ler itens falhou (${r.status})`);
      const itens = await r.json();
      return Array.isArray(itens) ? (itens as Array<Record<string, unknown>>) : [];
    },

    async abortar(runId) {
      const r = await chamar(cfg, `/v1/jobs/${encodeURIComponent(runId)}/abort`, { method: "POST" });
      if (!r.ok && r.status !== 404) throw new Error(`coletor: abortar falhou (${r.status})`);
    },
  };
}
