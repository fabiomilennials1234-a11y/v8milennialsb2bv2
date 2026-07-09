import { describe, it, expect } from "vitest";
import { TICKETS_PER_HOUR, rateLimitMessage, parseRateLimitError } from "./support-rate-limit";

describe("parseRateLimitError", () => {
  // O trigger levanta `rate_limit_chamados:<HH:MM>`. O marcador existe para o
  // cliente não ter que casar a mensagem inteira, que muda quando alguém a
  // reescreve.
  it("reconhece o erro do trigger e extrai o horário", () => {
    expect(parseRateLimitError(new Error("rate_limit_chamados:15:04"))).toEqual({
      limited: true,
      nextAt: "15:04",
    });
  });

  it("reconhece o erro mesmo com prefixo do PostgREST", () => {
    const err = new Error("new row violates check: rate_limit_chamados:09:30");
    expect(parseRateLimitError(err)).toEqual({ limited: true, nextAt: "09:30" });
  });

  it("um erro qualquer não é rate limit", () => {
    expect(parseRateLimitError(new Error("permission denied"))).toEqual({ limited: false });
  });

  it("não lança com um valor que não é Error", () => {
    expect(parseRateLimitError("string solta")).toEqual({ limited: false });
    expect(parseRateLimitError(null)).toEqual({ limited: false });
    expect(parseRateLimitError(undefined)).toEqual({ limited: false });
  });

  // Sem horário, ainda é rate limit — só não sabemos dizer quando.
  it("aceita o marcador sem horário", () => {
    expect(parseRateLimitError(new Error("rate_limit_chamados"))).toEqual({
      limited: true,
      nextAt: null,
    });
  });
});

describe("rateLimitMessage", () => {
  it("diz quantos e quando", () => {
    expect(rateLimitMessage("15:04")).toContain("15:04");
    expect(rateLimitMessage("15:04")).toContain(String(TICKETS_PER_HOUR));
  });

  // Um usuario autenticado de um tenant pagante nao e spammer: e gente com
  // problema. A mensagem oferece a saida, nao acusa.
  it("oferece comentar num chamado existente", () => {
    expect(rateLimitMessage("15:04").toLowerCase()).toContain("chamado");
  });

  it("funciona sem horário", () => {
    expect(rateLimitMessage(null)).toContain(String(TICKETS_PER_HOUR));
    expect(rateLimitMessage(null)).not.toContain("null");
  });

  it("o limite é 5 por hora", () => {
    expect(TICKETS_PER_HOUR).toBe(5);
  });
});
