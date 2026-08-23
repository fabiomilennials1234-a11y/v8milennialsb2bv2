/**
 * GERADO AUTOMATICAMENTE — NÃO EDITE À MÃO.
 *
 * Fonte: tabela `public.feature_catalog`.
 * Regerar: `node scripts/gen-feature-catalog.mjs`
 *
 * Editar este arquivo não muda o comportamento do produto: a resolução de features em
 * runtime lê o banco, não daqui. Uma edição manual só cria divergência, que o teste de
 * paridade em `tests/integration/feature-catalog-parity.test.ts` reprova.
 */

export type FeatureKey =
  | "analytics"
  | "api_access"
  | "automations"
  | "campaigns_auto"
  | "campaigns_manual"
  | "campaigns_semi"
  | "carteira"
  | "chat"
  | "commissions"
  | "copilot"
  | "copilot_advanced"
  | "customer_portfolio"
  | "deals"
  | "external_cadastro"
  | "funnels"
  | "funnels_custom"
  | "funnels_template_indicacao"
  | "funnels_template_prospeccao"
  | "funnels_template_reativacao"
  | "leads"
  | "marketing"
  | "merged_opportunity_funnel"
  | "message_templates"
  | "oraculo"
  | "performance"
  | "portfolio_alerts_whatsapp"
  | "products"
  | "review"
  | "scheduled_messages"
  | "tv_dashboard"
  | "unified_message_gateway"
  | "user_write_instance_strict"
  | "voice_calls"
  | "whatsapp_bulk"
  | "white_label";

export type FeatureCategory = string;

export interface FeatureMeta {
  key: FeatureKey;
  label: string;
  description: string;
  /** Nome do ícone Lucide, quando a feature aparece em superfície visual. */
  icon: string | null;
  category: FeatureCategory;
  sidebarPath: string | null;
  featureType: string;
  position: number;
  defaultEnabled: boolean;
  /** true = comercial: oferecível no link de pagamento e congelada no snapshot. */
  isSellable: boolean;
}

