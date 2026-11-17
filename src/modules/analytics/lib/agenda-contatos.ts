/**
 * Agenda de contatos do Comando — o marcador de PRÓXIMO PONTO DE CONTATO com o
 * cliente (Café Jurerê). Regras puras, sem React, para a tabela, o resumo e os
 * testes falarem a mesma língua.
 *
 * A situação vem pronta do banco (`get_agenda_contatos`), calculada no fuso da
 * org: o "hoje" de quem abre a tela às 23h em outro fuso não muda a cor.
 */

export type SituacaoAgenda = "atrasada" | "hoje" | "futura";

/** Flag por org (`organizations.feature_flags`). */
export const FLAG_AGENDA_CONTATOS = "comando_agenda_contatos";

export interface AgendaContato {
  id: string;
  lead_id: string;
  lead_name: string | null;
  lead_company: string | null;
  lead_phone: string | null;
  /** Todos os telefones do cliente, principal primeiro (planilha: "Telefones"). */
  lead_phones: string[] | null;
  lead_erp_code: string | null;
  lead_uf: string | null;
  /** Cidade do cadastro do ERP. */
  lead_cidade: string | null;
  /** Representante do cliente no ERP — não é o dono da agenda. */
  erp_representante: string | null;
  owner_id: string;
  owner_name: string | null;
  /** `YYYY-MM-DD`, dia no fuso da org. */
  data_agenda: string;
  observacao: string | null;
  situacao: SituacaoAgenda;
  created_at: string;
}

export interface ResumoAgendaLinha {
  /** `YYYY-MM-DD`; nulo na linha das atrasadas (somadas numa só). */
  dia: string | null;
  situacao: SituacaoAgenda;
  total: number;
}

/**
 * Cor por situação: azul futura, amarelo hoje, vermelho atrasada (pedido da
 * Café). Tokens do design system — `scheduled` é o azul das programadas,
 * `warning` e `destructive` os semânticos — com o par `*-strong` no texto para
 * passar AA nos dois temas.
 */
export const TOM_SITUACAO: Record<SituacaoAgenda, { pill: string; dot: string; label: string }> = {
  futura: { pill: "bg-scheduled/10 text-scheduled-ink ring-1 ring-inset ring-scheduled/25", dot: "bg-scheduled", label: "Futura" },
  hoje: { pill: "bg-warning/15 text-warning-strong ring-1 ring-inset ring-warning/35", dot: "bg-warning", label: "Hoje" },
  atrasada: { pill: "bg-destructive/10 text-destructive-strong ring-1 ring-inset ring-destructive/30", dot: "bg-destructive", label: "Atrasada" },
};

/** Dia `YYYY-MM-DD` como data local (meia-noite), sem o deslize de UTC do `new Date("YYYY-MM-DD")`. */
export function diaLocal(dia: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, (m ?? 1) - 1, d ?? 1);
}

/** `YYYY-MM-DD` de uma data local. */
export function paraDia(data: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`;
}

/** "Hoje" no fuso da org, como `YYYY-MM-DD` — o mesmo dia que o banco usa para a cor. */
export function hojeNoFuso(timezone: string | null | undefined, agora: Date = new Date()): string {
  try {
    return agora.toLocaleDateString("en-CA", { timeZone: timezone || "America/Sao_Paulo" });
  } catch {
    return agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  }
}

/** Diferença em dias de calendário entre `dia` e `hoje` (positivo = futuro). */
export function diasDeDistancia(dia: string, hoje: string): number {
  return Math.round((diaLocal(dia).getTime() - diaLocal(hoje).getTime()) / 86_400_000);
}

const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "12 nov" — a data como a planilha mostra, curta. */
export function dataCurta(dia: string): string {
  const d = diaLocal(dia);
  return `${String(d.getDate()).padStart(2, "0")} ${MES[d.getMonth()]}`;
}

/** "Seg, 12 nov" — só a primeira letra em maiúscula (o mês fica minúsculo). */
export function dataComSemana(dia: string): string {
  const s = `${DIA_SEMANA[diaLocal(dia).getDay()]}, ${dataCurta(dia)}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * O que vai ao lado da data: quanto falta ou quanto passou. É o que faz a
 * vermelha ser lida como "há 3 dias" e não só "09 nov".
 */
export function distanciaRelativa(dia: string, hoje: string): string {
  const n = diasDeDistancia(dia, hoje);
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  if (n === -1) return "ontem";
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}

/** Contadores por cor a partir do resumo do banco. */
export function contarPorSituacao(linhas: ResumoAgendaLinha[]): Record<SituacaoAgenda, number> {
  const c: Record<SituacaoAgenda, number> = { atrasada: 0, hoje: 0, futura: 0 };
  for (const l of linhas) c[l.situacao] += Number(l.total) || 0;
  return c;
}

/**
 * Os próximos `n` dias a partir de hoje (hoje incluso), com o total de cada um
 * — dia sem agenda aparece com zero, para a faixa da semana não pular dia.
 */
export function proximosDias(linhas: ResumoAgendaLinha[], hoje: string, n = 7): Array<{ dia: string; total: number }> {
  const porDia = new Map<string, number>();
  for (const l of linhas) if (l.dia) porDia.set(l.dia, (porDia.get(l.dia) ?? 0) + (Number(l.total) || 0));
  const base = diaLocal(hoje);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const dia = paraDia(d);
    return { dia, total: porDia.get(dia) ?? 0 };
  });
}

