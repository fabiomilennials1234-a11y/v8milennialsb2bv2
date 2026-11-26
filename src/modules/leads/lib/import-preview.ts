/**
 * Prévia da importação — o lado da tela.
 *
 * Espelha `supabase/functions/import-leads/import-preview.ts`: a edge classifica cada
 * linha num grupo; aqui a pessoa escolhe a ação de cada grupo (e, em dois grupos,
 * de cada linha) e o resultado vira a lista de decisões que vai para a edge. A edge
 * reclassifica antes de gravar: o que esta tela manda é pedido, não ordem.
 */

import { ERP_SITUACAO_NAO_INFORMADA, erpSituacao, type ErpSituacao } from "./erp-situacao";

/** Flag da org (`organizations.feature_flags`) que liga a prévia — hoje só na Café Jurerê. */
export const IMPORT_PREVIEW_FLAG = "importacao_previa";

export type PreviewGroup =
  | "novo"
  | "cliente_erp"
  | "ja_lead"
  | "repetido"
  | "outra_empresa"
  | "sem_telefone"
  | "invalido";

export type RowAction = "criar" | "pular" | "atualizar" | "vincular" | "criar_compartilhado";

export interface PreviewMatch {
  origem: "crm" | "arquivo";
  row?: number;
  lead_id?: string;
  label: string | null;
  erp_code?: string | null;
  /**
   * Situação no ERP, código cru do Toth ("0" ativo, "1" inativo…). `null` = o ERP não
   * informou; ausente = edge antiga ou carteira fora do ar (a tela não diz nada).
   */
  erp_situacao?: string | null;
  visible: boolean;
}

export interface PreviewRow {
  row: number;
  group: PreviewGroup;
  name: string;
  company?: string;
  phone?: string;
  reason?: string;
  match?: PreviewMatch;
}

export interface ImportPreview {
  rows: PreviewRow[];
  counts: Record<PreviewGroup, number>;
}

export interface RowDecision {
  row: number;
  action: RowAction;
}

interface GroupMeta {
  title: string;
  /** O que acontece com o padrão, em uma linha. */
  hint: string;
  /** Ações que valem para o grupo inteiro; a primeira é o padrão. */
  actions: { value: RowAction; label: string }[];
  /** O grupo aceita "criar com telefone compartilhado" linha a linha. */
  sharePerRow: boolean;
  tone: "good" | "info" | "warn" | "neutral" | "bad";
}

/** Ordem em que os grupos aparecem: primeiro o que pede decisão. */
export const GROUP_ORDER: PreviewGroup[] = [
  "cliente_erp",
  "outra_empresa",
  "ja_lead",
  "novo",
  "sem_telefone",
  "repetido",
  "invalido",
];

export const GROUP_META: Record<PreviewGroup, GroupMeta> = {
  novo: {
    title: "Novos",
    hint: "Ninguém na empresa tem esse telefone.",
    actions: [
      { value: "criar", label: "Criar" },
      { value: "pular", label: "Pular" },
    ],
    sharePerRow: false,
    tone: "good",
  },
  cliente_erp: {
    title: "Já são clientes do ERP",
    hint: "O cadastro do ERP nunca é alterado pela planilha.",
    actions: [
      { value: "pular", label: "Pular" },
      { value: "vincular", label: "Aplicar etiquetas" },
    ],
    sharePerRow: true,
    tone: "warn",
  },
  ja_lead: {
    title: "Já são leads",
    hint: "Mesmo telefone e mesmo nome. Só os campos vazios são completados.",
    actions: [
      { value: "atualizar", label: "Completar" },
      { value: "pular", label: "Pular" },
    ],
    sharePerRow: false,
    tone: "info",
  },
  repetido: {
    title: "Repetidos na planilha",
    hint: "Mesma empresa e mesmo telefone de uma linha anterior. Ficam de fora.",
    actions: [{ value: "pular", label: "Pular" }],
    sharePerRow: false,
    tone: "neutral",
  },
  outra_empresa: {
    title: "Telefone de outra empresa",
    hint: "O número já é de outro cadastro. Marque as que são empresas diferentes.",
    actions: [{ value: "pular", label: "Pular" }],
    sharePerRow: true,
    tone: "warn",
  },
  sem_telefone: {
    title: "Sem telefone",
    hint: "Entram como leads incompletos.",
    actions: [
      { value: "criar", label: "Criar" },
      { value: "pular", label: "Pular" },
    ],
    sharePerRow: false,
    tone: "neutral",
  },
  invalido: {
    title: "Com erro",
    hint: "Não entram. Corrija na planilha e importe de novo.",
    actions: [{ value: "pular", label: "Pular" }],
    sharePerRow: false,
    tone: "bad",
  },
};

export interface PreviewChoices {
  /** Ação escolhida para cada grupo. */
  group: Partial<Record<PreviewGroup, RowAction>>;
  /** Linhas marcadas para "criar com telefone compartilhado". */
  shared: Set<number>;
}

export function initialChoices(): PreviewChoices {
  return { group: {}, shared: new Set() };
}

export function groupAction(choices: PreviewChoices, group: PreviewGroup): RowAction {
  return choices.group[group] ?? GROUP_META[group].actions[0].value;
}

/** Decisão de cada linha: a marca de compartilhar vence a ação do grupo. */
export function buildDecisions(rows: PreviewRow[], choices: PreviewChoices): RowDecision[] {
  return rows.map((r) => ({
    row: r.row,
    action:
      GROUP_META[r.group].sharePerRow && choices.shared.has(r.row) ? "criar_compartilhado" : groupAction(choices, r.group),
  }));
}

/** Quantas linhas vão gravar algo (o número do botão de confirmar). */
export function countWrites(decisions: RowDecision[]): number {
  return decisions.filter((d) => d.action !== "pular").length;
}

/** "Mesmo número de Karmel Café (linha 6)" — de quem é o telefone, nas palavras da tela. */
export function matchSentence(row: PreviewRow): string | null {
  const m = row.match;
  if (!m) return null;
  if (m.origem === "arquivo") return `Mesmo número de ${m.label ?? "outra linha"} (linha ${m.row})`;
  if (!m.visible) return "Já cadastrado na empresa";
  if (m.erp_code) return `Cliente do ERP cód ${m.erp_code} — ${m.label ?? "sem nome"}`;
  return `Já cadastrado como ${m.label ?? "sem nome"}`;
}

/** Situação no ERP do cliente que já tem o número; só quando a pessoa enxerga o cadastro. */
export function matchErpSituacao(row: PreviewRow): ErpSituacao | null {
  const m = row.match;
  if (!m || m.origem !== "crm" || !m.visible || !m.erp_code || m.erp_situacao === undefined) return null;
  return erpSituacao(m.erp_situacao) ?? ERP_SITUACAO_NAO_INFORMADA;
}

/**
 * De quem é o número, com a situação no ERP — para o texto corrido (planilha de
 * resultado). A tela mostra a situação num selo ao lado, não na frase.
 */
export function matchDetail(row: PreviewRow): string | null {
  const sentence = matchSentence(row);
  const situacao = matchErpSituacao(row);
  if (!sentence || !situacao) return sentence;
  return situacao.code ? `${sentence} · Situação no ERP: ${situacao.label}` : `${sentence} · Situação no ERP não informada`;
}
