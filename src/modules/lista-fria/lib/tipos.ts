/**
 * Vocabulário da Lista Fria (ADR-0042) e os parsers das linhas do banco.
 *
 * O banco guarda `status`, `etapa` e `qualidade` como texto com CHECK; aqui eles
 * viram união fechada. Valor fora da lista (migration futura, linha antiga) cai
 * num default seguro em vez de quebrar a tela.
 */
import type { Database } from "@/integrations/supabase/types";

export type FonteDaBusca = "maps" | "instagram";
export type StatusDaBusca = "na_fila" | "executando" | "concluida" | "parada" | "falhou" | "cancelada";
export type EtapaDaBusca = "coletando" | "lendo_sites" | "ia" | "validando";
export type QualidadeDoContato = "verificado" | "sem_whatsapp" | "email_invalido" | "nao_verificado";

export const ROTULO_FONTE: Record<FonteDaBusca, string> = {
  maps: "Google Maps",
  instagram: "Instagram",
};

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

export function parseBusca(r: LinhaDaBusca): Busca {
  const fonte: FonteDaBusca = r.fonte === "instagram" ? "instagram" : "maps";
  return {
    id: r.id,
    fonte,
    titulo: fonte === "instagram" ? `@${r.instagram_handle ?? ""}` : `${r.nicho ?? ""} · ${r.cidade ?? ""}`,
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
