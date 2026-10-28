/**
 * Fonte CNPJ: empresas por CNAE/UF/município, lidas da base enxuta da Receita em Parquet
 * (ADR-0043). Plugada no mesmo `executarBusca` das outras fontes: ela só entrega candidatos; MX,
 * deduplicação contra leads, cobrança, limite, parada e prazo são do executor.
 *
 * Custo marginal zero: não há coletor externo. O que limita a busca é o saldo e a base.
 *
 * `ConsultaCnpj` é a fronteira com o arquivo (DuckDB em produção, lista em memória no teste). A
 * leitura anda por cursor de CNPJ (`cnpj > ?`), não por offset: estável mesmo se a base for trocada
 * no meio de uma busca, e sem reler o que já passou.
 */
import type { BuscaDaFila } from "./db.ts";
import type { Candidato, Fonte, Leitura } from "./executor.ts";
import { clamp } from "./executor.ts";

export type ExigeContato = "qualquer" | "email" | "telefone" | "ambos";

export interface FiltrosCnpj {
  /** Prefixos de CNAE (2 a 7 dígitos): "46" pega o grupo todo, "4639701" um código só. */
  cnaes: string[];
  uf: string;
  /** Nome do município, como a pessoa digitou; a consulta normaliza. */
  municipio?: string;
  contato: ExigeContato;
}

/** Uma linha da base. `email` já vem nulo quando é de contador (compartilhado). */
export interface LinhaCnpj {
  cnpj: string;
  razao: string | null;
  fantasia: string | null;
  cnae: string | null;
  cnae_desc: string | null;
  uf: string | null;
  municipio: string | null;
  bairro: string | null;
  endereco: string | null;
  tel: string | null;
  email: string | null;
  porte: string | null;
  celular: boolean | null;
}

export interface ConsultaCnpj {
  /** Próximas `limite` linhas com CNPJ maior que `depois` (ordem crescente de CNPJ). */
  buscar(filtros: FiltrosCnpj, depois: string | null, limite: number): Promise<LinhaCnpj[]>;
}

export interface CfgCnpj {
  /** Linhas por leitura (cada leitura vira um lote para o executor). */
  pagina: number;
  /** Quantas linhas varrer por crédito pedido, no máximo: o rendimento presumido pior. */
  varreduraPorCredito: number;
  /** Segundos por crédito para o prazo da busca (a checagem de MX é o que custa tempo). */
  segundosPorCredito: number;
}

export const CFG_CNPJ_PADRAO: CfgCnpj = {
  pagina: 250,
  varreduraPorCredito: 20,
  segundosPorCredito: 1,
};

const UFS = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);
const CONTATOS: ReadonlySet<string> = new Set(["qualquer", "email", "telefone", "ambos"]);

/**
 * Valida o que veio do banco (jsonb). O banco já recusa o formato errado ao criar a busca, mas o
 * worker não confia: o que vira SQL passa por aqui.
 */
export function filtrosDaBusca(busca: BuscaDaFila): FiltrosCnpj {
  const f = busca.filtros;
  if (!f || typeof f !== "object") throw new Error("busca de CNPJ sem filtros");
  const bruto = Array.isArray(f.cnaes) ? f.cnaes : [];
  const cnaes = [...new Set(bruto.map((c) => String(c).replace(/\D/g, "")).filter((c) => /^\d{2,7}$/.test(c)))];
  if (cnaes.length < 1 || cnaes.length > 20) throw new Error("CNAEs inválidos");
  const uf = String(f.uf ?? "").toUpperCase();
  if (!UFS.has(uf)) throw new Error("UF inválida");
  const contato = String(f.contato ?? "qualquer");
  if (!CONTATOS.has(contato)) throw new Error("contato inválido");
  const municipio = f.municipio ? String(f.municipio).trim().slice(0, 80) : undefined;
  return { cnaes, uf, municipio: municipio || undefined, contato: contato as ExigeContato };
}

/** "São Paulo - SP" / "sao paulo" -> "SAO PAULO", como a base guarda. */
export function municipioNormalizado(m: string): string {
  return m
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*[-/,]\s*[A-Za-z]{2}\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function candidatoDaLinha(l: LinhaCnpj): Candidato | null {
  const titulo = (l.fantasia ?? l.razao ?? "").trim();
  if (!titulo || !l.cnpj) return null;
  const local = [l.bairro, l.municipio && l.uf ? `${l.municipio} - ${l.uf}` : l.municipio].filter(Boolean).join(", ");
  return {
    ref: l.cnpj,
    titulo: titulo.slice(0, 200),
    categoria: l.cnae_desc ?? null,
    endereco: [l.endereco, local].filter(Boolean).join(", ").slice(0, 300) || null,
    bairro: l.bairro,
    telefone: l.tel,
    // A base já anula o e-mail de contador; aqui só o que sobrou.
    site: null,
    emails: l.email ? [l.email] : [],
    situacao: null,
  };
}

export function planoDaBuscaCnpj(creditos: number, cfg: CfgCnpj) {
  return {
    maxLinhas: Math.max(cfg.pagina, creditos * cfg.varreduraPorCredito),
    maxTimeS: clamp(creditos * cfg.segundosPorCredito, 300, 2 * 3_600),
  };
}

export function fonteCnpj(
  busca: BuscaDaFila,
  consulta: ConsultaCnpj,
  cfg: CfgCnpj,
  log: (evento: string, dados?: Record<string, unknown>) => void,
): Fonte {
  const plano = planoDaBuscaCnpj(busca.creditos_limite, cfg);
  let filtros: FiltrosCnpj;
  let cursor: string | null = null;
  let lidas = 0;
  // Dois CNPJs com o mesmo contato são um contato só: a segunda vez não é cobrada de novo.
  const emails = new Set<string>();
  const telefones = new Set<string>();

  return {
    nicho: null,
    async iniciar() {
      filtros = filtrosDaBusca(busca);
      if (filtros.municipio) filtros = { ...filtros, municipio: municipioNormalizado(filtros.municipio) };
      log("busca_iniciada", { busca: busca.id, fonte: "cnpj", ...plano, filtros, limite: busca.creditos_limite });
      return { id: busca.id, maxTimeS: plano.maxTimeS };
    },

    async ler(): Promise<Leitura> {
      const linhas = await consulta.buscar(filtros, cursor, cfg.pagina);
      if (linhas.length > 0) cursor = linhas[linhas.length - 1].cnpj;
      lidas += linhas.length;

      const candidatos: Candidato[] = [];
      for (const l of linhas) {
        const c = candidatoDaLinha(l);
        if (!c) continue;
        const email = c.emails[0]?.toLowerCase();
        const tel = c.telefone?.replace(/\D/g, "");
        if ((email && emails.has(email)) || (tel && telefones.has(tel))) continue;
        if (email) emails.add(email);
        if (tel) telefones.add(tel);
        candidatos.push(c);
      }

      // Acabou a base para esse alvo, ou a varredura passou do que vale gastar.
      const esgotou = linhas.length < cfg.pagina;
      const limite = lidas >= plano.maxLinhas;
      if (esgotou || limite) log("cnpj_varredura_fim", { busca: busca.id, lidas, esgotou, limite });
      return { linhas: candidatos, terminou: esgotou || limite, falhou: false };
    },

    async encerrar() {
      // Nada a parar: não há processo externo.
    },
  };
}
