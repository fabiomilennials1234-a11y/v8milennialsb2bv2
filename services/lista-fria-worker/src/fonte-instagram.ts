/**
 * Fonte Instagram: seguidores de uma conta pública, com o contato que cada perfil
 * publica, via Actor da Apify. Plugada no mesmo `executarBusca` do Maps.
 *
 * Custo: o Actor cobra por SEGUIDOR PROCESSADO (modo enriched), não por contato
 * achado. O cliente paga por contato novo e válido. A distância entre as duas
 * contas é o rendimento da conta alvo, que ninguém sabe de antemão. Dois freios
 * limitam o gasto nosso por busca, e o preço do crédito tem de cobrir o pior caso:
 *   - `maxSeguidores`: quantas contas processar, no máximo;
 *   - `maxTotalChargeUsd` na Apify: ela mesma aborta ao chegar nesse valor.
 */
import type { Execucao, EstadoDaExecucao } from "./apify.ts";
import { execucaoTerminou } from "./apify.ts";
import type { BuscaDaFila } from "./db.ts";
import type { Fonte, Leitura, Medicao } from "./executor.ts";
import { clamp } from "./executor.ts";
import { ACTOR_PADRAO, CONTAS_POR_PAGINA, candidatoDoItem } from "./instagram.ts";

export interface ApifyApi {
  iniciar(actorId: string, input: Record<string, unknown>, opcoes: { maxTotalChargeUsd: number; timeoutS: number }): Promise<Execucao>;
  execucao(runId: string): Promise<EstadoDaExecucao | null>;
  itens(datasetId: string, offset: number, limit: number): Promise<Array<Record<string, unknown>>>;
  abortar(runId: string): Promise<void>;
}

export interface CfgInstagram {
  actorId: string;
  /** Preço por seguidor enriquecido (US$). Tabela da Apify no plano FREE em 27/10/2026: 0,012. */
  precoPorSeguidorUsd: number;
  /** Teto de gasto por busca (US$), sempre. */
  maxUsdPorBusca: number;
  /** Teto de contas processadas por busca. */
  maxSeguidores: number;
  /** Quantas contas processar por crédito pedido (rendimento presumido). */
  contasPorCredito: number;
  /**
   * Coletor com login real: o tempo é o ritmo da conta (pausa entre perfis), não a velocidade do
   * provedor. Define o prazo da busca como contas × segundos. Sem isto vale a conta da Apify.
   */
  segundosPorConta?: number;
}

/** Coletor com login real: sem custo em dólar, limitado pelo ritmo e pelas contas. */
export const CFG_INSTAGRAM_SESSAO_PADRAO: Omit<CfgInstagram, "actorId"> = {
  precoPorSeguidorUsd: 0,
  maxUsdPorBusca: 0,
  maxSeguidores: 800,
  contasPorCredito: 8,
  segundosPorConta: 9,
};

export const CFG_INSTAGRAM_PADRAO: Omit<CfgInstagram, "actorId"> = {
  precoPorSeguidorUsd: 0.012,
  maxUsdPorBusca: 25,
  // Teto por busca, alinhado ao máximo do banco (10 a 1.000 créditos Meta, ADR-0047). Em 28/10/2026 o Actor
  // parou em 51 itens pedindo 3 páginas, mas o que se mediu foi o limite configurado e depois o prazo (30/10:
  // TIMED-OUT aos 300 s); que o Actor entregue acima de 50 AINDA NÃO foi provado. Se não entregar, a busca
  // conclui com o que veio e o cliente só paga o varrido.
  maxSeguidores: 1000,
  contasPorCredito: 8,
  // MEDIDO na Apify real em 28/10/2026: 45 itens em 216 s (4,8 s por conta) numa conta, 10 itens em
  // 300 s (30 s por conta) em outra. Prazo curto demais mata a execução no meio (TIMED-OUT) e
  // subestima o rendimento; 12 s por conta é folga para o caso comum, e o freio de gasto
  // (maxTotalChargeUsd) é quem limita o custo, não o relógio.
  // MEDIDO em produção em 30/10/2026: 8 a 10 s por conta (30 itens e 37 itens em 300 s). Com 12 s a busca de 50
  // contas ficava no limite e a Apify a matava (TIMED-OUT) antes do fim; 20 s dá folga. Prazo maior não custa
  // mais: a Apify cobra por resultado entregue, não por tempo.
  segundosPorConta: 20,
};

/**
 * A configuração do Instagram pela Apify a partir do ambiente. Fica aqui (e não no `main`) para o teste cobrir a
 * FIAÇÃO: em 30/10/2026 o `main` montava a configuração sem `segundosPorConta`, o prazo caía no piso de 300 s e
 * toda busca de 50 seguidores era morta no meio, entregando 30 a 37.
 */
export function cfgInstagramDaApify(env: Record<string, string | undefined>): CfgInstagram {
  const numero = (nome: string, padrao: number) => {
    const v = Number(env[nome]);
    return env[nome] !== undefined && env[nome] !== "" && Number.isFinite(v) ? v : padrao;
  };
  return {
    actorId: env.APIFY_INSTAGRAM_ACTOR || ACTOR_PADRAO,
    precoPorSeguidorUsd: numero("APIFY_PRECO_POR_SEGUIDOR_USD", CFG_INSTAGRAM_PADRAO.precoPorSeguidorUsd),
    maxUsdPorBusca: numero("APIFY_MAX_USD_POR_BUSCA", CFG_INSTAGRAM_PADRAO.maxUsdPorBusca),
    maxSeguidores: numero("INSTAGRAM_MAX_SEGUIDORES", CFG_INSTAGRAM_PADRAO.maxSeguidores),
    contasPorCredito: numero("INSTAGRAM_CONTAS_POR_CREDITO", CFG_INSTAGRAM_PADRAO.contasPorCredito),
    segundosPorConta: numero("INSTAGRAM_SEGUNDOS_POR_CONTA", CFG_INSTAGRAM_PADRAO.segundosPorConta ?? 20),
  };
}

