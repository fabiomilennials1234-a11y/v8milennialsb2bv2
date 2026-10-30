/**
 * Worker da Lista Fria: pega a próxima busca da fila no banco e a executa.
 *
 *   SUPABASE_URL                 obrigatória
 *   SUPABASE_SERVICE_ROLE_KEY    obrigatória
 *   GOSOM_URL                    padrão http://gosom:8080 (rede interna; sem autenticação)
 *   ANTHROPIC_API_KEY            opcional: liga expansão de busca e filtro de nicho (Haiku)
 *   INSTAGRAM_COLETOR_URL        opcional: liga o Instagram pelo coletor com LOGIN REAL (services/instagram-coletor)
 *   INSTAGRAM_COLETOR_SEGREDO    Bearer do coletor, se ele exigir
 *   APIFY_TOKEN                  opcional: liga o Instagram pela Apify (usado só se não houver coletor)
 *   APIFY_INSTAGRAM_ACTOR        padrão data-slayer~instagram-followers-scraper---no-login
 *   APIFY_PRECO_POR_SEGUIDOR_USD 0.012   (tabela do Actor, modo enriched)
 *   APIFY_MAX_USD_POR_BUSCA      25      (teto de gasto nosso por busca; a Apify aborta ao chegar)
 *   INSTAGRAM_MAX_SEGUIDORES     5000    (contas processadas por busca, no máximo)
 *   INSTAGRAM_CONTAS_POR_CREDITO 8       (rendimento presumido para dimensionar a busca)
 *   LISTA_FRIA_BASE_DIR          padrão /data/base (volume): base enxuta de CNPJ em partes Parquet, baixada do Storage (bucket lista-fria-base)
 *   WORKER_PULSO                 padrão /tmp/worker-vivo: arquivo de saúde (HEALTHCHECK); só é renovado se o banco respondeu há < 2 min
 *   WORKER_ID                    padrão <host>-<pid>
 *   POLL_MS, IDLE_MS             5000 / 5000
 *   GOSOM_MAX_TIME_S             3600
 */
import { writeFileSync } from "node:fs";
import os from "node:os";
import { setTimeout as dormir } from "node:timers/promises";

import { bancoPelaRede } from "./db.ts";
import { comPulso } from "./pulso.ts";
import { abortarExecucao, iniciarExecucao, lerExecucao, lerItens, type ApifyCfg } from "./apify.ts";
import { CFG_PADRAO, executarBusca, executarMaps, type Ambiente, type CfgDoExecutor } from "./executor.ts";
import { coletorApi } from "./coletor-instagram.ts";
import { ACTOR_PADRAO } from "./instagram.ts";
import { CFG_INSTAGRAM_PADRAO, CFG_INSTAGRAM_SESSAO_PADRAO, fonteInstagram, type ApifyApi, type CfgInstagram } from "./fonte-instagram.ts";
import { apagarJob, baixarCsv, criarJob, lerJob, type GosomCfg } from "./gosom.ts";
import { aderentes, expandirBusca, type IaCfg } from "./ia.ts";
import { sincronizarBase, type BaseLocal } from "./base-cnpj.ts";
import type { ConsultaCnpj } from "./fonte-cnpj.ts";
import { CFG_CNPJ_PADRAO, fonteCnpj } from "./fonte-cnpj.ts";
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

const SEIS_HORAS = 6 * 3_600_000;

