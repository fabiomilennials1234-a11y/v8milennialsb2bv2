/**
 * Vocabulário da Lista Fria (ADR-0042) e os parsers das linhas do banco.
 *
 * O banco guarda `status`, `etapa` e `qualidade` como texto com CHECK; aqui eles
 * viram união fechada. Valor fora da lista (migration futura, linha antiga) cai
 * num default seguro em vez de quebrar a tela.
 */
import type { Database, Json } from "@/integrations/supabase/types";

import { resumoDosCnaes } from "./cnae";

export type FonteDaBusca = "maps" | "instagram" | "cnpj";
export type StatusDaBusca = "na_fila" | "executando" | "concluida" | "parada" | "falhou" | "cancelada";
export type EtapaDaBusca = "coletando" | "lendo_sites" | "ia" | "validando";
export type QualidadeDoContato = "verificado" | "sem_whatsapp" | "email_invalido" | "nao_verificado";

export const ROTULO_FONTE: Record<FonteDaBusca, string> = {
  maps: "Google Maps",
  instagram: "Instagram",
  cnpj: "CNPJ por CNAE",
};

/** Saldo a que um crédito pertence. Instagram gasta crédito Meta; Maps e CNPJ, crédito normal (ADR-0044). */
export type TipoDeCredito = "normal" | "meta";

export interface Saldos {
  normal: number;
  meta: number;
}

export const ROTULO_CREDITO: Record<TipoDeCredito, string> = {
  normal: "créditos",
  meta: "créditos Meta",
};

/** ESPELHA `private.lista_fria_tipo_da_fonte` (migration 20271220000000): o banco é quem debita. */
export const tipoDaFonte = (fonte: FonteDaBusca): TipoDeCredito => (fonte === "instagram" ? "meta" : "normal");

