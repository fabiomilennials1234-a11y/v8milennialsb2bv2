import { describe, it, expect } from "vitest";
import {
  TITLE_MAX,
  TITLE_MIN,
  buildTicketInsert,
  ticketDraftErrors,
  isTicketDraftValid,
  emptyTicketDraft,
} from "./support-ticket-draft";

const validDraft = {
  title: "Kanban trava ao arrastar card",
  description: "Congela ao sair de abordado.",
  tipo: "bug" as const,
  impacto: "parado" as const,
};

describe("ticketDraftErrors", () => {
  it("aceita um rascunho completo", () => {
    expect(ticketDraftErrors(validDraft)).toEqual([]);
    expect(isTicketDraftValid(validDraft)).toBe(true);
  });

  it("aceita descrição vazia — ela é opcional", () => {
    expect(ticketDraftErrors({ ...validDraft, description: "" })).toEqual([]);
  });

  it("recusa título curto demais", () => {
    expect(ticketDraftErrors({ ...validDraft, title: "ab" })).toEqual(["title_too_short"]);
  });

  // O banco valida `length(btrim(title))`. Um título só de espaços passaria por
  // um `.length` ingênuo e explodiria no INSERT.
  it("recusa título feito só de espaço em branco", () => {
    expect(ticketDraftErrors({ ...validDraft, title: "      " })).toEqual(["title_too_short"]);
  });

  it("mede o título já aparado, como o CHECK do banco", () => {
    expect(ticketDraftErrors({ ...validDraft, title: "  abc  " })).toEqual([]);
  });

  it("recusa título longo demais", () => {
    expect(ticketDraftErrors({ ...validDraft, title: "a".repeat(TITLE_MAX + 1) })).toEqual([
      "title_too_long",
    ]);
  });

  it("aceita o título no limite exato", () => {
    expect(ticketDraftErrors({ ...validDraft, title: "a".repeat(TITLE_MAX) })).toEqual([]);
    expect(ticketDraftErrors({ ...validDraft, title: "a".repeat(TITLE_MIN) })).toEqual([]);
  });

  it("exige tipo e impacto", () => {
    expect(ticketDraftErrors({ ...validDraft, tipo: undefined })).toEqual(["tipo_missing"]);
    expect(ticketDraftErrors({ ...validDraft, impacto: undefined })).toEqual(["impacto_missing"]);
  });

  it("acumula os erros em vez de parar no primeiro", () => {
    expect(ticketDraftErrors({ title: "", description: "" })).toEqual([
      "title_too_short",
      "tipo_missing",
      "impacto_missing",
    ]);
  });

  it("um rascunho vazio é inválido, e não lança", () => {
    expect(isTicketDraftValid(emptyTicketDraft())).toBe(false);
  });
});

describe("buildTicketInsert", () => {
  const ctx = {
    organizationId: "org-1",
    authorUserId: "user-1",
    supportContext: { route: "/oportunidades" },
  };

  it("apara o título e a descrição", () => {
    const row = buildTicketInsert({ ...validDraft, title: "  titulo  ", description: "  corpo  " }, ctx);
    expect(row.title).toBe("titulo");
    expect(row.description).toBe("corpo");
  });

  it("manda descrição vazia como null, não como string vazia", () => {
    expect(buildTicketInsert({ ...validDraft, description: "   " }, ctx).description).toBeNull();
  });

  it("carrega dono, autor e contexto", () => {
    const row = buildTicketInsert(validDraft, ctx);
    expect(row.organization_id).toBe("org-1");
    expect(row.author_user_id).toBe("user-1");
    expect(row.support_context).toEqual({ route: "/oportunidades" });
  });

  // Severidade é veredito do staff; defect_url também. O trigger recusa os dois
  // vindos do cliente — o payload nunca deve sequer tentar.
  it("nunca emite severidade, defect_url, status ou atribuição", () => {
    const row = buildTicketInsert(validDraft, ctx) as Record<string, unknown>;
    expect(row).not.toHaveProperty("severidade");
    expect(row).not.toHaveProperty("defect_url");
    expect(row).not.toHaveProperty("status");
    expect(row).not.toHaveProperty("assigned_master_user_id");
  });

  it("ignora campos extras que um chamador tente injetar", () => {
    const hostile = { ...validDraft, severidade: "critica", defect_url: "http://x" } as never;
    const row = buildTicketInsert(hostile, ctx) as Record<string, unknown>;
    expect(row).not.toHaveProperty("severidade");
    expect(row).not.toHaveProperty("defect_url");
  });

  it("recusa montar um insert a partir de rascunho inválido", () => {
    expect(() => buildTicketInsert({ ...validDraft, title: "ab" }, ctx)).toThrow();
  });

  it("aceita um contexto vazio", () => {
    expect(buildTicketInsert(validDraft, { ...ctx, supportContext: {} }).support_context).toEqual({});
  });
});
