import { afterEach, describe, expect, it } from "vitest";
import {
  BODY_MAX,
  FEATURE_SUGGESTION_PROMPT_KEY,
  SUGGESTION_KINDS,
  SUGGESTION_KIND_LABEL,
  isAnotherDialogOpen,
  isBodyValid,
  isExcludedRoute,
  limitAnnouncement,
  normalizeBody,
} from "@/modules/platform/components/feedback/feature-suggestion";

describe("feature-suggestion: regras puras", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("chave do prompt casa com o CHECK do banco", () => {
    expect(FEATURE_SUGGESTION_PROMPT_KEY).toMatch(/^[a-z0-9_]{3,64}$/);
  });

  it("tipos e rótulos casam com o CHECK de kind", () => {
    expect([...SUGGESTION_KINDS]).toEqual(["feature", "improvement", "integration", "other"]);
    expect(SUGGESTION_KIND_LABEL).toEqual({
      feature: "Nova funcionalidade",
      improvement: "Melhoria",
      integration: "Integração",
      other: "Outro",
    });
  });

  it("texto: trim, mínimo 3 e máximo 1000 depois do trim", () => {
    expect(normalizeBody("  ideia  ")).toBe("ideia");
    expect(isBodyValid("ab")).toBe(false);
    expect(isBodyValid("   ab   ")).toBe(false);
    expect(isBodyValid("abc")).toBe(true);
    expect(isBodyValid("x".repeat(BODY_MAX))).toBe(true);
    expect(isBodyValid("x".repeat(BODY_MAX + 1))).toBe(false);
    expect(isBodyValid(`  ${"x".repeat(BODY_MAX)}  `)).toBe(true);
  });

  it("anúncio do limite só nos degraus 100/50/0 restantes", () => {
    expect(limitAnnouncement(0)).toBe("");
    expect(limitAnnouncement(899)).toBe("");
    expect(limitAnnouncement(900)).toBe("Restam 100 caracteres ou menos.");
    expect(limitAnnouncement(949)).toBe("Restam 100 caracteres ou menos.");
    expect(limitAnnouncement(950)).toBe("Restam 50 caracteres ou menos.");
    expect(limitAnnouncement(1000)).toBe("Limite de 1000 caracteres atingido.");
  });

  it.each(["/auth", "/auth/callback", "/signup", "/reset-password", "/_mockup/x", "/master", "/master/operacao", "/tv"])(
    "rota excluída: %s",
    (path) => {
      expect(isExcludedRoute(path)).toBe(true);
    },
  );

  it.each(["/", "/chat", "/chat/123", "/pipeline", "/agenda", "/configuracoes"])("rota permitida: %s", (path) => {
    expect(isExcludedRoute(path)).toBe(false);
  });

  it("detecta outro diálogo aberto (dialog ou alertdialog), ignora fechado", () => {
    expect(isAnotherDialogOpen()).toBe(false);
    document.body.innerHTML = '<div role="dialog" data-state="closed"></div>';
    expect(isAnotherDialogOpen()).toBe(false);
    document.body.innerHTML = '<div role="dialog" data-state="open"></div>';
    expect(isAnotherDialogOpen()).toBe(true);
    document.body.innerHTML = '<div role="alertdialog" data-state="open"></div>';
    expect(isAnotherDialogOpen()).toBe(true);
  });
});
