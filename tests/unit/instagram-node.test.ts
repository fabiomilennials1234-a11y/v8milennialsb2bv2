// @vitest-environment node
/**
 * O que o nó de Instagram vai mandar — issue #1691.
 *
 * A regra mora fora do handler porque é onde estão as decisões que custam caro:
 * o que o Direct aceita, o que ele não tem, e o que nunca deve virar uma URL que
 * um terceiro vai buscar. Aqui elas são exercitadas sem banco e sem rede.
 */
import { describe, expect, it } from "vitest";

import { lerEnvioDoNoInstagram } from "../../supabase/functions/_shared/instagram-node.ts";

describe("o que o Direct aceita", () => {
  it("texto é o padrão — nó sem tipo declarado manda o que está escrito", () => {
    const r = lerEnvioDoNoInstagram({ metaMessage: "Olá {{nome}}!" });

    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ kind: "text", text: "Olá {{nome}}!" });
  });

  it("imagem, vídeo e áudio viram mídia no vocabulário do provider", () => {
    const tipos: Array<[string, string]> = [
      ["imagem", "image"],
      ["video", "video"],
      ["áudio", "audio"],
    ];

    for (const [naTela, noProvider] of tipos) {
      const r = lerEnvioDoNoInstagram({
        metaMessageType: naTela,
        metaMediaUrl: "https://cdn.exemplo.com/catalogo.bin",
      });

      expect(r.ok, `${naTela} deveria ser aceito`).toBe(true);
      expect(r).toMatchObject({ kind: "media", media: { type: noProvider } });
    }
  });

  it("sem legenda própria, o texto do nó vira a legenda do anexo", () => {
    // Mandar os dois separados entregaria a mesma frase duas vezes ao cliente:
    // uma solta e outra colada na imagem.
    const r = lerEnvioDoNoInstagram({
      metaMessageType: "imagem",
      metaMediaUrl: "https://cdn.exemplo.com/foto.jpg",
      metaMessage: "Segue o catálogo",
    });

    expect(r).toMatchObject({ kind: "media", media: { caption: "Segue o catálogo" } });
  });

  it("a legenda explícita ganha do texto do nó", () => {
    const r = lerEnvioDoNoInstagram({
      metaMessageType: "imagem",
      metaMediaUrl: "https://cdn.exemplo.com/foto.jpg",
      metaMessage: "texto solto",
      metaCaption: "a legenda de verdade",
    });

    expect(r).toMatchObject({ media: { caption: "a legenda de verdade" } });
  });
});

describe("o que o Direct NÃO tem — e a recusa precisa dizer o nome", () => {
  // ⚠️ O provider já recusa os dois. Deixar a recusa SÓ lá faria o gestor montar
  // o nó, publicar o workflow e descobrir no primeiro lead real — depois de a
  // execução parar. E o erro que ele leria seria `media_type_unsupported`, que
  // manda abrir chamado em vez de trocar o campo.
  it("documento é recusado pelo nome, não por um código", () => {
    const r = lerEnvioDoNoInstagram({
      metaMessageType: "documento",
      metaMediaUrl: "https://cdn.exemplo.com/tabela.pdf",
    });

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: "tipo_fora_do_direct" });
    expect((r as { error: string }).error).toContain("documento");
  });

  it("figurinha é recusada pelo nome", () => {
    const r = lerEnvioDoNoInstagram({
      metaMessageType: "figurinha",
      metaMediaUrl: "https://cdn.exemplo.com/s.webp",
    });

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: "tipo_fora_do_direct" });
    expect((r as { error: string }).error).toContain("figurinha");
  });

  it("o nó não manda por Messenger, mesmo com o campo legado preenchido", () => {
    // `metaChannel` sobrou da rota da Meta direta. Silenciosamente virar
    // Instagram mandaria a mensagem pela caixa errada da empresa.
    const r = lerEnvioDoNoInstagram({ metaChannel: "facebook", metaMessage: "oi" });

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: "canal_nao_suportado" });
  });
});

describe("o que não sai daqui", () => {
  it("nó sem mensagem nenhuma não vira envio vazio", () => {
    const r = lerEnvioDoNoInstagram({ metaMessage: "   " });

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: "mensagem_vazia" });
  });

  it("mídia sem URL não vira envio", () => {
    const r = lerEnvioDoNoInstagram({ metaMessageType: "video", metaMediaUrl: "" });

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: "midia_url_invalida" });
  });

  it("endereço interno NUNCA vira anexo — quem busca o arquivo é o fornecedor", () => {
    // SSRF com executor emprestado: a URL é escolhida pelo cliente, mas o pedido
    // sai da rede e da reputação do fornecedor.
    for (const url of [
      "http://cdn.exemplo.com/a.jpg",
      "https://10.0.0.4/a.jpg",
      "https://localhost/a.jpg",
      "https://metadata.internal/a.jpg",
    ]) {
      const r = lerEnvioDoNoInstagram({ metaMessageType: "imagem", metaMediaUrl: url });
      expect(r.ok, `${url} não podia passar`).toBe(false);
      expect(r).toMatchObject({ code: "midia_url_invalida" });
    }
  });
});
