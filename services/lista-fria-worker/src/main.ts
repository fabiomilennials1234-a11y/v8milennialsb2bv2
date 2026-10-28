/**
 * Worker da Lista Fria: pega a próxima busca da fila no banco e a executa.
 *
 *   SUPABASE_URL                 obrigatória
 *   SUPABASE_SERVICE_ROLE_KEY    obrigatória
 *   GOSOM_URL                    padrão http://gosom:8080 (rede interna; sem autenticação)
 *   ANTHROPIC_API_KEY            opcional: liga expansão de busca e filtro de nicho (Haiku)
 *   APIFY_TOKEN                  opcional: liga as buscas de Instagram (sem ele, fecham como indisponíveis)
 *   APIFY_INSTAGRAM_ACTOR        padrão data-slayer~instagram-followers-scraper---no-login
 *   APIFY_PRECO_POR_SEGUIDOR_USD 0.012   (tabela do Actor, modo enriched)
 *   APIFY_MAX_USD_POR_BUSCA      25      (teto de gasto nosso por busca; a Apify aborta ao chegar)
 *   INSTAGRAM_MAX_SEGUIDORES     5000    (contas processadas por busca, no máximo)
 *   INSTAGRAM_CONTAS_POR_CREDITO 8       (rendimento presumido para dimensionar a busca)
 *   WORKER_ID                    padrão <host>-<pid>
 *   POLL_MS, IDLE_MS             5000 / 5000
 *   GOSOM_MAX_TIME_S             3600
 */
import os from "node:os";
import { setTimeout as dormir } from "node:timers/promises";

import { bancoPelaRede } from "./db.ts";
import { abortarExecucao, iniciarExecucao, lerExecucao, lerItens, type ApifyCfg } from "./apify.ts";
import { CFG_PADRAO, executarBusca, executarMaps, type Ambiente, type CfgDoExecutor } from "./executor.ts";
import { ACTOR_PADRAO } from "./instagram.ts";
import { CFG_INSTAGRAM_PADRAO, fonteInstagram, type ApifyApi, type CfgInstagram } from "./fonte-instagram.ts";
import { apagarJob, baixarCsv, criarJob, lerJob, type GosomCfg } from "./gosom.ts";
import { aderentes, expandirBusca, type IaCfg } from "./ia.ts";
import { lerSite } from "./site.ts";
import { mxPelaRede } from "./validar.ts";

const numero = (nome: string, padrao: number): number => {
  const n = Number(process.env[nome]);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(JSON.stringify({ evento: "config_faltando", variavel: nome }));
    process.exit(1);
  }
  return v;
}

const log = (evento: string, dados: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), evento, ...dados }));

async function main() {
  const url = exigir("SUPABASE_URL");
  const chave = exigir("SUPABASE_SERVICE_ROLE_KEY");
  const workerId = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
  const idleMs = Number(process.env.IDLE_MS ?? 5_000);
  const cfg: CfgDoExecutor = {
    ...CFG_PADRAO,
    workerId,
    pollMs: Number(process.env.POLL_MS ?? CFG_PADRAO.pollMs),
    maxTimeMaxS: Number(process.env.GOSOM_MAX_TIME_S ?? CFG_PADRAO.maxTimeMaxS),
  };

  const gosomCfg: GosomCfg = { baseUrl: process.env.GOSOM_URL || "http://gosom:8080" };
  const iaCfg: IaCfg | null = process.env.ANTHROPIC_API_KEY ? { apiKey: process.env.ANTHROPIC_API_KEY } : null;
  const banco = bancoPelaRede({ url, chaveDeServico: chave });

  // Instagram só liga com token da Apify. A Apify aborta a execução ao chegar em maxUsdPorBusca.
  let instagram: { api: ApifyApi; cfg: CfgInstagram } | null = null;
  if (process.env.APIFY_TOKEN) {
    const ac: ApifyCfg = { token: process.env.APIFY_TOKEN };
    instagram = {
      api: {
        iniciar: (actor, input, o) => iniciarExecucao(ac, actor, input, o),
        execucao: (id) => lerExecucao(ac, id),
        itens: (ds, off, lim) => lerItens(ac, ds, off, lim),
        abortar: (id) => abortarExecucao(ac, id),
      },
      cfg: {
        actorId: process.env.APIFY_INSTAGRAM_ACTOR || ACTOR_PADRAO,
        precoPorSeguidorUsd: numero("APIFY_PRECO_POR_SEGUIDOR_USD", CFG_INSTAGRAM_PADRAO.precoPorSeguidorUsd),
        maxUsdPorBusca: numero("APIFY_MAX_USD_POR_BUSCA", CFG_INSTAGRAM_PADRAO.maxUsdPorBusca),
        maxSeguidores: numero("INSTAGRAM_MAX_SEGUIDORES", CFG_INSTAGRAM_PADRAO.maxSeguidores),
        contasPorCredito: numero("INSTAGRAM_CONTAS_POR_CREDITO", CFG_INSTAGRAM_PADRAO.contasPorCredito),
      },
    };
  }
  let parar = false;
  const acordar = new AbortController();
  for (const sinal of ["SIGTERM", "SIGINT"] as const) process.on(sinal, () => {
    log("sinal_recebido", { sinal });
    parar = true;
    acordar.abort();
  });
  // Pausa que o sinal interrompe: o `docker stop` padrão mata em 10 s, e o backoff também é de 10 s.
  const pausa = (ms: number) => dormir(ms, undefined, { signal: acordar.signal }).catch(() => undefined);

  const amb: Ambiente = {
    banco,
    gosom: {
      criar: (j) => criarJob(gosomCfg, j),
      ler: (id) => lerJob(gosomCfg, id),
      csv: (id) => baixarCsv(gosomCfg, id),
      apagar: (id) => apagarJob(gosomCfg, id),
    },
    ia: iaCfg
      ? { expandir: (n, c) => expandirBusca(iaCfg, n, c), aderentes: (n, itens) => aderentes(iaCfg, n, itens) }
      : null,
    site: (u) => lerSite(u),
    mx: mxPelaRede(),
    esperar: (ms) => pausa(ms),
    agora: () => Date.now(),
    abortar: () => parar,
    log,
  };

  log("worker_iniciado", { workerId, gosom: gosomCfg.baseUrl, ia: iaCfg !== null, instagram: instagram !== null, actor: instagram?.cfg.actorId });
  let ultimaLimpeza = 0;
  while (!parar) {
    try {
      if (Date.now() - ultimaLimpeza > 60_000) {
        ultimaLimpeza = Date.now();
        const n = await banco.recuperarTravadas();
        if (n > 0) log("buscas_travadas_fechadas", { n });
      }
      const busca = await banco.reivindicar(workerId);
      if (!busca) {
        await pausa(idleMs);
        continue;
      }
      log("busca_reivindicada", { busca: busca.id, fonte: busca.fonte });
      if (busca.fonte === "maps") {
        await executarMaps(busca, amb, cfg);
      } else if (instagram) {
        await executarBusca(busca, fonteInstagram(busca, instagram.api, instagram.cfg, log), amb, cfg);
      } else {
        // Sem APIFY_TOKEN: fecha e devolve a reserva em vez de segurar a fila.
        await banco.encerrar(busca.id, workerId, "falhou", "instagram_indisponivel");
      }
    } catch (e) {
      // Banco fora do ar ou erro inesperado: espera e tenta de novo, sem derrubar o processo.
      log("loop_falhou", { erro: String(e) });
      await pausa(10_000);
    }
  }
  log("worker_encerrado");
}

main();
