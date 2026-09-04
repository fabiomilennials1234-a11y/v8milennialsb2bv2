/**
 * Vocabulário da classificação Lead · Cliente · Indefinido.
 *
 * Vive em `lib/` porque três consumidores precisam do MESMO vocabulário: o
 * seletor da barra de filtros, o submenu dos três pontos de cada linha, e o
 * filtro que vai ao banco. Espalhar os rótulos por esses três lugares garante
 * que um dia divirjam — e a divergência aparece como "o filtro não acha o que a
 * lista mostra", que é caro de diagnosticar.
 *
 * ⚠️ ESTE VOCABULÁRIO É COMPARTILHADO POR DUAS LEIS, e a fonte da verdade
 * depende da ORGANIZAÇÃO (decisão do CTO em 2026-09-04):
 *
 * - **org COM integração de ERP** — `cliente` significa "tem `erp_code` e a
 *   situação do parceiro está entre as que a org considera ativas", gravado em
 *   `leads.classificacao` pela migration `20270922000000`. `indefinido` só
 *   existe aqui: é o cadastrado cuja situação não está na lista.
 * - **org SEM integração** — `cliente` significa "comprou": venda líquida no
 *   funil OU pedido no ERP, a lei que `lead-relacao-situacao.ts` já usa na
 *   coluna "Relação" e que `primeira_venda_at`/`primeiro_pedido_erp_at`
 *   materializam para o filtro poder rodar no banco.
 *
 * As duas discordam quando ambas existiriam, e está medido: na Café Jurerê,
 * dos 5.442 leads com `classificacao='cliente'`, **exatamente 1** tem venda.
 * Por isso não convivem na mesma tela — quem escolhe é `useOrgUsaLeiDoErp`.
 */

export const LEAD_CLASSIFICACOES = ["lead", "cliente", "indefinido"] as const;

export type LeadClassificacao = (typeof LEAD_CLASSIFICACOES)[number];

export interface LeadClassificacaoConfig {
  label: string;
  /** Frase curta para o submenu — o usuário precisa saber o que está movendo. */
  descricao: string;
  /** Classe de cor do selo na lista. Dark-first, como o resto do produto. */
  badgeClassName: string;
}

export const LEAD_CLASSIFICACAO_CONFIG: Record<
  LeadClassificacao,
  LeadClassificacaoConfig
> = {
  lead: {
    label: "Lead",
    descricao: "Ainda não é cliente — não está cadastrado no ERP.",
    badgeClassName: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  },
  cliente: {
    label: "Cliente",
    descricao: "Cadastrado no ERP com situação ativa.",
    badgeClassName: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  indefinido: {
    label: "Indefinido",
    descricao: "Está no ERP, mas com situação fora do recorte da organização.",
    badgeClassName: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
};

/** Sentinel do seletor: sem recorte por classificação. */
export const CLASSIFICACAO_TODAS = "all";

export function isLeadClassificacao(v: unknown): v is LeadClassificacao {
  return typeof v === "string" && (LEAD_CLASSIFICACOES as readonly string[]).includes(v);
}

/**
 * Rótulo tolerante a lixo.
 *
 * A coluna tem CHECK, então valor fora do enum não deveria existir — mas visão
 * salva antiga, import e a própria evolução do enum passam por aqui. Devolver o
 * valor cru em vez de quebrar mantém a lista renderizável.
 */
export function labelDaClassificacao(v: string | null | undefined): string {
  if (!v) return LEAD_CLASSIFICACAO_CONFIG.lead.label;
  return isLeadClassificacao(v) ? LEAD_CLASSIFICACAO_CONFIG[v].label : v;
}
