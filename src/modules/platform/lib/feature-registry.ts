/**
 * Feature Registry — limites e mapeamentos de navegação.
 *
 * O CATÁLOGO DE FEATURES NÃO MORA MAIS AQUI. A fonte de verdade é a tabela
 * `public.feature_catalog`, e `FeatureKey`/`FEATURES` são gerados dela para
 * `feature-catalog.generated.ts` (decisão de #1386). Este arquivo re-exporta esses símbolos
 * para que todos os consumidores existentes continuem importando de um lugar só.
 *
 * O que continua sendo escrito à mão aqui: os limites (que não vivem no catálogo) e os
 * mapeamentos de rota, campanha e template de funil — todos cobertos por teste que reprova
 * referência a chave inexistente.
 */

export type {
  FeatureCategory,
  FeatureKey,
  FeatureMeta,
} from "./feature-catalog.generated";
export { FEATURES, SELLABLE_FEATURE_KEYS } from "./feature-catalog.generated";

import type { FeatureKey, FeatureMeta } from "./feature-catalog.generated";
import { FEATURES } from "./feature-catalog.generated";

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

// ─── Limits Metadata ───────────────────────────────────────────
export interface LimitMeta {
  key: LimitKey;
  label: string;
  description: string;
  unit: string;
}

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

// Sub-paths dos funis também são controlados pela feature "funnels".
// SCRUM-637: os pipes de sistema vivem em /funil/:slug — itens da sidebar
// resolvem a chave pelo prefixo (ver featureKeyFor em useNavigationModel).
SIDEBAR_FEATURE_MAP["/funil"] = "funnels";
SIDEBAR_FEATURE_MAP["/upsell"] = "carteira";
SIDEBAR_FEATURE_MAP["/templates"] = "message_templates";
// Rota legada do chat — mesma feature key da rota atual
SIDEBAR_FEATURE_MAP["/chat-whatsapp"] = "chat";
// Turbo é grupo, não feature: nenhuma entrada do catálogo tem
// `sidebarPath: "/turbo"`. Sem esta linha, `featureKeyFor("/turbo")` volta
// `undefined` e o `if (key)` de `Sidebar.openUpgrade` engole o clique — o item
// aparece com cadeado e não abre o UpgradeModal. Copilot é o add-on que o
// produto vende com o nome "Turbo" (ver PricingSection: "Add-on Turbo").
SIDEBAR_FEATURE_MAP["/turbo"] = "copilot";

// ─── Route Path → Feature Key Map (guards de rota) ───────────
/**
 * Fonte única dos guards de rota por plano. Todo path aqui DEVE estar
 * envolto em <FeatureRoute feature="<key>"> no App.tsx — consistência
 * enforced por tests/unit/route-feature-map.test.ts (cadeado na nav sem
 * guard na rota = contornável via URL direta).
 *
 * Paths de redirect (/marketing, /analytics, /chat) ficam FORA —
 * não têm elemento pra guardar.
 */
export const ROUTE_FEATURE_MAP: Record<string, FeatureKey> = {
  // chat (/chat é redirect pra /chat-whatsapp — fora do mapa)
  "/chat-whatsapp": "chat",
  "/atendimento/meta": "chat",
  // funis (CRM core — true nos 3 planos; guard fecha a porta pra plano futuro)
  "/funis": "funnels",
  // Rota única (SCRUM-632; flip na 637 — /pipe-* viraram redirects sem elemento)
  "/funil/:slug": "funnels",
  // leads
  "/leads": "leads",
  "/lixeira": "leads",
  "/duplicatas": "leads",
  // revisão / follow-ups
  "/follow-ups": "review",
  // performance / comissões / tv
  "/performance": "performance",
  "/comissoes": "commissions",
  "/tv": "tv_dashboard",
  // catálogo
  "/produtos": "products",
  // carteira
  "/upsell": "carteira",
  "/carteira/:clientId": "carteira",
  // copilot
  "/copilot": "copilot",
  "/copilot/metricas": "copilot",
  "/copilot/novo": "copilot",
  "/copilot/:id/editar": "copilot",
  // automações
  "/automacoes": "automations",
  "/automacoes/novo": "automations",
  "/automacoes/:id": "automations",
  "/automacoes/:id/execucoes": "automations",
  // disparos + templates
  "/disparos": "whatsapp_bulk",
  "/disparos/novo": "whatsapp_bulk",
  "/templates": "message_templates",
};

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
