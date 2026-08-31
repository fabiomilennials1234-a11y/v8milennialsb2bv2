/**
 * Tests for _shared/erp/toth-flow-client.ts — o serviço de PEDIDOS do Toth.
 *
 * O serviço real está inalcançável de fora da rede do cliente (a porta 3000
 * aceita a conexão TCP e fecha sem devolver um byte de HTTP, medido em 28/08),
 * então estes testes são a única prova que existe do transporte. Foco no que
 * separa este client do `TothClient` e no que o fornecedor NÃO documentou:
 * envelope `{success,data}`, token em Bearer, expiração legível no JWT, e o
 * `success:false` dentro de um HTTP 200.
 */
import { describe, it, expect, vi } from "vitest";
import {
  TothFlowClient,
  readJwtExpiry,
  extractFlowError,
  isFlowAuthError,
  scrubCredentials,
} from "../../supabase/functions/_shared/erp/toth-flow-client";
import {
  TothAuthError,
  TothRequestError,
} from "../../supabase/functions/_shared/erp/toth-client";

const BASE = "https://erp.exemplo.com.br/flow/crm";
const CREDS = { baseUrl: BASE, clientId: "usuario", clientSecret: "senha" };

function res(body: unknown, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

function fakeFetch(responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("chamada além do esperado");
    return Promise.resolve(next);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** JWT sintético — só o payload importa, a assinatura nunca é verificada. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.assinatura`;
}

const OK_LOGIN = (token = "T1") => res({ success: true, data: token, elapsed: 86, count: 1 });

describe("login", () => {
  it("posta client_id/client_secret como JSON em /auth", async () => {
    const { impl, calls } = fakeFetch([OK_LOGIN()]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });

    await client.login();

    expect(calls[0].url).toBe("https://erp.exemplo.com.br/flow/crm/auth");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      client_id: "usuario",
      client_secret: "senha",
    });
  });

  it("lê o token de `data`, não de `token`", async () => {
    const { impl } = fakeFetch([OK_LOGIN("JWT-AQUI")]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });
    await expect(client.login()).resolves.toBe("JWT-AQUI");
  });

  it("recusa login que responde 200 com success:false", async () => {
    const { impl } = fakeFetch([res({ success: false, error: "credencial inválida" })]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });
    await expect(client.login()).rejects.toBeInstanceOf(TothAuthError);
  });

  it("não ecoa o corpo do login na mensagem de erro — ele carrega o token", async () => {
    const { impl } = fakeFetch([res({ data: "TOKEN-SECRETO" }, 500)]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });
    await expect(client.login()).rejects.toThrow(/HTTP 500/);
    await expect(
      new TothFlowClient(CREDS, { fetchImpl: fakeFetch([res({ data: "X" }, 500)]).impl }).login(),
    ).rejects.not.toThrow(/TOKEN-SECRETO/);
  });

  it("explica porta publicada quando o host não devolve nada", async () => {
    const impl = vi.fn(() => Promise.reject(new Error("connection closed"))) as unknown as typeof fetch;
    const client = new TothFlowClient(
      { ...CREDS, baseUrl: "https://erp.exemplo.com.br:3000/flow/crm" },
      { fetchImpl: impl },
    );
    await expect(client.login()).rejects.toThrow(/porta 3000 está publicada/);
  });
});

describe("postEnvelope", () => {
  it("manda o token em Authorization: Bearer, nunca na query", async () => {
    const { impl, calls } = fakeFetch([
      OK_LOGIN("T1"),
      res({ success: true, data: [], page: 1, hasNext: false }),
    ]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });

    await client.postEnvelope("pedidos", { page: 1 });

    const headers = calls[1].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer T1");
    expect(calls[1].url).not.toContain("token=");
    expect(calls[1].url).toBe("https://erp.exemplo.com.br/flow/crm/pedidos");
  });

  it("devolve o envelope inteiro — `hasNext` vive FORA de `data`", async () => {
    const { impl } = fakeFetch([
      OK_LOGIN(),
      res({ success: true, data: [{ numeropedido: "1" }], page: 2, hasNext: true }),
    ]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });

    const envelope = await client.postEnvelope("pedidos", { page: 2 });
    expect(envelope.hasNext).toBe(true);
    expect(envelope.page).toBe(2);
    expect(Array.isArray(envelope.data)).toBe(true);
  });

  it("reautentica UMA vez em 401 e repete a chamada", async () => {
    const { impl, calls } = fakeFetch([
      OK_LOGIN("VELHO"),
      res({ error: "unauthorized" }, 401),
      OK_LOGIN("NOVO"),
      res({ success: true, data: [], hasNext: false }),
    ]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });

    await client.postEnvelope("pedidos", { page: 1 });

    expect(calls).toHaveLength(4);
    expect((calls[3].init.headers as Record<string, string>).Authorization).toBe("Bearer NOVO");
  });

  it("desiste quando o token continua recusado depois de reautenticar", async () => {
    const { impl } = fakeFetch([
      OK_LOGIN(),
      res({}, 403),
      OK_LOGIN(),
      res({}, 403),
    ]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });
    await expect(client.postEnvelope("pedidos", {})).rejects.toBeInstanceOf(TothAuthError);
  });

  it("trata success:false COM cara de auth como expiração, e reautentica", async () => {
    const { impl, calls } = fakeFetch([
      OK_LOGIN(),
      res({ success: false, error: "token expirado" }),
      OK_LOGIN("NOVO"),
      res({ success: true, data: [], hasNext: false }),
    ]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });

    await client.postEnvelope("pedidos", {});
    expect(calls).toHaveLength(4);
  });

  it("trata success:false SEM cara de auth como erro de chamada, sem reautenticar", async () => {
    const { impl, calls } = fakeFetch([
      OK_LOGIN(),
      res({ success: false, error: "dataInicial obrigatória" }),
    ]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });

    await expect(client.postEnvelope("pedidos", {})).rejects.toBeInstanceOf(TothRequestError);
    expect(calls).toHaveLength(2);
  });

  it("recusa 200 cujo corpo não é o envelope combinado", async () => {
    const { impl } = fakeFetch([OK_LOGIN(), res([{ numeropedido: "1" }])]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });
    await expect(client.postEnvelope("pedidos", {})).rejects.toThrow(/envelope/);
  });
});

describe("expiração do JWT", () => {
  it("renova preventivamente quando `exp` já passou", async () => {
    const agora = 1_700_000_000_000;
    const vencido = jwt({ exp: Math.floor(agora / 1000) - 10 });
    const { impl, calls } = fakeFetch([
      OK_LOGIN(vencido),
      OK_LOGIN("NOVO"),
      res({ success: true, data: [], hasNext: false }),
    ]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl, now: () => agora });

    await client.login();
    await client.postEnvelope("pedidos", {});

    // 3 chamadas: login inicial, login novo (o token guardado já não serve), e
    // a leitura. Sem a checagem de `exp`, seriam 2 — com a primeira falhando.
    expect(calls).toHaveLength(3);
    expect((calls[2].init.headers as Record<string, string>).Authorization).toBe("Bearer NOVO");
  });

  it("token sem `exp` legível é usado até o servidor recusar", async () => {
    const { impl, calls } = fakeFetch([
      OK_LOGIN("nao-e-jwt"),
      res({ success: true, data: [], hasNext: false }),
    ]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });

    await client.login();
    await client.postEnvelope("pedidos", {});
    expect(calls).toHaveLength(2);
  });

  it("a margem de 60s cobre relógio dessincronizado", () => {
    const agora = 1_700_000_000_000;
    // exp daqui a 30 segundos: dentro da margem, tratado como vencido.
    const quaseVencido = jwt({ exp: Math.floor(agora / 1000) + 30 });
    expect(readJwtExpiry(quaseVencido)).toBe((Math.floor(agora / 1000) + 30) * 1000);
  });
});

describe("readJwtExpiry", () => {
  it("lê exp em milissegundos", () => {
    expect(readJwtExpiry(jwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000);
  });

  it("devolve null para o que não é JWT, em vez de estourar", () => {
    expect(readJwtExpiry("abc")).toBeNull();
    expect(readJwtExpiry("a.b.c")).toBeNull();
    expect(readJwtExpiry(jwt({ sub: "sem-exp" }))).toBeNull();
  });
});

describe("extractFlowError", () => {
  it("success:false sem texto ainda é erro", () => {
    expect(extractFlowError({ success: false })).toBeTruthy();
  });

  it("success:true sem erro é sucesso", () => {
    expect(extractFlowError({ success: true, data: [] })).toBeNull();
  });

  it("erro no corpo conta mesmo sem o campo success", () => {
    expect(extractFlowError({ error: "algo" })).toBe("algo");
  });
});

describe("isFlowAuthError", () => {
  it("reconhece as formas de dizer 'token'", () => {
    for (const m of ["Token expirado", "Unauthorized", "JWT inválido", "não autorizado"]) {
      expect(isFlowAuthError(m)).toBe(true);
    }
  });

  it("não confunde erro de negócio com expiração", () => {
    expect(isFlowAuthError("dataInicial obrigatória")).toBe(false);
  });
});

/**
 * 🔒 O token do Flow viaja em `Authorization: Bearer`, e a mensagem de erro
 * desta função acaba em `toth_connections.last_error` — coluna que a policy
 * `toth_connections_member_select` deixa **qualquer membro da org** ler.
 *
 * Servidor de aplicação que devolve 5xx costuma despejar os cabeçalhos da
 * requisição na página de erro. Sem o filtro, esse caminho tira um segredo de
 * um cofre deny-all decifrável só por `service_role` e o entrega para a tela de
 * qualquer vendedor. É a diferença de risco em relação ao `TothClient`, onde o
 * token vai na query e a query nunca entra em mensagem.
 */
describe("scrubCredentials", () => {
  it("apaga o header Authorization inteiro", () => {
    expect(scrubCredentials("Authorization: Bearer eyJhbG.eyJzdWIi.zzz")).not.toMatch(/eyJ/);
  });

  it("apaga Bearer solto, em qualquer caixa", () => {
    expect(scrubCredentials("usou bearer abc123DEF-_= aqui")).toBe(
      "usou Bearer [removido] aqui",
    );
  });

  it("apaga JWT que aparece sozinho no texto", () => {
    const t = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-_123";
    expect(scrubCredentials(`falhou com ${t} no meio`)).toBe("falhou com [jwt removido] no meio");
  });

  it("não estraga texto sem credencial", () => {
    expect(scrubCredentials("dataInicial obrigatória")).toBe("dataInicial obrigatória");
  });
});

describe("🔒 vazamento de token em resposta de erro", () => {
  it("5xx que ecoa o header NÃO leva o token para a mensagem", async () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYWZlIn0.assinatura";
    const paginaDeErro =
      "<html><body>Exception report<br>Request headers: " +
      `Authorization: Bearer ${token}</body></html>`;
    const { impl } = fakeFetch([OK_LOGIN(token), res(paginaDeErro, 500)]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });

    await expect(client.postEnvelope("pedidos", {})).rejects.toThrow(/HTTP 500/);
    await expect(client.postEnvelope("pedidos", {})).rejects.not.toThrow(/eyJ/);
  });

  it("erro do envelope que cita o token também é filtrado", async () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.zzz";
    const { impl } = fakeFetch([
      OK_LOGIN(token),
      res({ success: false, error: `pedido malformado para ${token}` }),
    ]);
    const client = new TothFlowClient(CREDS, { fetchImpl: impl });

    await expect(client.postEnvelope("pedidos", {})).rejects.not.toThrow(/eyJ/);
  });
});
