/**
 * feature-registry — plan gating map
 *
 * Garante que toda rota de feature paga tem feature_key mapeada no
 * SIDEBAR_FEATURE_MAP (é o que faz o cadeado aparecer na navegação) e que
 * as keys usadas nos planos do DB (subscription_plans.features, migration
 * 20260830000000) existem no registry do frontend.
 */
import { describe, it, expect } from "vitest";
import {
  SIDEBAR_FEATURE_MAP,
  FEATURES,
  getFeatureMeta,
  type FeatureKey,
} from "@/modules/platform/lib/feature-registry";

// Keys seedadas nos planos torque-1.0 / torque-2.0 / torque-v8 no DB.
// "leads" no plano = módulo Combustível; demais nomes batem 1:1.
const DB_PLAN_FEATURE_KEYS: FeatureKey[] = [
  "leads",
  "funnels",
  "performance",
  "products",
  "analytics",
  "chat",
  "carteira",
  "copilot",
  "oraculo",
  "scheduled_messages",
  "automations",
  "whatsapp_bulk",
  "message_templates",
];

describe("SIDEBAR_FEATURE_MAP — rotas de feature paga", () => {
  const expected: Record<string, FeatureKey> = {
    "/chat": "chat",
    "/chat-whatsapp": "chat",
    "/copilot": "copilot",
    "/automacoes": "automations",
    "/disparos": "whatsapp_bulk",
    "/upsell": "carteira",
    "/templates": "message_templates",
    // SCRUM-637 (flip): os pipes vivem na rota única — a chave é o prefixo.
    "/funil": "funnels",
  };

  for (const [path, key] of Object.entries(expected)) {
    it(`${path} → ${key}`, () => {
      expect(SIDEBAR_FEATURE_MAP[path]).toBe(key);
    });
  }

  it("não mapeia rota stale /chat-whatsapp como única rota do chat", () => {
    // Regressão: chat apontava só pra /chat-whatsapp e o item "Chat" da
    // navegação (path /chat) nunca lockeava.
    expect(SIDEBAR_FEATURE_MAP["/chat"]).toBeDefined();
  });
});

describe("paridade registry ↔ features dos planos do DB", () => {
  for (const key of DB_PLAN_FEATURE_KEYS) {
    it(`plan key "${key}" existe no FEATURES catalog`, () => {
      expect(getFeatureMeta(key)).toBeDefined();
    });
  }

  it("catalog não tem keys duplicadas", () => {
    const keys = FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
