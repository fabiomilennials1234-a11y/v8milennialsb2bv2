import { describe, it, expect } from "vitest";
import {
  resolveScreen,
  isTerminal,
  resolvePaymentScreen,
  pixBloqueado,
  trilhaDoCartao,
} from "@/modules/billing/lib/checkout-state";

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

describe("resolvePaymentScreen — os estados de pagamento", () => {
  const base = { targetKind: "new_org" as const, metodo: null, status: "pending" as const };

  it("sem método escolhido não há tela de pagamento — a página continua no pedido", () => {
    expect(resolvePaymentScreen(base)).toBeNull();
  });

  it("Pix escolhido e pendente é a tela do Pix", () => {
    expect(resolvePaymentScreen({ ...base, metodo: "pix" })).toBe("pix");
  });

  it("cartão escolhido, ANTES de sair, mostra a trilha inteira — o cliente vê os três passos antes de clicar", () => {
    expect(resolvePaymentScreen({ ...base, metodo: "credit_card" })).toBe("cartao_antes");
  });

  it("voltou do componente hospedado SEM cobrança criada é o estado 06 — não é erro, é desistência no meio", () => {
    expect(resolvePaymentScreen({
      ...base, metodo: "credit_card", voltouSemConcluir: true, cobrancaCriada: false,
    })).toBe("cartao_incompleto");
  });

  it("voltou COM cobrança criada é ANÁLISE, não incompleto — há dinheiro em processo, e sem essa distinção o estado 05 seria inalcançável", () => {
    expect(resolvePaymentScreen({
      ...base, metodo: "credit_card", voltouSemConcluir: true, cobrancaCriada: true,
    })).toBe("cartao_analise");
  });

  it("PRECEDÊNCIA: pagou vence 'voltou sem concluir' — senão a tela contradiz o extrato do cliente", () => {
    expect(resolvePaymentScreen({
      ...base, metodo: "credit_card", status: "paid", voltouSemConcluir: true, cobrancaCriada: false,
    })).toBe("aprovado_nova");
  });

  it("o ALVO decide qual tela de aprovado — new_org promete empresa criada, existing_org promete que nada mudou", () => {
    expect(resolvePaymentScreen({ ...base, status: "paid" })).toBe("aprovado_nova");
    expect(resolvePaymentScreen({ ...base, targetKind: "existing_org", status: "paid" })).toBe("aprovado_existente");
  });

  it("alvo DESCONHECIDO cai no caminho conservador — o que NÃO promete criação de empresa", () => {
    expect(resolvePaymentScreen({ ...base, targetKind: "alvo_novo_do_futuro", status: "paid" })).toBe("aprovado_existente");
  });

  it("recusado tem tela própria, em qualquer método", () => {
    expect(resolvePaymentScreen({ ...base, metodo: "pix", status: "failed" })).toBe("recusado");
    expect(resolvePaymentScreen({ ...base, metodo: "credit_card", status: "failed" })).toBe("recusado");
  });

  it("expirado NÃO produz tela de pagamento — quem manda é a proposta, e dois donos para a mesma decisão é como ela diverge", () => {
    expect(resolvePaymentScreen({ ...base, metodo: "pix", status: "expired" })).toBeNull();
  });
});

describe("pixBloqueado — leitura da regra do motor, não uma segunda cópia", () => {
  it("Pix vale a partir do semestral", () => {
    expect(pixBloqueado("semiannual")).toBe(false);
    expect(pixBloqueado("annual")).toBe(false);
  });

  it("mensal bloqueia — não existe cobrança automática todo mês no Pix", () => {
    expect(pixBloqueado("monthly")).toBe(true);
  });

  it("ciclo DESCONHECIDO bloqueia — oferecer método que o servidor vai recusar é pior que esconder um que ele aceitaria", () => {
    expect(pixBloqueado("trimestral_do_futuro")).toBe(true);
    expect(pixBloqueado(null)).toBe(true);
    expect(pixBloqueado(undefined)).toBe(true);
  });
});

describe("trilhaDoCartao — a mesma trilha, adiantada", () => {
  it("antes de sair, os três passos pendentes", () => {
    expect(trilhaDoCartao("cartao_antes")).toEqual(["pendente", "pendente", "pendente"]);
  });

  it("no retorno interrompido o passo 1 é NEUTRO, nunca um X — o cliente não errou", () => {
    expect(trilhaDoCartao("cartao_incompleto")[0]).toBe("neutro");
  });

  it("em análise, os dois primeiros feitos e o terceiro em andamento", () => {
    expect(trilhaDoCartao("cartao_analise")).toEqual(["feito", "feito", "andamento"]);
  });

  it("aprovado fecha os três, nos dois alvos", () => {
    expect(trilhaDoCartao("aprovado_nova")).toEqual(["feito", "feito", "feito"]);
    expect(trilhaDoCartao("aprovado_existente")).toEqual(["feito", "feito", "feito"]);
  });

  it("é SEMPRE a mesma trilha de três passos — comprimento diferente entre momentos faria o retorno parecer tela nova", () => {
    const momentos = ["cartao_antes", "cartao_analise", "cartao_incompleto", "aprovado_nova"] as const;
    expect(momentos.map(m => trilhaDoCartao(m).length)).toEqual([3, 3, 3, 3]);
  });

  it("tela sem trilha não inventa passos", () => {
    expect(trilhaDoCartao("pix")).toEqual([]);
    expect(trilhaDoCartao(null)).toEqual([]);
  });
});
