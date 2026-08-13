/**
 * Trava a regra INEGOCIÁVEL de origem do `postMessage` do Seamless.
 *
 * `window.postMessage` não tem porteiro: qualquer aba que o usuário abra pode
 * postar na nossa janela dizendo `{status:"channel-success"}`. A única coisa que
 * separa "o NotificaMe concluiu" de "um site hostil disse que concluiu" é o
 * `event.origin` — e ele só serve se a comparação for por IGUALDADE ESTRITA.
 *
 * O precedente `useConnectWhatsAppCloud.ts:131` compara com
 * `event.origin.endsWith("facebook.com")`. Traduzido para cá, `endsWith(
 * "notificame.com.br")` aceitaria `https://evil-notificame.com.br` — domínio que
 * qualquer um registra por R$40. Os casos marcados «endsWith passaria» abaixo são
 * exatamente os que ficam VERMELHOS se alguém voltar àquela forma.
 *
 * Consequência de aceitar uma mensagem forjada: o front chama
 * `notificame-channel-finish`, que vincula à org do atacante o próximo canal
 * livre da NOSSA conta-mãe — o canal de outro cliente.
 */
import { describe, it, expect } from "vitest";
import {
  NOTIFICAME_ORIGIN,
  readSeamlessMessage,
  seamlessOriginFromStartUrl,
} from "@/modules/communication/lib/notificame-message";

const OK = NOTIFICAME_ORIGIN;

describe("NOTIFICAME_ORIGIN", () => {
  it("é a origem exata e com TLS do popup (contrato verificado)", () => {
    expect(NOTIFICAME_ORIGIN).toBe("https://api.notificame.com.br");
    // Origem NUNCA tem barra final nem caminho — se ganhar, a comparação estrita
    // passa a rejeitar tudo e a feature morre em silêncio.
    expect(NOTIFICAME_ORIGIN.endsWith("/")).toBe(false);
  });
});

// ── Origem forjada (o teste obrigatório) ─────────────────────────────────────

describe("readSeamlessMessage — origem", () => {
  const FORJADAS = [
    // «endsWith("notificame.com.br") passaria» — o furo do precedente.
    "https://evil-notificame.com.br",
    "https://api-notificame.com.br",
    "https://notificame.com.br.evil.io",
    // sufixo depois do host legítimo
    "https://api.notificame.com.br.evil.io",
    // «startsWith/includes passariam»
    "https://api.notificame.com.br.attacker.test",
    "https://attacker.test/?u=https://api.notificame.com.br",
    // sem TLS: mesma string, esquema diferente
    "http://api.notificame.com.br",
    // porta diferente é outra origem
    "https://api.notificame.com.br:8443",
    // subdomínio irmão — mesmo backend, mas não é a origem contratada
    "https://hub.notificame.com.br",
    // barra final não é origem válida
    "https://api.notificame.com.br/",
    "null",
    "",
  ];

  it.each(FORJADAS)(
    "IGNORA channel-success vindo de %s",
    (origin) => {
      expect(readSeamlessMessage({ origin, data: { status: "channel-success" } })).toBe("ignore");
      // também na forma string (JSON), que é a que o popup usa em alguns browsers
      expect(readSeamlessMessage({ origin, data: '{"status":"channel-success"}' })).toBe("ignore");
    },
  );

  it("ignora origin que nem string é (evento sintético / postMessage de extensão)", () => {
    for (const origin of [null, undefined, 42, {}, ["https://api.notificame.com.br"]]) {
      expect(readSeamlessMessage({ origin, data: { status: "channel-success" } })).toBe("ignore");
    }
  });

  it("CONTROLE POSITIVO: a origem legítima é aceita", () => {
    // Sem esta asserção, todo o bloco acima passaria numa função que devolve
    // 'ignore' para tudo — verde por ausência.
    expect(readSeamlessMessage({ origin: OK, data: { status: "channel-success" } })).toBe("success");
  });
});

// ── Origem DERIVADA da mesma fonte que a base do fornecedor ──────────────────
//
// A base é configurável por env no servidor (`NOTIFICAME_BASE_URL`) e é dela que
// sai a `start_url` do popup. Com a origem esperada presa numa constante, apontar
// a base para outro host faria TODO postMessage legítimo virar 'ignore' — conexão
// morrendo em silêncio, sem erro no console. Estes testes travam a derivação.

describe("seamlessOriginFromStartUrl", () => {
  it("extrai a origem da URL do popup, sem caminho nem querystring", () => {
    expect(
      seamlessOriginFromStartUrl("https://api.notificame.com.br/v2/oauth/meta/start?company=abc"),
    ).toBe("https://api.notificame.com.br");
  });

  it("acompanha um host alternativo (staging/mock) — o caso que a constante fixa quebrava", () => {
    expect(seamlessOriginFromStartUrl("https://hub.notificame.com.br/v2/oauth/meta/start")).toBe(
      "https://hub.notificame.com.br",
    );
    expect(seamlessOriginFromStartUrl("http://localhost:54321/v2/oauth/meta/start")).toBe(
      "http://localhost:54321",
    );
  });

  it("preserva a porta — porta diferente é outra origem", () => {
    expect(seamlessOriginFromStartUrl("https://api.notificame.com.br:8443/x")).toBe(
      "https://api.notificame.com.br:8443",
    );
  });

  it("nunca devolve origem com barra final", () => {
    expect(seamlessOriginFromStartUrl("https://api.notificame.com.br/")).toBe(
      "https://api.notificame.com.br",
    );
  });

  it("devolve null para entrada que não é URL absoluta com host", () => {
    for (const bad of [null, undefined, 42, {}, "", "   ", "/v2/oauth/meta/start", "not a url"]) {
      expect(seamlessOriginFromStartUrl(bad)).toBeNull();
    }
  });
});