const PAGINA_DO_DATASET = 500;

/**
 * Quantos seguidores a busca pode varrer. Por varredura (ADR-0046) o crédito É o seguidor: reserva ×
 * seguidores por crédito. Por contato é só o presumido (créditos × rendimento esperado), sem teto duro.
 */
export function tetoDeSeguidores(busca: Pick<BuscaDaFila, "cobranca" | "creditos_limite" | "seguidores_por_credito">): number {
  return busca.cobranca === "por_varredura" ? busca.creditos_limite * Math.max(1, busca.seguidores_por_credito ?? 1) : Number.POSITIVE_INFINITY;
}

export function planoDaBusca(creditos: number, cfg: CfgInstagram, tetoPorVarredura?: number) {
  // Por varredura o pedido é EXATO (1 crédito = 1 seguidor): pedir uma página inteira a mais seria pagar por
  // seguidores que o cliente não comprou. Por contato é a conta presumida, com piso de uma página.
  const maxItems =
    tetoPorVarredura !== undefined
      ? clamp(tetoPorVarredura, 1, cfg.maxSeguidores)
      : clamp(creditos * cfg.contasPorCredito, CONTAS_POR_PAGINA, cfg.maxSeguidores);
  const maxPages = Math.ceil(maxItems / CONTAS_POR_PAGINA);
  // 15% de folga sobre o preço de tabela (add-ons, arredondamento); nunca acima do teto.
  const maxTotalChargeUsd = Math.min(cfg.maxUsdPorBusca, Number((maxItems * cfg.precoPorSeguidorUsd * 1.15 + 0.01).toFixed(4)));
  const timeoutS = cfg.segundosPorConta
    ? clamp(maxItems * cfg.segundosPorConta, 300, 6 * 3_600)
    : clamp(maxPages * 45, 300, 3_600);
  return { maxItems, maxPages, maxTotalChargeUsd, timeoutS };
}

export function fonteInstagram(
  busca: BuscaDaFila,
  api: ApifyApi,
  cfg: CfgInstagram,
  log: (evento: string, dados?: Record<string, unknown>) => void,
): Fonte {
  let datasetId = "";
  let offset = 0;
  let terminal = false;
  let gastoUsd: number | null = null;
  const teto = tetoDeSeguidores(busca);

  return {
    nicho: null,
    async iniciar() {
      const handle = busca.instagram_handle;
      if (!handle) throw new Error("busca de Instagram sem @");
      const plano = planoDaBusca(busca.creditos_limite, cfg, Number.isFinite(teto) ? teto : undefined);
      const exec = await api.iniciar(
        cfg.actorId,
        { username: handle, mode: "enriched", maxPages: plano.maxPages, maxItems: plano.maxItems },
        { maxTotalChargeUsd: plano.maxTotalChargeUsd, timeoutS: plano.timeoutS },
      );
      datasetId = exec.datasetId;
      log("busca_iniciada", { busca: busca.id, fonte: "instagram", runId: exec.runId, ...plano, limite: busca.creditos_limite });
      return { id: exec.runId, maxTimeS: plano.timeoutS };
    },

    async ler(runId): Promise<Leitura> {
      // Status ANTES dos itens: se a execução já terminou, os itens lidos em seguida são todos.
      const estado = await api.execucao(runId);
      const terminou = estado === null || execucaoTerminou(estado.status);
      gastoUsd = estado?.gastoUsd ?? gastoUsd;
      const linhas = [];
      for (;;) {
        // Por varredura nunca se lê além da reserva: o que passar dela a Apify entregou, mas o cliente não pagou.
        const cabe = Math.min(PAGINA_DO_DATASET, teto - offset);
        if (cabe <= 0) break;
        const itens = await api.itens(datasetId, offset, cabe);
        offset += itens.length;
        for (const item of itens) {
          const c = candidatoDoItem(item);
          if (c) linhas.push(c);
        }
        if (itens.length < cabe) break;
      }
      if (terminou && estado) {
        terminal = true;
        log("apify_encerrada", { busca: busca.id, status: estado.status, gastoUsd: estado.gastoUsd });
      }
      // Reserva toda varrida: acabou, a execução (se ainda roda) é abortada em `encerrar`. Não é falha.
      const noTeto = offset >= teto;
      return {
        linhas,
        terminou: terminou || noTeto,
        falhou: !noTeto && (estado === null || estado.status !== "SUCCEEDED"),
        varridos: offset,
        custoUsd: gastoUsd,
      };
    },

    async medir(runId): Promise<Medicao | null> {
      const estado = await api.execucao(runId);
      gastoUsd = estado?.gastoUsd ?? gastoUsd;
      return { varridos: offset, custoUsd: gastoUsd };
    },

    async encerrar(runId) {
      if (terminal) return;
      try {
        await api.abortar(runId);
      } catch (e) {
        log("apify_abortar_falhou", { busca: busca.id, erro: String(e) });
      }
    },
  };
}