/** Lê o jsonb de `lista_fria_saldos` sem confiar nele: o que não for número vira 0. */
export function parseSaldos(j: Json | null | undefined): Saldos {
  const o = j && typeof j === "object" && !Array.isArray(j) ? j : {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { normal: n(o.normal), meta: n(o.meta) };
}

export const ROTULO_STATUS: Record<StatusDaBusca, string> = {
  na_fila: "Na fila",
  executando: "Em andamento",
  concluida: "Concluída",
  parada: "Parada",
  falhou: "Falhou",
  cancelada: "Cancelada",
};

/** As etapas, na ordem em que acontecem — a tela as mostra como trilha. */
export const ETAPAS_DA_BUSCA: ReadonlyArray<{ chave: EtapaDaBusca; rotulo: string }> = [
  { chave: "coletando", rotulo: "Coletando" },
  { chave: "lendo_sites", rotulo: "Lendo os sites" },
  { chave: "ia", rotulo: "IA extraindo contatos" },
  { chave: "validando", rotulo: "Validando" },
];

export const ROTULO_QUALIDADE: Record<QualidadeDoContato, string> = {
  verificado: "Verificado",
  sem_whatsapp: "Sem WhatsApp",
  email_invalido: "E-mail não confere",
  nao_verificado: "Não verificado",
};

/**
 * Instagram ainda não tem adaptador no worker (a fonte e o método de coleta sem
 * login estão por validar, ver ADR-0042). O banco já aceita a busca; a tela só a
 * oferece quando o adaptador existir, para ninguém gastar crédito numa busca que
 * não roda.
 */
export const INSTAGRAM_DISPONIVEL = false;

export const STATUS_ABERTOS: readonly StatusDaBusca[] = ["na_fila", "executando"];

export interface Busca {
  id: string;
  fonte: FonteDaBusca;
  /** "Dentistas · São Paulo - SP" ou "@clinicaodontovida". */
  titulo: string;
  status: StatusDaBusca;
  etapa: EtapaDaBusca | null;
  progresso: number;
  creditosLimite: number;
  creditosUsados: number;
  encontrados: number;
  comTelefone: number;
  comEmail: number;
  jaLeads: number;
  semContato: number;
  importados: number;
  importadaEm: string | null;
  erro: string | null;
  criadaEm: string;
  terminouEm: string | null;
}

export interface Resultado {
  id: string;
  nome: string;
  categoria: string | null;
  telefone: string | null;
  email: string | null;
  site: string | null;
  bairro: string | null;
  qualidade: QualidadeDoContato;
  jaELead: boolean;
  selecionado: boolean;
  importado: boolean;
}

type LinhaDaBusca = Database["public"]["Tables"]["lista_fria_buscas"]["Row"];
type LinhaDoResultado = Database["public"]["Tables"]["lista_fria_resultados"]["Row"];

const STATUS = new Set<string>(Object.keys(ROTULO_STATUS));
const ETAPAS = new Set<string>(ETAPAS_DA_BUSCA.map((e) => e.chave));
const QUALIDADES = new Set<string>(Object.keys(ROTULO_QUALIDADE));

export const CONTATOS_EXIGIDOS = ["qualquer", "email", "telefone", "ambos"] as const;
export type ContatoExigido = (typeof CONTATOS_EXIGIDOS)[number];

export const ROTULO_CONTATO: Record<ContatoExigido, string> = {
  qualquer: "E-mail ou telefone",
  email: "Com e-mail",
  telefone: "Com telefone",
  ambos: "E-mail e telefone",
};

/** Alvo de uma busca de CNPJ, como o banco guarda em `filtros`. */
export interface FiltrosCnpj {
  cnaes: string[];
  uf: string;
  municipio: string | null;
  contato: ContatoExigido;
}

export function parseFiltrosCnpj(j: Json | null): FiltrosCnpj {
  const o = j && typeof j === "object" && !Array.isArray(j) ? j : {};
  const cnaes = Array.isArray(o.cnaes) ? o.cnaes.filter((c): c is string => typeof c === "string") : [];
  const contato = CONTATOS_EXIGIDOS.find((c) => c === o.contato) ?? "qualquer";
  return {
    cnaes,
    uf: typeof o.uf === "string" ? o.uf : "",
    municipio: typeof o.municipio === "string" && o.municipio ? o.municipio : null,
    contato,
  };
}

/** "CNAE 4639-7/01 · São Paulo - SP" ou "3 CNAEs · SP". */
export function tituloDaBuscaCnpj(f: FiltrosCnpj): string {
  const onde = f.municipio ? `${f.municipio} - ${f.uf}` : f.uf;
  return [resumoDosCnaes(f.cnaes), onde].filter(Boolean).join(" · ");
}

export function parseBusca(r: LinhaDaBusca): Busca {
  const fonte: FonteDaBusca = r.fonte === "instagram" ? "instagram" : r.fonte === "cnpj" ? "cnpj" : "maps";
  return {
    id: r.id,
    fonte,
    titulo:
      fonte === "instagram"
        ? `@${r.instagram_handle ?? ""}`
        : fonte === "cnpj"
          ? tituloDaBuscaCnpj(parseFiltrosCnpj(r.filtros))
          : `${r.nicho ?? ""} · ${r.cidade ?? ""}`,
    status: STATUS.has(r.status) ? (r.status as StatusDaBusca) : "falhou",
    etapa: r.etapa && ETAPAS.has(r.etapa) ? (r.etapa as EtapaDaBusca) : null,
    progresso: r.progresso,
    creditosLimite: r.creditos_limite,
    creditosUsados: r.creditos_usados,
    encontrados: r.encontrados,
    comTelefone: r.com_telefone,
    comEmail: r.com_email,
    jaLeads: r.ja_leads,
    semContato: r.sem_contato,
    importados: r.importados,
    importadaEm: r.importada_em,
    erro: r.erro,
    criadaEm: r.created_at,
    terminouEm: r.finished_at,
  };
}

export function parseResultado(r: LinhaDoResultado): Resultado {
  return {
    id: r.id,
    nome: r.nome,
    categoria: r.categoria,
    telefone: r.telefone,
    email: r.email,
    site: r.site,
    bairro: r.bairro,
    qualidade: QUALIDADES.has(r.qualidade) ? (r.qualidade as QualidadeDoContato) : "nao_verificado",
    jaELead: r.ja_e_lead,
    selecionado: r.selecionado,
    importado: r.lead_id !== null,
  };
}

export const buscaEstaAberta = (b: Pick<Busca, "status">) => STATUS_ABERTOS.includes(b.status);

/** Terminou com algo para levar (concluída ou parada no meio). */
export const buscaTemResultado = (b: Pick<Busca, "status">) => b.status === "concluida" || b.status === "parada";

/** Falta importar? Terminou, achou algo novo e ainda não foi tudo para os leads. */
export function buscaPedeRevisao(b: Busca): boolean {
  return buscaTemResultado(b) && b.creditosUsados > 0 && b.importadaEm === null;
}
