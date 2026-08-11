import { describe, it, expect } from "vitest";
import { resolveScreen, isTerminal } from "@/modules/billing/lib/checkout-state";

describe("resolveScreen — tradução da porta pública em estado de tela", () => {
  it("link válido com pedido vira a tela do pedido", () => {
    expect(resolveScreen({ state: "valid", link: { amount_cents: 19900 } })).toBe("pedido");
  });

  it("os quatro estados inválidos têm tela própria, e não uma tela de erro genérica", () => {
    expect(resolveScreen({ state: "expired" })).toBe("expirado");
    expect(resolveScreen({ state: "already_paid" })).toBe("usado");
    expect(resolveScreen({ state: "revoked" })).toBe("revogado");
    expect(resolveScreen({ state: "not_found" })).toBe("nao_encontrado");
  });

  it("ESTADO NOVO da porta não quebra a tela — cai no fallback", () => {
    // Combinado com a porta pública: ela pode ADICIONAR estado sem nos avisar,
    // em troca de não mandar copy. Sem este fallback, o dia que ela evoluísse a
    // página de pagamento renderizaria nada.
    expect(resolveScreen({ state: "chargeback_em_disputa" })).toBe("indisponivel");
  });

  it("link válido SEM o objeto do pedido é indisponível, não pedido vazio", () => {
    // Renderizar a moldura do checkout sem preço é pior que assumir a falha:
    // o cliente ficaria olhando um valor que não existe.
    expect(resolveScreen({ state: "valid" })).toBe("indisponivel");
  });

  it("resposta ausente ou malformada não explode", () => {
    expect(resolveScreen(null)).toBe("indisponivel");
    expect(resolveScreen(undefined)).toBe("indisponivel");
    expect(resolveScreen({} as never)).toBe("indisponivel");
    expect(resolveScreen({ state: 42 } as never)).toBe("indisponivel");
  });
});

describe("isTerminal — onde não faz sentido pedir status", () => {
  it("os quatro desfechos fechados são terminais", () => {
    expect(isTerminal("expirado")).toBe(true);
    expect(isTerminal("usado")).toBe(true);
    expect(isTerminal("revogado")).toBe(true);
    expect(isTerminal("nao_encontrado")).toBe(true);
  });

  it("pedido NÃO é terminal — é exatamente onde o polling precisa rodar", () => {
    expect(isTerminal("pedido")).toBe(false);
    expect(isTerminal("carregando")).toBe(false);
  });

  it("indisponível não é terminal: a falha pode ser transitória e o retry é legítimo", () => {
    expect(isTerminal("indisponivel")).toBe(false);
  });
});