describe("readSeamlessMessage — origem esperada injetada", () => {
  const ALT_START = "https://hub.notificame.com.br/v2/oauth/meta/start?company=abc";
  const ALT = seamlessOriginFromStartUrl(ALT_START)!;

  it("aceita a origem derivada da start_url que o servidor devolveu", () => {
    expect(readSeamlessMessage({ origin: ALT, data: { status: "channel-success" } }, ALT)).toBe(
      "success",
    );
  });

  it("com origem derivada, a origem PADRÃO deixa de ser aceita", () => {
    // Simetria: trocar a base não pode deixar o host antigo continuar valendo.
    expect(readSeamlessMessage({ origin: OK, data: { status: "channel-success" } }, ALT)).toBe(
      "ignore",
    );
  });

  it("segue estrito: vizinho do host derivado é rejeitado", () => {
    for (const forjada of [
      "https://evil-hub.notificame.com.br",
      "https://hub.notificame.com.br.evil.io",
      "http://hub.notificame.com.br",
      "https://hub.notificame.com.br:8443",
    ]) {
      expect(
        readSeamlessMessage({ origin: forjada, data: { status: "channel-success" } }, ALT),
      ).toBe("ignore");
    }
  });

  it("FAIL-CLOSED: origem esperada null/vazia não aceita NADA", () => {
    // Derivação falhou ⇒ não se sabe quem está falando. Cair no default aqui
    // reintroduziria o host fixo pela porta dos fundos.
    for (const expected of [null, ""]) {
      expect(
        readSeamlessMessage({ origin: OK, data: { status: "channel-success" } }, expected),
      ).toBe("ignore");
      expect(
        readSeamlessMessage({ origin: ALT, data: { status: "channel-success" } }, expected),
      ).toBe("ignore");
    }
  });

  it("omitir o parâmetro mantém o comportamento anterior (default)", () => {
    expect(readSeamlessMessage({ origin: OK, data: { status: "channel-success" } })).toBe("success");
  });
});

// ── status ───────────────────────────────────────────────────────────────────

describe("readSeamlessMessage — status", () => {
  it("channel-success (objeto ou string JSON) é sucesso", () => {
    expect(readSeamlessMessage({ origin: OK, data: { status: "channel-success" } })).toBe("success");
    expect(readSeamlessMessage({ origin: OK, data: '{"status":"channel-success"}' })).toBe("success");
  });

  it("QUALQUER outro status é FALHA declarada — nunca sucesso", () => {
    for (const status of ["error", "channel-error", "cancelled", "channel-success-ish", "CHANNEL-SUCCESS"]) {
      expect(readSeamlessMessage({ origin: OK, data: { status } })).toBe("failure");
      expect(readSeamlessMessage({ origin: OK, data: JSON.stringify({ status }) })).toBe("failure");
    }
  });

  it("mensagem sem status legível é ruído — ignora, não falha", () => {
    // 'ignore' e não 'failure': outras integrações postam na mesma janela
    // (React DevTools, Vite HMR, SDK do Facebook). Tratar ruído como falha
    // encerraria a conexão em curso com um toast vermelho mentiroso.
    expect(readSeamlessMessage({ origin: OK, data: {} })).toBe("ignore");
    expect(readSeamlessMessage({ origin: OK, data: { status: 1 } })).toBe("ignore");
    expect(readSeamlessMessage({ origin: OK, data: { status: null } })).toBe("ignore");
    expect(readSeamlessMessage({ origin: OK, data: null })).toBe("ignore");
    expect(readSeamlessMessage({ origin: OK, data: undefined })).toBe("ignore");
  });

  it("string que não é JSON é ignorada, sem lançar", () => {
    expect(() => readSeamlessMessage({ origin: OK, data: "webpackHotUpdate" })).not.toThrow();
    expect(readSeamlessMessage({ origin: OK, data: "webpackHotUpdate" })).toBe("ignore");
    expect(readSeamlessMessage({ origin: OK, data: "" })).toBe("ignore");
  });

  it("JSON válido que não é objeto não vira sucesso", () => {
    expect(readSeamlessMessage({ origin: OK, data: '"channel-success"' })).toBe("ignore");
    expect(readSeamlessMessage({ origin: OK, data: "123" })).toBe("ignore");
    expect(readSeamlessMessage({ origin: OK, data: '["channel-success"]' })).toBe("ignore");
  });
});
