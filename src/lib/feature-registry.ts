/**
 * Feature Registry — constantes de features, limites e mapeamento sidebar → feature_key.
 *
 * Este arquivo é a fonte de verdade no frontend para saber quais features existem,
 * como se agrupam (para o editor de planos) e qual feature_key corresponde a cada
 * item da sidebar.
 */

// ─── Feature Keys ──────────────────────────────────────────────
export type FeatureKey =
  // Modules (sidebar)
  | "chat"
  | "funnels"
  | "review"
  | "leads"
  | "copilot"
  | "commissions"
  | "performance"
  | "marketing"
  | "analytics"
  | "tv_dashboard"
  | "products"
  // Campaign types (legacy — deprecated, kept for backward compat)
  | "campaigns_manual"
  | "campaigns_semi"
  | "campaigns_auto"
  // Advanced
  | "copilot_advanced"
  | "whatsapp_bulk"
  | "api_access"
  | "white_label"
  // Integrations
  | "external_cadastro"
  // Funnels v2
  | "funnels_custom"
  | "carteira"
  | "funnels_template_indicacao"
  | "funnels_template_prospeccao"
  | "funnels_template_reativacao"
  // Legacy campaign keys (deprecated — use funnels_template_* instead)
  | "campaigns_indicacao"
  | "campaigns_prospeccao"
  | "campaigns_reativacao"
  | "message_templates";

export type LimitKey =
  | "max_leads"
  | "max_users"
  | "max_campaigns" // legacy — deprecated
  | "max_copilot_agents"
  | "max_whatsapp_instances"
  | "max_funnels"
  | "max_documents_per_agent"
  | "max_active_campaigns" // legacy — deprecated
  | "max_custom_funnels"
  | "max_temporary_funnels";

// ─── Feature Metadata ──────────────────────────────────────────
export interface FeatureMeta {
  key: FeatureKey;
  label: string;
  description: string;
  icon: string; // Lucide icon name
  category: "modules" | "campaigns" | "advanced";
  sidebarPath?: string;
}

export interface LimitMeta {
  key: LimitKey;
  label: string;
  description: string;
  unit: string;
}

// ─── Feature Catalog ───────────────────────────────────────────
export const FEATURES: FeatureMeta[] = [
  // Modules
  { key: "chat", label: "Chat", description: "Chat e mensagens WhatsApp", icon: "Zap", category: "modules", sidebarPath: "/chat-whatsapp" },
  { key: "funnels", label: "Funis", description: "Pipelines de qualificação, confirmação e propostas", icon: "GitBranch", category: "modules", sidebarPath: "/funis" },
  { key: "review", label: "Revisão", description: "Revisão e follow-ups", icon: "Wrench", category: "modules", sidebarPath: "/follow-ups" },
  { key: "leads", label: "Combustível", description: "Gestão de leads e contatos", icon: "Fuel", category: "modules", sidebarPath: "/leads" },
  { key: "commissions", label: "Comissões", description: "Comissões e pagamentos", icon: "DollarSign", category: "modules", sidebarPath: "/comissoes" },
  { key: "performance", label: "Pódio", description: "Performance, ranking e metas", icon: "Trophy", category: "modules", sidebarPath: "/performance" },
  { key: "marketing", label: "Marketing", description: "Marketing e análises", icon: "BarChart2", category: "modules", sidebarPath: "/marketing" },
  {
    key: "analytics",
    label: "Analytics",
    description: "Painel de inteligência com métricas avançadas de vendas, financeiro e engajamento",
    icon: "BarChart3",
    category: "modules",
    sidebarPath: "/analytics",
  },
  { key: "products", label: "Produtos", description: "Catálogo de produtos", icon: "Package", category: "modules", sidebarPath: "/produtos" },
  { key: "tv_dashboard", label: "TV Dashboard", description: "Dashboard para exibição em TV", icon: "Tv", category: "modules", sidebarPath: "/tv" },
  { key: "copilot", label: "Copilot", description: "Agente de IA conversacional", icon: "Bot", category: "modules", sidebarPath: "/copilot" },
  // Campaigns
  { key: "campaigns_manual", label: "Campanhas Manuais", description: "Campanhas via Kanban tradicional", icon: "MousePointer", category: "campaigns" },
  { key: "campaigns_semi", label: "Campanhas Semi-Auto", description: "Disparo de templates em lote", icon: "Zap", category: "campaigns" },
  { key: "campaigns_auto", label: "Campanhas Automáticas", description: "Campanhas com IA conversacional", icon: "Bot", category: "campaigns" },
  // Advanced
  { key: "copilot_advanced", label: "Copilot Avançado", description: "Follow-up automático, qualificação avançada", icon: "Sparkles", category: "advanced" },
  { key: "whatsapp_bulk", label: "Disparo em Massa", description: "Envio de mensagens em lote", icon: "Send", category: "advanced" },
  { key: "api_access", label: "Acesso API", description: "Acesso à API pública", icon: "Code", category: "advanced" },
  { key: "white_label", label: "White Label", description: "Personalização completa de marca", icon: "Palette", category: "advanced" },
  { key: "external_cadastro", label: "Cadastro Externo", description: "Cadastro automático de clientes no sistema externo", icon: "UserPlus", category: "advanced" },
  // Funnels v2
  { key: "funnels_custom", label: "Funis Customizados", description: "Criar funis personalizados", icon: "GitBranch", category: "modules" },
  { key: "carteira", label: "Carteira", description: "Gestão de carteira de clientes", icon: "TrendingUp", category: "modules", sidebarPath: "/upsell" },
  { key: "message_templates", label: "Templates", description: "Modelos de mensagem com slash commands", icon: "FileText", category: "modules", sidebarPath: "/templates" },
  { key: "funnels_template_indicacao", label: "Funil de Indicação", description: "Funis temporários de indicação", icon: "Heart", category: "modules" },
  { key: "funnels_template_prospeccao", label: "Funil de Prospecção", description: "Funis temporários de prospecção ativa", icon: "Target", category: "modules" },
  { key: "funnels_template_reativacao", label: "Funil de Reativação", description: "Funis temporários de reativação de base", icon: "RefreshCw", category: "modules" },
  // Legacy campaign keys (deprecated — kept for backward compat with existing orgs)
  { key: "campaigns_indicacao", label: "Campanha de Indicação (legacy)", description: "Deprecated — use funnels_template_indicacao", icon: "Heart", category: "campaigns" },
  { key: "campaigns_prospeccao", label: "Campanha de Prospecção (legacy)", description: "Deprecated — use funnels_template_prospeccao", icon: "Target", category: "campaigns" },
  { key: "campaigns_reativacao", label: "Campanha de Reativação (legacy)", description: "Deprecated — use funnels_template_reativacao", icon: "RefreshCw", category: "campaigns" },
];