/** Arquivo que o HEALTHCHECK do container lê (Dockerfile). */
const ARQUIVO_DE_PULSO = process.env.WORKER_PULSO || "/tmp/worker-vivo";
/** Sem contato bem-sucedido com o banco por tanto tempo, o worker se declara doente. */
const PULSO_VALE_MS = 120_000;

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
  const { banco, ultimoContatoMs } = comPulso(bancoPelaRede({ url, chaveDeServico: chave }));
  // Renova o pulso a cada 15 s enquanto o banco responder. Se parar de renovar, o HEALTHCHECK reprova.
  const pulsar = () => {
    if (Date.now() - ultimoContatoMs() < PULSO_VALE_MS) {
      try {
        writeFileSync(ARQUIVO_DE_PULSO, String(Date.now()));
      } catch {
        /* disco sem escrita: o healthcheck reprova e o container reinicia */
      }
    }
  };
  pulsar();
  setInterval(pulsar, 15_000).unref();

  // Instagram: coletor com login real (sem custo em dólar) tem precedência; senão a Apify; senão desligado.
  // Na Apify, ela mesma aborta a execução ao chegar em maxUsdPorBusca.
  let instagram: { api: ApifyApi; cfg: CfgInstagram; provedor: "coletor" | "apify" } | null = null;
  if (process.env.INSTAGRAM_COLETOR_URL) {
    instagram = {
      provedor: "coletor",
      api: coletorApi({ baseUrl: process.env.INSTAGRAM_COLETOR_URL, segredo: process.env.INSTAGRAM_COLETOR_SEGREDO || undefined }),
      cfg: {
        actorId: "coletor",
        ...CFG_INSTAGRAM_SESSAO_PADRAO,
        maxSeguidores: numero("INSTAGRAM_MAX_SEGUIDORES", CFG_INSTAGRAM_SESSAO_PADRAO.maxSeguidores),
        contasPorCredito: numero("INSTAGRAM_CONTAS_POR_CREDITO", CFG_INSTAGRAM_SESSAO_PADRAO.contasPorCredito),
        segundosPorConta: numero("INSTAGRAM_SEGUNDOS_POR_CONTA", CFG_INSTAGRAM_SESSAO_PADRAO.segundosPorConta ?? 9),
      },
    };
  } else if (process.env.APIFY_TOKEN) {
    const ac: ApifyCfg = { token: process.env.APIFY_TOKEN };
    instagram = {
      provedor: "apify",
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
  // Base de CNPJ: sincronizada no boot e, ociosa, a cada 6 h. A consulta (DuckDB) é aberta sob demanda
  // e só é trocada quando o arquivo muda, nunca no meio de uma busca.
  const dirBase = process.env.LISTA_FRIA_BASE_DIR || "/data/base";
  let baseCnpj: BaseLocal | null = null;
  let ultimaSyncBase = 0;
  let consulta: (ConsultaCnpj & { fechar(): void }) | null = null;
  let consultaSha = "";
  const manterBase = async () => {
    ultimaSyncBase = Date.now();
    baseCnpj = (await sincronizarBase({ url, chave, dir: dirBase }, log)) ?? baseCnpj;
  };
  const consultaCnpj = async (): Promise<ConsultaCnpj | null> => {
    if (!baseCnpj) return null;
    if (consultaSha !== baseCnpj.manifesto.sha256) {
      consulta?.fechar();
      const { consultaDuckdb } = await import("./consulta-duckdb.ts");
      consulta = await consultaDuckdb(baseCnpj.arquivos);
      consultaSha = baseCnpj.manifesto.sha256;
    }
    return consulta;
  };

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

  log("worker_iniciado", { workerId, gosom: gosomCfg.baseUrl, ia: iaCfg !== null, instagram: instagram?.provedor ?? null, actor: instagram?.cfg.actorId });
  await manterBase();
  log("base_cnpj", { disponivel: baseCnpj !== null, mes: baseCnpj?.manifesto.mes ?? null, partes: baseCnpj?.arquivos.length ?? 0 });
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
        if (Date.now() - ultimaSyncBase > SEIS_HORAS) await manterBase();
        await pausa(idleMs);
        continue;
      }
      log("busca_reivindicada", { busca: busca.id, fonte: busca.fonte });
      if (busca.fonte === "maps") {
        await executarMaps(busca, amb, cfg);
      } else if (busca.fonte === "cnpj") {
        const c = await consultaCnpj();
        if (c) {
          await executarBusca(busca, fonteCnpj(busca, c, CFG_CNPJ_PADRAO, log), amb, cfg);
        } else {
          // Sem base publicada: fecha e devolve a reserva em vez de segurar a fila.
          await banco.encerrar(busca.id, workerId, "falhou", "base_cnpj_indisponivel");
        }
      } else if (instagram) {
        await executarBusca(busca, fonteInstagram(busca, instagram.api, instagram.cfg, log), amb, cfg);
      } else {
        // Sem coletor nem APIFY_TOKEN: fecha e devolve a reserva em vez de segurar a fila.
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
