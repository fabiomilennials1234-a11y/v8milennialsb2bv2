import { describe, it, expect, beforeEach } from "vitest";
import { clearClientErrors, recordClientError } from "./client-error-buffer";
import { buildSupportContext, sanitizeRoute } from "./support-context";

beforeEach(() => clearClientErrors());

describe("sanitizeRoute", () => {
  it("mantém o caminho", () => {
    expect(sanitizeRoute("/oportunidades", "")).toBe("/oportunidades");
  });

  it("mantém os parâmetros que descrevem a tela", () => {
    expect(sanitizeRoute("/oportunidades", "?pipe=whatsapp&tab=kanban")).toBe(
      "/oportunidades?pipe=whatsapp&tab=kanban",
    );
  });

  // `?q=Fulano` é o nome de um lead do nosso cliente. A rota vai parar num
  // Chamado que o suporte da Torque lê.
  it("apaga o valor de um parâmetro que não está na lista segura", () => {
    expect(sanitizeRoute("/leads", "?q=Fulano+da+Silva")).toBe("/leads?q=");
  });

  it("preserva os seguros e apaga os demais na mesma rota", () => {
    expect(sanitizeRoute("/leads", "?pipe=whatsapp&q=Fulano&email=a@b.com")).toBe(
      "/leads?pipe=whatsapp&q=&email=",
    );
  });

  it("preserva a ordem dos parâmetros", () => {
    expect(sanitizeRoute("/x", "?q=a&pipe=b")).toBe("/x?q=&pipe=b");
  });

  it("aceita query vazia e query só com '?'", () => {
    expect(sanitizeRoute("/x", "")).toBe("/x");
    expect(sanitizeRoute("/x", "?")).toBe("/x");
  });

  it("não trata um id de rota como parâmetro", () => {
    expect(sanitizeRoute("/leads/9f8a-1234", "")).toBe("/leads/9f8a-1234");
  });
});

describe("buildSupportContext", () => {
  const base = {
    pathname: "/oportunidades",
    search: "?pipe=whatsapp",
    appVersion: "sha-a1b2c3",
    userAgent: "Mozilla/5.0 (Macintosh)",
    viewport: { width: 1440, height: 900 },
    organizationId: "org-1",
    userId: "user-1",
    role: "member",
    sessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  };

  it("carrega rota, versão, browser e viewport", () => {
    const ctx = buildSupportContext(base);
    expect(ctx.route).toBe("/oportunidades?pipe=whatsapp");
    expect(ctx.app_version).toBe("sha-a1b2c3");
    expect(ctx.user_agent).toBe("Mozilla/5.0 (Macintosh)");
    expect(ctx.viewport).toEqual({ width: 1440, height: 900 });
  });

  // É o id que amarra o Chamado ao que o backend fez naquela sessão,
  // em `runtime_logs`.
  it("carrega o session_id", () => {
    expect(buildSupportContext(base).session_id).toBe(base.sessionId);
  });

  it("carrega org, usuário e papel", () => {
    const ctx = buildSupportContext(base);
    expect(ctx.org_id).toBe("org-1");
    expect(ctx.user_id).toBe("user-1");
    expect(ctx.role).toBe("member");
  });

  it("anexa os erros do buffer", () => {
    recordClientError(new Error("kanban explodiu"), "unhandled");
    const ctx = buildSupportContext(base);
    expect(ctx.client_errors).toHaveLength(1);
    expect(ctx.client_errors[0].message).toBe("kanban explodiu");
  });

  it("um buffer vazio produz um contexto válido", () => {
    const ctx = buildSupportContext(base);
    expect(ctx.client_errors).toEqual([]);
    expect(ctx.route).toBeTruthy();
  });

  it("sanitiza a rota também aqui", () => {
    const ctx = buildSupportContext({ ...base, pathname: "/leads", search: "?q=Fulano" });
    expect(ctx.route).toBe("/leads?q=");
    expect(JSON.stringify(ctx)).not.toContain("Fulano");
  });

  it("aceita org e usuário ausentes sem lançar", () => {
    const ctx = buildSupportContext({ ...base, organizationId: null, userId: null, role: null });
    expect(ctx.org_id).toBeNull();
    expect(ctx.user_id).toBeNull();
  });

  // O snapshot é gravado num jsonb e nunca mais alterado. Se ele não
  // serializar, o INSERT falha na cara do usuário que está pedindo ajuda.
  it("é serializável em JSON", () => {
    recordClientError(new Error("x"), "unhandled");
    expect(() => JSON.stringify(buildSupportContext(base))).not.toThrow();
  });
});
