/**
 * As RPCs `lista_fria_worker_*` do banco (migration 20271217000000) pelo
 * PostgREST, com a chave de serviço. É o único acesso do worker ao banco.
 */

export interface BuscaDaFila {
  id: string;
  organization_id: string;
  fonte: "maps" | "instagram" | "cnpj";
  nicho: string | null;
  cidade: string | null;
  instagram_handle: string | null;
  /** Alvo da busca de CNPJ (jsonb): { cnaes, uf, municipio?, contato }. Nulo nas outras fontes. */
  filtros?: Record<string, unknown> | null;
  creditos_limite: number;
  creditos_usados: number;
  /**
   * Como a busca é cobrada (ADR-0046). `por_varredura`: 1 crédito por seguidor varrido, o contato achado não
   * gasta. Ausente ou `por_contato`: 1 crédito por contato novo (Maps, CNPJ e buscas antigas).
   */
  cobranca?: "por_contato" | "por_varredura";
  /** Seguidores por crédito, gravado na criação da busca. */
  seguidores_por_credito?: number;
}

export interface ItemParaRegistrar {
  ref_externa: string;
  nome: string;
  categoria?: string | null;
  telefone?: string | null;
  email?: string | null;
  site?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  instagram?: string | null;
  qualidade?: string;
}

export interface ResultadoDoRegistro {
  aceitos: number;
  ja_eram_leads?: number;
  limite_atingido: boolean;
  ativa: boolean;
}

/** Resposta de `lista_fria_worker_varrer`. */
export interface ResultadoDaVarredura {
  ativa: boolean;
  /** A busca é cobrada por varredura (senão a RPC só audita). */
  cobrando: boolean;
  creditos_usados: number;
  /** O débito chegou à reserva: não há mais o que varrer nesta busca. */
  limite_atingido: boolean;
}

export interface Progresso {
  etapa: "coletando" | "lendo_sites" | "ia" | "validando";
  progresso: number;
  encontrados: number;
  comTelefone: number;
  comEmail: number;
  semContato: number;
}

/** O que o executor precisa do banco; o teste troca por uma versão em memória ou por PGlite. */
export interface Banco {
  reivindicar(worker: string): Promise<BuscaDaFila | null>;
  /** Devolve o status da busca: `executando`, `parada`, `cancelada`… */
  progresso(busca: string, worker: string, p: Progresso): Promise<string>;
  registrar(busca: string, worker: string, itens: ItemParaRegistrar[]): Promise<ResultadoDoRegistro>;
  encerrar(busca: string, worker: string, status: "concluida" | "parada" | "falhou", erro?: string): Promise<void>;
  /**
   * Informa o total CUMULATIVO de seguidores varridos e o custo real do coletor (US$). O banco debita até a
   * reserva (ADR-0046). `null` = o banco ainda não tem a RPC (worker implantado antes da migration): segue sem
   * cobrança por varredura.
   */
  varrer(busca: string, worker: string, varridos: number, custoUsd: number | null): Promise<ResultadoDaVarredura | null>;
  recuperarTravadas(): Promise<number>;
}

export function bancoPelaRede(cfg: { url: string; chaveDeServico: string; fetch?: typeof fetch }): Banco {
  const base = `${cfg.url.replace(/\/+$/, "")}/rest/v1/rpc`;
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const r = await (cfg.fetch ?? fetch)(`${base}/${fn}`, {
      method: "POST",
      headers: {
        apikey: cfg.chaveDeServico,
        Authorization: `Bearer ${cfg.chaveDeServico}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`rpc ${fn} (${r.status}): ${texto.slice(0, 300)}`);
    return (texto === "" ? null : JSON.parse(texto)) as T;
  }

  return {
    async reivindicar(worker) {
      const linhas = await rpc<BuscaDaFila[] | BuscaDaFila | null>("lista_fria_worker_reivindicar", { p_worker: worker });
      const b = Array.isArray(linhas) ? linhas[0] : linhas;
      return b && b.id ? b : null;
    },
    progresso: (busca, worker, p) =>
      rpc<string>("lista_fria_worker_progresso", {
        p_busca: busca,
        p_worker: worker,
        p_etapa: p.etapa,
        p_progresso: Math.round(p.progresso),
        p_encontrados: p.encontrados,
        p_com_telefone: p.comTelefone,
        p_com_email: p.comEmail,
        p_sem_contato: p.semContato,
      }),
    registrar: (busca, worker, itens) =>
      rpc<ResultadoDoRegistro>("lista_fria_worker_registrar", { p_busca: busca, p_worker: worker, p_itens: itens }),
    async encerrar(busca, worker, status, erro) {
      await rpc("lista_fria_worker_encerrar", { p_busca: busca, p_worker: worker, p_status: status, p_erro: erro ?? null });
    },
    async varrer(busca, worker, varridos, custoUsd) {
      try {
        return await rpc<ResultadoDaVarredura>("lista_fria_worker_varrer", {
          p_busca: busca,
          p_worker: worker,
          p_varridos: Math.max(0, Math.trunc(varridos)),
          p_custo_usd: custoUsd,
        });
      } catch (e) {
        // Worker novo com banco antigo: a função ainda não existe (PostgREST 404 / PGRST202). Qualquer outro
        // erro é real e sobe.
        if (/\(404\)|PGRST202/.test(String(e))) return null;
        throw e;
      }
    },
    recuperarTravadas: () => rpc<number>("lista_fria_worker_recuperar_travadas", {}),
  };
}
