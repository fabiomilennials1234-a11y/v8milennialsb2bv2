// @vitest-environment node
/**
 * A REGRA COMPOSTA DO NÓ DE TEXTO — issue #1689.
 *
 * Três linhas e nada mais: janela aberta manda texto, janela fechada com
 * template manda template, janela fechada sem template falha com motivo
 * legível. O arquivo existe para que essa tabela seja LIDA — se ela deixar de
 * caber num teste curto, é sinal de que a decisão voltou a se espalhar.
 *
 * Puro de ponta a ponta: sem banco, sem provedor, sem relógio. O estado da
 * janela entra como dado, e é isso que permite exercitar o caso caro — janela
 * fechada — sem esperar 24 horas nem forjar um contato.
 *
 * ⚠️ O CHIP UAZAPI NÃO APARECE AQUI DE PROPÓSITO. Este módulo não conhece
 * provedor nenhum: quem escopa a janela ao canal oficial é o governor, e é ele
 * quem nunca emite o motivo para um chip. A prova de que o chip segue idêntico
 * está no teste de comportamento do nó, não nesta tabela.
 */
import { describe, expect, it } from "vitest";

import {
  decidirEnvioDoNoDeTexto,
  escapeConfigurado,
  IDIOMA_PADRAO,
  janelaPeloErroDoTransporte,
  MOTIVO_JANELA_FECHADA,
  MOTIVO_LEGIVEL_SEM_ESCAPE,
} from "../../supabase/functions/_shared/decisao-de-envio.ts";

const ESCAPE = {
  name: "retomada_agosto",
  language: "pt_BR",
  components: [{ type: "BODY", text: "Olá {{1}}" }],
  variables: { "1": "{{nome}}" },
  headerMediaUrl: null,
};

describe("a tabela de três linhas", () => {
  it("janela aberta: manda o texto, com ou sem escape configurado", () => {
    expect(decidirEnvioDoNoDeTexto({ janela: "aberta_ou_sem_janela", escape: null }))
      .toEqual({ acao: "texto" });
    expect(decidirEnvioDoNoDeTexto({ janela: "aberta_ou_sem_janela", escape: ESCAPE }))
      .toEqual({ acao: "texto" });
  });

  it("janela fechada com escape: manda o template", () => {
    const d = decidirEnvioDoNoDeTexto({ janela: "fechada", escape: ESCAPE });
    expect(d.acao).toBe("template");
    if (d.acao !== "template") throw new Error("inalcançável");
    expect(d.escape.name).toBe("retomada_agosto");
    expect(d.escape.variables).toEqual({ "1": "{{nome}}" });
  });

  it("janela fechada sem escape: falha, e o motivo é legível para quem opera", () => {
    const d = decidirEnvioDoNoDeTexto({ janela: "fechada", escape: null });
    expect(d).toEqual({ acao: "falhar", motivo: MOTIVO_LEGIVEL_SEM_ESCAPE });
    // Não é código de erro: é frase, em português, que diz o que fazer.
    expect(MOTIVO_LEGIVEL_SEM_ESCAPE).toMatch(/janela de 24h fechada/i);
    expect(MOTIVO_LEGIVEL_SEM_ESCAPE).toMatch(/template de escape/i);
  });
});

describe("o que conta como escape configurado", () => {
  it("o nome é o que decide — sem ele não há o que a Meta referencie", () => {
    expect(escapeConfigurado(null)).toBeNull();
    expect(escapeConfigurado({})).toBeNull();
    expect(escapeConfigurado({ language: "pt_BR", variables: { "1": "x" } })).toBeNull();
  });

  it("campo tocado e apagado não vale como configuração", () => {
    expect(escapeConfigurado({ name: "   " })).toBeNull();
  });

  it("idioma ausente cai no padrão em vez de ir vazio para a Meta", () => {
    expect(escapeConfigurado({ name: "t" })?.language).toBe(IDIOMA_PADRAO);
    expect(escapeConfigurado({ name: "t", language: "  " })?.language).toBe(IDIOMA_PADRAO);
  });

  it("mídia em branco significa 'use o arquivo que veio aprovado', não string vazia", () => {
    expect(escapeConfigurado({ name: "t", headerMediaUrl: "  " })?.headerMediaUrl).toBeNull();
    expect(escapeConfigurado({ name: "t", headerMediaUrl: "https://x/y.jpg" })?.headerMediaUrl)
      .toBe("https://x/y.jpg");
  });

  it("componentes ausentes viram lista vazia — o envio não pode receber undefined", () => {
    expect(escapeConfigurado({ name: "t" })?.components).toEqual([]);
  });
});

describe("o que conta como janela fechada", () => {
  it("só o bloqueio explícito do governor", () => {
    expect(janelaPeloErroDoTransporte(`governor_block:${MOTIVO_JANELA_FECHADA}`))
      .toBe("fechada");
    // O handler prefixa a falha antes de propagá-la; o casamento sobrevive.
    expect(janelaPeloErroDoTransporte(
      `WhatsApp send failed: governor_block:${MOTIVO_JANELA_FECHADA}`,
    )).toBe("fechada");
  });

  it("outra falha do governor NÃO é janela", () => {
    expect(janelaPeloErroDoTransporte("governor_block:quarantined"))
      .toBe("aberta_ou_sem_janela");
    expect(janelaPeloErroDoTransporte("governor_defer:per_number_cap"))
      .toBe("aberta_ou_sem_janela");
  });

  it("falha comum do envio NÃO é janela — não se gasta template com número morto", () => {
    for (const erro of [
      "Invalid phone",
      "instance not available",
      "provider notificame returned 500",
      null,
      undefined,
      "",
    ]) {
      expect(janelaPeloErroDoTransporte(erro)).toBe("aberta_ou_sem_janela");
    }
  });

  it("a MENÇÃO ao motivo dentro de um texto qualquer não vale como bloqueio", () => {
    // O fornecedor pode ecoar a expressão numa mensagem de erro dele. Sem a
    // âncora `governor_<ação>:`, o nó escaparia para template por coincidência
    // — e gastaria um template aprovado para responder a outro problema.
    expect(janelaPeloErroDoTransporte(
      `Meta recusou: message failed, ${MOTIVO_JANELA_FECHADA} suspected`,
    )).toBe("aberta_ou_sem_janela");
  });
});