/** Filtro da tabela. `dia:YYYY-MM-DD` vem do clique num dia do resumo. */
export type FiltroAgenda = "todas" | SituacaoAgenda | `dia:${string}`;

export function filtrarAgendas(itens: AgendaContato[], filtro: FiltroAgenda): AgendaContato[] {
  if (filtro === "todas") return itens;
  if (filtro.startsWith("dia:")) {
    const dia = filtro.slice(4);
    return itens.filter((i) => i.data_agenda === dia);
  }
  return itens.filter((i) => i.situacao === filtro);
}

/** Termo de busca seguro para `.or()` do PostgREST: vírgula e parêntese quebram o filtro. */
export function termoDeBusca(termo: string): string {
  return termo.replace(/[,()\\%_*]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Busca de cliente na "Nova agenda": só nome, empresa e código do ERP. Telefone
 * fica de fora de propósito (pedido da Café) — número digitado não acha cliente.
 */
export function filtrosDaBuscaCliente(termo: string): string[] {
  const limpo = termoDeBusca(termo);
  return [`name.ilike.%${limpo}%`, `company.ilike.%${limpo}%`, `erp_code.ilike.%${limpo}%`];
}

/** Colunas da busca; cidade, representante e telefones só alimentam o hover. */
export const SELECT_BUSCA_CLIENTE =
  "id, name, company, phone, erp_code, uf, upsell_clients(erp_city, erp_uf, erp_owner_name, updated_at), lead_phones(phone, is_primary, created_at)";

export interface ClienteParaAgenda {
  id: string;
  name: string | null;
  company: string | null;
  erp_code: string | null;
  uf: string | null;
  /** Cidade do cadastro do ERP. */
  cidade: string | null;
  /** Representante do cliente no ERP — não é o dono da agenda. */
  representante: string | null;
  /** Principal primeiro, sem repetição. */
  telefones: string[];
}

type Um<T> = T | T[] | null | undefined;

export interface LinhaBuscaCliente {
  id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  erp_code: string | null;
  uf: string | null;
  upsell_clients?: Um<{ erp_city: string | null; erp_uf: string | null; erp_owner_name: string | null; updated_at: string | null }>;
  lead_phones?: Um<{ phone: string | null; is_primary: boolean | null; created_at: string | null }>;
}

const lista = <T>(v: Um<T>): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const texto = (v: string | null | undefined): string | null => v?.trim() || null;

/**
 * Linha do PostgREST → cliente do modal. Mesmas regras do `get_agenda_contatos`:
 * cidade e representante vêm do cadastro do ERP, UF cai no UF do lead, e os
 * telefones são os de `lead_phones` com o principal primeiro.
 */
export function paraClienteAgenda(l: LinhaBuscaCliente): ClienteParaAgenda {
  const erp = [...lista(l.upsell_clients)].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0];
  const fones = [...lista(l.lead_phones)]
    .sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary) || (a.created_at ?? "").localeCompare(b.created_at ?? ""))
    .map((p) => texto(p.phone));
  const vistos = new Set<string>();
  const telefones = [...fones, texto(l.phone)].filter((p): p is string => {
    if (!p) return false;
    const chave = p.replace(/\D/g, "") || p;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  return {
    id: l.id,
    name: l.name,
    company: l.company,
    erp_code: texto(l.erp_code),
    uf: texto(erp?.erp_uf) ?? texto(l.uf),
    cidade: texto(erp?.erp_city),
    representante: texto(erp?.erp_owner_name),
    telefones,
  };
}
