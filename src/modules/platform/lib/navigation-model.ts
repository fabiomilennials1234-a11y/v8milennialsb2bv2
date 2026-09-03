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
  CalendarDays,
  Copy,
  DollarSign,
  FileText,
  Flag,
  Fuel,
  Gauge,
  GitBranch,
  ListChecks,
  MoreHorizontal,
  Package,
  Send,
  Settings,
  Trash2,
  Trophy,
  Tv,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";

import {
  SETTINGS_OTHERS_LABEL,
  SETTINGS_OTHERS_PATH,
  SETTINGS_TAB_PATHS,
  settingsTabPath,
  visibleOtherSettingsTabs,
  visiblePrimarySettingsTabs,
  type SettingsTabVisibility,
} from "./settings-tabs";

export interface NavNode {
  label: string;
  icon: React.ElementType;
  path: string;
  /** Item só aparece para master. */
  masterOnly?: boolean;
  /** Gate de runtime resolvido pelo hook (ex.: páginas Meta conectadas). */
  gate?: "meta_pages_connected" | "metrics_studio_enabled";
  /** Cor própria do item. Nenhum item usa hoje — funil não tem mais classe. */
  color?: string;
  /**
   * Pai que é só rótulo de grupo: o clique expande e NÃO navega.
   *
   * Funis tem tela-índice (`/funis`), então navega e expande no mesmo clique.
   * Turbo não tem: `/turbo` é um `<Navigate>` nu em `App.tsx`, fora do
   * `LayoutWrapper`. Navegar pra lá desmontava a árvore do layout inteira e o
   * `useState` da lateral voltava a `{}` — o submenu fechava no mesmo frame em
   * que abria, e o item "Copilot" era inalcançável no desktop.
   */
  expandOnly?: boolean;
  children?: NavNode[];
}

// `FUNIL_ICON` (ícone fixo para todo funil) morreu na SCRUM-637: a lateral
// resolve por `funilIcon(pipelines.icon)` — a identidade que o USUÁRIO deu ao
// funil, igual para os de fábrica e os criados por ele.

/**
 * SCRUM-637 (flip): o `PIPE_PATH_MAP` morreu — TODO funil navega pela rota
 * única `/funil/:slug`. Só a Carteira mantém rota própria (não é funil de
 * negócio — D6/ADR-0034).
 */
export const CARTEIRA_PATH = "/upsell";

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
  { label: "Turbo", icon: Zap, path: "/turbo", children: TURBO_CHILDREN, expandOnly: true },
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
 * "Administração" são os itens que exigiam admin. O grupo "Configurações" é
 * montado à parte (`buildSettingsGroup`) porque depende de admin e do tipo da
 * org, que só o hook conhece.
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

export const SETTINGS_GROUP_ID = "configuracoes";

/**
 * Grupo "Configurações" do Pitstop — Tags, Notificações e WhatsApp com rota
 * própria, e "Outros" para todo o resto.
 *
 * É a correção do buraco que fechava a tela: no desktop o gatilho do Pitstop só
 * abre o painel (não navega), então sem estes itens `/configuracoes` não tinha
 * nenhum caminho de UI — só URL digitada na mão. O corte em três é deliberado:
 * o painel é lateral e estreito, e listar as treze abas aqui trocaria um menu
 * inacessível por um menu ilegível.
 */
export function buildSettingsGroup(visibility: SettingsTabVisibility): PitstopGroup {
  const items: NavNode[] = visiblePrimarySettingsTabs(visibility).map((tab) => ({
    label: tab.label,
    icon: tab.icon,
    path: settingsTabPath(tab),
  }));

  // "Outros" só entra se sobrou alguma coisa para ele guardar.
  if (visibleOtherSettingsTabs(visibility).length > 0) {
    items.push({ label: SETTINGS_OTHERS_LABEL, icon: MoreHorizontal, path: SETTINGS_OTHERS_PATH });
  }

  return {
    id: SETTINGS_GROUP_ID,
    title: "Configurações",
    hint: "Ajustes da operação",
    items,
  };
}

/**
 * Prefixos que ativam o item Funis.
 *
 * `/funil` é o prefixo canônico da rota única (SCRUM-632); os demais são
 * compat do expand-contract — `/pipe-*` cai na SCRUM-637 e `/pipe/custom`
 * hoje é só redirect. NÃO cresce além disso.
 */
export const FUNIS_PATHS = [
  "/funil",
  "/funis",
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
  // SCRUM-637: os pipes de sistema vivem em `/funil/:slug` — entrada por
  // PREFIXO (ver `isOutboundAllowed`), cobrindo qualquer funil visível.
  "/funil",
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
  // SCRUM-637: `/funil` cobre `/funil/:slug` por prefixo (ver makeCanViewRoute)
  // — mesma permissão que os /pipe-* levavam, agora pra QUALQUER funil.
  "/funil": "pipeline.view",
  "/upsell": "upsell.view",
  "/agenda": "agenda.view",
  "/follow-ups": "followups.view",
  "/leads": "leads.view",
  "/checklists": "checklists.view",
  "/templates": "message_templates.view",
  "/duplicatas": "leads.view",
  "/lixeira": "leads.view",
  // SCRUM-430. A chave existe no catálogo desde a migration 20270828000000 —
  // sem ela no banco, esta linha esconde Métricas de todo membro não-admin.
  "/metricas": "metrics.view",
  "/performance": "performance.view",
  "/comissoes": "commissions.view",
  "/copilot": "copilot.view",
  "/automacoes": "workflows.view",
  "/equipe": "team.view",
  "/produtos": "products.view",
  "/negocios": "deals.view",
  "/configuracoes": "settings.view",
  // Cada aba virou rota; todas herdam o mesmo gate da tela que as hospeda —
  // senão o Pitstop mostraria itens que a rota depois recusa.
  ...Object.fromEntries(SETTINGS_TAB_PATHS.map((path) => [path, "settings.view"])),
};

/** Largura da lateral, em px. Mesma medida validada no estudo. */
export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_WIDTH_COLLAPSED = 64;
/** Abaixo disto o Pitstop vira overlay em vez de coluna que empurra. */
export const PITSTOP_OVERLAY_BREAKPOINT = 1180;
