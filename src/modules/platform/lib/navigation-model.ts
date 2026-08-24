/**
 * Modelo de navegação lateral.
 *
 * Substitui a top bar (`TopNavigation`) e o menu "Mais": as rotas que viviam no
 * overflow passam a morar dentro do Pitstop, junto das abas de configuração.
 *
 * Este arquivo é só dado — sem React, sem hook, sem Supabase. As regras de
 * visibilidade (permissão, plano, outbound, master) moram em
 * `useNavigationModel`, que consome estas tabelas.
 */

import {
  Bot,
  ChartNoAxesCombined,
  Briefcase,
  Gift,
  Heart,
  ShoppingBag,
  Star,
  Target,
  UserCheck,
  CalendarDays,
  Copy,
  DollarSign,
  FileText,
  Flag,
  Fuel,
  Gauge,
  GitBranch,
  Kanban,
  ListChecks,
  MessageSquare,
  Package,
  Send,
  Settings,
  Trash2,
  TrendingUp,
  Trophy,
  Tv,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";

export interface NavNode {
  label: string;
  icon: React.ElementType;
  path: string;
  /** Item só aparece para master. */
  masterOnly?: boolean;
  /** Gate de runtime resolvido pelo hook (ex.: páginas Meta conectadas). */
  gate?: "meta_pages_connected" | "metrics_studio_enabled";
  /** Cor própria do item — só funis customizados usam. */
  color?: string;
  /** Abre um grupo novo dentro da lista de filhos (funis customizados). */
  startsGroup?: boolean;
  children?: NavNode[];
}

/** Ícone por tipo de pipe — usado ao montar os filhos dinâmicos de Funis. */
export const PIPE_ICON_MAP: Record<string, React.ElementType> = {
  whatsapp: MessageSquare,
  confirmacao: CalendarDays,
  propostas: Kanban,
  upsell: TrendingUp,
};

/** Ícones que um funil customizado pode escolher. */
export const CUSTOM_PIPE_ICON_MAP: Record<string, React.ElementType> = {
  kanban: Kanban,
  target: Target,
  users: UserCheck,
  "shopping-bag": ShoppingBag,
  heart: Heart,
  briefcase: Briefcase,
  star: Star,
  zap: Zap,
  gift: Gift,
};

export const PIPE_PATH_MAP: Record<string, string> = {
  whatsapp: "/pipe-whatsapp",
  confirmacao: "/pipe-confirmacao",
  propostas: "/pipe-propostas",
  upsell: "/upsell",
};

/** Filhos de Turbo. Os de Funis são dinâmicos (vêm de `usePipelineDisplayConfig`). */
export const TURBO_CHILDREN: NavNode[] = [
  { label: "Copilot", icon: Bot, path: "/copilot" },
  { label: "Automações", icon: Workflow, path: "/automacoes" },
];

/**
 * As seis portas da lateral.
 *
 * Fechado no estudo de navegação: mesma densidade do concorrente (6 na lateral
 * + 4 no rodapé). Ranking desceu para o Pitstop porque é consulta semanal de
 * gestor, não tela de turno. Disparos fica — é porta canônica (#904).
 *
 * Duas decisões que esta branch NÃO reabre, porque já eram da navegação daqui:
 * Leads é a fonte de verdade do lead e ocupa lugar próprio (o antigo rótulo
 * "Combustível" morreu junto); Carteira deixou de ser módulo e virou dado do
 * lead, então não volta ao primeiro nível.
 */
export const SIDEBAR_PRIMARY: NavNode[] = [
  { label: "Comando", icon: Gauge, path: "/dashboard" },
  // Métricas sai do Pitstop e vira porta de primeiro nível, entre Comando e
  // Chat (decisão CTO 2026-08-24). O Pitstop é "consulta semanal, não diária" —
  // e o Estúdio deixou de ser isso no momento em que passou a ser a tela onde
  // se monta o painel de trabalho.
  //
  // O `gate` viaja junto e continua valendo: `primary` passa por `filterByGate`
  // em `useNavigationModel`, exatamente como o Pitstop passava. Org fora do
  // rollout não vê o item — o clique cairia em tela de "ainda não liberado".
  {
    label: "Métricas",
    icon: ChartNoAxesCombined,
    path: "/metricas",
    gate: "metrics_studio_enabled",
  },
  { label: "Chat", icon: Zap, path: "/chat-whatsapp" },
  { label: "Disparos", icon: Send, path: "/disparos" },
  { label: "Funis", icon: GitBranch, path: "/funis", children: [] },
  { label: "Leads", icon: Fuel, path: "/leads" },
  { label: "Turbo", icon: Zap, path: "/turbo", children: TURBO_CHILDREN },
];

/** Agenda mora no rodapé, no lugar que o calendário ocupa em produtos comparáveis. */
export const SIDEBAR_AGENDA: NavNode = {
  label: "Agenda",
  icon: CalendarDays,
  path: "/agenda",
};

export const SIDEBAR_PITSTOP: NavNode = {
  label: "Pitstop",
  icon: Settings,
  path: "/configuracoes",
};

export interface PitstopGroup {
  id: string;
  title: string;
  hint: string;
  items: NavNode[];
}

/**
 * Conteúdo do Pitstop. Os grupos "Gestão" e "Rotas" são o antigo menu "Mais";
 * "Administração" são os itens que exigiam admin. As abas de configuração
 * continuam vivendo dentro de `/configuracoes` e são linkadas por `?tab=`.
 */
export const PITSTOP_GROUPS: PitstopGroup[] = [
  {
    id: "gestao",
    title: "Gestão",
    hint: "Consulta semanal, não diária",
    items: [
      // Métricas NÃO mora mais aqui — subiu para `SIDEBAR_PRIMARY`, entre
      // Comando e Chat (decisão CTO 2026-08-24). Não devolva o item para cá
      // sem tirá-lo de lá: duplicado, ele aparece nos dois lugares.
      { label: "Ranking", icon: Trophy, path: "/performance" },
      { label: "Comissões", icon: DollarSign, path: "/comissoes" },
      { label: "Revisão", icon: Wrench, path: "/follow-ups" },
    ],
  },
  {
    id: "rotas",
    title: "Rotas",
    hint: "O que vivia no menu “Mais”",
    items: [
      { label: "Checklists", icon: ListChecks, path: "/checklists" },
      { label: "Templates", icon: FileText, path: "/templates" },
      { label: "Duplicatas", icon: Copy, path: "/duplicatas" },
      { label: "Lixeira", icon: Trash2, path: "/lixeira" },
    ],
  },
  {
    id: "admin",
    title: "Administração",
    hint: "Depende de permissão",
    items: [
      { label: "Pilotos", icon: Flag, path: "/equipe" },
      { label: "Produtos", icon: Package, path: "/produtos" },
      { label: "TV Dashboard", icon: Tv, path: "/tv" },
    ],
  },
];

/** Prefixos que ativam o item Funis. */
export const FUNIS_PATHS = [
  "/pipe-whatsapp",
  "/pipe-confirmacao",
  "/pipe-propostas",
  "/funis",
  "/pipe/custom",
] as const;

export const TURBO_PATHS = ["/copilot", "/automacoes"] as const;

/**
 * Membro de org outbound só enxerga este recorte.
 * Herdado da top bar — mesma lista, mesma semântica.
 */
export const OUTBOUND_MEMBER_ALLOWED_PATHS = [
  "/dashboard",
  "/chat",
  "/chat-whatsapp",
  "/pipe-whatsapp",
  "/pipe-confirmacao",
  "/pipe-propostas",
  "/funis",
  "/follow-ups",
] as const;

/**
 * Permissão de view exigida por rota. Ausência da chave = rota liberada.
 * `/disparos` fica de fora de propósito: porta canônica aberta a membro (#904).
 */
export const NAV_VIEW_PERMISSIONS: Record<string, string> = {
  "/campanhas": "campaigns.view",
  "/marketing": "marketing.view",
  "/chat": "whatsapp.view",
  "/chat-whatsapp": "whatsapp.view",
  "/pipe-whatsapp": "pipeline.view",
  "/pipe-confirmacao": "pipeline.view",
  "/pipe-propostas": "pipeline.view",
  "/upsell": "upsell.view",
  "/agenda": "agenda.view",
  "/follow-ups": "followups.view",
  "/leads": "leads.view",
  "/checklists": "checklists.view",
  "/templates": "message_templates.view",
  "/duplicatas": "leads.view",
  "/lixeira": "leads.view",
  "/performance": "performance.view",
  "/comissoes": "commissions.view",
  "/copilot": "copilot.view",
  "/automacoes": "workflows.view",
  "/equipe": "team.view",
  "/produtos": "products.view",
  "/negocios": "deals.view",
  "/configuracoes": "settings.view",
};

/** Largura da lateral, em px. Mesma medida validada no estudo. */
export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_WIDTH_COLLAPSED = 64;
/** Abaixo disto o Pitstop vira overlay em vez de coluna que empurra. */
export const PITSTOP_OVERLAY_BREAKPOINT = 1180;
