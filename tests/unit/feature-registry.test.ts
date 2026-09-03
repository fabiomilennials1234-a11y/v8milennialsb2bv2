import { describe, it, expect } from "vitest";
import {
  FEATURES,
  LIMITS,
  SIDEBAR_FEATURE_MAP,
  CAMPAIGN_TYPE_FEATURE_MAP,
  FUNNEL_TEMPLATE_FEATURE_MAP,
  getFeaturesByCategory,
  getFeatureMeta,
  getLimitMeta,
  isUnlimited,
} from "../../src/modules/platform/lib/feature-registry";

describe("FEATURES catalog", () => {
  it("has at least 20 features", () => {
    expect(FEATURES.length).toBeGreaterThanOrEqual(20);
  });

  it("every feature has required fields", () => {
    FEATURES.forEach((f) => {
      expect(f.key).toBeTruthy();
      expect(f.label).toBeTruthy();
      expect(f.description).toBeTruthy();
      expect(f.icon).toBeTruthy();
      expect(["modules", "campaigns", "advanced"]).toContain(f.category);
    });
  });

  it("no duplicate feature keys", () => {
    const keys = FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("LIMITS catalog", () => {
  it("has at least 8 limits", () => {
    expect(LIMITS.length).toBeGreaterThanOrEqual(8);
  });

  it("every limit has required fields", () => {
    LIMITS.forEach((l) => {
      expect(l.key).toBeTruthy();
      expect(l.label).toBeTruthy();
      expect(l.unit).toBeTruthy();
    });
  });
});

describe("SIDEBAR_FEATURE_MAP", () => {
  it("maps /chat-whatsapp to chat", () => {
    expect(SIDEBAR_FEATURE_MAP["/chat-whatsapp"]).toBe("chat");
  });

  it("maps /funis to funnels", () => {
    expect(SIDEBAR_FEATURE_MAP["/funis"]).toBe("funnels");
  });

  it("maps o prefixo /funil (rota única pós-637) to funnels", () => {
    expect(SIDEBAR_FEATURE_MAP["/funil"]).toBe("funnels");
  });

  it("maps /upsell to carteira", () => {
    expect(SIDEBAR_FEATURE_MAP["/upsell"]).toBe("carteira");
  });

  it("maps /templates to message_templates", () => {
    expect(SIDEBAR_FEATURE_MAP["/templates"]).toBe("message_templates");
  });
});

describe("CAMPAIGN_TYPE_FEATURE_MAP", () => {
  it("maps manual to campaigns_manual", () => {
    expect(CAMPAIGN_TYPE_FEATURE_MAP["manual"]).toBe("campaigns_manual");
  });

  it("maps semi_automatica to campaigns_semi", () => {
    expect(CAMPAIGN_TYPE_FEATURE_MAP["semi_automatica"]).toBe("campaigns_semi");
  });

  it("maps automatica to campaigns_auto", () => {
    expect(CAMPAIGN_TYPE_FEATURE_MAP["automatica"]).toBe("campaigns_auto");
  });
});

describe("FUNNEL_TEMPLATE_FEATURE_MAP", () => {
  it("maps indicacao", () => {
    expect(FUNNEL_TEMPLATE_FEATURE_MAP["indicacao"]).toBe("funnels_template_indicacao");
  });

  it("maps prospeccao", () => {
    expect(FUNNEL_TEMPLATE_FEATURE_MAP["prospeccao"]).toBe("funnels_template_prospeccao");
  });

  it("maps reativacao", () => {
    expect(FUNNEL_TEMPLATE_FEATURE_MAP["reativacao"]).toBe("funnels_template_reativacao");
  });
});

describe("getFeaturesByCategory", () => {
  it("returns only modules", () => {
    const modules = getFeaturesByCategory("modules");
    expect(modules.length).toBeGreaterThan(0);
    modules.forEach((f) => expect(f.category).toBe("modules"));
  });

  it("returns only campaigns", () => {
    const campaigns = getFeaturesByCategory("campaigns");
    campaigns.forEach((f) => expect(f.category).toBe("campaigns"));
  });

  it("returns empty for invalid category", () => {
    const result = getFeaturesByCategory("nonexistent" as any);
    expect(result).toHaveLength(0);
  });
});

describe("getFeatureMeta", () => {
  it("returns meta for existing feature", () => {
    const meta = getFeatureMeta("chat");
    expect(meta).toBeDefined();
    expect(meta!.label).toBe("Chat");
  });

  it("returns undefined for unknown feature", () => {
    expect(getFeatureMeta("nonexistent" as any)).toBeUndefined();
  });
});

describe("getLimitMeta", () => {
  it("returns meta for existing limit", () => {
    const meta = getLimitMeta("max_leads");
    expect(meta).toBeDefined();
    expect(meta!.unit).toBe("leads");
  });

  it("returns undefined for unknown limit", () => {
    expect(getLimitMeta("nonexistent" as any)).toBeUndefined();
  });
});

describe("isUnlimited", () => {
  it("returns true for -1", () => {
    expect(isUnlimited(-1)).toBe(true);
  });

  it("returns false for 0", () => {
    expect(isUnlimited(0)).toBe(false);
  });

  it("returns false for positive numbers", () => {
    expect(isUnlimited(100)).toBe(false);
  });
});
