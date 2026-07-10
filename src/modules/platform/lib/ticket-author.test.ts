import { describe, it, expect } from "vitest";
import { isFromOrganization, ticketMessageAuthor } from "./ticket-author";

const AUTOR = "user-autor";
const STAFF = "user-staff";
const ADMIN = "user-admin";

describe("ticketMessageAuthor", () => {
  it("marca como 'voce' a mensagem de quem está lendo", () => {
    expect(ticketMessageAuthor(AUTOR, AUTOR, AUTOR)).toBe("voce");
  });

  it("marca como 'suporte' quem não é o autor do chamado", () => {
    expect(ticketMessageAuthor(STAFF, AUTOR, AUTOR)).toBe("suporte");
  });

  // O caso que a heurística ingênua "não é você ⇒ suporte" erra: o admin lê o
  // chamado de um membro e veria o próprio colega etiquetado como Torque.
  it("um admin lendo o chamado de um membro vê o membro como autor, não como suporte", () => {
    expect(ticketMessageAuthor(AUTOR, AUTOR, ADMIN)).toBe("autor");
  });

  it("o admin vê a mensagem do staff como suporte", () => {
    expect(ticketMessageAuthor(STAFF, AUTOR, ADMIN)).toBe("suporte");
  });

  it("o admin vê a própria mensagem como sua", () => {
    expect(ticketMessageAuthor(ADMIN, AUTOR, ADMIN)).toBe("voce");
  });

  // author_user_id é nullable: o autor pode ter saído da empresa.
  it("trata autor removido como suporte apenas se não casar com ninguém", () => {
    expect(ticketMessageAuthor(null, AUTOR, ADMIN)).toBe("suporte");
    expect(ticketMessageAuthor(AUTOR, null, ADMIN)).toBe("suporte");
  });

  it("não casa nulo com nulo", () => {
    expect(ticketMessageAuthor(null, null, undefined)).toBe("suporte");
  });

  it("não confunde viewer indefinido com autor indefinido", () => {
    expect(ticketMessageAuthor(AUTOR, AUTOR, undefined)).toBe("autor");
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
