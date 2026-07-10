import { describe, it, expect } from "vitest";
import { isFromOrganization, ticketMessageAuthor } from "./ticket-author";

const AUTOR = "user-autor";
const ADMIN = "user-admin";

describe("ticketMessageAuthor", () => {
  it("é 'suporte' quando veio do staff, independente de quem escreveu", () => {
    expect(ticketMessageAuthor(true, AUTOR, ADMIN)).toBe("suporte");
    // até se o autor do comentário for o próprio leitor: a origem manda.
    expect(ticketMessageAuthor(true, ADMIN, ADMIN)).toBe("suporte");
  });

  it("marca como 'voce' a mensagem da org escrita por quem está lendo", () => {
    expect(ticketMessageAuthor(false, AUTOR, AUTOR)).toBe("voce");
  });

  // O caso que a heurística ingênua "não é você ⇒ suporte" errava: o admin lê o
  // chamado de um membro e veria o próprio colega etiquetado como Torque.
  it("um admin lendo a mensagem de um membro vê 'autor', nunca 'suporte'", () => {
    expect(ticketMessageAuthor(false, AUTOR, ADMIN)).toBe("autor");
  });

  it("o admin vê a própria mensagem da org como sua", () => {
    expect(ticketMessageAuthor(false, ADMIN, ADMIN)).toBe("voce");
  });

  // Um master escrevendo pelo painel do cliente (shadow) carimba from_staff=false
  // → é mensagem da org, não do suporte.
  it("mensagem de org sem casar com o leitor cai em 'autor', não em 'suporte'", () => {
    expect(ticketMessageAuthor(false, AUTOR, undefined)).toBe("autor");
    expect(ticketMessageAuthor(false, null, ADMIN)).toBe("autor");
  });
});

describe("isFromOrganization", () => {
  it("alinha à direita o que vem da organização", () => {
    expect(isFromOrganization("voce")).toBe(true);
    expect(isFromOrganization("autor")).toBe(true);
  });

  it("alinha à esquerda o que vem da Torque", () => {
    expect(isFromOrganization("suporte")).toBe(false);
  });
});
