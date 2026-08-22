/**
 * Fila de ação da aba "Próximos passos" do Comando.
 *
 * ⚠ AMOSTRA. A tela é a proposta: Comando deixa de ser painel de contemplação e
 * vira fila de trabalho. Cada faixa aponta o hook/RPC que a alimentaria de
 * verdade — a lista abaixo é o contrato que o wiring precisa devolver.
 */

export type LaneUrgency = "critica" | "alta" | "media";

export interface ActionItem {
  id: string;
  /** Quem/o quê — nome do lead, cliente ou reunião. */
  title: string;
  /** Por que está aqui — o motivo, não o dado. */
  reason: string;
  /** Há quanto tempo espera. */
  age: string;
  owner: string | null;
}

export interface ActionLane {
  id: string;
  label: string;
  /** Uma linha explicando o critério de entrada na faixa. */
  criterion: string;
  urgency: LaneUrgency;
  cta: string;
  /** De onde o dado real viria — some quando o wiring existir. */
  wiring: string;
  items: ActionItem[];
  /** Total real da faixa; `items` é só o topo mostrado. */
  total: number;
}

export const ACTION_LANES: ActionLane[] = [
  {
    id: "sem-resposta",
    label: "Responder agora",
    criterion: "Cliente falou e ninguém respondeu.",
    urgency: "critica",
    cta: "Abrir conversa",
    wiring: "conversation_messages + SLA da org (métrica “Clientes sem resposta”, hoje parcial)",
    total: 7,
    items: [
      { id: "a1", title: "Distribuidora Andrade", reason: "Perguntou prazo de entrega", age: "2h14", owner: "Lucas" },
      { id: "a2", title: "Metalúrgica Vetri", reason: "Pediu proposta revisada", age: "4h02", owner: null },
      { id: "a3", title: "Casa Bertoldo", reason: "Respondeu ao disparo de ontem", age: "6h48", owner: "Ana" },
    ],
  },
  {
    id: "reunioes-hoje",
    label: "Reuniões de hoje",
    criterion: "meeting_events com data para hoje, ainda sem desfecho.",
    urgency: "alta",
    cta: "Confirmar presença",
    wiring: "meeting_events (ADR-0007) — mesma fonte de “Reuniões marcadas”",
    total: 4,
    items: [
      { id: "b1", title: "Sorvfoods · 14:00", reason: "Sem confirmação D-0", age: "em 3h", owner: "Marcelo" },
      { id: "b2", title: "Café Jurerê · 16:30", reason: "Remarcada 1×", age: "em 5h", owner: "Hellayne" },
    ],
  },
  {
    id: "propostas-paradas",
    label: "Propostas paradas",
    criterion: "Na etapa de proposta há mais dias que o dwell médio do funil.",
    urgency: "alta",
    cta: "Fazer follow-up",
    wiring: "medida tempo_medio_etapa + pipeline_entries",
    total: 11,
    items: [
      { id: "c1", title: "Chique Comercial", reason: "9 dias na proposta (média: 4)", age: "9d", owner: "Lucas" },
      { id: "c2", title: "Natu Plast", reason: "7 dias sem interação", age: "7d", owner: "Ana" },
      { id: "c3", title: "Elvéra Cosméticos", reason: "6 dias na proposta", age: "6d", owner: "Marcelo" },
    ],
  },
  {
    id: "sem-dono",
    label: "Sem responsável",
    criterion: "Lead ativo que ninguém assumiu.",
    urgency: "media",
    cta: "Distribuir",
    wiring: "leads.responsible_id IS NULL (métrica “Leads sem responsável”, hoje parcial)",
    total: 18,
    items: [
      { id: "d1", title: "3 leads de Meta Ads", reason: "Entraram na madrugada", age: "9h", owner: null },
      { id: "d2", title: "2 leads de indicação", reason: "Sem rodízio configurado", age: "1d", owner: null },
    ],
  },
  {
    id: "esfriando",
    label: "Esfriando",
    criterion: "Sem movimentação, negócio novo ou mensagem há mais de 14 dias.",
    urgency: "media",
    cta: "Reativar",
    wiring: "métrica “Clientes sem atuação” — hoje só cobre pedido (carteira)",
    total: 26,
    items: [
      { id: "e1", title: "Basic4u", reason: "21 dias sem contato", age: "21d", owner: "Hellayne" },
      { id: "e2", title: "Villa Branca", reason: "17 dias sem contato", age: "17d", owner: "Ana" },
    ],
  },
];

export const URGENCY_META: Record<LaneUrgency, { dot: string; ring: string; label: string }> = {
  critica: { dot: "bg-destructive", ring: "border-destructive/30", label: "Crítico" },
  alta: { dot: "bg-primary", ring: "border-primary/30", label: "Alta" },
  media: { dot: "bg-muted-foreground/50", ring: "border-border", label: "Média" },
};