export const FEATURES: FeatureMeta[] = [
  {
    key: "analytics",
    label: "Analytics",
    description: "Painel de inteligência com métricas avançadas",
    icon: "BarChart3",
    category: "modules",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "api_access",
    label: "Acesso API",
    description: "Acesso a API publica",
    icon: "Code",
    category: "advanced",
    sidebarPath: null,
    featureType: "advanced",
    position: 32,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "automations",
    label: "Automações",
    description: "Workflows e automações",
    icon: "Workflow",
    category: "modules",
    sidebarPath: "/automacoes",
    featureType: "boolean",
    position: 0,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "campaigns_auto",
    label: "Campanhas Automaticas",
    description: "Campanhas com IA conversacional",
    icon: "Bot",
    category: "campaigns",
    sidebarPath: null,
    featureType: "campaign_type",
    position: 22,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "campaigns_manual",
    label: "Campanhas Manuais",
    description: "Criacao de campanhas manuais via Kanban",
    icon: "MousePointer",
    category: "campaigns",
    sidebarPath: null,
    featureType: "campaign_type",
    position: 20,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "campaigns_semi",
    label: "Campanhas Semi-Auto",
    description: "Campanhas com disparo de templates em lote",
    icon: "Zap",
    category: "campaigns",
    sidebarPath: null,
    featureType: "campaign_type",
    position: 21,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "carteira",
    label: "Carteira",
    description: "Gestão de carteira de clientes",
    icon: "TrendingUp",
    category: "modules",
    sidebarPath: "/upsell",
    featureType: "boolean",
    position: 0,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "chat",
    label: "Chat",
    description: "Modulo de chat e mensagens WhatsApp",
    icon: "Zap",
    category: "modules",
    sidebarPath: "/chat",
    featureType: "boolean",
    position: 1,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "commissions",
    label: "Comissoes",
    description: "Modulo de comissoes e pagamentos",
    icon: "DollarSign",
    category: "modules",
    sidebarPath: "/comissoes",
    featureType: "boolean",
    position: 5,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "copilot",
    label: "Copilot IA",
    description: "Acesso ao agente de IA conversacional",
    icon: "Bot",
    category: "modules",
    sidebarPath: "/copilot",
    featureType: "boolean",
    position: 10,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "copilot_advanced",
    label: "Copilot Avancado",
    description: "Funcoes avancadas do Copilot (follow-up, qualificacao)",
    icon: "Sparkles",
    category: "advanced",
    sidebarPath: null,
    featureType: "advanced",
    position: 30,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "customer_portfolio",
    label: "Customer Portfolio & Reorder",
    description: "Enables customer portfolio management: health scores, reorder prediction, retention copilot, and client 360 view",
    icon: "Users",
    category: "advanced",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "deals",
    label: "Negócios",
    description: "Gestão de negócios com produtos, probabilidade e forecast",
    icon: "Briefcase",
    category: "modules",
    sidebarPath: null,
    featureType: "module",
    position: 0,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "external_cadastro",
    label: "Cadastro Externo",
    description: "Modal de cadastro automático no sistema externo ao fechar venda",
    icon: "UserPlus",
    category: "advanced",
    sidebarPath: null,
    featureType: "advanced",
    position: 40,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "funnels",
    label: "Funis",
    description: "Pipelines de qualificacao, confirmacao e propostas",
    icon: "GitBranch",
    category: "modules",
    sidebarPath: "/funis",
    featureType: "boolean",
    position: 2,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "funnels_custom",
    label: "Funis Customizados",
    description: "Funis personalizados",
    icon: "GitBranch",
    category: "modules",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "funnels_template_indicacao",
    label: "Funil de Indicação",
    description: "Templates de funil de indicação",
    icon: "Heart",
    category: "modules",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "funnels_template_prospeccao",
    label: "Funil de Prospecção",
    description: "Templates de funil de prospecção",
    icon: "Target",
    category: "modules",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "funnels_template_reativacao",
    label: "Funil de Reativação",
    description: "Templates de funil de reativação",
    icon: "RefreshCw",
    category: "modules",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "leads",
    label: "Leads",
    description: "Gestao de leads e contatos",
    icon: "Fuel",
    category: "modules",
    sidebarPath: "/leads",
    featureType: "boolean",
    position: 4,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "marketing",
    label: "Marketing",
    description: "Modulo de marketing e analises",
    icon: "BarChart2",
    category: "modules",
    sidebarPath: "/marketing",
    featureType: "boolean",
    position: 7,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "merged_opportunity_funnel",
    label: "Funil Oportunidades Consolidado",
    description: "Mergeia Agendamentos em Oportunidades — anexa etapas de reunião + confirmação por status (ADR-0004)",
    icon: "GitMerge",
    category: "advanced",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: false,
    isSellable: false,
  },
  {
    key: "message_templates",
    label: "Templates de Mensagem",
    description: "Templates de mensagem com slash commands no chat",
    icon: "FileText",
    category: "modules",
    sidebarPath: "/templates",
    featureType: "boolean",
    position: 0,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "oraculo",
    label: "Oráculo",
    description: "IA de análise e recomendações",
    icon: "Sparkles",
    category: "advanced",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "performance",
    label: "Podio",
    description: "Modulo de performance, ranking e metas",
    icon: "Trophy",
    category: "modules",
    sidebarPath: "/performance",
    featureType: "boolean",
    position: 6,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "portfolio_alerts_whatsapp",
    label: "Portfolio Alerts via WhatsApp",
    description: "Send WhatsApp notifications to salespeople when critical portfolio alerts fire",
    icon: "BellRing",
    category: "advanced",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: false,
    isSellable: false,
  },
  {
    key: "products",
    label: "Produtos",
    description: "Catalogo de produtos",
    icon: "Package",
    category: "modules",
    sidebarPath: "/produtos",
    featureType: "boolean",
    position: 8,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "review",
    label: "Revisao",
    description: "Modulo de revisao e follow-ups",
    icon: "Wrench",
    category: "modules",
    sidebarPath: "/follow-ups",
    featureType: "boolean",
    position: 3,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "scheduled_messages",
    label: "Mensagens Agendadas",
    description: "Agendamento de mensagens WhatsApp",
    icon: "Clock",
    category: "advanced",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "tv_dashboard",
    label: "TV Dashboard",
    description: "Dashboard para exibicao em TV",
    icon: "Tv",
    category: "modules",
    sidebarPath: "/tv",
    featureType: "boolean",
    position: 9,
    defaultEnabled: true,
    isSellable: true,
  },
  {
    key: "unified_message_gateway",
    label: "Unified Message Gateway",
    description: "Route outbound WhatsApp messages through the unified message-gateway module instead of per-caller send logic",
    icon: "Send",
    category: "advanced",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: false,
    isSellable: false,
  },
  {
    key: "user_write_instance_strict",
    label: "Vínculo estrito user-instância de escrita",
    description: "Quando ativo, envio só ocorre via instância vinculada ao responsável do lead. Admin/master sempre permitidos.",
    icon: "Lock",
    category: "advanced",
    sidebarPath: null,
    featureType: "boolean",
    position: 0,
    defaultEnabled: false,
    isSellable: false,
  },
  {
    key: "voice_calls",
    label: "TorqueCalls (Voz)",
    description: "Chamada de voz pelo WhatsApp direto no CRM, sem sair da conversa",
    icon: "Phone",
    category: "advanced",
    sidebarPath: null,
    featureType: "advanced",
    position: 45,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "whatsapp_bulk",
    label: "Disparo em Massa",
    description: "Disparo de mensagens em lote",
    icon: "Send",
    category: "advanced",
    sidebarPath: "/disparos",
    featureType: "advanced",
    position: 31,
    defaultEnabled: false,
    isSellable: true,
  },
  {
    key: "white_label",
    label: "White Label",
    description: "Personalizacao de marca",
    icon: "Palette",
    category: "advanced",
    sidebarPath: null,
    featureType: "advanced",
    position: 33,
    defaultEnabled: false,
    isSellable: true,
  },
];

/** Chaves que o montador do link pode vender. Ver decisão de #1386. */
export const SELLABLE_FEATURE_KEYS: FeatureKey[] = [
  "analytics",
  "api_access",
  "automations",
  "campaigns_auto",
  "campaigns_manual",
  "campaigns_semi",
  "carteira",
  "chat",
  "commissions",
  "copilot",
  "copilot_advanced",
  "customer_portfolio",
  "deals",
  "external_cadastro",
  "funnels",
  "funnels_custom",
  "funnels_template_indicacao",
  "funnels_template_prospeccao",
  "funnels_template_reativacao",
  "leads",
  "marketing",
  "message_templates",
  "oraculo",
  "performance",
  "products",
  "review",
  "scheduled_messages",
  "tv_dashboard",
  "voice_calls",
  "whatsapp_bulk",
  "white_label",
];