// ─── Limits Catalog ────────────────────────────────────────────
export const LIMITS: LimitMeta[] = [
  { key: "max_leads", label: "Leads", description: "Número máximo de leads ativos", unit: "leads" },
  { key: "max_users", label: "Usuários", description: "Número máximo de usuários na equipe", unit: "usuários" },
  { key: "max_campaigns", label: "Campanhas", description: "Número máximo de campanhas ativas", unit: "campanhas" },
  { key: "max_copilot_agents", label: "Agentes Copilot", description: "Número máximo de agentes de IA", unit: "agentes" },
  { key: "max_whatsapp_instances", label: "Instâncias WhatsApp", description: "Número de instâncias WhatsApp conectadas", unit: "instâncias" },
  { key: "max_funnels", label: "Funis (legacy)", description: "Deprecated — use max_custom_funnels", unit: "funis" },
  { key: "max_documents_per_agent", label: "Docs por Agente", description: "Documentos na base de conhecimento por agente", unit: "documentos" },
  { key: "max_active_campaigns", label: "Campanhas Ativas (legacy)", description: "Deprecated — use max_temporary_funnels", unit: "campanhas" },
  { key: "max_custom_funnels", label: "Funis Custom", description: "Número máximo de funis customizados permanentes", unit: "funis" },
  { key: "max_temporary_funnels", label: "Funis Temporários", description: "Número máximo de funis temporários ativos simultâneos", unit: "funis" },
];

// ─── Sidebar Path → Feature Key Map ───────────────────────────
/** Mapeia paths da sidebar para a feature_key que controla o acesso. */
export const SIDEBAR_FEATURE_MAP: Record<string, FeatureKey> = {};
for (const f of FEATURES) {
  if (f.sidebarPath) {
    SIDEBAR_FEATURE_MAP[f.sidebarPath] = f.key;
  }
}

// Sub-paths dos funis também são controlados pela feature "funnels"
SIDEBAR_FEATURE_MAP["/pipe-whatsapp"] = "funnels";
SIDEBAR_FEATURE_MAP["/pipe-confirmacao"] = "funnels";
SIDEBAR_FEATURE_MAP["/pipe-propostas"] = "funnels";
SIDEBAR_FEATURE_MAP["/upsell"] = "carteira";
SIDEBAR_FEATURE_MAP["/templates"] = "message_templates";

// ─── Campaign Type → Feature Key Map (legacy) ────────────────
export const CAMPAIGN_TYPE_FEATURE_MAP: Record<string, FeatureKey> = {
  manual: "campaigns_manual",
  semi_automatica: "campaigns_semi",
  automatica: "campaigns_auto",
};

// ─── Funnel Template Type → Feature Key Map ──────────────────
export const FUNNEL_TEMPLATE_FEATURE_MAP: Record<string, FeatureKey> = {
  indicacao: "funnels_template_indicacao",
  prospeccao: "funnels_template_prospeccao",
  reativacao: "funnels_template_reativacao",
};

// ─── Helpers ───────────────────────────────────────────────────
export function getFeaturesByCategory(category: FeatureMeta["category"]) {
  return FEATURES.filter((f) => f.category === category);
}

export function getFeatureMeta(key: FeatureKey): FeatureMeta | undefined {
  return FEATURES.find((f) => f.key === key);
}

export function getLimitMeta(key: LimitKey): LimitMeta | undefined {
  return LIMITS.find((l) => l.key === key);
}

/** Retorna true se o valor do limite significa "ilimitado" */
export function isUnlimited(value: number): boolean {
  return value === -1;
}
