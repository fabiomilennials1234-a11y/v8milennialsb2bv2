/**
 * A tradução das recusas da Meta.
 *
 * O texto original é escrito para quem integra, não para quem vende. Estes dois
 * chegaram em produção no mesmo dia, na mesma conversa, e pedem ações opostas:
 *
 *   "(#132012) Parameter format does not match format in the created template…"
 *      → anexar a imagem do cabeçalho
 *   "(#131026) Message Undeliverable."
 *      → corrigir o telefone do lead
 */
import { describe, expect, it } from "vitest";

import { traduzirRecusaDaMeta } from "@/modules/communication/lib/meta-send-errors";

describe("traduzirRecusaDaMeta", () => {
  it("132012 vira 'faltou parâmetro', com o caminho de conserto", () => {
    const r = traduzirRecusaDaMeta("132012", "(#132012) Parameter format does not match…");

    expect(r?.mensagem).toContain("Faltou um parâmetro");
    expect(r?.acao).toContain("seletor de template");
    expect(r?.codigo).toBe("132012");
  });

  it("131026 aponta para o TELEFONE, não para o envio", () => {
    // O erro não é de formato: o número não existe no WhatsApp. Mandar o vendedor
    // reenviar seria mandá-lo repetir o mesmo nada.
    const r = traduzirRecusaDaMeta("131026", "(#131026) Message Undeliverable.");

    expect(r?.mensagem).toContain("não recebe mensagens");
    expect(r?.acao).toContain("telefone");
  });

  it("código desconhecido devolve o texto do fornecedor, sem inventar", () => {
    // Frase amigável para código que não conhecemos seria adivinhar em nome da
    // Meta — e mandar consertar a coisa errada.
    const r = traduzirRecusaDaMeta("999999", "(#999999) Something new happened");

    expect(r?.mensagem).toBe("(#999999) Something new happened");
    expect(r?.acao).toBeUndefined();
    expect(r?.codigo).toBe("999999");
  });

  it("sem código, o texto cru ainda passa", () => {
    expect(traduzirRecusaDaMeta(null, "erro sem código")?.mensagem).toBe("erro sem código");
  });

  it("sem nada, devolve null — a bolha não desenha linha vazia", () => {
    expect(traduzirRecusaDaMeta(null, null)).toBeNull();
    expect(traduzirRecusaDaMeta("", "   ")).toBeNull();
  });

  it("o código sobrevive à tradução — é ele que acha a mensagem em prod", () => {
    expect(traduzirRecusaDaMeta("131053", "qualquer coisa")?.codigo).toBe("131053");
  });
});
