/**
 * Unit tests for the pure parts of Meta WhatsApp Cloud message templates
 * (Slice 6, ADR-0009): input validation, Graph create-payload building, Meta
 * status → our enum mapping, and the injectable Graph client (mocked network).
 *
 * No real network — fetchImpl is injected. Vitest (Node env).
 */
import { describe, it, expect, vi } from "vitest";
import {
  validateCreateInput,
  buildCreatePayload,
  mapMetaStatus,
  createMetaTemplateGraph,
  TEMPLATE_CATEGORIES,
  type ValidatedTemplate,
} from "../../supabase/functions/_shared/meta-templates";

// ── helpers ──────────────────────────────────────────────────────
const bodyComponent = (text = "Olá {{1}}, sua reunião é amanhã.") => ({
  type: "BODY",
  text,
});

function jsonResponse(payload: unknown): Response {
  return { json: () => Promise.resolve(payload) } as unknown as Response;
}

// ── validateCreateInput ──────────────────────────────────────────
describe("validateCreateInput", () => {
  it("accepts a well-formed template and normalizes the category to upper-case", () => {
    const res = validateCreateInput({
      name: "lembrete_reuniao",
      language: "pt_BR",
      category: "utility",
      components: [bodyComponent()],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.category).toBe("UTILITY");
      expect(res.value.name).toBe("lembrete_reuniao");
      expect(res.value.components).toHaveLength(1);
      expect(res.value.components[0].type).toBe("BODY");
    }
  });

  it("defaults language to pt_BR when omitted/blank", () => {
    const res = validateCreateInput({
      name: "boas_vindas",
      language: "",
      category: "MARKETING",
      components: [bodyComponent()],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.language).toBe("pt_BR");
  });

  it("rejects an empty name", () => {
    const res = validateCreateInput({
      name: "  ",
      language: "pt_BR",
      category: "UTILITY",
      components: [bodyComponent()],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/name/i);
  });

  it("rejects a name with uppercase / spaces / punctuation (Meta naming rule)", () => {
    for (const bad of ["Lembrete Reuniao", "lembrete-reuniao", "Olá", "tem espaço"]) {
      const res = validateCreateInput({
        name: bad,
        language: "pt_BR",
        category: "UTILITY",
        components: [bodyComponent()],
      });
      expect(res.ok, `expected "${bad}" to be rejected`).toBe(false);
    }
  });

  it("rejects an invalid category", () => {
    const res = validateCreateInput({
      name: "x",
      language: "pt_BR",
      category: "PROMO",
      components: [bodyComponent()],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/category/i);
  });

  it("accepts each valid category", () => {
    for (const cat of TEMPLATE_CATEGORIES) {
      const res = validateCreateInput({
        name: "valid_name",
        language: "pt_BR",
        category: cat,
        components: [bodyComponent()],
      });
      expect(res.ok, `expected category ${cat} to be valid`).toBe(true);
    }
  });

  it("rejects empty / non-array components", () => {
    expect(
      validateCreateInput({ name: "x", language: "pt_BR", category: "UTILITY", components: [] }).ok,
    ).toBe(false);
    expect(
      validateCreateInput({
        name: "x",
        language: "pt_BR",
        category: "UTILITY",
        components: "nope" as unknown,
      }).ok,
    ).toBe(false);
  });

  it("requires a BODY component", () => {
    const res = validateCreateInput({
      name: "no_body",
      language: "pt_BR",
      category: "UTILITY",
      components: [{ type: "FOOTER", text: "rodapé" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/BODY/);
  });

  it("rejects a BODY with blank text", () => {
    const res = validateCreateInput({
      name: "blank_body",
      language: "pt_BR",
      category: "UTILITY",
      components: [{ type: "BODY", text: "   " }],
    });
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown component type", () => {
    const res = validateCreateInput({
      name: "weird",
      language: "pt_BR",
      category: "UTILITY",
      components: [bodyComponent(), { type: "CAROUSEL" }],
    });
    expect(res.ok).toBe(false);
  });

  it("preserves extra Graph keys on components (e.g. example, buttons)", () => {
    const res = validateCreateInput({
      name: "rich",
      language: "pt_BR",
      category: "MARKETING",
      components: [
        { type: "HEADER", format: "TEXT", text: "Oferta" },
        { type: "BODY", text: "Confira {{1}}", example: { body_text: [["Promo"]] } },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero" }] },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.components[1].example).toEqual({ body_text: [["Promo"]] });
      expect(res.value.components[2].buttons).toHaveLength(1);
    }
  });
});

// ── buildCreatePayload ───────────────────────────────────────────
describe("buildCreatePayload", () => {
  it("maps a validated template 1:1 to the Graph create body", () => {
    const t: ValidatedTemplate = {
      name: "lembrete_reuniao",
      language: "pt_BR",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Olá {{1}}" }],
    };
    const payload = buildCreatePayload(t);
    expect(payload).toEqual({
      name: "lembrete_reuniao",
      language: "pt_BR",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Olá {{1}}" }],
    });
  });
});

// ── mapMetaStatus ────────────────────────────────────────────────
describe("mapMetaStatus", () => {
  it("maps the known Meta statuses to our enum", () => {
    expect(mapMetaStatus("APPROVED")).toBe("approved");
    expect(mapMetaStatus("REJECTED")).toBe("rejected");
    expect(mapMetaStatus("PAUSED")).toBe("paused");
    expect(mapMetaStatus("DISABLED")).toBe("disabled");
    expect(mapMetaStatus("PENDING")).toBe("pending");
  });

  it("is case-insensitive", () => {
    expect(mapMetaStatus("approved")).toBe("approved");
    expect(mapMetaStatus("Rejected")).toBe("rejected");
  });

  it("treats in-flight Meta statuses as pending", () => {
    expect(mapMetaStatus("IN_APPEAL")).toBe("pending");
    expect(mapMetaStatus("PENDING_DELETION")).toBe("pending");
  });

  it("falls back to pending for unknown / null / empty (fail-safe)", () => {
    expect(mapMetaStatus("SOMETHING_NEW")).toBe("pending");
    expect(mapMetaStatus(null)).toBe("pending");
    expect(mapMetaStatus(undefined)).toBe("pending");
    expect(mapMetaStatus("")).toBe("pending");
  });
});

// ── createMetaTemplateGraph (mocked fetch) ───────────────────────
describe("createMetaTemplateGraph.createTemplate", () => {
  it("POSTs to /{waba_id}/message_templates with a Bearer token and returns the id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "123456", status: "PENDING" }));
    const graph = createMetaTemplateGraph({ token: "tok-secret", fetchImpl });
    const result = await graph.createTemplate("WABA_1", {
      name: "lembrete_reuniao",
      language: "pt_BR",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Olá" }],
    });
    expect(result.id).toBe("123456");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("/WABA_1/message_templates");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok-secret",
    });
  });

  it("throws on a Graph error without leaking the token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "Invalid parameter", code: 100 } }));
    const graph = createMetaTemplateGraph({ token: "tok-secret", fetchImpl });
    await expect(
      graph.createTemplate("WABA_1", {
        name: "x",
        language: "pt_BR",
        category: "UTILITY",
        components: [{ type: "BODY", text: "Olá" }],
      }),
    ).rejects.toThrow(/Invalid parameter/);
    await expect(
      graph.createTemplate("WABA_1", {
        name: "x",
        language: "pt_BR",
        category: "UTILITY",
        components: [{ type: "BODY", text: "Olá" }],
      }),
    ).rejects.not.toThrow(/tok-secret/);
  });

  it("throws when Graph returns no id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "PENDING" }));
    const graph = createMetaTemplateGraph({ token: "t", fetchImpl });
    await expect(
      graph.createTemplate("WABA_1", {
        name: "x",
        language: "pt_BR",
        category: "UTILITY",
        components: [{ type: "BODY", text: "Olá" }],
      }),
    ).rejects.toThrow(/template id/);
  });
});

describe("createMetaTemplateGraph.getTemplateStatus", () => {
  it("reads status + rejected_reason", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: "REJECTED", rejected_reason: "INVALID_FORMAT" }));
    const graph = createMetaTemplateGraph({ token: "t", fetchImpl });
    const res = await graph.getTemplateStatus("123456");
    expect(res).toEqual({ status: "REJECTED", rejectedReason: "INVALID_FORMAT" });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain("/123456");
    expect(url).toContain("fields=status");
  });

  it("returns null when the template no longer exists on Meta (code 100)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "does not exist", code: 100 } }));
    const graph = createMetaTemplateGraph({ token: "t", fetchImpl });
    expect(await graph.getTemplateStatus("gone")).toBeNull();
  });

  it("defaults rejectedReason to null when absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "APPROVED" }));
    const graph = createMetaTemplateGraph({ token: "t", fetchImpl });
    const res = await graph.getTemplateStatus("123456");
    expect(res).toEqual({ status: "APPROVED", rejectedReason: null });
  });
});
